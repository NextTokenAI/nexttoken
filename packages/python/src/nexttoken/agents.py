"""NextToken Agents client — programmatic agent invocation.

Two entry points, one HTTP backend (`POST /agents/runs`):

  1. **Multi-turn** via a session handle:

         agent = client.agents.create(workspace=ws, model="gpt-5")
         run = agent.send("Analyze inputs/data.csv and write a report.")
         result = run.wait()
         # follow-up reuses the conversation
         agent.send("Now add a YoY comparison.").wait()

  2. **One-shot** for callers who already have IDs:

         result = client.agents.run(
             "Summarize key findings",
             workspace_id=ws.id,
             conversation_id=existing_conv_id,
         )

  3. **Reattach** to an existing server-side run (e.g. after process restart):

         run = client.agents.get_run("run_abc123")
         result = run.wait()

The `Run` object is a server-side handle (just identifiers + a back-ref
to the client). It survives client crashes — pickle the `run_id` and
keep polling later from a different process.
"""

from __future__ import annotations

import json as _json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Union

import requests


# Statuses that mean the run is finished (any direction).
_TERMINAL_STATUSES = frozenset(
    {"completed", "failed", "timeout", "cancelled"}
)

# Server-side `max_wait` cap on the long-poll endpoint. Each `wait()` round-trip
# uses at most this many seconds; the client loops until the caller's overall
# timeout (or forever, if None).
_LONG_POLL_MAX_WAIT_SECONDS = 30


@dataclass
class RunEvent:
    """A single event from `Run.stream()`.

    Two event types are emitted by the server:
      * ``message`` — an agent message. ``data`` is the message JSON
        (see ``RunResult.messages`` for the shape).
      * ``terminal`` — sent once when the run reaches a terminal state.
        ``data`` includes ``status``, ``final_text``, ``error``, etc.
    """

    type: str       # "message" | "terminal"
    id: Optional[str]
    data: Dict[str, Any]


@dataclass
class RunResult:
    """Terminal state of an agent run."""

    run_id: str
    workspace_id: str
    conversation_id: str
    status: str  # one of: completed | failed | timeout | cancelled
    final_text: Optional[str]
    messages: List[Dict[str, Any]]
    usage_estimate: Optional[Dict[str, Any]]  # may be None in MVP
    duration_ms: Optional[int]
    error: Optional[str]
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    @classmethod
    def _from_response(cls, data: Dict[str, Any]) -> "RunResult":
        return cls(
            run_id=data["run_id"],
            workspace_id=data["workspace_id"],
            conversation_id=data["conversation_id"],
            status=data["status"],
            final_text=data.get("final_text"),
            messages=data.get("messages") or [],
            usage_estimate=data.get("usage_estimate"),
            duration_ms=data.get("duration_ms"),
            error=data.get("error"),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
        )


class Run:
    """Server-side run handle. Lightweight: stores identifiers + a
    back-reference to the client. Every method makes an HTTP call.

    `wait()` uses the server's long-poll endpoint
    (`?wait_for_terminal=true&max_wait=30`) to avoid polling floods.
    """

    def __init__(
        self,
        *,
        run_id: str,
        workspace_id: str,
        conversation_id: str,
        client: "Agents",
    ):
        self.run_id = run_id
        self.workspace_id = workspace_id
        self.conversation_id = conversation_id
        self._client = client
        self._last_status: Optional[str] = None

    def __repr__(self) -> str:
        status = self._last_status or "?"
        return f"Run(run_id={self.run_id!r}, status={status})"

    @property
    def status(self) -> str:
        """Latest known status. Fetches if not yet populated; otherwise
        returns cached. Use `refresh()` to force a fetch."""
        if self._last_status is None:
            self.refresh()
        return self._last_status or "unknown"

    def done(self) -> bool:
        """True if the last known status is terminal. Does NOT fetch — call
        `refresh()` first if you want a definitive check."""
        return (self._last_status or "") in _TERMINAL_STATUSES

    def refresh(self) -> "Run":
        """Single short-poll GET. Updates the cached status. Returns self."""
        data = self._client._fetch_run(self.run_id, wait_for_terminal=False)
        self._last_status = data["status"]
        return self

    def stream(self) -> Iterator[RunEvent]:
        """Stream live events from this run.

        Yields one ``RunEvent`` per server-sent event. Replays already-
        persisted messages on first connection (so a late subscriber
        doesn't miss output), then live messages, then a final
        ``terminal`` event when the run reaches a terminal state.

        Reconnection is handled automatically using ``Last-Event-ID`` —
        if the connection drops mid-stream, ``stream()`` reconnects and
        resumes from the highest sequence it observed. Non-recoverable
        errors raise.
        """
        for ev in self._client._stream_events(self.run_id):
            yield ev
            if ev.type == "terminal":
                self._last_status = ev.data.get("status")
                return

    def cancel(self) -> "Run":
        """Request cancellation of this run.

        Returns immediately with the run state at the time the cancel
        was processed (status will likely still be ``running``); the
        consumer finalizes the row to ``cancelled`` shortly after. Call
        ``.wait()`` afterward to confirm the terminal state.

        Idempotent: cancelling an already-terminal run returns the
        current row unchanged (no error). Status reaches the SDK via
        the cached ``_last_status``.

        Returns:
            self (so you can chain ``.cancel().wait()``).
        """
        data = self._client._cancel_run(self.run_id)
        self._last_status = data["status"]
        return self

    def wait(self, timeout: Optional[float] = None) -> RunResult:
        """Block until the run reaches a terminal state.

        Uses the server's long-poll endpoint
        (`GET /runs/{id}?wait_for_terminal=true&max_wait=30`) and loops
        until terminal or `timeout` elapses.

        Args:
            timeout: Client-side wall-clock cap in seconds. None means
                wait forever. Note: this is separate from the
                `timeout_seconds` passed to `agent.send()` (which caps
                the agent's run server-side).

        Returns:
            A `RunResult` with the terminal status, messages, and
            metadata.

        Raises:
            TimeoutError: when `timeout` is reached without the run
                terminating.
            requests.HTTPError: on any HTTP-level failure.
        """
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            now = time.monotonic()
            if deadline is not None and now >= deadline:
                raise TimeoutError(
                    f"Run {self.run_id} did not complete within {timeout}s"
                )

            # How long this round-trip is allowed to wait server-side.
            if deadline is None:
                this_wait = _LONG_POLL_MAX_WAIT_SECONDS
            else:
                remaining = max(1, int(deadline - now))
                this_wait = min(_LONG_POLL_MAX_WAIT_SECONDS, remaining)

            data = self._client._fetch_run(
                self.run_id, wait_for_terminal=True, max_wait=this_wait
            )
            self._last_status = data["status"]
            if data["status"] in _TERMINAL_STATUSES:
                return RunResult._from_response(data)
            # Otherwise loop. Server already absorbed `this_wait` seconds, so
            # we don't sleep client-side — just re-issue the long-poll.


class Agent:
    """A reusable session handle.

    Bundles a workspace + model + conversation. Every `send()` reuses
    these defaults. The first `send()` may set `conversation_id` if you
    didn't pass one to `Agents.create()` — subsequent sends reuse it,
    so the agent remembers the thread.

    Concurrent sends on a single Agent are NOT supported (would race on
    `conversation_id` assignment + hit the server-side per-conversation
    serialization). Fan-out: create multiple Agents.
    """

    def __init__(
        self,
        *,
        workspace_id: str,
        model: Optional[str] = None,
        conversation_id: Optional[str] = None,
        client: "Agents",
    ):
        self.workspace_id = workspace_id
        self.model = model
        self.conversation_id = conversation_id
        self._client = client

    def __repr__(self) -> str:
        return (
            f"Agent(workspace_id={self.workspace_id!r}, "
            f"model={self.model!r}, conversation_id={self.conversation_id!r})"
        )

    def send(
        self,
        prompt: str,
        *,
        timeout_seconds: int = 600,
    ) -> Run:
        """POST a new run with this Agent's bundled defaults. Returns
        immediately with a `Run` handle (status `pending` or `running`).

        Args:
            prompt: The message to send to the agent.
            timeout_seconds: Wall-clock cap on the agent run, enforced
                server-side by the timeout watcher. Defaults to 600.

        Returns:
            A `Run` you can `.wait()` on.
        """
        run = self._client._create_run(
            prompt=prompt,
            workspace_id=self.workspace_id,
            conversation_id=self.conversation_id,
            model=self.model,
            timeout_seconds=timeout_seconds,
        )
        # First send may populate the conversation_id.
        if self.conversation_id is None:
            self.conversation_id = run.conversation_id
        return run

    def reset(self) -> None:
        """Clear `conversation_id` so the next `send()` starts a fresh
        thread in the same workspace."""
        self.conversation_id = None


class Agents:
    """Top-level resource on the NextToken client."""

    DEFAULT_BASE_URL = "https://api.nexttoken.co"

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self._api_key = api_key
        self._base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")

    # ---------- High-level API ----------

    def create(
        self,
        *,
        workspace: Union["Workspace", str],
        model: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> Agent:
        """Build an `Agent` session handle bound to a workspace.

        Args:
            workspace: A `Workspace` handle (returned by
                `client.workspaces.create/get/list`) or a workspace_id
                string.
            model: Optional model override (e.g. 'gpt-5'). Validated by
                the server when the first run is dispatched.
            conversation_id: Optional. If set, all sends append to this
                existing thread. If None, the first send creates a new
                thread and the Agent remembers it.
        """
        ws_id = workspace.id if hasattr(workspace, "id") else workspace
        return Agent(
            workspace_id=ws_id,
            model=model,
            conversation_id=conversation_id,
            client=self,
        )

    def run(
        self,
        prompt: str,
        *,
        workspace_id: str,
        conversation_id: Optional[str] = None,
        model: Optional[str] = None,
        timeout_seconds: int = 600,
        wait_timeout: Optional[float] = None,
    ) -> RunResult:
        """One-shot: create a run, wait for terminal, return the
        `RunResult`. Sugar for
        `client.agents.create(...).send(...).wait()`.

        Args:
            prompt: The message to send.
            workspace_id: Required — we don't auto-create from the
                one-shot path. Use `client.workspaces.create()` first
                if you don't have one.
            conversation_id: Optional — if set, continues an existing
                thread.
            model: Optional model override.
            timeout_seconds: Server-side wall-clock cap on the run.
            wait_timeout: Client-side cap on `.wait()`. None means
                wait forever (subject to server's timeout_seconds).

        Returns:
            The terminal `RunResult`.
        """
        run = self._create_run(
            prompt=prompt,
            workspace_id=workspace_id,
            conversation_id=conversation_id,
            model=model,
            timeout_seconds=timeout_seconds,
        )
        return run.wait(timeout=wait_timeout)

    def get_run(self, run_id: str) -> Run:
        """Reattach to an existing server-side run. Makes one GET to
        populate workspace_id + conversation_id immediately. Raises
        `requests.HTTPError` (404) if the run doesn't exist or isn't
        owned by this API key."""
        data = self._fetch_run(run_id, wait_for_terminal=False)
        run = Run(
            run_id=data["run_id"],
            workspace_id=data["workspace_id"],
            conversation_id=data["conversation_id"],
            client=self,
        )
        run._last_status = data["status"]
        return run

    # ---------- Internal HTTP plumbing ----------

    def _headers(self, *, json_body: bool = False) -> Dict[str, str]:
        h = {"Authorization": f"Bearer {self._api_key}"}
        if json_body:
            h["Content-Type"] = "application/json"
        return h

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    def _create_run(
        self,
        *,
        prompt: str,
        workspace_id: str,
        conversation_id: Optional[str],
        model: Optional[str],
        timeout_seconds: int,
    ) -> Run:
        body: Dict[str, Any] = {
            "prompt": prompt,
            "workspace_id": workspace_id,
            "timeout_seconds": timeout_seconds,
        }
        if conversation_id is not None:
            body["conversation_id"] = conversation_id
        if model is not None:
            body["model"] = model

        r = requests.post(
            self._url("/agents/runs"),
            headers=self._headers(json_body=True),
            json=body,
        )
        r.raise_for_status()
        data = r.json()
        run = Run(
            run_id=data["run_id"],
            workspace_id=data["workspace_id"],
            conversation_id=data["conversation_id"],
            client=self,
        )
        run._last_status = data["status"]
        return run

    def _cancel_run(self, run_id: str) -> Dict[str, Any]:
        """POST /agents/runs/{id}/cancel — returns the current row."""
        r = requests.post(
            self._url(f"/agents/runs/{run_id}/cancel"),
            headers=self._headers(),
        )
        r.raise_for_status()
        return r.json()

    def _stream_events(self, run_id: str) -> Iterator[RunEvent]:
        """GET /agents/runs/{id}/events — yields RunEvents until terminal.

        Auto-reconnects on transient disconnects using Last-Event-ID. The
        outer loop terminates on a ``terminal`` event or after the
        retry budget is exhausted.
        """
        last_id: Optional[str] = None
        max_reconnects = 3
        attempts = 0

        while True:
            headers = {**self._headers(), "Accept": "text/event-stream"}
            if last_id is not None:
                headers["Last-Event-ID"] = last_id
            try:
                with requests.get(
                    self._url(f"/agents/runs/{run_id}/events"),
                    headers=headers,
                    stream=True,
                    # No client-side timeout — long-lived connection. The
                    # server caps the run via timeout_seconds.
                ) as resp:
                    resp.raise_for_status()
                    for ev in _parse_sse_stream(resp.iter_lines(decode_unicode=True)):
                        if ev.id is not None:
                            last_id = ev.id
                        yield ev
                        if ev.type == "terminal":
                            return
                # Server closed the stream without a terminal event;
                # treat as a soft disconnect and try to reconnect.
                attempts += 1
                if attempts > max_reconnects:
                    return
                time.sleep(min(2.0 * attempts, 5.0))
            except (requests.ConnectionError, requests.Timeout):
                attempts += 1
                if attempts > max_reconnects:
                    raise
                time.sleep(min(2.0 * attempts, 5.0))


    def _fetch_run(
        self,
        run_id: str,
        *,
        wait_for_terminal: bool = False,
        max_wait: int = 0,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if wait_for_terminal:
            params["wait_for_terminal"] = "true"
            if max_wait > 0:
                params["max_wait"] = max_wait
        r = requests.get(
            self._url(f"/agents/runs/{run_id}"),
            headers=self._headers(),
            params=params or None,
        )
        r.raise_for_status()
        return r.json()


def _parse_sse_stream(lines: Iterator[str]) -> Iterator[RunEvent]:
    """Minimal SSE parser. Splits the line stream into ``RunEvent``s.

    Handles the three fields we use: ``event:``, ``id:``, and ``data:``.
    Multi-line ``data`` fields are concatenated with newlines (per SSE
    spec). Comments (``:``-prefixed) and other fields are ignored.
    """
    cur_event = "message"
    cur_id: Optional[str] = None
    cur_data: List[str] = []

    for line in lines:
        if line is None:
            continue
        if line == "":
            if cur_data:
                data_str = "\n".join(cur_data)
                try:
                    parsed = _json.loads(data_str)
                except Exception:
                    parsed = {"raw": data_str}
                yield RunEvent(type=cur_event, id=cur_id, data=parsed)
            cur_event = "message"
            cur_id = None
            cur_data = []
        elif line.startswith(":"):
            continue  # comment / heartbeat
        elif line.startswith("event:"):
            cur_event = line[len("event:"):].strip()
        elif line.startswith("id:"):
            cur_id = line[len("id:"):].strip() or None
        elif line.startswith("data:"):
            cur_data.append(line[len("data:"):].strip())
        # Other field names (retry:, etc.) ignored.

    # Trailing event without final blank line.
    if cur_data:
        data_str = "\n".join(cur_data)
        try:
            parsed = _json.loads(data_str)
        except Exception:
            parsed = {"raw": data_str}
        yield RunEvent(type=cur_event, id=cur_id, data=parsed)

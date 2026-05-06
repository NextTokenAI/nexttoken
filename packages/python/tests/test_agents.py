"""Tests for the nexttoken SDK Agents resource.

Mocks `requests.post` and `requests.get` so we exercise the SDK's HTTP
plumbing (URL composition, headers, retry/wait loop, response parsing)
without a live backend.
"""

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Run from the package root so `nexttoken.*` imports work.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from nexttoken.agents import Agent, Agents, Run, RunResult


def make_response(json_data, status_code=200):
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = json_data
    r.raise_for_status = MagicMock()
    return r


def make_run_response(
    run_id="run_1",
    workspace_id="ws_1",
    conversation_id="c1",
    status="running",
    **extra,
):
    return {
        "run_id": run_id,
        "workspace_id": workspace_id,
        "conversation_id": conversation_id,
        "status": status,
        "started_at": None,
        "completed_at": None,
        "duration_ms": None,
        "final_text": None,
        "messages": None,
        "usage_estimate": None,
        "error": None,
        **extra,
    }


# ============================================================
# Agents.create + Agent.send
# ============================================================


class TestAgentSession:
    def test_create_with_workspace_handle(self):
        ws = MagicMock()
        ws.id = "ws_42"
        agents = Agents(api_key="nt_test")
        agent = agents.create(workspace=ws, model="gpt-5")
        assert agent.workspace_id == "ws_42"
        assert agent.model == "gpt-5"
        assert agent.conversation_id is None

    def test_create_with_workspace_id_string(self):
        agents = Agents(api_key="nt_test")
        agent = agents.create(workspace="ws_42")
        assert agent.workspace_id == "ws_42"

    def test_send_posts_to_runs_endpoint(self):
        agents = Agents(api_key="nt_test", base_url="https://api.example.com")
        agent = agents.create(workspace="ws_1", model="gpt-5")
        with patch("nexttoken.agents.requests.post",
                   return_value=make_response(
                       make_run_response(conversation_id="c_new", status="running"),
                       status_code=202,
                   )) as mock_post:
            run = agent.send("hello")
        # URL + headers + body
        args, kwargs = mock_post.call_args
        assert args[0] == "https://api.example.com/agents/runs"
        assert kwargs["headers"]["Authorization"] == "Bearer nt_test"
        assert kwargs["headers"]["Content-Type"] == "application/json"
        assert kwargs["json"]["prompt"] == "hello"
        assert kwargs["json"]["workspace_id"] == "ws_1"
        assert kwargs["json"]["model"] == "gpt-5"
        # Returns a Run with state populated from response
        assert isinstance(run, Run)
        assert run.run_id == "run_1"
        assert run.workspace_id == "ws_1"
        assert run.conversation_id == "c_new"
        # Agent records the conversation_id from the first send
        assert agent.conversation_id == "c_new"

    def test_send_reuses_conversation_id_after_first_send(self):
        agents = Agents(api_key="nt_test")
        agent = agents.create(workspace="ws_1")
        with patch("nexttoken.agents.requests.post",
                   return_value=make_response(
                       make_run_response(conversation_id="c1"),
                   )) as mock_post:
            agent.send("first")
            agent.send("second")
        # Second call must include the conversation_id from the first response
        second_call_body = mock_post.call_args_list[1].kwargs["json"]
        assert second_call_body["conversation_id"] == "c1"

    def test_send_passes_explicit_conversation_id(self):
        agents = Agents(api_key="nt_test")
        agent = agents.create(workspace="ws_1", conversation_id="c_explicit")
        with patch("nexttoken.agents.requests.post",
                   return_value=make_response(
                       make_run_response(conversation_id="c_explicit"),
                   )) as mock_post:
            agent.send("hello")
        body = mock_post.call_args.kwargs["json"]
        assert body["conversation_id"] == "c_explicit"

    def test_reset_clears_conversation(self):
        agents = Agents(api_key="nt_test")
        agent = agents.create(workspace="ws_1")
        agent.conversation_id = "c1"
        agent.reset()
        assert agent.conversation_id is None

    def test_send_propagates_timeout_seconds(self):
        agents = Agents(api_key="nt_test")
        agent = agents.create(workspace="ws_1")
        with patch("nexttoken.agents.requests.post",
                   return_value=make_response(make_run_response())) as mock_post:
            agent.send("hi", timeout_seconds=120)
        assert mock_post.call_args.kwargs["json"]["timeout_seconds"] == 120


# ============================================================
# Run.wait + Run.refresh
# ============================================================


class TestRunWait:
    def test_returns_immediately_if_terminal(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r1",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        with patch("nexttoken.agents.requests.get",
                   return_value=make_response(
                       make_run_response(
                           status="completed",
                           final_text="done!",
                           messages=[
                               {"id": "m1", "role": "assistant", "content": "done!",
                                "sequence": 5, "tool_call_count": 0,
                                "tool_result_count": 0},
                           ],
                           duration_ms=1234,
                       )
                   )) as mock_get:
            result = run.wait()
        assert isinstance(result, RunResult)
        assert result.status == "completed"
        assert result.final_text == "done!"
        assert result.duration_ms == 1234
        # Single GET
        assert mock_get.call_count == 1

    def test_loops_until_terminal(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r1",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        responses = [
            make_response(make_run_response(status="running")),
            make_response(make_run_response(status="running")),
            make_response(
                make_run_response(status="completed", final_text="done")
            ),
        ]
        with patch("nexttoken.agents.requests.get", side_effect=responses):
            result = run.wait()
        assert result.status == "completed"
        assert result.final_text == "done"

    def test_uses_long_poll_params(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r1",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        with patch("nexttoken.agents.requests.get",
                   return_value=make_response(
                       make_run_response(status="completed")
                   )) as mock_get:
            run.wait()
        params = mock_get.call_args.kwargs["params"]
        assert params["wait_for_terminal"] == "true"
        assert params["max_wait"] > 0

    def test_raises_timeout_error(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r1",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        with patch("nexttoken.agents.requests.get",
                   return_value=make_response(make_run_response(status="running"))):
            with pytest.raises(TimeoutError):
                run.wait(timeout=0.5)  # tiny timeout, response stays running

    def test_refresh_short_poll(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r1",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        with patch("nexttoken.agents.requests.get",
                   return_value=make_response(
                       make_run_response(status="completed")
                   )) as mock_get:
            run.refresh()
        # No long-poll params on refresh
        params = mock_get.call_args.kwargs.get("params")
        assert params is None or "wait_for_terminal" not in params
        assert run._last_status == "completed"
        assert run.done() is True

    def test_status_property_fetches_when_unknown(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r1",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        # _last_status is None initially → status accessor must fetch
        with patch("nexttoken.agents.requests.get",
                   return_value=make_response(
                       make_run_response(status="running")
                   )) as mock_get:
            assert run.status == "running"
        assert mock_get.call_count == 1
        # Second access uses cache
        assert run.status == "running"

    def test_done_false_when_running(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r1",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        run._last_status = "running"
        assert run.done() is False

    def test_done_true_for_each_terminal_status(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r1",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        for status in ("completed", "failed", "timeout", "cancelled"):
            run._last_status = status
            assert run.done() is True


# ============================================================
# Agents.run + Agents.get_run
# ============================================================


class TestAgentsTopLevel:
    def test_run_one_shot(self):
        agents = Agents(api_key="nt_test")
        with patch("nexttoken.agents.requests.post",
                   return_value=make_response(
                       make_run_response(status="running")
                   )), \
             patch("nexttoken.agents.requests.get",
                   return_value=make_response(
                       make_run_response(status="completed", final_text="ok")
                   )):
            result = agents.run(
                "do it", workspace_id="ws_1", conversation_id="c1", model="gpt-5"
            )
        assert isinstance(result, RunResult)
        assert result.status == "completed"
        assert result.final_text == "ok"

    def test_get_run_populates_handle(self):
        agents = Agents(api_key="nt_test")
        with patch("nexttoken.agents.requests.get",
                   return_value=make_response(
                       make_run_response(
                           run_id="run_x",
                           workspace_id="ws_x",
                           conversation_id="c_x",
                           status="running",
                       )
                   )):
            run = agents.get_run("run_x")
        assert isinstance(run, Run)
        assert run.run_id == "run_x"
        assert run.workspace_id == "ws_x"
        assert run.conversation_id == "c_x"
        assert run._last_status == "running"

    def test_get_run_404_raises(self):
        agents = Agents(api_key="nt_test")
        bad = MagicMock()
        bad.status_code = 404
        bad.raise_for_status.side_effect = Exception("404 not found")
        bad.json.return_value = {}
        with patch("nexttoken.agents.requests.get", return_value=bad):
            with pytest.raises(Exception):
                agents.get_run("nonexistent")


# ============================================================
# Run.cancel
# ============================================================


class TestRunCancel:
    def test_cancel_posts_to_cancel_endpoint(self):
        agents = Agents(api_key="nt_test", base_url="https://api.example.com")
        run = Run(
            run_id="r_cancel",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        with patch("nexttoken.agents.requests.post",
                   return_value=make_response(
                       make_run_response(run_id="r_cancel", status="running")
                   )) as mock_post:
            returned = run.cancel()
        # URL + auth
        args, kwargs = mock_post.call_args
        assert args[0] == "https://api.example.com/agents/runs/r_cancel/cancel"
        assert kwargs["headers"]["Authorization"] == "Bearer nt_test"
        # Returns self for chaining; status cached
        assert returned is run
        assert run._last_status == "running"

    def test_cancel_idempotent_on_terminal(self):
        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r_done",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )
        with patch("nexttoken.agents.requests.post",
                   return_value=make_response(
                       make_run_response(run_id="r_done", status="completed")
                   )):
            run.cancel()
        assert run._last_status == "completed"
        assert run.done() is True


# ============================================================
# Run.stream + _parse_sse_stream
# ============================================================


class TestSseParser:
    def test_parses_simple_event(self):
        from nexttoken.agents import _parse_sse_stream
        lines = [
            "event: message",
            'data: {"sequence": 1, "content": "hi"}',
            "",
        ]
        events = list(_parse_sse_stream(iter(lines)))
        assert len(events) == 1
        assert events[0].type == "message"
        assert events[0].data["sequence"] == 1

    def test_parses_event_with_id(self):
        from nexttoken.agents import _parse_sse_stream
        lines = [
            "event: message",
            "id: 42",
            'data: {"x": 1}',
            "",
        ]
        events = list(_parse_sse_stream(iter(lines)))
        assert events[0].id == "42"

    def test_ignores_comments_and_unknown_fields(self):
        from nexttoken.agents import _parse_sse_stream
        lines = [
            ": heartbeat",
            "retry: 5000",
            "event: message",
            'data: {"a": 1}',
            "",
        ]
        events = list(_parse_sse_stream(iter(lines)))
        assert len(events) == 1
        assert events[0].data == {"a": 1}

    def test_parses_terminal_event(self):
        from nexttoken.agents import _parse_sse_stream
        lines = [
            "event: terminal",
            'data: {"status": "completed", "final_text": "ok"}',
            "",
        ]
        events = list(_parse_sse_stream(iter(lines)))
        assert events[0].type == "terminal"
        assert events[0].data["status"] == "completed"

    def test_parses_multiple_events(self):
        from nexttoken.agents import _parse_sse_stream
        lines = [
            "event: message",
            "id: 1",
            'data: {"sequence": 1}',
            "",
            "event: message",
            "id: 2",
            'data: {"sequence": 2}',
            "",
            "event: terminal",
            'data: {"status": "completed"}',
            "",
        ]
        events = list(_parse_sse_stream(iter(lines)))
        assert [e.type for e in events] == ["message", "message", "terminal"]
        assert events[0].id == "1"
        assert events[1].id == "2"


class TestRunStream:
    def test_stream_returns_message_then_terminal_then_stops(self):
        from nexttoken.agents import Run, RunEvent

        agents = Agents(api_key="nt_test")
        run = Run(
            run_id="r_stream",
            workspace_id="ws_1",
            conversation_id="c1",
            client=agents,
        )

        def fake_stream_events(run_id):
            assert run_id == "r_stream"
            yield RunEvent(type="message", id="1", data={"sequence": 1})
            yield RunEvent(type="terminal", id=None,
                           data={"status": "completed", "final_text": "ok"})

        with patch.object(agents, "_stream_events", fake_stream_events):
            events = list(run.stream())

        assert len(events) == 2
        assert events[0].type == "message"
        assert events[1].type == "terminal"
        # Cached status updated from terminal payload.
        assert run._last_status == "completed"

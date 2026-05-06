"""NextToken Workspaces client — files + environment for SDK agent runs.

A Workspace is a long-lived filesystem + runtime container owned by your
account. You upload files into it, agents you run in it can read/write
those files, and you can download the artifacts they produce.

Example:
    >>> from nexttoken import NextToken
    >>> client = NextToken(api_key="nt_...")
    >>>
    >>> # Create a workspace and upload data
    >>> ws = client.workspaces.create(name="Revenue analysis")
    >>> ws.upload("data.csv", "inputs/data.csv")
    >>>
    >>> # ... run an agent against it (see client.agents) ...
    >>>
    >>> # Read what the agent produced
    >>> print(ws.read_text("notes.md"))
    >>> ws.download("report.pdf", "report.pdf")
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Iterable

import requests


class Workspace:
    """Handle to a server-side workspace.

    Lightweight wrapper over `id` + immutable metadata. Every method makes
    an HTTP call — no caching of mutable state, so you never see stale
    files. Multiple agent runs can target the same workspace.
    """

    def __init__(
        self,
        *,
        id: str,
        name: Optional[str],
        created_at: Optional[str],
        updated_at: Optional[str],
        client: "Workspaces",
    ):
        self.id = id
        self.name = name
        self.created_at = created_at
        self.updated_at = updated_at
        self._client = client

    def __repr__(self) -> str:
        return f"Workspace(id={self.id!r}, name={self.name!r})"

    # --- Files: transfer ---

    def upload(self, local_path: str, remote_path: str) -> Dict[str, Any]:
        """Upload a local file into the workspace at `remote_path`.

        Args:
            local_path: Path to the local file.
            remote_path: Destination path within the workspace (relative,
                no leading "/", no ".." segments).

        Returns:
            Dict with `path` and `bytes` keys.
        """
        return self._client.upload(self.id, local_path, remote_path)

    def download(self, remote_path: str, local_path: str) -> int:
        """Download a workspace file to `local_path`.

        Returns the number of bytes written.
        """
        return self._client.download(self.id, remote_path, local_path)

    # --- Files: text convenience ---

    def read_text(self, remote_path: str, *, max_bytes: int = 1_000_000) -> str:
        """Read a small text file as a string (UTF-8). Refuses binary or
        files larger than `max_bytes`."""
        return self._client.read_text(self.id, remote_path, max_bytes=max_bytes)

    def write_text(self, remote_path: str, content: str) -> None:
        """Write a string to `remote_path` (UTF-8)."""
        self._client.write_text(self.id, remote_path, content)

    # --- Stat & list ---

    def exists(self, remote_path: str) -> bool:
        """Return True if the path exists in the workspace."""
        return self._client.exists(self.id, remote_path)

    def list_files(
        self, path: str = "", *, recursive: bool = False
    ) -> List[Dict[str, Any]]:
        """List entries in a workspace directory.

        Returns a list of dicts with `name` and `type` ("file" or
        "directory"). `path=""` lists the workspace root.
        """
        return self._client.list_files(self.id, path, recursive=recursive)

    # --- Mutation ---

    def delete_file(self, remote_path: str) -> None:
        """Delete a file or directory in the workspace."""
        self._client.delete_file(self.id, remote_path)

    def delete(self) -> None:
        """Delete this workspace and all its files + conversations.

        Raises an HTTPError 409 if any agent run is currently active in
        this workspace; wait for it to finish (or cancel it) and try again.
        """
        self._client.delete(self.id)


class Workspaces:
    """Top-level resource on the NextToken client."""

    DEFAULT_BASE_URL = "https://api.nexttoken.co"

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self._api_key = api_key
        self._base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")

    # ---------- HTTP helpers ----------

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        h = {"Authorization": f"Bearer {self._api_key}"}
        if extra:
            h.update(extra)
        return h

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        headers = self._headers({"Content-Type": "application/json"} if json is not None else None)
        r = requests.request(method, self._url(path), headers=headers, json=json, params=params)
        r.raise_for_status()
        if r.status_code == 204 or not r.content:
            return None
        return r.json()

    # ---------- Workspace CRUD ----------

    def create(self, name: Optional[str] = None) -> Workspace:
        """Create a new workspace. Returns a Workspace handle."""
        body: Dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        data = self._request_json("POST", "/workspaces", json=body)
        return self._workspace_from_dict(data)

    def list(self) -> List[Workspace]:
        """List your workspaces."""
        data = self._request_json("GET", "/workspaces")
        return [self._workspace_from_dict(w) for w in data.get("workspaces", [])]

    def get(self, workspace_id: str) -> Workspace:
        """Fetch a workspace by id."""
        data = self._request_json("GET", f"/workspaces/{workspace_id}")
        return self._workspace_from_dict(data)

    def delete(self, workspace_id: str) -> None:
        """Delete a workspace and all its files + conversations.

        Raises an HTTPError 409 if any agent run is active in the
        workspace.
        """
        self._request_json("DELETE", f"/workspaces/{workspace_id}")

    # ---------- File ops ----------

    def upload(
        self, workspace_id: str, local_path: str, remote_path: str
    ) -> Dict[str, Any]:
        """Upload a single file from `local_path` to `remote_path` inside
        the workspace."""
        url = self._url(f"/workspaces/{workspace_id}/files")
        with open(local_path, "rb") as f:
            files = {"file": (os.path.basename(local_path), f)}
            r = requests.post(
                url,
                headers=self._headers(),
                params={"path": remote_path},
                files=files,
            )
        r.raise_for_status()
        return r.json()

    def download(
        self, workspace_id: str, remote_path: str, local_path: str
    ) -> int:
        """Stream a workspace file to `local_path`. Creates intermediate
        directories if needed. Returns bytes written."""
        url = self._url(f"/workspaces/{workspace_id}/files/content")
        r = requests.get(
            url,
            headers=self._headers(),
            params={"path": remote_path},
            stream=True,
        )
        r.raise_for_status()
        local_dir = os.path.dirname(os.path.abspath(local_path))
        if local_dir:
            os.makedirs(local_dir, exist_ok=True)
        total = 0
        with open(local_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=64 * 1024):
                if chunk:
                    f.write(chunk)
                    total += len(chunk)
        return total

    def list_files(
        self,
        workspace_id: str,
        path: str = "",
        *,
        recursive: bool = False,
    ) -> List[Dict[str, Any]]:
        """List files in a workspace directory (`path=""` for root)."""
        params: Dict[str, Any] = {"path": path, "recursive": "true" if recursive else "false"}
        data = self._request_json(
            "GET", f"/workspaces/{workspace_id}/files", params=params
        )
        return data.get("items", [])

    def delete_file(self, workspace_id: str, remote_path: str) -> None:
        """Delete a single file or directory in the workspace."""
        url = self._url(f"/workspaces/{workspace_id}/files")
        r = requests.delete(url, headers=self._headers(), params={"path": remote_path})
        r.raise_for_status()

    def exists(self, workspace_id: str, remote_path: str) -> bool:
        """Return True if a path exists in the workspace."""
        data = self._request_json(
            "GET",
            f"/workspaces/{workspace_id}/files/exists",
            params={"path": remote_path},
        )
        return bool(data.get("exists"))

    def read_text(
        self,
        workspace_id: str,
        remote_path: str,
        *,
        max_bytes: int = 1_000_000,
    ) -> str:
        """Read a small text file (UTF-8). Refuses binary or oversize."""
        data = self._request_json(
            "GET",
            f"/workspaces/{workspace_id}/files/text",
            params={"path": remote_path, "max_bytes": max_bytes},
        )
        return data["content"]

    def write_text(
        self, workspace_id: str, remote_path: str, content: str
    ) -> None:
        """Write a string to `remote_path` (UTF-8)."""
        self._request_json(
            "PUT",
            f"/workspaces/{workspace_id}/files/text",
            json={"path": remote_path, "content": content},
        )

    # ---------- Internal ----------

    def _workspace_from_dict(self, d: Dict[str, Any]) -> Workspace:
        return Workspace(
            id=d["id"],
            name=d.get("name"),
            created_at=d.get("created_at"),
            updated_at=d.get("updated_at"),
            client=self,
        )

"""NextToken Integrations client for connected third-party services."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests


class Integrations:
    """Client for NextToken Integrations API.

    Allows invoking actions on connected third-party services
    (Gmail, Slack, etc.) using your NextToken API key.

    Example:
        >>> from nexttoken import NextToken
        >>> client = NextToken(api_key="your-api-key")
        >>> integrations = client.integrations.list()
        >>> result = client.integrations.invoke(
        ...     app="gmail",
        ...     function_key="gmail-send-email",
        ...     args={"to": "user@example.com", "subject": "Hi", "body": "Hello!"}
        ... )
    """

    DEFAULT_BASE_URL = "https://api.nexttoken.co"

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self._api_key = api_key
        self._base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, **kwargs) -> Dict[str, Any]:
        url = f"{self._base_url}{path}"
        response = requests.request(
            method, url, headers=self._headers(), **kwargs
        )
        response.raise_for_status()
        return response.json()

    def list(self) -> List[Dict[str, Any]]:
        """List connected integrations.

        Returns:
            List of connected integration objects.
        """
        data = self._request("GET", "/integrations")
        return data.get("data", {}).get("integrations", [])

    def search(self, query: str) -> List[Dict[str, Any]]:
        """Search for available integrations by name or category.

        Args:
            query: Search query (e.g., "email", "crm", "slack").

        Returns:
            List of matching app objects with slug, name, description, logo_url.
        """
        data = self._request("GET", f"/integrations/search?q={query}")
        return data.get("data", {}).get("apps", [])

    def list_actions(self, app: str) -> List[Dict[str, Any]]:
        """List available actions for a connected app.

        Args:
            app: The app identifier (e.g., "gmail", "slack").

        Returns:
            List of action objects with key, name, description, etc.
        """
        data = self._request("GET", f"/integrations/{app}/actions")
        return data.get("data", {}).get("actions", [])

    def get_action_details(self, app: str, action_key: str) -> Dict[str, Any]:
        """Get detailed prop schema for a specific action.

        Returns the full parameter schema including prop names, types,
        descriptions, required/optional, and available options.

        Args:
            app: The app identifier (e.g., "gmail", "notion").
            action_key: The action key (e.g., "notion-append-block").

        Returns:
            Action details with configurable_props schema.
        """
        data = self._request("GET", f"/integrations/{app}/actions/{action_key}")
        return data.get("data", {})

    def invoke(
        self,
        app: str,
        function_key: str,
        args: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Invoke a function on a connected integration.

        Args:
            app: The app identifier (e.g., "gmail", "slack").
            function_key: The function to invoke (e.g., "gmail-send-email").
            args: Arguments required by the function.

        Returns:
            Function result data.
        """
        data = self._request(
            "POST",
            f"/integrations/{app}/invoke",
            json={"action_key": function_key, "props": args or {}},
        )
        return data.get("data", {})

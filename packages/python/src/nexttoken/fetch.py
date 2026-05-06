"""NextToken Fetch client for web page content fetching."""

from __future__ import annotations

from typing import Any, Dict, Optional

import requests


class Fetch:
    """Client for NextToken Web Fetch API.

    Fetches web page content as clean markdown.

    Example:
        >>> from nexttoken import NextToken
        >>> client = NextToken(api_key="your-api-key")
        >>> result = client.fetch.url("https://example.com/article")
        >>> print(result["title"])
        >>> print(result["content"][:500])
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

    def url(
        self,
        url: str,
        *,
        timeout: int = 10,
        max_content_length: int = 1000000,
        output_format: str = "markdown",
    ) -> Dict[str, Any]:
        """Fetch content from a web page as clean markdown or DOM structure.

        Args:
            url: The URL to fetch content from.
            timeout: Request timeout in seconds (1-30, default 10).
            max_content_length: Max content chars (1000-1000000, default 1000000).
            output_format: "markdown" (default) for clean readable content,
                "structure" for condensed DOM skeleton with tags, classes,
                and text hints — useful for discovering CSS selectors.

        Returns:
            Dict with keys: title, content, url, links, method,
            content_length, and optionally truncated, total_length.

        Raises:
            requests.HTTPError: If the API request fails.
        """
        payload: Dict[str, Any] = {
            "url": url,
            "timeout": timeout,
            "max_content_length": max_content_length,
            "output_format": output_format,
        }

        data = self._request("POST", "/fetch", json=payload)
        return data.get("data", {})

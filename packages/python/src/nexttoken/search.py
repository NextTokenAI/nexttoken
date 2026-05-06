"""NextToken Search client for web search."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests


class Search:
    """Client for NextToken Web Search API.

    Provides web search functionality through NextToken's
    search backend.

    Example:
        >>> from nexttoken import NextToken
        >>> client = NextToken(api_key="your-api-key")
        >>> results = client.search.query("latest AI developments")
        >>> for r in results:
        ...     print(r["title"], r["url"])
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

    def query(
        self,
        query: str,
        *,
        num_results: int = 10,
        include_domains: Optional[List[str]] = None,
        exclude_domains: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Search the web.

        Args:
            query: The search query string.
            num_results: Number of results to return (1-20, default 10).
            include_domains: Only include results from these domains.
            exclude_domains: Exclude results from these domains.

        Returns:
            List of search result dicts with keys:
            title, url, snippet, published_date.

        Raises:
            requests.HTTPError: If the API request fails.
        """
        payload: Dict[str, Any] = {
            "query": query,
            "num_results": num_results,
        }
        if include_domains is not None:
            payload["include_domains"] = include_domains
        if exclude_domains is not None:
            payload["exclude_domains"] = exclude_domains

        data = self._request("POST", "/search", json=payload)
        return data.get("data", {}).get("results", [])

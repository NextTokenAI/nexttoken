"""NextToken client for the OpenAI-compatible Gateway."""

from __future__ import annotations

import os

from openai import OpenAI

from .agents import Agents
from .email import Email
from .fetch import Fetch
from .integrations import Integrations
from .search import Search
from .workspaces import Workspaces


class NextToken:
    """Simple client for the NextToken Gateway.

    The Gateway is an OpenAI-compatible LLM proxy that provides:
    - Access to multiple models (GPT-4, Claude, Gemini)
    - Usage tracking and cost management
    - Simple Bearer token authentication

    Example:
        >>> from nexttoken import NextToken
        >>> client = NextToken(api_key="your-api-key")
        >>> response = client.chat.completions.create(
        ...     model="gpt-4o",
        ...     messages=[{"role": "user", "content": "Hello!"}]
        ... )
        >>> print(response.choices[0].message.content)
    """

    DEFAULT_BASE_URL = "https://gateway.nexttoken.co/v1"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        api_base_url: str | None = None,
    ):
        """Initialize the NextToken client.

        Args:
            api_key: Your NextToken API key. Falls back to NEXTTOKEN_API_KEY env var.
            base_url: Optional custom gateway URL (defaults to production)
            api_base_url: Optional custom API URL for integrations (defaults to https://api.nexttoken.co)
        """
        resolved_key = api_key or os.environ.get("NEXTTOKEN_API_KEY")
        if not resolved_key:
            raise ValueError(
                "API key required. Pass api_key or set NEXTTOKEN_API_KEY environment variable."
            )
        self._api_key = resolved_key
        gateway_url = base_url or os.environ.get("NEXTTOKEN_GATEWAY_BASE_URL") or self.DEFAULT_BASE_URL
        self._client = OpenAI(
            api_key=resolved_key,
            base_url=gateway_url,
        )
        api_url = api_base_url or os.environ.get("NEXTTOKEN_API_BASE_URL")
        self._email = Email(api_key=resolved_key, base_url=api_url)
        self._fetch = Fetch(api_key=resolved_key, base_url=api_url)
        self._integrations = Integrations(api_key=resolved_key, base_url=api_url)
        self._search = Search(api_key=resolved_key, base_url=api_url)
        self._workspaces = Workspaces(api_key=resolved_key, base_url=api_url)
        self._agents = Agents(api_key=resolved_key, base_url=api_url)

    @property
    def chat(self):
        """Access chat completions."""
        return self._client.chat

    @property
    def embeddings(self):
        """Access embeddings."""
        return self._client.embeddings

    @property
    def models(self):
        """Access models list."""
        return self._client.models

    @property
    def email(self) -> Email:
        """Access email API for sending transactional emails."""
        return self._email

    @property
    def fetch(self) -> Fetch:
        """Access web fetch API for fetching page content as markdown."""
        return self._fetch

    @property
    def integrations(self) -> Integrations:
        """Access integrations API for connected third-party services."""
        return self._integrations

    @property
    def search(self) -> Search:
        """Access web search API."""
        return self._search

    @property
    def workspaces(self) -> Workspaces:
        """Access workspaces API for files + agent execution environments."""
        return self._workspaces

    @property
    def agents(self) -> Agents:
        """Access agents API for programmatic agent invocation."""
        return self._agents

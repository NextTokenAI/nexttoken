"""NextToken Email client for sending transactional emails."""

from __future__ import annotations

from typing import Any, Dict, Optional

import requests


class Email:
    """Client for NextToken Email API.

    Sends emails on behalf of the authenticated user via the
    NextToken transactional email service.

    Example:
        >>> from nexttoken import NextToken
        >>> client = NextToken(api_key="your-api-key")
        >>> result = client.email.send(
        ...     subject="Daily Report",
        ...     body="Here is your daily report...",
        ... )
        >>> print(result)  # {"success": True, "message_id": "..."}
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

    def send(
        self,
        subject: str,
        body: str,
        to: Optional[str] = None,
        body_html: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send an email.

        The email is sent from a personalized NextToken address
        (e.g., ``John Doe <john-doe@nexttoken.dev>``) with reply-to
        set to the user's real email address.

        Args:
            subject: Email subject line.
            body: Plain text email body.
            to: Recipient address. Defaults to the user's own email.
            body_html: Optional HTML body for rich formatting.

        Returns:
            Dict with ``success`` and ``message_id`` keys.
        """
        payload: Dict[str, Any] = {"subject": subject, "body": body}
        if to is not None:
            payload["to"] = to
        if body_html is not None:
            payload["body_html"] = body_html

        return self._request("POST", "/email/send", json=payload)

    def usage(self) -> Dict[str, Any]:
        """Get email usage stats for the authenticated user.

        Returns:
            Dict with ``sent_today``, ``daily_limit``, and ``tier`` keys.
        """
        return self._request("GET", "/api/public/email/usage")

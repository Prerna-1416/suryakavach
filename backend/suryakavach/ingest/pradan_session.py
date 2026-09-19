from __future__ import annotations

"""Authenticated PRADAN/ISSDC session support.

PRADAN delegates authentication to ISSDC's Keycloak OpenID Connect service.
The login action and hidden state fields are generated per session, so they
must be fetched immediately before submitting local-only credentials.
"""

from html import unescape
import os
import re
from urllib.parse import urljoin, urlparse

import httpx

from suryakavach.config import load_config


class PradanAuthenticationError(RuntimeError):
    """Raised when PRADAN credentials are absent or ISSDC rejects the login."""


_LOGIN_ENTRYPOINT = "/al1/protected/payload.xhtml"
_AUTH_FAILURE_MARKERS = (
    "invalid username or password",
    "invalid credentials",
    "account is disabled",
)


class PradanSession:
    """Own one authenticated, in-memory PRADAN browser-equivalent session."""

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        timeout_seconds: float = 30.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.client = client or httpx.Client(
            follow_redirects=True,
            timeout=timeout_seconds,
            headers={"User-Agent": "SURYAKAVACH data-ingestion/0.1"},
        )
        self.authenticated = False

    @classmethod
    def from_environment(cls) -> PradanSession:
        """Create a session from local ``PRADAN_*`` environment variables."""
        load_config()  # Loads the gitignored root .env without overriding deployment env vars.
        username = os.environ.get("PRADAN_USERNAME")
        password = os.environ.get("PRADAN_PASSWORD")
        if not username or not password:
            raise PradanAuthenticationError(
                "PRADAN_USERNAME and PRADAN_PASSWORD must be set in the local environment."
            )
        return cls(
            base_url=os.environ.get("PRADAN_BASE_URL", "https://pradan.issdc.gov.in"),
            username=username,
            password=password,
            timeout_seconds=float(os.environ.get("PRADAN_TIMEOUT_SECONDS", "30")),
        )

    def login(self) -> None:
        """Authenticate through the dynamic ISSDC Keycloak login form."""
        login_page = self.client.get(self.base_url + _LOGIN_ENTRYPOINT)
        action, payload = _login_form(login_page.text, str(login_page.url))
        parsed_action = urlparse(action)
        parsed_base = urlparse(self.base_url)
        allowed_hosts = {parsed_base.hostname, "pradan.issdc.gov.in", "issdc.gov.in", "idp.issdc.gov.in"}
        if parsed_action.scheme != "https" or (parsed_action.hostname and parsed_action.hostname not in allowed_hosts):
            raise PradanAuthenticationError(
                f"Invalid or insecure PRADAN login action URL: '{action}'"
            )
        payload.update({"username": self.username, "password": self.password, "login": "Log In"})
        response = self.client.post(action, data=payload)
        if not _is_authenticated(response, self.base_url):
            raise PradanAuthenticationError("PRADAN authentication was rejected or did not complete.")
        self.authenticated = True

    def get(self, path_or_url: str) -> httpx.Response:
        """Fetch an authenticated PRADAN resource, authenticating once if needed."""
        if not self.authenticated:
            self.login()
        return self.client.get(urljoin(self.base_url + "/", path_or_url))

    def post(self, path_or_url: str, **kwargs: object) -> httpx.Response:
        """Post to an authenticated PRADAN page without exposing cookies."""
        if not self.authenticated:
            self.login()
        return self.client.post(urljoin(self.base_url + "/", path_or_url), **kwargs)

    def close(self) -> None:
        """Discard in-memory cookies and close the underlying HTTP client."""
        self.client.close()

    def __enter__(self) -> PradanSession:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def _login_form(html: str, page_url: str) -> tuple[str, dict[str, str]]:
    form = re.search(r"<form\b([^>]*)>(.*?)</form>", html, flags=re.IGNORECASE | re.DOTALL)
    if not form:
        raise PradanAuthenticationError("ISSDC login form was not found.")
    attrs, body = form.groups()
    action_match = re.search(r"action=[\"']([^\"']*)", attrs, flags=re.IGNORECASE)
    if not action_match:
        raise PradanAuthenticationError("ISSDC login action was not found.")

    payload: dict[str, str] = {}
    for tag in re.findall(r"<input\b[^>]*>", body, flags=re.IGNORECASE):
        name_match = re.search(r"\bname=[\"']([^\"']+)", tag, flags=re.IGNORECASE)
        type_match = re.search(r"\btype=[\"']([^\"']+)", tag, flags=re.IGNORECASE)
        value_match = re.search(r"\bvalue=[\"']([^\"']*)", tag, flags=re.IGNORECASE)
        if name_match and type_match and type_match.group(1).lower() == "hidden":
            payload[name_match.group(1)] = unescape(value_match.group(1) if value_match else "")
    return urljoin(page_url, unescape(action_match.group(1))), payload


def _is_authenticated(response: httpx.Response, base_url: str) -> bool:
    page = re.sub(r"\s+", " ", response.text).lower()
    if any(marker in page for marker in _AUTH_FAILURE_MARKERS):
        return False
    expected_host = urlparse(base_url).hostname
    return response.url.host == expected_host and response.url.path.startswith("/al1/protected/")

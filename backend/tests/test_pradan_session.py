from __future__ import annotations

import httpx
import pytest

from suryakavach.ingest.pradan_session import PradanAuthenticationError, PradanSession


LOGIN_PAGE = """
<form action="https://idp.issdc.gov.in/login?state=one&amp;tab=two" method="post">
  <input type="hidden" name="session_code" value="generated-value" />
  <input type="text" name="username" />
  <input type="password" name="password" />
</form>
"""


class FakePradanClient:
    def __init__(self, final_page: str, final_url: str) -> None:
        self.final_page = final_page
        self.final_url = final_url
        self.post_data: dict[str, str] | None = None
        self.post_url: str | None = None

    def get(self, _url: str):
        return httpx.Response(200, text=LOGIN_PAGE, request=httpx.Request("GET", "https://idp.issdc.gov.in/login"))

    def post(self, url: str, data: dict[str, str]):
        self.post_url = url
        self.post_data = data
        return httpx.Response(200, text=self.final_page, request=httpx.Request("POST", self.final_url))

    def close(self) -> None:
        return None


def test_pradan_session_submits_dynamic_keycloak_fields_without_logging_credentials():
    client = FakePradanClient("<html>catalogue</html>", "https://pradan.issdc.gov.in/al1/protected/payload.xhtml")
    session = PradanSession("https://pradan.issdc.gov.in", "user", "password", client=client)  # type: ignore[arg-type]

    session.login()

    assert session.authenticated is True
    assert client.post_url == "https://idp.issdc.gov.in/login?state=one&tab=two"
    assert client.post_data == {
        "session_code": "generated-value",
        "username": "user",
        "password": "password",
        "login": "Log In",
    }


def test_pradan_session_rejects_invalid_credentials_page():
    client = FakePradanClient(
        "<span>Invalid username or password.</span>",
        "https://idp.issdc.gov.in/login",
    )
    session = PradanSession("https://pradan.issdc.gov.in", "user", "password", client=client)  # type: ignore[arg-type]

    with pytest.raises(PradanAuthenticationError, match="rejected"):
        session.login()

from __future__ import annotations

import pytest

from suryakavach.ingest.cli import main


def test_download_requires_an_exact_visible_filename(monkeypatch):
    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    monkeypatch.setattr("suryakavach.ingest.cli.PradanSession.from_environment", lambda: Session())
    monkeypatch.setattr("suryakavach.ingest.cli.catalogue_page", lambda *_args: [])

    with pytest.raises(SystemExit, match="PRADAN catalogue"):
        main(["download", "--payload", "solexs", "--filename", "not-listed.zip"])

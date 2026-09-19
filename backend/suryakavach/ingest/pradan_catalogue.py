from __future__ import annotations

"""PRADAN catalogue parsing and safe product downloads.

The portal presents a JSF/PrimeFaces catalogue, but each visible row contains a
stable authenticated ``/downloadData/`` link. This module records that concrete
product identity before downloading so the cache has reproducible provenance.
"""

from dataclasses import dataclass
from datetime import datetime
from html import unescape
from pathlib import Path
import hashlib
import os
import re
from urllib.parse import urljoin, urlparse

from suryakavach.ingest.pradan_session import PradanSession


@dataclass(frozen=True)
class PradanProduct:
    """One product currently listed by the authenticated PRADAN catalogue."""

    payload: str
    filename: str
    download_url: str
    observation_start: str | None
    observation_end: str | None
    size_kib: float | None


def catalogue_page(session: PradanSession, payload: str, page_number: int = 0, rows: int = 10) -> list[PradanProduct]:
    """Return a bounded PRADAN catalogue page using its PrimeFaces paginator."""
    if page_number < 0 or rows not in {10, 25, 50, 75, 100}:
        raise ValueError("page must be non-negative and rows must be a portal-supported page size")
    response_page = session.get(f"/al1/protected/browse.xhtml?id={payload}")
    if response_page.status_code != 200:
        raise RuntimeError(f"PRADAN catalogue request failed for {payload}: HTTP {response_page.status_code}")
    if page_number == 0 and rows == 10:
        return parse_catalogue_page(response_page.text, session.base_url, payload)
    view_state = _view_state(response_page.text)
    offset = page_number * rows
    response = session.post(
        str(response_page.url),
        data={
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": "tableForm:lazyDocTable",
            "javax.faces.partial.execute": "tableForm:lazyDocTable",
            "javax.faces.partial.render": "tableForm:lazyDocTable",
            "tableForm:lazyDocTable_pagination": "true",
            "tableForm:lazyDocTable_first": str(offset),
            "tableForm:lazyDocTable_rows": str(rows),
            "tableForm": "tableForm",
            "javax.faces.ViewState": view_state,
        },
        headers={"Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest"},
    )
    if response.status_code != 200:
        raise RuntimeError(f"PRADAN catalogue paginator failed for {payload}: HTTP {response.status_code}")
    return parse_catalogue_page(response.text, session.base_url, payload)


def product_for_day(
    session: PradanSession, payload: str, day: str, *, max_pages: int = 10, rows: int = 100
) -> PradanProduct | None:
    """Find the first visible product matching a UTC observation day, bounded."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise ValueError("day must be YYYY-MM-DD")
    if max_pages < 1:
        raise ValueError("max_pages must be at least 1")
    for page_number in range(max_pages):
        products = catalogue_page(session, payload, page_number=page_number, rows=rows)
        if not products:
            return None
        matched = next((product for product in products if (product.observation_start or "").startswith(day)), None)
        if matched:
            return matched
        if len(products) < rows:
            return None
    return None


def parse_catalogue_page(html: str, base_url: str, payload: str) -> list[PradanProduct]:
    """Parse visible data-product rows without relying on unstable JSF IDs."""
    table = re.search(
        r'<tbody\b[^>]*\bid=["\']tableForm:lazyDocTable_data["\'][^>]*>(.*?)</tbody>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not table:
        return []

    products: list[PradanProduct] = []
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", table.group(1), flags=re.IGNORECASE | re.DOTALL):
        link = re.search(
            r'href=["\']([^"\']*/downloadData/[^"\']+)["\'][^>]*>(.*?)</a>',
            row,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not link:
            continue
        href, filename_html = link.groups()
        filename = _text(filename_html)
        if not filename:
            continue
        cells = [_text(cell) for cell in re.findall(r"<td\b[^>]*>(.*?)</td>", row, flags=re.IGNORECASE | re.DOTALL)]
        dates = [cell for cell in cells if _looks_like_timestamp(cell)]
        size = _last_number(cells)
        products.append(
            PradanProduct(
                payload=payload,
                filename=filename,
                download_url=urljoin(base_url.rstrip("/") + "/", unescape(href)),
                observation_start=dates[0] if dates else None,
                observation_end=dates[1] if len(dates) > 1 else None,
                size_kib=size,
            )
        )
    return products


def download_product(session: PradanSession, product: PradanProduct, destination: str | os.PathLike) -> dict[str, str | int]:
    """Download one product atomically and return its immutable cache manifest.

    The function never treats an HTML login/error page as a data product. A
    temporary sibling ``.part`` file prevents a cancelled transfer looking
    complete on the next run.
    """
    dst_dir = Path(destination)
    dst_dir.mkdir(parents=True, exist_ok=True)
    target = dst_dir / Path(product.filename).name
    partial = target.with_suffix(target.suffix + ".part")
    if partial.exists():
        partial.unlink()

    digest = hashlib.sha256()
    byte_count = 0
    with session.client.stream("GET", product.download_url) as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        if "text/html" in content_type:
            raise RuntimeError(f"PRADAN returned HTML instead of {product.filename}")
        with partial.open("wb") as fh:
            for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                fh.write(chunk)
                digest.update(chunk)
                byte_count += len(chunk)
    partial.replace(target)
    return {
        "payload": product.payload,
        "filename": target.name,
        "source_url": _without_query(product.download_url),
        "sha256": digest.hexdigest(),
        "bytes": byte_count,
        "observation_start": product.observation_start or "",
        "observation_end": product.observation_end or "",
    }


def _text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(value))).strip()


def _looks_like_timestamp(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _last_number(cells: list[str]) -> float | None:
    for cell in reversed(cells):
        try:
            return float(cell.replace(",", ""))
        except ValueError:
            continue
    return None


def _without_query(url: str) -> str:
    parsed = urlparse(url)
    return parsed._replace(query="", fragment="").geturl()


def _view_state(html: str) -> str:
    match = re.search(r'name=["\']javax\.faces\.ViewState["\'][^>]*value=["\']([^"\']+)', html, re.I)
    if not match:
        raise RuntimeError("PRADAN JSF ViewState was not found")
    return unescape(match.group(1))

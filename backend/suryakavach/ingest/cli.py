from __future__ import annotations

"""Bounded command-line operations for authenticated PRADAN product caching."""

import argparse
import json
from pathlib import Path

from suryakavach.config import data_dir, load_config
from suryakavach.ingest.pradan_catalogue import catalogue_page, download_product, product_for_day
from suryakavach.ingest.pradan_session import PradanSession
from suryakavach.ingest.registry import ObservedProduct, ObservedProductRegistry


def main(argv: list[str] | None = None) -> int:
    """Run a deliberately bounded catalogue or exact-product download command."""
    parser = argparse.ArgumentParser(description="SURYAKAVACH PRADAN data cache")
    subcommands = parser.add_subparsers(dest="command", required=True)
    catalogue = subcommands.add_parser("catalogue", help="list the visible portal catalogue page")
    catalogue.add_argument("--payload", required=True, choices=("solexs", "hel1os", "suit", "mag"))
    catalogue.add_argument("--limit", type=int, default=10)
    download = subcommands.add_parser("download", help="download one exact visible product")
    download.add_argument("--payload", required=True, choices=("solexs", "hel1os", "suit", "mag"))
    selected = download.add_mutually_exclusive_group(required=True)
    selected.add_argument("--filename", help="exact visible portal filename")
    selected.add_argument("--day", help="UTC observation day, YYYY-MM-DD")
    download.add_argument("--max-pages", type=int, default=10, help="bounded portal pages to inspect for --day")
    download.add_argument("--destination", type=Path)
    args = parser.parse_args(argv)

    with PradanSession.from_environment() as session:
        if args.command == "catalogue":
            products = catalogue_page(session, args.payload)
            for product in products[: max(args.limit, 0)]:
                row = dict(product.__dict__)
                row["download_url"] = row["download_url"].split("?", 1)[0]
                print(json.dumps(row, sort_keys=True))
            return 0

        if args.day:
            product = product_for_day(session, args.payload, args.day, max_pages=args.max_pages)
        else:
            products = catalogue_page(session, args.payload)
            product = next((item for item in products if item.filename == args.filename), None)
        if product is None:
            raise SystemExit(
                "product was not found within the bounded PRADAN catalogue selection; "
                "run catalogue first, use an exact filename, or increase --max-pages deliberately"
            )
        cfg = load_config()
        destination = args.destination or data_dir(cfg) / "raw" / "pradan" / args.payload
        target = destination / product.filename
        manifest_path = destination / f"{product.filename}.manifest.json"
        if target.is_file() and manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        else:
            manifest = download_product(session, product, destination)
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        registry_path = Path(cfg["data"]["registry_path"])
        with ObservedProductRegistry(registry_path) as registry:
            registry.register(ObservedProduct.from_download_manifest(manifest, target))
        print(json.dumps(manifest, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

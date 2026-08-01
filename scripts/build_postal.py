from __future__ import annotations

import argparse
import csv
from datetime import UTC, datetime
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
import zipfile


SOURCE_URL = (
    "https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip"
)
SOURCE_PAGE = "https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html"
CANONICAL_ORIGIN = "https://yubin-hiki.yhay81.com"
USER_AGENT = "YubinHikiDataBuilder/1.0 (+https://github.com/yhay81/yubin-hiki)"
CSV_HEADER = (
    "local_code",
    "old_postal_code",
    "postal_code",
    "prefecture_kana",
    "city_kana",
    "town_kana",
    "prefecture",
    "city",
    "town",
    "has_multiple_postal_codes",
    "uses_koaza",
    "has_chome",
    "covers_multiple_towns",
    "change_status",
    "change_reason",
)
SQL_COLUMNS = (
    "id",
    "local_code",
    "old_postal_code",
    "postal_code",
    "prefecture_kana",
    "city_kana",
    "town_kana",
    "prefecture",
    "city",
    "town",
    "address",
    "city_town",
    "kana_address",
    "kana_city_town",
    "has_multiple_postal_codes",
    "uses_koaza",
    "has_chome",
    "covers_multiple_towns",
    "change_status",
    "change_reason",
)


def request_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def source_date() -> str:
    page = request_bytes(SOURCE_PAGE).decode("utf-8")
    match = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日更新", page)
    if not match:
        raise RuntimeError("Could not find the published data date")
    year, month, day = (int(part) for part in match.groups())
    return f"{year:04d}-{month:02d}-{day:02d}"


def read_rows(archive: bytes) -> tuple[list[dict[str, str]], int]:
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        members = [name for name in bundle.namelist() if name.lower().endswith(".csv")]
        if members != ["utf_ken_all.csv"]:
            raise RuntimeError(f"Unexpected archive members: {members}")
        csv_bytes = bundle.read(members[0])
    reader = csv.reader(io.StringIO(csv_bytes.decode("utf-8")))
    rows: list[dict[str, str]] = []
    for index, values in enumerate(reader, start=1):
        if len(values) != len(CSV_HEADER):
            raise RuntimeError(f"Row {index} has {len(values)} columns")
        row = dict(zip(CSV_HEADER, values, strict=True))
        if not re.fullmatch(r"\d{7}", row["postal_code"]):
            raise RuntimeError(f"Row {index} has an invalid postal code")
        rows.append(row)
    return rows, len(csv_bytes)


def validate_rows(rows: list[dict[str, str]]) -> tuple[int, int]:
    unique_codes = {row["postal_code"] for row in rows}
    prefectures = {row["prefecture"] for row in rows}
    if len(rows) < 120_000:
        raise RuntimeError(f"Expected at least 120,000 rows, found {len(rows)}")
    if len(unique_codes) < 115_000:
        raise RuntimeError(f"Expected at least 115,000 postal codes, found {len(unique_codes)}")
    if len(prefectures) != 47:
        raise RuntimeError(f"Expected 47 prefectures, found {len(prefectures)}")
    tokyo = [row for row in rows if row["postal_code"] == "1000001"]
    if not any(
        row["prefecture"] == "東京都" and row["city"] == "千代田区" and row["town"] == "千代田"
        for row in tokyo
    ):
        raise RuntimeError("The 100-0001 reference record is missing")
    return len(unique_codes), len(prefectures)


def public_row(row: dict[str, str], index: int) -> tuple[object, ...]:
    return (
        index,
        row["local_code"],
        row["old_postal_code"],
        row["postal_code"],
        row["prefecture_kana"],
        row["city_kana"],
        row["town_kana"],
        row["prefecture"],
        row["city"],
        row["town"],
        row["prefecture"] + row["city"] + row["town"],
        row["city"] + row["town"],
        row["prefecture_kana"] + row["city_kana"] + row["town_kana"],
        row["city_kana"] + row["town_kana"],
        int(row["has_multiple_postal_codes"]),
        int(row["uses_koaza"]),
        int(row["has_chome"]),
        int(row["covers_multiple_towns"]),
        int(row["change_status"]),
        int(row["change_reason"]),
    )


def sql_value(value: object) -> str:
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def render_sql(rows: list[dict[str, str]], generated: Path) -> list[str]:
    generated.mkdir(parents=True, exist_ok=True)
    for existing in generated.glob("*.sql"):
        existing.unlink()
    reset_name = "000-reset.sql"
    (generated / reset_name).write_text("DELETE FROM postal_entries;\n", encoding="utf-8")
    names = [reset_name]
    chunk_size = 5_000
    statement_size = 100
    for chunk_index, start in enumerate(range(0, len(rows), chunk_size), start=1):
        chunk = rows[start : start + chunk_size]
        lines: list[str] = []
        for statement_start in range(0, len(chunk), statement_size):
            batch = chunk[statement_start : statement_start + statement_size]
            values = []
            for local_index, row in enumerate(batch, start=start + statement_start + 1):
                values.append("(" + ",".join(sql_value(value) for value in public_row(row, local_index)) + ")")
            lines.append(
                f"INSERT INTO postal_entries ({','.join(SQL_COLUMNS)}) VALUES\n"
                + ",\n".join(values)
                + ";"
            )
        name = f"{chunk_index:03d}-postal.sql"
        (generated / name).write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        names.append(name)
    return names


def render_sitemaps(codes: list[str], public_root: Path) -> dict[str, str]:
    sitemap_root = public_root / "sitemaps"
    sitemap_root.mkdir(parents=True, exist_ok=True)
    expected: dict[str, str] = {}
    stable_urls = ["/", "/guide", "/source", "/privacy"]
    expected["static.xml"] = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(f"<url><loc>{CANONICAL_ORIGIN}{path}</loc></url>" for path in stable_urls)
        + "</urlset>"
    )
    sitemap_names = ["static.xml"]
    for index, start in enumerate(range(0, len(codes), 10_000), start=1):
        name = f"zip-{index:02d}.xml"
        chunk = codes[start : start + 10_000]
        expected[name] = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + "".join(
                f"<url><loc>{CANONICAL_ORIGIN}/zip/{postal_code}</loc></url>"
                for postal_code in chunk
            )
            + "</urlset>"
        )
        sitemap_names.append(name)
    index_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(
            f"<sitemap><loc>{CANONICAL_ORIGIN}/sitemaps/{name}</loc></sitemap>"
            for name in sitemap_names
        )
        + "</sitemapindex>"
    )
    expected["../sitemap.xml"] = index_xml
    return expected


def write_sitemaps(expected: dict[str, str], public_root: Path) -> None:
    sitemap_root = public_root / "sitemaps"
    for existing in sitemap_root.glob("*.xml"):
        existing.unlink()
    for name, contents in expected.items():
        target = public_root / "sitemap.xml" if name == "../sitemap.xml" else sitemap_root / name
        target.write_text(contents + "\n", encoding="utf-8", newline="\n")


def verify_outputs(meta: dict[str, object], expected_sitemaps: dict[str, str], project_root: Path) -> None:
    meta_path = project_root / "src" / "generated" / "postal-meta.json"
    if json.loads(meta_path.read_text(encoding="utf-8")) != meta:
        raise RuntimeError("postal-meta.json is stale")
    public_root = project_root / "public"
    expected_paths: set[Path] = set()
    for name, contents in expected_sitemaps.items():
        target = public_root / "sitemap.xml" if name == "../sitemap.xml" else public_root / "sitemaps" / name
        expected_paths.add(target)
        if not target.exists() or target.read_text(encoding="utf-8").rstrip("\n") != contents:
            raise RuntimeError(f"Sitemap is stale: {target}")
    actual_paths = {path for path in (public_root / "sitemaps").glob("*.xml")}
    if actual_paths != {path for path in expected_paths if path.parent.name == "sitemaps"}:
        raise RuntimeError("Unexpected sitemap files are present")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--source-zip", type=Path)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    project_root = args.project_root.resolve()
    source_path = (args.source_zip or project_root / "data" / "source" / "utf_ken_all.zip").resolve()
    meta_path = project_root / "src" / "generated" / "postal-meta.json"
    old_meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    if args.download:
        archive = request_bytes(SOURCE_URL)
        updated_at = source_date()
        if not args.verify:
            source_path.parent.mkdir(parents=True, exist_ok=True)
            source_path.write_bytes(archive)
    else:
        if not source_path.exists():
            raise RuntimeError(f"Source archive does not exist: {source_path}")
        archive = source_path.read_bytes()
        updated_at = str(old_meta.get("data_updated_at", "pending"))

    digest = hashlib.sha256(archive).hexdigest()
    rows, csv_bytes = read_rows(archive)
    unique_count, prefecture_count = validate_rows(rows)
    meta: dict[str, object] = {
        "csv_bytes": csv_bytes,
        "data_updated_at": updated_at,
        "prefectures": prefecture_count,
        "rows": len(rows),
        "sha256": digest,
        "source_url": SOURCE_URL,
        "unique_postal_codes": unique_count,
        "zip_bytes": len(archive),
    }
    codes = sorted({row["postal_code"] for row in rows})
    expected_sitemaps = render_sitemaps(codes, project_root / "public")

    if args.verify:
        verify_outputs(meta, expected_sitemaps, project_root)
    else:
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        write_sitemaps(expected_sitemaps, project_root / "public")
        sql_files = render_sql(rows, project_root / ".generated" / "postal")
        import_manifest = {
            "built_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
            "data_sha256": digest,
            "files": sql_files,
            "rows": len(rows),
        }
        manifest_path = project_root / ".generated" / "postal" / "manifest.json"
        manifest_path.write_text(
            json.dumps(import_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

    print(json.dumps(meta, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()

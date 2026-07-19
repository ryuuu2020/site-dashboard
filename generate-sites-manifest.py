#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


DASHBOARD_DIR = Path(__file__).resolve().parent
ROOT_DIR = DASHBOARD_DIR.parent
SITES_JSON_PATH = DASHBOARD_DIR / "sites.json"
SITES_JS_PATH = DASHBOARD_DIR / "sites.js"
ACTIVITY_JSON_PATH = DASHBOARD_DIR / "activity.json"

SKIP_DIRS = {
    "site-dashboard",
    "shared",
    "templates",
    "scripts",
    "reports",
    "solarpunk-guide-old",
}
DEFAULT_FEATS = {"adsense": 1, "adstxt": 1, "ga4": 1, "gsc": 1}
STYLE_MAP = {
    "A": ("A-战术指挥", "style-a"),
    "B": ("B-暗黑史诗", "style-b"),
    "C": ("C-生存日志", "style-c"),
    "3": ("3-古卷羊皮纸", "style-3"),
    "6": ("6-城市蓝图", "style-6"),
}
MANUAL_SITE_METADATA = {
    "solarpunk-guide": {"rank": 1, "name": "Solarpunk", "steam": 1805110, "style": "C-生存日志", "styleTag": "style-c"},
    "dispatch-guide": {"rank": 2, "name": "Dispatch", "steam": 2592160, "style": "A-战术指挥", "styleTag": "style-a"},
    "menace-guide": {"rank": 3, "name": "MENACE", "steam": 2432860, "style": "A-战术指挥", "styleTag": "style-a"},
    "olden-era-guide": {"rank": 4, "name": "Olden Era", "steam": 3105440, "style": "B-暗黑史诗", "styleTag": "style-b"},
    "going-medieval-guide": {"rank": 5, "name": "Going Medieval", "steam": 1029780, "style": "3-古卷羊皮纸", "styleTag": "style-3"},
    "tabletop-tavern-guide": {"rank": 6, "name": "Tabletop Tavern", "steam": 3337380, "style": "A-战术指挥", "styleTag": "style-a"},
    "demon-lord-guide": {"rank": 7, "name": "Demon Lord", "steam": 3720420, "style": "B-暗黑史诗", "styleTag": "style-b"},
    "town-to-city-guide": {"rank": 8, "name": "Town to City", "steam": 3115220, "style": "6-城市蓝图", "styleTag": "style-6"},
    "witchspire-guide": {"rank": 9, "name": "Witchspire", "steam": 2679100, "style": "B-暗黑史诗", "styleTag": "style-b"},
    "vampire-crawlers-guide": {"rank": 10, "name": "Vampire Crawlers", "steam": 3265700, "style": "A-战术指挥", "styleTag": "style-a"},
    "cairn-guide": {"rank": 11, "name": "Cairn", "steam": 1588550, "style": "C-生存日志", "styleTag": "style-c"},
    "mewgenics-guide": {"rank": 12, "name": "Mewgenics", "steam": 686060, "style": "A-战术指挥", "styleTag": "style-a"},
    "die-in-the-dungeon-guide": {"rank": 13, "name": "Die in the Dungeon", "steam": 2026820, "style": "A-战术指挥", "styleTag": "style-a"},
    "nova-roma-guide": {"rank": 14, "name": "Nova Roma", "steam": 2426530, "style": "6-城市蓝图", "styleTag": "style-6"},
    "space-haven-guide": {"rank": 15, "name": "Space Haven", "steam": 979110, "style": "C-生存日志", "styleTag": "style-c"},
    "realm-of-ink-guide": {"rank": 16, "name": "Realm of Ink", "steam": 2597080, "style": "B-暗黑史诗", "styleTag": "style-b"},
    "shapez-2-guide": {"rank": 17, "name": "shapez 2", "steam": 2162800, "style": "5-工业电路", "styleTag": "style-c"},
    "alabaster-dawn-guide": {"rank": 18, "name": "Alabaster Dawn", "steam": 3110760, "style": "A-战术指挥", "styleTag": "style-a"},
    "terra-invicta-guide": {"rank": 19, "name": "Terra Invicta", "steam": 1176470, "style": "A-战术指挥", "styleTag": "style-a"},
    "humanitz-guide": {"rank": 20, "name": "HumanitZ", "steam": 1766060, "style": "C-生存日志", "styleTag": "style-c"},
    "adira-nusantara-guide": {"rank": 21, "name": "Adira Nusantara", "steam": 3522550, "style": "C-生存日志", "styleTag": "style-c"},
}
BEIJING_TZ = ZoneInfo("Asia/Shanghai")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def load_existing_sites() -> dict[str, dict]:
    if not SITES_JSON_PATH.exists():
        return {}
    data = json.loads(SITES_JSON_PATH.read_text(encoding="utf-8"))
    return {
        site.get("dir") or site.get("name") or str(site.get("id")): site
        for site in data.get("sites", [])
    }


def is_site_dir(path: Path) -> bool:
    if not path.is_dir() or path.name.startswith(".") or path.name in SKIP_DIRS:
        return False
    return (path / "package.json").exists() and (path / "app").is_dir()


def infer_url(site_dir: Path, existing: dict) -> str:
    patterns = [
        (site_dir / "app" / "layout.tsx", r"metadataBase:\s*new URL\(['\"]([^'\"]+)['\"]\)"),
        (site_dir / "app" / "sitemap.ts", r"BASE_URL\s*=\s*['\"]([^'\"]+)['\"]"),
        (site_dir / "app" / "robots.ts", r"sitemap:\s*['\"]([^'\"]+)['\"]"),
    ]
    for path, pattern in patterns:
        text = read_text(path)
        match = re.search(pattern, text)
        if match:
            url = match.group(1).rstrip("/")
            normalized = url.removesuffix("/sitemap.xml")
            if "gguidehub.com" in normalized:
                return normalized

    if existing.get("url"):
        return existing["url"]

    return f"https://{site_dir.name}.vercel.app"


def infer_name(site_dir: Path, existing: dict) -> str:
    if existing.get("name"):
        return existing["name"]

    layout_text = read_text(site_dir / "app" / "layout.tsx")
    match = re.search(r"openGraph:\s*\{[^}]*title:\s*['\"]([^'\"]+)['\"]", layout_text, re.DOTALL)
    if not match:
        match = re.search(r'"name":\s*"([^"]+)"', layout_text)
    if not match:
        match = re.search(r"title:\s*['\"]([^'\"]+)['\"]", layout_text)
    if match:
        name = match.group(1).split(" - ")[0].split(" — ")[0].strip()
        return name[:-6] if name.endswith(" Guide") else name

    slug = site_dir.name.removesuffix("-guide").replace("-", " ").strip()
    return " ".join(part.capitalize() for part in slug.split())


def infer_style(site_dir: Path, existing: dict) -> tuple[str, str]:
    if existing.get("style") and existing.get("styleTag"):
        return existing["style"], existing["styleTag"]

    design_text = read_text(site_dir / "DESIGN.md")
    match = re.search(r"Template\s+([ABC36])", design_text)
    if match:
        return STYLE_MAP[match.group(1)]
    return "未知", "style-a"


def infer_pages(site_dir: Path, existing: dict) -> int:
    sitemap_text = read_text(site_dir / "out" / "sitemap.xml")
    if sitemap_text:
        return len(re.findall(r"<loc>", sitemap_text))

    html_files = [
        path
        for path in (site_dir / "out").glob("*.html")
        if path.name not in {"404.html", "_not-found.html"} and not path.name.startswith("google")
    ]
    if html_files:
        return len(html_files)

    return int(existing.get("pages") or 0)


def infer_steam(site_dir: Path, existing: dict) -> int:
    if existing.get("steam"):
        return int(existing["steam"])

    for path in [site_dir / "app" / "page.tsx", site_dir / "app" / "layout.tsx", site_dir / "README.md"]:
        text = read_text(path)
        match = re.search(r"store\.steampowered\.com/app/(\d+)", text)
        if match:
            return int(match.group(1))
    return 0


def infer_launch(site_dir: Path, existing: dict) -> str:
    if existing.get("launch") and existing["launch"] != "?":
        return existing["launch"]

    try:
        result = subprocess.run(
            ["git", "-C", str(site_dir), "log", "--reverse", "--date=format:%-m/%-d", "--format=%ad", "-n", "1"],
            check=True,
            capture_output=True,
            text=True,
        )
        launch = result.stdout.strip()
        return launch or "?"
    except subprocess.CalledProcessError:
        return "?"


def infer_latest_git_update(site_dir: Path, existing: dict) -> tuple[str, str]:
    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(site_dir),
                "log",
                "-1",
                "--date=iso-strict",
                "--format=%ad%x00%s",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        raw = result.stdout.strip()
        if not raw:
            return existing.get("push", ""), existing.get("update", "")
        committed_at, subject = raw.split("\x00", 1)
        dt = datetime.fromisoformat(committed_at).astimezone(BEIJING_TZ)
        push = dt.strftime("%m-%d %H:%M")
        update = subject.strip().splitlines()[0][:120]
        return push, update
    except (subprocess.CalledProcessError, ValueError):
        return existing.get("push", ""), existing.get("update", "")


def build_site_entry(site_dir: Path, existing: dict, site_id: int) -> dict:
    existing = {**existing, **MANUAL_SITE_METADATA.get(site_dir.name, {})}
    style, style_tag = infer_style(site_dir, existing)
    push, update = infer_latest_git_update(site_dir, existing)
    existing_feats = {k: v for k, v in existing.get("feats", {}).items() if k != "afdian"}
    return {
        "id": site_id,
        "name": infer_name(site_dir, existing),
        "dir": site_dir.name,
        "url": infer_url(site_dir, existing),
        "steam": infer_steam(site_dir, existing),
        "pages": infer_pages(site_dir, existing),
        "style": style,
        "styleTag": style_tag,
        "feats": {**DEFAULT_FEATS, **existing_feats},
        "push": push,
        "update": update,
        "eng": existing.get("eng", 0),
        "pps": existing.get("pps", 0),
        "launch": infer_launch(site_dir, existing),
        "draft": bool(existing.get("draft", False)),
    }


def write_manifest(sites: list[dict]) -> None:
    payload = {
        "generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "sites": sites,
    }
    SITES_JSON_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    js_lines = [
        "// Auto-generated by generate-sites-manifest.py",
        f"// Generated: {payload['generated']}",
        f"const SITES = {json.dumps(sites, ensure_ascii=False, indent=2)};",
        "",
    ]
    SITES_JS_PATH.write_text("\n".join(js_lines), encoding="utf-8")


def classify_activity(subject: str) -> str:
    lowered = subject.lower()
    if any(token in lowered for token in ["fix", "repair", "bug", "hotfix"]):
        return "fix"
    if any(token in lowered for token in ["launch", "上线", "deploy", "release"]):
        return "launch"
    if any(token in lowered for token in ["feat", "add", "update", "expand", "content"]):
        return "update"
    return "push"


def write_activity_snapshot(site_dirs: list[Path], sites: list[dict]) -> None:
    site_name_by_dir = {site["dir"]: site["name"] for site in sites}
    entries: list[dict] = []
    for site_dir in site_dirs:
        try:
            result = subprocess.run(
                [
                    "git",
                    "-C",
                    str(site_dir),
                    "log",
                    "--date=iso-strict",
                    "--format=%ad%x00%s",
                    "-n",
                    "3",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError:
            continue

        for line in result.stdout.splitlines():
            if "\x00" not in line:
                continue
            committed_at, subject = line.split("\x00", 1)
            try:
                dt = datetime.fromisoformat(committed_at).astimezone(BEIJING_TZ)
            except ValueError:
                continue
            clean_subject = subject.strip().splitlines()[0][:120]
            entries.append(
                {
                    "time": dt.strftime("%m-%d %H:%M"),
                    "timestamp": dt.isoformat(),
                    "dot": classify_activity(clean_subject),
                    "msg": clean_subject,
                    "site": site_name_by_dir.get(site_dir.name, site_dir.name),
                }
            )

    entries.sort(key=lambda item: item["timestamp"], reverse=True)
    payload = {
        "generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": "local-git",
        "entries": entries[:30],
    }
    ACTIVITY_JSON_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    existing_sites = load_existing_sites()
    site_dirs = sorted(path for path in ROOT_DIR.iterdir() if is_site_dir(path))
    site_dirs.sort(key=lambda path: (MANUAL_SITE_METADATA.get(path.name, {}).get("rank", 999), path.name))

    sites = [
        build_site_entry(site_dir, existing_sites.get(site_dir.name, {}), site_id=index)
        for index, site_dir in enumerate(site_dirs, start=1)
    ]
    write_manifest(sites)
    write_activity_snapshot(site_dirs, sites)
    print(f"Generated {SITES_JSON_PATH} and {SITES_JS_PATH} with {len(sites)} sites.")


if __name__ == "__main__":
    main()

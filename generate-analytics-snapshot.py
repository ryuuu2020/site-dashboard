#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path


DASHBOARD_DIR = Path(__file__).resolve().parent
ROOT_DIR = DASHBOARD_DIR.parent
SCRIPTS_DIR = ROOT_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from ga4_api import DEFAULT_SERVICE_ACCOUNT, Ga4ApiError, request_access_token, run_report  # noqa: E402


SITES_JSON_PATH = DASHBOARD_DIR / "sites.json"
ANALYTICS_JSON_PATH = DASHBOARD_DIR / "analytics.json"
PROPERTY_ID = "542906144"

LEGACY_HOST_MAP = {
    "solarpunk-game-wiki.vercel.app": "Solarpunk",
    "solarpunk-guide-ecru.vercel.app": "Solarpunk",
    "dispatch-guide-sigma.vercel.app": "Dispatch",
    "dispatch-guide-six.vercel.app": "Dispatch",
    "menace-guide.vercel.app": "MENACE",
    "olden-era-guide-tau.vercel.app": "Olden Era",
    "going-medieval-guide.vercel.app": "Going Medieval",
    "tabletop-tavern-guide.vercel.app": "Tabletop Tavern",
    "demon-lord-guide.vercel.app": "Demon Lord",
    "town-to-city-guide.vercel.app": "Town to City",
    "witchspire-guide.vercel.app": "Witchspire",
    "vampire-crawlers-guide.vercel.app": "Vampire Crawlers",
    "cairn-guide.vercel.app": "Cairn",
    "mewgenics-guide.vercel.app": "Mewgenics",
    "die-in-the-dungeon-guide.vercel.app": "Die in the Dungeon",
    "nova-roma-guide.vercel.app": "Nova Roma",
    "space-haven-guide.vercel.app": "Space Haven",
    "realm-of-ink-guide.vercel.app": "Realm of Ink",
    "shapez-2-guide.vercel.app": "shapez 2",
    "alabaster-dawn-guide.vercel.app": "Alabaster Dawn",
    "terra-invicta-guide.vercel.app": "Terra Invicta",
    "humanitz-guide.vercel.app": "HumanitZ",
}


def load_sites() -> list[dict]:
    payload = json.loads(SITES_JSON_PATH.read_text(encoding="utf-8"))
    return payload.get("sites", [])


def load_latest_report() -> dict | None:
    candidates = sorted(ROOT_DIR.glob("ga4-report-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        return None
    return json.loads(candidates[0].read_text(encoding="utf-8"))


def build_host_maps(sites: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    host_to_name = dict(LEGACY_HOST_MAP)
    name_to_host: dict[str, str] = {}
    for site in sites:
        host = site["url"].replace("https://", "").rstrip("/")
        name = site["name"]
        host_to_name[host] = name
        name_to_host[name] = host
    return host_to_name, name_to_host


def build_empty_site_stats(sites: list[dict], day_keys: list[str], name_to_host: dict[str, str]) -> dict[str, dict]:
    return {
        site["name"]: {
            "name": site["name"],
            "host": name_to_host.get(site["name"], ""),
            "viewsByDay": [0] * len(day_keys),
            "totalViews": 0,
            "sessions": 0,
            "users": 0,
            "avgSessionDuration": 0,
            "pagesPerSession": 0,
        }
        for site in sites
    }


def normalize_site_name(host: str, host_to_name: dict[str, str]) -> str | None:
    return host_to_name.get(host)


def build_live_snapshot(sites: list[dict]) -> dict:
    host_to_name, name_to_host = build_host_maps(sites)

    today = date.today()
    end_date = today - timedelta(days=1)
    start_date = end_date - timedelta(days=6)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")
    day_keys = [(start_date + timedelta(days=offset)).strftime("%Y%m%d") for offset in range(7)]
    day_index = {day: index for index, day in enumerate(day_keys)}
    day_labels = [(start_date + timedelta(days=offset)).strftime("%m-%d") for offset in range(7)]

    site_stats_by_name = build_empty_site_stats(sites, day_keys, name_to_host)
    top_pages_by_host: dict[str, dict[str, dict]] = defaultdict(dict)

    token = request_access_token(DEFAULT_SERVICE_ACCOUNT, timeout=5)
    summary_rows = run_report(
        PROPERTY_ID,
        token,
        ["hostName"],
        ["screenPageViews", "sessions", "activeUsers", "averageSessionDuration", "screenPageViewsPerSession"],
        start_str,
        end_str,
        limit=2000,
        timeout=10,
    ).get("rows", [])
    daily_rows = run_report(
        PROPERTY_ID,
        token,
        ["hostName", "date"],
        ["screenPageViews"],
        start_str,
        end_str,
        limit=20000,
        timeout=10,
    ).get("rows", [])
    page_rows = run_report(
        PROPERTY_ID,
        token,
        ["hostName", "pagePath"],
        ["screenPageViews", "averageSessionDuration"],
        start_str,
        end_str,
        limit=20000,
        timeout=10,
    ).get("rows", [])

    for row in summary_rows:
        host = row["dimensionValues"][0]["value"]
        site_name = normalize_site_name(host, host_to_name)
        if not site_name or site_name not in site_stats_by_name:
            continue
        site_stat = site_stats_by_name[site_name]
        site_stat["totalViews"] += int(row["metricValues"][0]["value"])
        site_stat["sessions"] += int(row["metricValues"][1]["value"])
        site_stat["users"] += int(row["metricValues"][2]["value"])
        site_stat["avgSessionDuration"] = max(
            site_stat["avgSessionDuration"],
            round(float(row["metricValues"][3]["value"] or 0)),
        )
        site_stat["pagesPerSession"] = max(
            site_stat["pagesPerSession"],
            round(float(row["metricValues"][4]["value"] or 0), 2),
        )

    for row in daily_rows:
        host = row["dimensionValues"][0]["value"]
        day_key = row["dimensionValues"][1]["value"]
        site_name = normalize_site_name(host, host_to_name)
        if not site_name or site_name not in site_stats_by_name or day_key not in day_index:
            continue
        site_stats_by_name[site_name]["viewsByDay"][day_index[day_key]] += int(row["metricValues"][0]["value"])

    for row in page_rows:
        host = row["dimensionValues"][0]["value"]
        path = row["dimensionValues"][1]["value"] or "/"
        if path == "/ads.txt":
            continue
        site_name = normalize_site_name(host, host_to_name)
        if not site_name:
            continue
        canonical_host = name_to_host.get(site_name)
        if not canonical_host:
            continue
        page_entry = top_pages_by_host[canonical_host].setdefault(
            path,
            {"path": path, "views": 0, "eng": 0},
        )
        page_entry["views"] += int(row["metricValues"][0]["value"])
        page_entry["eng"] = max(page_entry["eng"], round(float(row["metricValues"][1]["value"] or 0)))

    top_pages_payload = {
        host: sorted(pages.values(), key=lambda page: page["views"], reverse=True)[:8]
        for host, pages in top_pages_by_host.items()
    }

    return {
        "generatedAt": datetime.now().isoformat(),
        "source": "ga4-live",
        "period": {"start": start_str, "end": end_str, "label": f"{start_str} ~ {end_str}"},
        "trafficDays": day_labels,
        "siteStats": list(site_stats_by_name.values()),
        "topPagesByHost": top_pages_payload,
    }


def build_fallback_snapshot(sites: list[dict], report: dict | None, error_message: str) -> dict:
    host_to_name, name_to_host = build_host_maps(sites)

    today = date.today()
    end_date = today - timedelta(days=1)
    start_date = end_date - timedelta(days=6)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")
    day_labels = [(start_date + timedelta(days=offset)).strftime("%m-%d") for offset in range(7)]
    site_stats_by_name = build_empty_site_stats(sites, ["0"] * 7, name_to_host)

    report_sites = (report or {}).get("site_stats", {})
    for site_name, stats in report_sites.items():
        if site_name not in site_stats_by_name:
            continue
        sessions = int(stats.get("sessions", 0))
        total_views = int(stats.get("pv", 0))
        site_stats_by_name[site_name].update(
            {
                "totalViews": total_views,
                "sessions": sessions,
                "users": int(stats.get("users", 0)),
                "avgSessionDuration": 0,
                "pagesPerSession": round(total_views / sessions, 2) if sessions else 0,
            }
        )

    top_pages_by_host: dict[str, list[dict]] = {}
    for host, site_name in host_to_name.items():
        if site_name != "Going Medieval":
            continue
        top_pages_by_host[name_to_host.get(site_name, host)] = [
            {"path": path, "views": int(views), "eng": 0}
            for path, views in (report or {}).get("going_medieval_top_pages", [])[:8]
            if path != "/ads.txt"
        ]
        break

    return {
        "generatedAt": datetime.now().isoformat(),
        "source": "ga4-report-fallback",
        "fallbackError": error_message,
        "period": {"start": start_str, "end": end_str, "label": f"{start_str} ~ {end_str}"},
        "trafficDays": day_labels,
        "siteStats": list(site_stats_by_name.values()),
        "topPagesByHost": top_pages_by_host,
    }


def main() -> None:
    sites = load_sites()
    try:
        payload = build_live_snapshot(sites)
    except Ga4ApiError as exc:
        payload = build_fallback_snapshot(sites, load_latest_report(), str(exc))

    ANALYTICS_JSON_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {ANALYTICS_JSON_PATH} ({payload['source']})")


if __name__ == "__main__":
    main()

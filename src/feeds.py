"""Fetch and normalize candidate items: research papers from the arXiv API and
news from RSS feeds (Google News topic searches + VR industry sites).

Everything goes through cloudscraper, which clears basic bot walls."""
import calendar
import re
from datetime import datetime, timedelta, timezone

import cloudscraper
import feedparser

from . import config

_scraper = cloudscraper.create_scraper()
MAX_PER_SOURCE = 40

ARXIV_API = "http://export.arxiv.org/api/query"


def http_get(url: str, params: dict = None):
    last = None
    for attempt in range(2):
        try:
            return _scraper.get(url, params=params,
                                headers={"User-Agent": config.USER_AGENT}, timeout=45)
        except Exception as e:
            last = e
    raise last


def _cutoff(kind: str) -> datetime:
    hours = config.MAX_RESEARCH_AGE_HOURS if kind == "research" else config.MAX_NEWS_AGE_HOURS
    return datetime.now(timezone.utc) - timedelta(hours=hours)


def _item(src, kind, title, url, when, desc=""):
    return {
        "source_id": src["id"],
        "source": src["name"],
        "kind": kind,  # "research" | "news"
        "topic": src.get("topic", ""),
        "title": re.sub(r"\s+", " ", title).strip(),
        "url": url.strip(),
        "published": when.strftime("%Y-%m-%dT%H:%M:%SZ") if when else "",
        "description": re.sub(r"\s+", " ", desc).strip()[:600],
    }


# ---------- arXiv API (research) ----------

def _fetch_arxiv(src) -> list:
    resp = http_get(ARXIV_API, params={
        "search_query": src["query"],
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": MAX_PER_SOURCE,
    })
    parsed = feedparser.parse(resp.content)
    items = []
    for entry in parsed.entries:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue
        t = entry.get("published_parsed") or entry.get("updated_parsed")
        when = (datetime.fromtimestamp(calendar.timegm(t), tz=timezone.utc) if t else None)
        if when and when < _cutoff("research"):
            continue
        abstract = re.sub(r"\s+", " ", entry.get("summary", "") or "").strip()
        authors = ", ".join(a.get("name", "") for a in entry.get("authors", [])[:4])
        desc = f"{abstract}" + (f" (Authors: {authors})" if authors else "")
        items.append(_item(src, "research", title, link, when, desc))
    return items


# ---------- generic RSS (news) ----------

def _fetch_rss(src) -> list:
    parsed = feedparser.parse(http_get(src["url"]).content)
    items = []
    for entry in parsed.entries:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue
        t = entry.get("published_parsed") or entry.get("updated_parsed")
        when = (datetime.fromtimestamp(calendar.timegm(t), tz=timezone.utc)
                if t else datetime.now(timezone.utc))
        if when < _cutoff("news"):
            continue
        desc = re.sub(r"<[^>]+>", " ", entry.get("summary", "") or "")
        # Google News appends " - Publisher" to titles; keep it (useful credit)
        items.append(_item(src, "news", title, link, when, desc))
        if len(items) >= MAX_PER_SOURCE:
            break
    return items


_FETCHERS = {
    "arxiv": _fetch_arxiv,
    "rss": _fetch_rss,
}


def interleave_cap(items: list, cap: int = 120) -> list:
    """Round-robin across sources so no feed crowds the others out of the
    candidate window shown to the AI."""
    by_src = {}
    for it in items:
        by_src.setdefault(it["source_id"], []).append(it)
    queues = list(by_src.values())
    out = []
    while len(out) < cap and any(queues):
        for q in queues:
            if q and len(out) < cap:
                out.append(q.pop(0))
    return out


def fetch_all() -> list:
    all_items = []
    for src in config.SOURCES:
        try:
            items = _FETCHERS[src["kind"]](src)
        except Exception as e:
            print(f"  [warn] {src['name']} ({src['id']}): fetch failed: {e}")
            items = []
        print(f"  {src['name']} ({src['id']}): {len(items)} fresh items")
        all_items.extend(items)
    all_items.sort(key=lambda x: x["published"], reverse=True)
    seen, out = set(), []
    for it in all_items:
        if it["url"] in seen:
            continue
        seen.add(it["url"])
        out.append(it)
    return out

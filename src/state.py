"""Drafted/posted-history persistence. The JSON file is committed back to the
repo by the workflow, so history survives between Actions runs and the same
story is never drafted twice."""
import hashlib
import json
import os
import re
from datetime import datetime, timezone

from . import config


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def norm_title(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip().lower())
    return re.sub(r"[^\w ]", "", t)


def title_hash(title: str) -> str:
    return hashlib.sha1(norm_title(title).encode("utf-8")).hexdigest()[:16]


def load_history() -> list:
    if os.path.exists(config.STATE_FILE):
        with open(config.STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_history(history: list) -> None:
    history = history[-config.HISTORY_KEEP:]
    os.makedirs(os.path.dirname(config.STATE_FILE), exist_ok=True)
    with open(config.STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=1)


def seen_keys(history: list) -> set:
    keys = set()
    for e in history:
        if e.get("url"):
            keys.add(e["url"])
        if e.get("title_hash"):
            keys.add(e["title_hash"])
    return keys


def record(history: list, item: dict, status: str) -> None:
    history.append({
        "title_hash": title_hash(item.get("orig_title") or item.get("title", "")),
        "url": item.get("url", ""),
        "headline": item.get("title", ""),
        "topic": item.get("topic_key", ""),
        "source": item.get("source", ""),
        "status": status,  # drafted | skipped
        "at": _now(),
    })


_STOPWORDS = {
    "the", "a", "an", "in", "on", "at", "of", "for", "to", "by", "with", "and",
    "or", "as", "is", "are", "was", "were", "be", "been", "after", "over",
    "amid", "against", "regarding", "about", "from", "its", "his", "her",
    "using", "based", "toward", "towards", "via", "study", "new",
}


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > 4 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _tokens(text: str) -> set:
    words = re.findall(r"[a-z]+", (text or "").lower())
    return {_stem(w) for w in words if w not in _STOPWORDS and len(w) > 2}


def is_duplicate(title: str, topic: str, history: list, threshold: float = 0.55) -> bool:
    """Deterministic lexical backstop for the AI's semantic dedup."""
    new_words = _tokens(title) | _tokens(topic)
    if not new_words:
        return False
    for e in history:
        old_words = _tokens(f"{e.get('headline', '')} {e.get('topic', '')}")
        if not old_words:
            continue
        shared = new_words & old_words
        jaccard = len(shared) / len(new_words | old_words)
        hl_new, hl_old = _tokens(title), _tokens(e.get("headline", ""))
        shared_hl = hl_new & hl_old
        containment = (len(shared_hl) / min(len(hl_new), len(hl_old))
                       if hl_new and hl_old else 0.0)
        if jaccard >= threshold or (containment >= 0.6 and len(shared_hl) >= 4):
            print(f"  [dedup] '{title[:60]}' matches drafted '{e.get('headline', '')[:60]}' "
                  f"(jaccard={jaccard:.2f}, containment={containment:.2f})")
            return True
    return False

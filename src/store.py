"""Persist generated drafts as JSON files the static website reads directly.

Each draft is one file: docs/data/posts/<id>.json
A lightweight index (docs/data/index.json) lists every post for the dashboard,
newest first. The website (GitHub Pages) fetches these by relative URL — no
server needed."""
import hashlib
import json
import os
from datetime import datetime, timezone

from . import config


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_id(url: str, title: str) -> str:
    """Stable, filesystem-safe id from the source url (+title fallback)."""
    h = hashlib.sha1((url or title).encode("utf-8")).hexdigest()[:10]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{stamp}-{h}"


def load_index() -> list:
    if os.path.exists(config.INDEX_FILE):
        with open(config.INDEX_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_index(index: list) -> None:
    index = index[: config.INDEX_KEEP]
    os.makedirs(os.path.dirname(config.INDEX_FILE), exist_ok=True)
    with open(config.INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)


def pending_count(index: list) -> int:
    return sum(1 for e in index if e.get("status") == "draft")


def save_post(post: dict) -> dict:
    """Write one draft file + prepend its index entry. Returns the index entry."""
    pid = make_id(post.get("url", ""), post.get("title", ""))
    record = {
        "id": pid,
        "title": post["title"],
        "summary": post.get("summary", ""),
        "topic": post.get("topic", ""),
        "kind": post.get("kind", ""),
        "source": post.get("source", ""),
        "url": post.get("url", ""),
        "post_text": post["post_text"],
        # --- carousel slide fields (the exact Meta Life design) ---
        "template": post.get("template", "article"),
        "headline": post.get("headline", post["title"]),
        "kicker": post.get("kicker", ""),
        "details": post.get("details", []),
        "thank_you": post.get("thank_you", True),
        "thanks_title": post.get("thanks_title", "Thank you"),
        "thanks_brand": post.get("thanks_brand", "Meta Life AI"),
        "thanks_at": post.get("thanks_at", "@metaLifeAI"),
        "thanks_follow": post.get("thanks_follow", "Follow us for more\nnews and updates of our work"),
        "image": post.get("image", ""),
        "image_pos": post.get("image_pos", {"x": 50, "y": 50, "zoom": 100}),
        "image_prompt": post.get("image_prompt", ""),
        "handle": post.get("handle", "metalifeai.com"),
        "attach_link": post.get("attach_link", True),
        "status": "draft",            # draft | queued | posted
        "created_at": _now(),
        "posted_at": "",
        "linkedin_url": "",
    }
    os.makedirs(config.POSTS_DIR, exist_ok=True)
    with open(os.path.join(config.POSTS_DIR, f"{pid}.json"), "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=1)

    index = load_index()
    index = [e for e in index if e.get("id") != pid]
    # index entries are trimmed (no full post_text) to keep index.json small
    index.insert(0, {k: record[k] for k in
                     ("id", "title", "summary", "topic", "kind", "source",
                      "url", "status", "created_at", "posted_at", "linkedin_url")})
    save_index(index)
    return record


def load_post(pid: str) -> dict:
    path = os.path.join(config.POSTS_DIR, f"{pid}.json")
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_post(record: dict) -> None:
    """Overwrite a post file and sync its index entry (used after publish)."""
    pid = record["id"]
    with open(os.path.join(config.POSTS_DIR, f"{pid}.json"), "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=1)
    index = load_index()
    for e in index:
        if e.get("id") == pid:
            for k in ("status", "posted_at", "linkedin_url", "title", "summary"):
                if k in record:
                    e[k] = record[k]
            break
    save_index(index)

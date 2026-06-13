"""Publish a stored draft to LinkedIn via the UGC Posts API.

Posting is never automatic: a post is published only when its file is marked
status="posted" by the dashboard's "Post to LinkedIn" action (which commits the
change), and this module then sends it. Without credentials it dry-runs.

Requires a LinkedIn app with the 'w_member_social' scope (share on behalf of a
member). LINKEDIN_AUTHOR_URN is the member/org URN, e.g. urn:li:person:AbC123."""
import requests

from . import budget, config

API = "https://api.linkedin.com/v2/ugcPosts"


def publish_text(post_text: str, link_url: str = "", link_title: str = "") -> dict:
    """Post text (optionally with a shared link) to LinkedIn.
    Returns {"status": "...", "url"/"id"/"error": ...}."""
    if not (config.LINKEDIN_ACCESS_TOKEN and config.LINKEDIN_AUTHOR_URN):
        return {"status": "dry-run", "detail": "no LinkedIn credentials set"}
    if budget.remaining("linkedin", config.LINKEDIN_DAILY_LIMIT) <= 0:
        return {"status": "skipped", "detail": "daily LinkedIn budget reached"}

    media_category = "NONE"
    share_content = {
        "shareCommentary": {"text": post_text},
        "shareMediaCategory": "NONE",
    }
    if link_url:
        media_category = "ARTICLE"
        share_content = {
            "shareCommentary": {"text": post_text},
            "shareMediaCategory": "ARTICLE",
            "media": [{
                "status": "READY",
                "originalUrl": link_url,
                **({"title": {"text": link_title[:200]}} if link_title else {}),
            }],
        }

    body = {
        "author": config.LINKEDIN_AUTHOR_URN,
        "lifecycleState": "PUBLISHED",
        "specificContent": {"com.linkedin.ugc.ShareContent": share_content},
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    try:
        resp = requests.post(
            API,
            headers={
                "Authorization": f"Bearer {config.LINKEDIN_ACCESS_TOKEN}",
                "X-Restli-Protocol-Version": "2.0.0",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=60,
        )
    except requests.RequestException as e:
        return {"status": "error", "detail": str(e)[:160]}
    if resp.status_code not in (200, 201):
        return {"status": "error", "detail": f"HTTP {resp.status_code}: {resp.text[:200]}"}
    budget.spend("linkedin")
    urn = resp.headers.get("x-restli-id") or resp.json().get("id", "")
    share_url = f"https://www.linkedin.com/feed/update/{urn}" if urn else ""
    return {"status": "posted", "id": urn, "url": share_url}

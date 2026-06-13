"""Publish a stored draft to LinkedIn as a multi-image carousel.

Flow (per post): render the Meta Life slides to PNGs -> register + upload each
image to LinkedIn -> create one UGC post carrying the caption and all images.
Posting is never automatic: only drafts the dashboard marked "queued" reach
here. Without credentials it dry-runs (still renders, so you can preview PNGs).

Requires a LinkedIn app token with 'w_member_social'. LINKEDIN_AUTHOR_URN is the
member/org URN, e.g. urn:li:person:AbC123."""
import os

import requests

from . import budget, config, render

UGC = "https://api.linkedin.com/v2/ugcPosts"
REGISTER = "https://api.linkedin.com/v2/assets?action=registerUpload"


def _headers():
    return {
        "Authorization": f"Bearer {config.LINKEDIN_ACCESS_TOKEN}",
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }


def _upload_image(path: str) -> str:
    """Register + upload one image; returns its asset URN ('' on failure)."""
    reg = requests.post(REGISTER, headers=_headers(), timeout=60, json={
        "registerUploadRequest": {
            "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
            "owner": config.LINKEDIN_AUTHOR_URN,
            "serviceRelationships": [{
                "relationshipType": "OWNER",
                "identifier": "urn:li:userGeneratedContent",
            }],
        }
    })
    if reg.status_code not in (200, 201):
        raise RuntimeError(f"registerUpload HTTP {reg.status_code}: {reg.text[:160]}")
    info = reg.json()["value"]
    asset = info["asset"]
    upload_url = info["uploadMechanism"][
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]["uploadUrl"]
    with open(path, "rb") as f:
        up = requests.post(
            upload_url,
            headers={"Authorization": f"Bearer {config.LINKEDIN_ACCESS_TOKEN}"},
            data=f.read(), timeout=120)
    if up.status_code not in (200, 201):
        raise RuntimeError(f"image upload HTTP {up.status_code}: {up.text[:160]}")
    return asset


def publish_post(record: dict) -> dict:
    """Render the carousel and post it to LinkedIn.
    Returns {"status": ..., "url"/"detail": ...}."""
    # 1) render slides (always — lets dry-runs produce previewable PNGs)
    try:
        paths = render.render_post(record)
    except Exception as e:
        return {"status": "error", "detail": f"render failed: {str(e)[:160]}"}
    if not paths:
        return {"status": "error", "detail": "no slides rendered"}

    if not (config.LINKEDIN_ACCESS_TOKEN and config.LINKEDIN_AUTHOR_URN):
        return {"status": "dry-run", "detail": f"rendered {len(paths)} slide(s); no LinkedIn credentials"}
    if budget.remaining("linkedin", config.LINKEDIN_DAILY_LIMIT) <= 0:
        return {"status": "skipped", "detail": "daily LinkedIn budget reached"}

    # 2) upload every slide (LinkedIn carousels allow up to 9 images)
    try:
        assets = [_upload_image(p) for p in paths[:9]]
    except Exception as e:
        return {"status": "error", "detail": str(e)[:180]}

    # 3) create the multi-image UGC post
    media = [{"status": "READY", "media": a,
              "title": {"text": record.get("title", "")[:200]}} for a in assets]
    body = {
        "author": config.LINKEDIN_AUTHOR_URN,
        "lifecycleState": "PUBLISHED",
        "specificContent": {"com.linkedin.ugc.ShareContent": {
            "shareCommentary": {"text": record["post_text"]},
            "shareMediaCategory": "IMAGE",
            "media": media,
        }},
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    try:
        resp = requests.post(UGC, headers=_headers(), json=body, timeout=90)
    except requests.RequestException as e:
        return {"status": "error", "detail": str(e)[:160]}
    if resp.status_code not in (200, 201):
        return {"status": "error", "detail": f"UGC HTTP {resp.status_code}: {resp.text[:200]}"}
    budget.spend("linkedin")
    urn = resp.headers.get("x-restli-id") or resp.json().get("id", "")
    return {"status": "posted", "id": urn,
            "url": f"https://www.linkedin.com/feed/update/{urn}" if urn else ""}

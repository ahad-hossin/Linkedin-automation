"""Best-effort topical image lookup for drafts that have no source image
(e.g. arXiv research papers). Uses the Openverse API — free, no key, CC-licensed
images filtered to commercial-use. Returns a wide image URL or "".

The dashboard editor lets the user replace/position whatever this finds, and the
slide design falls back to a branded backdrop when this returns nothing."""
import requests

from . import config

OPENVERSE = "https://api.openverse.org/v1/images/"

# a couple of concrete visual cues per topic improve relevance over the bare label
_QUERY = {
    "virtual reality": "virtual reality headset",
    "augmented reality": "augmented reality glasses",
    "driving simulation": "car driving simulator cockpit",
    "driver blind zone": "car side mirror road traffic",
    "pedestrian safety": "pedestrian crosswalk street",
}


def search(topic: str, extra: str = "") -> str:
    """Return a landscape image URL for the topic, or '' on any failure."""
    q = (_QUERY.get(topic, topic) + (" " + extra if extra else "")).strip()
    try:
        resp = requests.get(OPENVERSE, params={
            "q": q,
            "license_type": "commercial",
            "aspect_ratio": "wide",
            "size": "large",
            "page_size": 8,
        }, headers={"User-Agent": config.USER_AGENT}, timeout=20)
        if resp.status_code != 200:
            return ""
        for r in resp.json().get("results", []):
            url = r.get("url") or r.get("thumbnail")
            w, h = r.get("width") or 0, r.get("height") or 0
            if url and (not (w and h) or w >= h):  # prefer landscape
                return url
    except Exception as e:
        print(f"  [warn] image search failed: {str(e)[:80]}")
    return ""

"""Central configuration. Everything tunable lives here or in env vars."""
import os
import re

# Load a local .env file if present (for testing on your PC; Actions uses secrets)
_env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
if os.path.exists(_env_file):
    with open(_env_file, "r", encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

# --- Focus topics (drive both the feed queries and the AI selection) ---
TOPICS = [
    "virtual reality",
    "augmented reality",
    "driving simulation",
    "driver blind zone",
    "pedestrian safety",
]

# --- Gemini ---
# Keys can arrive three ways, all merged + de-duped (browser-supplied keys come
# through GEMINI_API_KEYS as a comma/newline list passed as a workflow input):
#   GEMINI_API_KEYS  - comma- or newline-separated list (the website's path)
#   GEMINI_API_KEY / _2 / _3 - individual env vars (optional repo-secret path)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_API_KEY_2 = os.environ.get("GEMINI_API_KEY_2", "")
GEMINI_API_KEY_3 = os.environ.get("GEMINI_API_KEY_3", "")
_gemini_list = [k.strip() for k in re.split(r"[,\n]", os.environ.get("GEMINI_API_KEYS", "")) if k.strip()]
GEMINI_API_KEYS = list(dict.fromkeys(
    [k for k in (GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3, *_gemini_list) if k]
))
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
# tried in order when the primary model keeps returning 429/5xx.
GEMINI_FALLBACK_MODELS = [
    m.strip() for m in os.environ.get(
        "GEMINI_FALLBACK_MODELS", "gemma-4-31b-it,gemini-2.5-flash-lite"
    ).split(",") if m.strip()
]

# --- Volume ---
MAX_POSTS_PER_RUN = int(os.environ.get("MAX_POSTS_PER_RUN", "2"))
MAX_NEWS_AGE_HOURS = int(os.environ.get("MAX_NEWS_AGE_HOURS", "48"))      # news older than this is skipped
MAX_RESEARCH_AGE_HOURS = int(os.environ.get("MAX_RESEARCH_AGE_HOURS", "240"))  # papers move slower (10 days)
MAX_PENDING_DRAFTS = int(os.environ.get("MAX_PENDING_DRAFTS", "30"))      # stop generating when this many drafts await review
INDEX_KEEP = 400  # post ids kept in the dashboard index

# --- API budgets (calls per UTC day) ---
GEMINI_DEFAULT_DAILY_LIMIT = 6
GEMINI_DAILY_LIMITS = {
    "gemini-2.5-flash": int(os.environ.get("GEMINI_25_FLASH_DAILY", "6")),
    "gemma-4-31b-it": int(os.environ.get("GEMMA_4_31B_DAILY", "450")),
    "gemini-2.5-flash-lite": int(os.environ.get("GEMINI_25_LITE_DAILY", "6")),
}
GEMINI_MIN_INTERVAL = float(os.environ.get("GEMINI_MIN_INTERVAL", "6.5"))  # sec between calls (10 RPM)

# Groq: first cross-provider fallback when every Gemini lane fails.
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_TEXT_MODEL = os.environ.get("GROQ_TEXT_MODEL", "llama-3.3-70b-versatile")
GROQ_DAILY_LIMIT = int(os.environ.get("GROQ_DAILY_LIMIT", "800"))

# GitHub Models: last-resort fallback (runs on GitHub's infra, workflow-token auth).
GH_MODELS_TOKEN = os.environ.get("GH_MODELS_TOKEN", "")
GH_MODELS_MODEL = os.environ.get("GH_MODELS_MODEL", "openai/gpt-4o-mini")
GH_MODELS_DAILY_LIMIT = int(os.environ.get("GH_MODELS_DAILY_LIMIT", "140"))

LINKEDIN_DAILY_LIMIT = int(os.environ.get("LINKEDIN_DAILY_LIMIT", "10"))

# --- History / dedup ---
HISTORY_KEEP = 600          # entries kept in state/history.json
HISTORY_FOR_DEDUP = 120     # recent topics shown to the AI for dedup

# --- Sources ---
# kind "arxiv"  -> arXiv Atom API search (research papers)
# kind "rss"    -> any RSS/Atom feed (industry & general news)
# "topic" tags every item from that source for the dashboard filter.
_GN = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
SOURCES = [
    # ---- research (arXiv) ----
    {
        "id": "arxiv-driving-sim",
        "name": "arXiv",
        "kind": "arxiv",
        "query": 'all:"driving simulator" OR all:"driving simulation"',
        "topic": "driving simulation",
    },
    {
        "id": "arxiv-pedestrian",
        "name": "arXiv",
        "kind": "arxiv",
        "query": 'all:"pedestrian safety" OR all:"pedestrian detection" OR all:"vulnerable road user"',
        "topic": "pedestrian safety",
    },
    {
        "id": "arxiv-blindzone",
        "name": "arXiv",
        "kind": "arxiv",
        "query": 'all:"blind spot" AND (all:driver OR all:vehicle OR all:driving)',
        "topic": "driver blind zone",
    },
    {
        "id": "arxiv-vr-ar",
        "name": "arXiv",
        "kind": "arxiv",
        "query": '(all:"virtual reality" OR all:"augmented reality") AND (all:driving OR all:pedestrian OR all:road OR all:traffic OR all:simulator)',
        "topic": "virtual reality",
    },
    # ---- news (Google News topic searches) ----
    {
        "id": "gnews-driving-sim",
        "name": "Google News",
        "kind": "rss",
        "url": _GN.format(q="%22driving%20simulator%22%20OR%20%22driving%20simulation%22"),
        "topic": "driving simulation",
    },
    {
        "id": "gnews-pedestrian",
        "name": "Google News",
        "kind": "rss",
        "url": _GN.format(q="%22pedestrian%20safety%22"),
        "topic": "pedestrian safety",
    },
    {
        "id": "gnews-blindzone",
        "name": "Google News",
        "kind": "rss",
        "url": _GN.format(q="driver%20%22blind%20spot%22%20vehicle"),
        "topic": "driver blind zone",
    },
    # ---- VR/AR industry feeds ----
    {
        "id": "roadtovr",
        "name": "Road to VR",
        "kind": "rss",
        "url": "https://www.roadtovr.com/feed/",
        "topic": "virtual reality",
    },
    {
        "id": "uploadvr",
        "name": "UploadVR",
        "kind": "rss",
        "url": "https://www.uploadvr.com/rss/",
        "topic": "virtual reality",
    },
    {
        "id": "sciencedaily-vr",
        "name": "ScienceDaily",
        "kind": "rss",
        "url": "https://www.sciencedaily.com/rss/computers_math/virtual_reality.xml",
        "topic": "virtual reality",
    },
]

# --- LinkedIn credentials (set as GitHub secrets; publish dry-runs without them) ---
LINKEDIN_ACCESS_TOKEN = os.environ.get("LINKEDIN_ACCESS_TOKEN", "")
LINKEDIN_AUTHOR_URN = os.environ.get("LINKEDIN_AUTHOR_URN", "")  # e.g. urn:li:person:AbC12dE

# --- Paths ---
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(ROOT, "state", "history.json")
POSTS_DIR = os.path.join(ROOT, "docs", "data", "posts")
INDEX_FILE = os.path.join(ROOT, "docs", "data", "index.json")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

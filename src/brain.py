"""The AI does the thinking, in two phases.

Phase 1 (one call): look at every fresh candidate (papers + news), cluster
duplicates, drop topics already drafted, pick the items most valuable to a
professional LinkedIn audience in VR/AR/driving-simulation/road-safety.

Phase 2 (one call per selected item): read the abstract/article text and write
the LinkedIn post in professional structure (hook, short paragraphs, source
credit, closing question, hashtags).

Provider lanes: Gemini (multi-key, multi-model) -> Groq -> GitHub Models."""
import json
import re
import time
from datetime import datetime, timezone

import requests

from . import budget, config


def _extract_json(text: str) -> dict:
    """Parse a JSON object out of model output that may carry markdown fences
    or stray prose around it (Gemma especially)."""
    text = text.strip()
    text = re.sub(r"^```[a-z]*\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in model output")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("unbalanced JSON in model output")


_last_call = 0.0

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

_SELECT_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "indices of ALL candidates covering this same paper/story",
                    },
                    "topic_key": {"type": "string", "description": "short unique English topic key for future dedup, e.g. 'vr headset reduces driver blind spot study'"},
                },
                "required": ["candidate_ids", "topic_key"],
            },
        }
    },
    "required": ["items"],
}

_SELECT_PROMPT = """You curate content for a LinkedIn page run by a professional working in: virtual reality (VR), augmented reality (AR), driving simulation, driver blind zones / blind spots, and pedestrian safety.

Below are fresh candidates: research papers (arXiv) and news items, plus topics already drafted or posted.

1. CLUSTER candidates covering the SAME paper or story. One cluster = one post.
2. DROP anything already drafted/posted (see list). Same paper or same event = duplicate even if worded differently.
3. DROP candidates NOT genuinely about the focus areas. In scope: VR/AR research, hardware, training and simulation uses; driving simulators and driving-simulation studies; ADAS, blind-spot/blind-zone detection and driver perception; pedestrian safety research, vehicle design, infrastructure, V2X, policy with real substance. OUT of scope: pure gaming/entertainment VR releases (unless genuinely notable for professionals), local traffic incident reports with no research/engineering angle, ads, listicles, product price-drop posts.
4. SELECT the {max_posts} remaining items with the HIGHEST VALUE to a professional audience. Rank by: novel research findings with concrete results > major industry/technology developments > policy and infrastructure news > opinion. A paper with a clear, surprising or applicable result beats a vague press release. Prefer items under 24h old, but substance beats freshness here. Fewer than {max_posts} — or zero — is fine if nothing is genuinely post-worthy.
5. Give each selected item a short English topic key for future dedup.

ALREADY DRAFTED/POSTED TOPICS (do not repeat):
{history}

CANDIDATES (index | kind | source | topic | age | title | snippet):
{candidates}
"""

_COMPOSE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "short internal title for the dashboard list, max 90 chars, plain factual English"},
        "template": {"type": "string", "enum": ["article", "cover"], "description": "'cover' for a bold statement-style lead (short kicker + big punchy title); 'article' for a headline + explanatory subtext. Pick 'cover' for launches/announcements/striking single facts, 'article' for studies and nuanced findings."},
        "headline": {"type": "string", "description": "the on-image headline. For 'article': the main headline (max ~80 chars, Bebas Neue, will render in caps). For 'cover': the big display title (max ~60 chars)."},
        "kicker": {"type": "string", "description": "cover template only: a short ALL-CAPS lead-in line above the title, max ~38 chars (e.g. 'NEW DRIVING-SIM RESEARCH'). Empty for article."},
        "summary": {"type": "string", "description": "article template: 1-2 sentence subtext under the headline on the cover slide, max 200 chars. Also used as the dashboard card summary."},
        "details": {
            "type": "array",
            "items": {"type": "string"},
            "description": "the fuller story as 3-7 short standalone paragraphs (2-3 sentences each). They auto-flow onto the carousel's story slides. Put the most important facts first; for a paper give method (simulator study / field test / dataset, N participants if known), main finding, and one limitation or open question.",
        },
        "post_text": {"type": "string", "description": "the complete LinkedIn CAPTION, ready to publish: hook line, blank-line-separated short paragraphs, source credit, closing question, then 3-5 hashtags on the final line"},
        "topic": {"type": "string", "enum": ["virtual reality", "augmented reality", "driving simulation", "driver blind zone", "pedestrian safety"]},
        "relevance": {"type": "string", "enum": ["high", "medium", "off_topic"], "description": "off_topic if, on reading the full text, this is not actually about the focus areas"},
    },
    "required": ["title", "template", "headline", "summary", "details", "post_text", "topic", "relevance"],
}

_COMPOSE_PROMPT = """You create LinkedIn carousel posts for a professional working in virtual reality, augmented reality, driving simulation, driver blind zones, and pedestrian safety.

You produce TWO things for the item below: (A) the on-image carousel slide text, and (B) the LinkedIn caption. FACTS ONLY — never invent results, numbers or claims beyond what the material supports. No clickbait, no hype words ("game-changer", "revolutionary", "mind-blowing").

(A) CAROUSEL SLIDES — text that will be typeset onto a designed image:
- Lead slide: choose template 'cover' (short ALL-CAPS kicker + a big punchy title) for launches/announcements/striking single facts; or 'article' (a headline + a 1-2 sentence subtext) for studies and nuanced findings.
- headline: concrete and specific. Keep it short — it renders large.
- kicker (cover only): a short ALL-CAPS category/lead-in.
- summary (article): the second-punch detail in 1-2 sentences.
- details: 3-7 short standalone paragraphs telling the fuller story (what/who/numbers/why it matters/what's next). They auto-flow onto the carousel's story slides — do NOT add slide headings. Most important facts first. For a research paper: method (simulator study, field test, dataset, N participants if given), main finding, one limitation/open question. Keep each paragraph phone-readable.

(B) LinkedIn CAPTION (post_text) — write the BEST possible LinkedIn post for a professional audience, applying 2026 LinkedIn best practices. FACTS ONLY: never invent a statistic, quote, anecdote or personal story; every claim must come from the material below.

1. THE HOOK (line 1) decides everything. Only ~140 characters show on mobile before "…see more", so line 1 must stop the scroll ON ITS OWN. Lead with the single most striking, concrete element. Choose the hook framework that best fits the FACTS:
   - Surprising number/stat — "Drivers caught 38% more hazards — without looking away from the road."
   - Counterintuitive finding — "More mirrors didn't fix the blind spot. A VR overlay did."
   - Uncomfortable truth in the field — "Most blind-spot alerts fire too late to prevent the crash."
   - Result preview — "A driving-simulator study just cut pedestrian misses by a third."
   - The question practitioners already ask — "What if a headset could teach drivers to check their blind spot?"
   NEVER open with "I'm excited", "Thrilled to share", a dictionary definition, or generic context. No hype words (game-changer, revolutionary, mind-blowing), no clickbait, no engagement bait.
2. LINE 2 is the RE-HOOK: one short line that deepens the stakes or tension and makes the reader commit to "…see more".
3. Then 3-6 SHORT paragraphs, each 1-2 sentences (~12-18 words per sentence), every paragraph separated by a BLANK LINE. Heavy white space — it must be effortless to skim on a phone. Deliver real substance: what was done, the key numbers, the mechanism/why it works, one limitation, and the practical implication for safety / engineering / training / policy. Make it worth SAVING (LinkedIn's strongest ranking signal): concrete, specific, reference-worthy — not fluff.
4. Tone: professional, clear, confident, human. First-person insight is fine ("What stands out to me…") but never fabricated experience. 0-1 emoji, only if natural.
5. Credit the source by name in the text ("New research on arXiv", "according to Road to VR"). Do NOT put the URL in the post body — LinkedIn suppresses posts with outbound links, so the link is shared separately.
6. End with ONE specific, genuine question that invites practitioners to weigh in (not a lazy "Thoughts?").
7. Final line: 3-5 hashtags mixing broad reach and niche (e.g. #RoadSafety #VirtualReality #DrivingSimulation #ADAS #HumanFactors).
8. Target 1,300-2,000 characters. Short sentences. Every line earns its place.

For research papers: name the method (simulator study, field test, dataset, survey, N participants if given), the main finding with numbers, and one limitation/open question.
For news: what happened, who's behind it, the concrete detail that matters, and the professional implication.

Also judge relevance: if the full text reveals this is NOT genuinely about VR/AR/driving simulation/blind zones/pedestrian safety for a professional audience, answer relevance="off_topic".

ITEM ({kind}, from {source}):
Title: {title}

TEXT (abstract or article body; may be partial):
{text}
"""

_POLISH_SCHEMA = {
    "type": "object",
    "properties": {
        "post_text": {"type": "string", "description": "the rewritten LinkedIn-ready post text"},
    },
    "required": ["post_text"],
}

_POLISH_PROMPT = """Rewrite the text below into the BEST possible LinkedIn post in English (translate first if it is in another language). Keep every fact exactly as given — invent nothing.

Apply 2026 LinkedIn best practices:
- LINE 1 is the hook — only ~140 chars show on mobile before "…see more", so it must stop the scroll alone. Lead with the most striking number, a counterintuitive finding, an uncomfortable truth, or the question practitioners are asking. Never open with "I'm excited"/"Thrilled to share", a definition, or generic context. No hype words or clickbait.
- LINE 2 re-hooks: deepen the stakes so the reader expands the post.
- Then 3-6 short paragraphs (1-2 sentences each, ~12-18 words/sentence), every paragraph separated by a BLANK LINE for heavy white space and easy mobile skimming. Make it save-worthy: concrete, specific, useful.
- Professional, confident, human tone; 0-1 emoji. Credit the source by name; keep any URL OUT of the body.
- End with ONE specific question inviting practitioners to comment (not "Thoughts?").
- Final line: 3-5 hashtags mixing broad and niche. Target 1,300-2,000 characters; short sentences.
{instruction}
TEXT:
{text}
"""


def _call_llm(parts: list, schema: dict) -> dict:
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    global _last_call
    models = [config.GEMINI_MODEL] + config.GEMINI_FALLBACK_MODELS
    keys = config.GEMINI_API_KEYS
    last_err = None
    deadline = time.time() + 120  # hard cap per call — a run must never stall
    cooled = False                # at most ONE throttle cool-off per call
    for model in models:
        limit = config.GEMINI_DAILY_LIMITS.get(model, config.GEMINI_DEFAULT_DAILY_LIMIT)
        for ki, api_key in enumerate(keys):
            pair = budget.gemini_pair_key(ki, model)
            if budget.remaining(pair, limit) <= 0:
                print(f"  [budget] {model} (key {ki + 1}): daily budget used up, trying next")
                continue
            for attempt in range(2):
                if time.time() > deadline:
                    raise RuntimeError(f"LLM call exceeded time cap ({last_err})")
                if attempt:
                    time.sleep(2)
                gap = config.GEMINI_MIN_INTERVAL - (time.time() - _last_call)
                if gap > 0:
                    time.sleep(gap)
                _last_call = time.time()
                try:
                    resp = requests.post(
                        _ENDPOINT.format(model=model),
                        params={"key": api_key},
                        json=body,
                        timeout=90,
                    )
                except requests.RequestException as e:
                    last_err = f"network error on {model}: {str(e)[:80]}"
                    continue
                budget.spend(pair)
                if resp.status_code == 429:
                    text_l = resp.text.lower()
                    if "perday" in text_l or "per day" in text_l or "daily" in text_l:
                        budget.exhaust(pair, limit)
                        last_err = f"HTTP 429 on {model} (key {ki + 1}, daily quota)"
                        break
                    if not cooled:
                        cooled = True
                        print(f"  [warn] HTTP 429 on {model} (key {ki + 1}), cooling off 15s...")
                        time.sleep(15)
                        last_err = f"HTTP 429 on {model} (key {ki + 1})"
                        continue
                    last_err = f"HTTP 429 on {model} (key {ki + 1}, throttled)"
                    break
                if resp.status_code == 403:
                    last_err = f"HTTP 403 on {model} (key {ki + 1})"
                    break
                if resp.status_code in (500, 502, 503, 504):
                    last_err = f"HTTP {resp.status_code} on {model}"
                    continue
                if resp.status_code != 200:
                    last_err = f"HTTP {resp.status_code} on {model} (key {ki + 1}): {resp.text[:160]}"
                    break
                data = resp.json()
                try:
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    return _extract_json(text)
                except (KeyError, IndexError, ValueError) as e:
                    last_err = f"unparseable output from {model}: {str(e)[:60]}"
                    break
    result = _call_groq(parts, schema, last_err)
    if result is None:
        result = _call_github_models(parts, schema, last_err)
    if result is not None:
        return result
    raise RuntimeError(f"LLM unavailable after retries ({last_err})")


def _call_groq(parts: list, schema: dict, gemini_err: str = ""):
    if not config.GROQ_API_KEY:
        return None
    if budget.remaining("groq", config.GROQ_DAILY_LIMIT) <= 0:
        print("  [budget] Groq fallback budget used up")
        return None
    print(f"  [warn] all Gemini lanes failed ({gemini_err}) — falling back to Groq")
    content = [{"type": "text", "text":
                "Respond ONLY with a JSON object exactly matching this JSON schema:\n"
                + json.dumps(schema)}]
    for p in parts:
        if "text" in p:
            content.append({"type": "text", "text": p["text"]})
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
            json={"model": config.GROQ_TEXT_MODEL,
                  "messages": [{"role": "user", "content": content}],
                  "response_format": {"type": "json_object"},
                  "temperature": 0.4},
            timeout=90,
        )
        budget.spend("groq")
        if resp.status_code != 200:
            print(f"  [warn] Groq HTTP {resp.status_code}: {resp.text[:140]}")
            return None
        return _extract_json(resp.json()["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"  [warn] Groq fallback failed: {str(e)[:120]}")
        return None


_GH_MODELS_URL = "https://models.github.ai/inference/chat/completions"


def _call_github_models(parts: list, schema: dict, gemini_err: str = ""):
    if not config.GH_MODELS_TOKEN:
        return None
    if budget.remaining("ghmodels", config.GH_MODELS_DAILY_LIMIT) <= 0:
        print("  [budget] GitHub Models fallback budget used up")
        return None
    print(f"  [warn] all Gemini lanes failed ({gemini_err}) — falling back to GitHub Models")
    content = [{"type": "text", "text": p["text"]} for p in parts if "text" in p]
    body = {
        "model": config.GH_MODELS_MODEL,
        "messages": [{"role": "user", "content": content}],
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": "output", "schema": schema}},
        "temperature": 0.4,
    }
    try:
        resp = requests.post(
            _GH_MODELS_URL,
            headers={"Authorization": f"Bearer {config.GH_MODELS_TOKEN}",
                     "X-GitHub-Api-Version": "2022-11-28"},
            json=body,
            timeout=90,
        )
        budget.spend("ghmodels")
        if resp.status_code != 200:
            print(f"  [warn] GitHub Models HTTP {resp.status_code}: {resp.text[:140]}")
            return None
        return _extract_json(resp.json()["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"  [warn] GitHub Models fallback failed: {str(e)[:120]}")
        return None


def select_items(candidates: list, history: list) -> list:
    """Phase 1 -> [{cluster: [items], topic_key: str}], best first."""
    if not config.GEMINI_API_KEYS and not config.GROQ_API_KEY and not config.GH_MODELS_TOKEN:
        raise RuntimeError("no LLM credentials set (GEMINI_API_KEY / GROQ_API_KEY / GH_MODELS_TOKEN)")

    recent = [e for e in history if e.get("topic")][-config.HISTORY_FOR_DEDUP:]
    history_lines = "\n".join(
        f"- {e['topic']} ({e.get('headline', '')})" for e in recent
    ) or "(nothing drafted yet)"
    now = datetime.now(timezone.utc)

    def _age(c):
        try:
            dt = datetime.fromisoformat(c["published"].replace("Z", "+00:00"))
            hours = (now - dt).total_seconds() / 3600
            return f"{hours / 24:.1f}d ago" if hours > 48 else f"{hours:.1f}h ago"
        except Exception:
            return "age unknown"

    cand_lines = "\n".join(
        f"{i} | {c['kind']} | {c['source']} | {c['topic']} | {_age(c)} | {c['title']} | {c['description'][:160]}"
        for i, c in enumerate(candidates)
    )
    # ask for a ranked shortlist larger than we'll draft, so items vetoed by
    # the dedup/relevance layers have ranked replacements waiting
    shortlist = min(config.MAX_POSTS_PER_RUN * 3, 6)
    prompt = _SELECT_PROMPT.format(
        max_posts=shortlist,
        history=history_lines,
        candidates=cand_lines,
    ) + "\nRank your selected items BEST FIRST (highest professional value first)."
    result = _call_llm([{"text": prompt}], _SELECT_SCHEMA)
    items = []
    for s in result.get("items", [])[:shortlist]:
        ids = [i for i in s.get("candidate_ids", []) if 0 <= i < len(candidates)]
        if not ids:
            continue
        items.append({"cluster": [candidates[i] for i in ids], "topic_key": s.get("topic_key", "")})
    return items


def compose_post(selected: dict, body_text: str, image_url: str = "") -> dict:
    """Phase 2 -> draft post content for one selected item."""
    cluster = selected["cluster"]
    primary = cluster[0]
    text = body_text or primary.get("description", "")
    prompt = _COMPOSE_PROMPT.format(
        kind="research paper" if primary["kind"] == "research" else "news item",
        source=primary["source"],
        title=primary["title"],
        text=text[:4500] or "(text unavailable — use only the title; keep claims minimal)",
    )
    p = _call_llm([{"text": prompt}], _COMPOSE_SCHEMA)
    # defensive: a fallback model may omit fields — never KeyError, and never
    # produce an empty caption (synthesize one from the slide fields if needed)
    details = [s.strip() for s in (p.get("details") or []) if s and s.strip()][:10]
    title = (p.get("title") or primary.get("title") or "Untitled").strip()[:120]
    headline = (p.get("headline") or title).strip()[:120]
    summary = (p.get("summary") or "").strip()[:260]
    post_text = (p.get("post_text") or "").strip()
    if not post_text:  # model didn't return a caption — build a basic one
        parts_ = [summary] + details
        post_text = "\n\n".join([x for x in parts_ if x]).strip() or title
    return {
        "topic_key": selected["topic_key"],
        "title": title,
        "post_text": post_text,
        "summary": summary,
        "topic": p.get("topic", primary["topic"]),
        "relevance": p.get("relevance", "medium"),
        # --- carousel slide fields (the exact Meta Life design) ---
        "template": p.get("template", "article"),
        "headline": headline,
        "kicker": (p.get("kicker") or "").upper()[:40],
        "details": details,
        "thank_you": True,
        "image": image_url,                  # og:image / arXiv preview if any
        "image_pos": {"x": 50, "y": 50, "zoom": 100},
        "handle": config.BRAND_HANDLE,
        # --- provenance ---
        "kind": primary["kind"],
        "source": primary["source"],
        "url": primary["url"],
        "orig_title": primary["title"],
        "cluster_urls": [c["url"] for c in cluster],
        "cluster_titles": [c["title"] for c in cluster],
    }


def polish(text: str, instruction: str = "") -> str:
    """The LinkedIn-language translator: rewrite any text (any language) into
    a professional LinkedIn post. Also used by the dashboard via the Gemini
    API directly; this server-side version exists for CLI use."""
    extra = f"Extra instruction from the author: {instruction}\n" if instruction else ""
    prompt = _POLISH_PROMPT.format(instruction=extra, text=text[:6000])
    return _call_llm([{"text": prompt}], _POLISH_SCHEMA)["post_text"].strip()

"""Orchestrator.

  python -m src.main generate   fetch -> AI select/dedup -> compose -> save drafts
  python -m src.main publish    send any drafts marked "queued" to LinkedIn

The 'generate' workflow runs hourly, composing drafts into docs/data/ and
committing them so the GitHub Pages dashboard can show them. Nothing is ever
posted automatically — 'publish' only acts on drafts the dashboard has marked
"queued" (the user's explicit "Post to LinkedIn" click)."""
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from . import article, brain, budget, config, feeds, images, state, store


def _summary(lines: list) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    text = "\n".join(lines)
    print(text)
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")


def generate() -> int:
    print(f"API budgets: {budget.summary()}")

    index = store.load_index()
    pending = store.pending_count(index)
    if pending >= config.MAX_PENDING_DRAFTS:
        _summary(["## LinkedIn bot",
                  f"Skipped: {pending} drafts already awaiting review "
                  f"(cap {config.MAX_PENDING_DRAFTS}). Review or post some first."])
        return 0

    gem_left = budget.gemini_remaining_total()
    have_fallback = bool(config.GROQ_API_KEY or config.GH_MODELS_TOKEN)
    if gem_left < 2 and not have_fallback:
        _summary(["## LinkedIn bot", f"Skipped: LLM daily budget exhausted ({budget.summary()})"])
        return 0
    affordable = config.MAX_POSTS_PER_RUN
    if gem_left and not have_fallback:
        affordable = min(config.MAX_POSTS_PER_RUN, gem_left - 1)
    affordable = min(affordable, config.MAX_PENDING_DRAFTS - pending)
    if affordable < config.MAX_POSTS_PER_RUN:
        print(f"[budget] capping run at {affordable} post(s)")
        config.MAX_POSTS_PER_RUN = max(affordable, 0)
    if config.MAX_POSTS_PER_RUN <= 0:
        _summary(["## LinkedIn bot", "Skipped: no budget/slot for a post this run."])
        return 0

    print("== Fetching feeds ==")
    candidates = feeds.fetch_all()
    print(f"Total fresh candidates: {len(candidates)}")

    history = state.load_history()
    seen = state.seen_keys(history)
    fresh = [
        c for c in candidates
        if c["url"] not in seen and state.title_hash(c["title"]) not in seen
    ]
    print(f"After exact-dedup against history: {len(fresh)}")
    if not fresh:
        _summary(["## LinkedIn bot", "No new candidates this run."])
        return 0

    print("== Phase 1: AI selects and dedupes items ==")
    try:
        selected = brain.select_items(feeds.interleave_cap(fresh, 120), history)
    except Exception as e:
        _summary(["## LinkedIn bot", f"Skipped this hour: LLM unavailable ({e})"])
        return 0
    print(f"AI selected {len(selected)} item(s)")
    if not selected:
        _summary(["## LinkedIn bot", "AI selected no items this run."])
        return 0

    print("== Phase 2: fetch text, compose drafts ==")
    saved = []
    for item in selected:
        if len(saved) >= config.MAX_POSTS_PER_RUN:
            break
        cluster = item["cluster"]
        primary = cluster[0]
        body_text, image_url = "", ""
        if primary["kind"] == "news":  # arXiv abstract already in description
            art = article.fetch_article(primary["url"])
            body_text, image_url = art["text"], art["image"]
        # no source image (typical for research papers) -> topical photo;
        # the slide design falls back to a branded backdrop if this is empty too
        if not image_url:
            image_url = images.search(primary.get("topic", ""))

        try:
            post = brain.compose_post(item, body_text, image_url)
        except Exception as e:
            print(f"  [warn] compose failed for '{item['topic_key']}': {e}")
            continue

        if post["relevance"] == "off_topic":
            print(f"  [relevance] skipping '{post['title'][:60]}' (AI judged off-topic on full read)")
            state.record(history, post, "skipped")
            continue

        if state.is_duplicate(post["title"], post["topic_key"], history):
            print(f"  [dedup] skipping '{post['title'][:60]}' (already drafted)")
            continue

        record = store.save_post(post)
        state.record(history, post, "drafted")
        for url, title in zip(post.get("cluster_urls", []), post.get("cluster_titles", [])):
            if url != post["url"]:
                state.record(history, {"orig_title": title, "url": url,
                                       "title": post["title"], "topic_key": post["topic_key"],
                                       "source": post["source"]}, "drafted")
        print(f"  drafted: {post['title'][:70]} [{post['topic']}, {post['kind']}] -> {record['id']}")
        saved.append(record)

    state.save_history(history)

    if not saved:
        _summary(["## LinkedIn bot", "No drafts composed this run (all off-topic or duplicate)."])
        return 0

    lines = ["## LinkedIn bot — drafted", ""]
    for r in saved:
        lines.append(f"- **{r['title']}** ({r['topic']}, {r['kind']}) — {r['source']} — `{r['id']}`")
    lines += ["", f"Pending review now: {store.pending_count(store.load_index())}",
              f"Budgets after run: {budget.summary()}"]
    _summary(lines)
    return 0


def publish() -> int:
    from . import publish as pub

    index = store.load_index()
    queued = [e for e in index if e.get("status") == "queued"]
    if not queued:
        print("No drafts marked 'queued' — nothing to publish.")
        return 0

    lines = ["## LinkedIn bot — published", ""]
    for entry in queued:
        record = store.load_post(entry["id"])
        if not record:
            continue
        print(f"== Publishing: {record['title'][:70]} ==")
        result = pub.publish_post(record)
        status = result.get("status")
        if status == "posted":
            record["status"] = "posted"
            record["posted_at"] = state._now()
            record["linkedin_url"] = result.get("url", "")
            store.write_post(record)
            lines.append(f"- **{record['title']}** → posted ({result.get('url', 'ok')})")
        elif status == "dry-run":
            record["status"] = "posted"
            record["posted_at"] = state._now()
            record["linkedin_url"] = "(dry-run — no credentials)"
            store.write_post(record)
            lines.append(f"- **{record['title']}** → dry-run (no LinkedIn credentials)")
        else:
            record["status"] = "draft"  # send it back for another try
            record["last_error"] = result.get("detail", status)
            store.write_post(record)
            lines.append(f"- **{record['title']}** → {status}: {result.get('detail', '')}")

    lines += ["", f"Budgets after publish: {budget.summary()}"]
    _summary(lines)
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "generate"
    if cmd == "generate":
        sys.exit(generate())
    elif cmd == "publish":
        sys.exit(publish())
    else:
        print(f"Unknown command: {cmd} (use 'generate' or 'publish')")
        sys.exit(1)

# VR/AR & Road-Safety — LinkedIn Post Studio

An automation that finds **VR, AR, driving-simulation, driver blind-zone and
pedestrian-safety** news and research, drafts professional **LinkedIn carousel
posts** about them (caption **and** designed 1080×1080 image slides in the exact
**Meta Life AI** template), and stores the drafts in this repo. A static website
(GitHub Pages) lets you review every draft, edit **everything** — template,
headline, kicker, summary, image + position, detail slides, thank-you slide,
caption — with a live carousel preview, polish/translate the caption, and
publish to LinkedIn with one click. **Nothing is ever posted automatically.**

## The image carousel (exact Meta Life design)

The slide design was lifted verbatim from `Meta Life AI Post Studio.html` into
[`docs/slide-render.js`](docs/slide-render.js) — one render module shared by:
- the **dashboard** (live preview while you edit), and
- the **server renderer** ([`src/render.py`](src/render.py), headless Chromium),
  which rasterizes each slide to a 1080×1080 PNG at publish time so the images
  posted to LinkedIn are pixel-identical to the preview.

Slide types: **Cover** (Bebas Neue kicker + Anton display title), **Article**
(headline + summary), **Detail** (heading + paragraphs, one or more), and a
**Thank-you** end slide — all on the navy Meta Life canvas with the goggles
logo, blue→purple wave, watermark and social footer. The lead slide takes an
uploaded/linked image with horizontal/vertical/zoom positioning. The post goes
up as a LinkedIn **multi-image carousel**.

## How it works

```
generate.yml (hourly / on demand)            publish.yml (on demand only)
  fetch arXiv + news feeds                     read drafts marked "queued"
  → AI selects + dedupes the best items        → post each to LinkedIn
  → AI writes a LinkedIn post for each          → flip to "posted", save the URL
  → save docs/data/posts/<id>.json + index
  → commit                                    Dashboard (GitHub Pages)
                                                list every draft, filter by topic/status
                                                open one → edit text, Polish/Translate (Gemini)
                                                Save → commits the edit via GitHub API
                                                Post to LinkedIn → queue + trigger publish.yml
```

The pipeline is adapted from the `news` bot: multi-provider AI lanes
(Gemini → Groq → GitHub Models), per-(key,model) daily budgets, exact + lexical
+ semantic dedup, and resilient feed fetching.

## Keys live only in your browser

Open the site, click **⚙ Settings**, and paste:

| Field | Used for | Get it |
|---|---|---|
| **GitHub repo** | `ahad-hossin/Linkedin-automation` | — |
| **GitHub token** | saving edits + triggering workflows | fine-grained PAT, this repo, **Contents: write** + **Actions: write** |
| **Gemini API keys** | AI drafting + the Polish/Translate button (one per line, **rotated** when one hits its limit) | https://aistudio.google.com/apikey |
| **Groq API key** | optional AI fallback | https://console.groq.com/keys |
| **LinkedIn access token** | publishing (scope `w_member_social`) | LinkedIn developer app |
| **LinkedIn author URN** | who posts, e.g. `urn:li:person:xxxx` | your LinkedIn profile/app |

Keys are stored **only in this browser** (localStorage) and are **never saved
as GitHub secrets**. When you click *Generate* or *Post*, the site passes the
needed keys to that single workflow run as one-time inputs, and the run uses
them transiently.

> ⚠️ **Public-repo note:** this repo is public, so workflow run metadata is
> publicly viewable. Keys passed as inputs are masked in logs, but use
> short-lived tokens (LinkedIn tokens already expire) and rotate Gemini keys.
> For full privacy, make the repo private (GitHub Pages on a private repo needs
> a paid plan).

## One-time setup

1. **Enable GitHub Pages:** repo **Settings → Pages → Source: Deploy from a
   branch → `main` / `/docs`**. Site goes live at
   `https://ahad-hossin.github.io/Linkedin-automation/`.
2. **Open the site**, fill in **Settings** (above).
3. Click **⚡ Generate now** (or wait for the hourly run) → drafts appear.
4. Open a draft, edit/polish, then **Post to LinkedIn**.

The **hourly** cadence runs while the Studio tab is open (toggle in Settings).
For truly unattended hourly runs with the tab closed, add `GEMINI_API_KEY` as a
repo secret — the cron will then use it.

## Run locally

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m playwright install chromium   # for slide rendering
copy .env.example .env       # then fill in your own keys
.venv\Scripts\python -m src.main generate    # fetch → select → compose → save drafts
.venv\Scripts\python -m src.render            # render the demo carousel to output/ (visual check)
.venv\Scripts\python -m src.main publish      # render + post any "queued" drafts (dry-run without creds)
```

Serve the dashboard locally: `python -m http.server 8765 --directory docs`.

## Files

```
src/feeds.py        arXiv API + RSS/Google-News fetchers
src/article.py      article body + og:image extraction (for news links)
src/brain.py        AI lanes + select / compose (caption + slide fields) / polish
src/store.py        writes docs/data/posts/<id>.json + index.json
src/render.py       headless-Chromium slide renderer -> 1080×1080 PNGs
src/publish.py      renders slides, uploads images, posts the LinkedIn carousel
src/state.py        dedup history; src/budget.py  API budgets
src/main.py         generate / publish orchestrator
docs/slide-render.js  the exact Meta Life slide design (shared preview + render)
docs/render.html      render harness Playwright loads
docs/                 static dashboard (GitHub Pages): index.html, styles.css, app.js
docs/data/            generated drafts (posts/<id>.json) + index.json
templates/DESIGN_NOTES.txt   notes on the extracted design
.github/workflows/generate.yml   hourly/on-demand drafting
.github/workflows/publish.yml    on-demand render + LinkedIn carousel posting
```

## Tuning

Edit `src/config.py`: `TOPICS`, `SOURCES`, age windows, `MAX_POSTS_PER_RUN`,
`MAX_PENDING_DRAFTS`, and daily budgets. Repo Variables `MAX_POSTS_PER_RUN` /
`MAX_PENDING_DRAFTS` override per run.

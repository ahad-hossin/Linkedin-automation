"""Server-side slide renderer.

Renders a post's carousel slides to 1080×1080 PNGs using the EXACT Meta Life
design — the same docs/slide-render.js that powers the dashboard preview — driven
headlessly by Playwright. Used at publish time so the images uploaded to
LinkedIn are pixel-identical to what the editor showed.

  render_post(post) -> [list of PNG file paths]
"""
import json
import os
from pathlib import Path

from . import config

RENDER_HTML = os.path.join(config.ROOT, "docs", "render.html")
OUTPUT_DIR = os.path.join(config.ROOT, "output")


def render_post(post: dict) -> list:
    """Render every slide of `post` to a PNG; returns the file paths in order."""
    from playwright.sync_api import sync_playwright

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    data = {"handle": post.get("handle", "metalifeai.com"), "post": post}
    pid = post.get("id", "post")
    paths = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1200, "height": 1200},
                                device_scale_factor=1)
        # inject the slide data before the page's own script runs
        page.add_init_script(f"window.__SLIDES__ = {json.dumps(data)};")
        # as_uri() percent-encodes the path (critical: the '#' in the dir name
        # would otherwise be parsed as a URL fragment and the page never loads)
        page.goto(Path(RENDER_HTML).as_uri())
        # wait for build() and web fonts (Anton/Bebas Neue/Poppins) to settle
        page.wait_for_function("window.__SLIDES_READY__ === true", timeout=15000)
        page.evaluate("document.fonts && document.fonts.ready")
        page.wait_for_timeout(600)
        slides = page.query_selector_all(".ml-slide")
        for i, el in enumerate(slides):
            path = os.path.join(OUTPUT_DIR, f"{pid}-{i + 1}.png")
            el.screenshot(path=path)
            paths.append(path)
        browser.close()
    return paths


if __name__ == "__main__":
    # quick local smoke test: render the demo deck
    demo = {
        "id": "demo",
        "template": "cover",
        "kicker": "NEW DRIVING-SIM RESEARCH",
        "headline": "Augmented reality windshield overlays slash driver blind-spot misses by 38%",
        "summary": "A closed-course study with 42 drivers.",
        "details": ["Researchers instrumented test vehicles with an AR head-up display that renders pedestrians hidden behind the A-pillar.",
                    "Across 42 participants the system reduced missed detections from 21% to 13%, a relative improvement of 38%.",
                    "Older drivers benefited most, though the trial was on a closed course and real-world validation is still pending."],
        "thank_you": True,
    }
    print(render_post(demo))

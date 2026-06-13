"""Fetch an article page and extract its body text (feeds the AI compose step).
Generic heuristics; every step degrades gracefully to an empty string."""
import re

from bs4 import BeautifulSoup

from .feeds import http_get


def fetch_article(url: str) -> str:
    """Returns the article body text ('' on failure)."""
    try:
        resp = http_get(url)
        if resp.status_code != 200:
            return ""
        html = resp.text
    except Exception as e:
        print(f"  [warn] article fetch failed {url}: {e}")
        return ""

    soup = BeautifulSoup(html, "html.parser")
    scope = (soup.find("article")
             or soup.find(class_=re.compile(r"(article|news|post|details?)[-_]?(body|content|details)", re.I))
             or soup)
    paras = []
    for p in scope.find_all("p"):
        t = p.get_text(" ", strip=True)
        if len(t) >= 60 and not re.search(r"(copyright|all rights reserved|follow us|subscribe)", t, re.I):
            paras.append(t)
    text = "\n".join(paras)
    if not text:
        d = soup.find("meta", attrs={"property": "og:description"}) or \
            soup.find("meta", attrs={"name": "description"})
        if d and d.get("content"):
            text = d["content"].strip()
    return text[:5000]

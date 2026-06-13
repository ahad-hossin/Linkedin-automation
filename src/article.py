"""Fetch an article page and extract its body text (feeds the AI compose step).
Generic heuristics; every step degrades gracefully to an empty string."""
import re

from bs4 import BeautifulSoup

from .feeds import http_get


def fetch_article(url: str) -> dict:
    """Returns {"title": str, "text": str, "image": str}; empty strings on failure."""
    out = {"title": "", "text": "", "image": ""}
    try:
        resp = http_get(url)
        if resp.status_code != 200:
            return out
        html = resp.text
    except Exception as e:
        print(f"  [warn] article fetch failed {url}: {e}")
        return out

    soup = BeautifulSoup(html, "html.parser")
    og = soup.find("meta", attrs={"property": "og:image"}) or \
        soup.find("meta", attrs={"name": "og:image"})
    if og and og.get("content"):
        out["image"] = og["content"].strip()
    ogt = soup.find("meta", attrs={"property": "og:title"}) or \
        soup.find("meta", attrs={"name": "og:title"})
    title = (ogt.get("content").strip() if ogt and ogt.get("content") else "")
    if not title and soup.title and soup.title.string:
        title = soup.title.string.strip()
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(" ", strip=True) if h1 else ""
    out["title"] = re.sub(r"\s+", " ", title)[:200]

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
    out["text"] = text[:5000]
    return out

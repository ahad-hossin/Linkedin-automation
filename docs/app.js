/* VR/AR & Road-Safety LinkedIn Post Studio — static dashboard.
   Reads drafts from docs/data/, edits them, polishes via Gemini, and writes
   back to the repo via the GitHub API (token kept in localStorage). Posting is
   done by the publish workflow, which this UI triggers — never automatic. */

const TOPICS = ["virtual reality", "augmented reality", "driving simulation",
                "driver blind zone", "pedestrian safety"];
const POSTS_PATH = "docs/data/posts";
const INDEX_PATH = "docs/data/index.json";

const store = {
  get repo() { return localStorage.getItem("ls_repo") || guessRepo(); },
  get ghtoken() { return localStorage.getItem("ls_ghtoken") || ""; },
  get geminiKeys() {
    return (localStorage.getItem("ls_gemini") || "")
      .split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  },
  get groq() { return localStorage.getItem("ls_groq") || ""; },
  get liToken() { return localStorage.getItem("ls_litoken") || ""; },
  get liUrn() { return localStorage.getItem("ls_liurn") || ""; },
  get autohour() { return localStorage.getItem("ls_autohour") === "1"; },
};

function guessRepo() {
  // owner.github.io/repo  ->  owner/repo
  const host = location.hostname.split(".")[0];
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return host && seg ? `${host}/${seg}` : "";
}

let state = { index: [], filterTopic: "all", filterStatus: "all" };

/* ---------------- data loading ---------------- */

async function loadIndex() {
  try {
    const r = await fetch(`data/index.json?t=${Date.now()}`);
    state.index = r.ok ? await r.json() : [];
  } catch { state.index = []; }
}

async function loadPost(id) {
  const r = await fetch(`data/posts/${id}.json?t=${Date.now()}`);
  if (!r.ok) throw new Error("post not found");
  return r.json();
}

/* ---------------- GitHub API ---------------- */

function ghHeaders() {
  return {
    "Authorization": `Bearer ${store.ghtoken}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghGetFile(path) {
  const r = await fetch(`https://api.github.com/repos/${store.repo}/contents/${path}`,
                        { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${(await r.text()).slice(0,120)}`);
  return r.json(); // {content (b64), sha, ...}
}

function utf8ToB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function ghPutFile(path, obj, message) {
  const existing = await ghGetFile(path);
  const body = {
    message,
    content: utf8ToB64(JSON.stringify(obj, null, 1)),
    ...(existing ? { sha: existing.sha } : {}),
  };
  const r = await fetch(`https://api.github.com/repos/${store.repo}/contents/${path}`,
                        { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0,160)}`);
  return r.json();
}

async function dispatchWorkflow(file, inputs) {
  if (!store.ghtoken || !store.repo) throw new Error("Set your GitHub repo and token in Settings first.");
  const r = await fetch(
    `https://api.github.com/repos/${store.repo}/actions/workflows/${file}/dispatches`,
    { method: "POST", headers: ghHeaders(),
      body: JSON.stringify({ ref: "main", inputs: inputs || {} }) });
  if (!r.ok && r.status !== 204)
    throw new Error(`dispatch ${r.status}: ${(await r.text()).slice(0,160)}`);
}

/* Save the edited post and keep index.json in sync (single source of truth). */
async function persistPost(record) {
  if (!store.ghtoken || !store.repo) throw new Error("Set your GitHub repo and token in Settings first.");
  await ghPutFile(`${POSTS_PATH}/${record.id}.json`, record, `studio: edit ${record.id}`);
  // sync the index entry
  const idxFile = await ghGetFile(INDEX_PATH);
  let index = idxFile ? JSON.parse(decodeURIComponent(escape(atob(idxFile.content)))) : [];
  const keys = ["id","title","summary","topic","kind","source","url","status","created_at","posted_at","linkedin_url"];
  const trimmed = Object.fromEntries(keys.map(k => [k, record[k] ?? ""]));
  const i = index.findIndex(e => e.id === record.id);
  if (i >= 0) index[i] = { ...index[i], ...trimmed }; else index.unshift(trimmed);
  await ghPutFile(INDEX_PATH, index, `studio: index ${record.id}`);
}

/* ---------------- Gemini polish / translate ---------------- */

const POLISH_SCHEMA = {
  type: "object",
  properties: { post_text: { type: "string" } },
  required: ["post_text"],
};

async function geminiPolish(text, instruction) {
  const keys = store.geminiKeys;
  if (!keys.length) throw new Error("Add at least one Gemini API key in Settings to use Polish / Translate.");
  const prompt =
`Rewrite the text below into the BEST possible LinkedIn post in English (translate first if it is in another language). Keep every fact exactly as given — invent nothing.

Apply 2026 LinkedIn best practices:
- LINE 1 is the hook — only ~140 characters show on mobile before "…see more", so it must stop the scroll on its own. Lead with the most striking number, a counterintuitive finding, an uncomfortable industry truth, or the question practitioners are already asking. Never open with "I'm excited"/"Thrilled to share", a definition, or generic context. No hype words ("game-changer", "revolutionary") and no clickbait.
- LINE 2 re-hooks: one line that deepens the stakes so the reader expands the post.
- Then 3-6 short paragraphs (1-2 sentences each, ~12-18 words per sentence), every paragraph separated by a BLANK LINE — heavy white space, easy to skim on a phone. Make it save-worthy: concrete, specific, useful.
- Professional, confident, human tone; 0-1 emoji. Credit the source by name; keep any URL OUT of the body (LinkedIn suppresses outbound links).
- End with ONE specific question inviting practitioners to comment (not a lazy "Thoughts?").
- Final line: 3-5 hashtags mixing broad reach and niche. Target 1,300-2,000 characters; short sentences.
${instruction ? "Extra instruction from the author: " + instruction + "\n" : ""}
TEXT:
${text}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: POLISH_SCHEMA },
  };
  // rotate across keys: on a quota/auth error (429/403) try the next key
  let lastErr = "no keys";
  for (const key of keys) {
    let r;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { lastErr = e.message; continue; }
    if (r.status === 429 || r.status === 403) { lastErr = `Gemini ${r.status} (key …${key.slice(-4)}) — trying next`; continue; }
    if (!r.ok) { lastErr = `Gemini ${r.status}: ${(await r.text()).slice(0,140)}`; continue; }
    const data = await r.json();
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(out).post_text || text;
  }
  throw new Error(`All Gemini keys failed (${lastErr})`);
}

/* ---------------- views ---------------- */

const app = () => document.getElementById("app");

function renderList() {
  const items = state.index.filter(e =>
    (state.filterTopic === "all" || e.topic === state.filterTopic) &&
    (state.filterStatus === "all" || e.status === state.filterStatus));

  const chips = (label, key, val, cur) =>
    `<span class="chip ${cur === val ? "active" : ""}" data-${key}="${val}">${label}</span>`;

  const topicChips = [chips("All topics", "topic", "all", state.filterTopic),
    ...TOPICS.map(t => chips(titleCase(t), "topic", t, state.filterTopic))].join("");
  const statusChips = ["all","draft","queued","posted"]
    .map(s => chips(titleCase(s === "all" ? "any status" : s), "status", s, state.filterStatus)).join("");

  const cards = items.map(e => `
    <div class="card" data-id="${e.id}">
      <div class="card-meta">
        <span class="tag ${e.kind}">${e.kind === "research" ? "Research" : "News"}</span>
        <span class="tag">${titleCase(e.topic || "")}</span>
        <span class="tag status-${e.status}">${titleCase(e.status)}</span>
      </div>
      <h3>${esc(e.title)}</h3>
      <p class="summary">${esc(e.summary || "")}</p>
      <p class="src">${esc(e.source)} · ${fmtDate(e.created_at)}</p>
    </div>`).join("");

  app().innerHTML = `
    <div class="filters">${topicChips}</div>
    <div class="gen-bar">
      <input id="gen-url" class="gen-url" type="text"
        placeholder="Paste an article or paper URL to cover it specifically (optional)" />
      <button id="gen-btn" class="btn primary">⚡ Generate now</button>
    </div>
    <div class="filters">${statusChips}</div>
    ${items.length ? `<div class="grid">${cards}</div>`
      : `<div class="empty"><h2>No posts yet</h2>
         <p>Click <b>Generate now</b> (or paste a link to cover), or wait for the hourly run.</p></div>`}`;

  document.getElementById("gen-btn").onclick = triggerGenerate;
  document.getElementById("gen-url").addEventListener("keydown", e => { if (e.key === "Enter") triggerGenerate(); });

  app().querySelectorAll(".chip[data-topic]").forEach(c =>
    c.onclick = () => { state.filterTopic = c.dataset.topic; renderList(); });
  app().querySelectorAll(".chip[data-status]").forEach(c =>
    c.onclick = () => { state.filterStatus = c.dataset.status; renderList(); });
  app().querySelectorAll(".card").forEach(c =>
    c.onclick = () => { location.hash = `#/post/${c.dataset.id}`; });

  setPill(`${state.index.filter(e=>e.status==="draft").length} drafts · ${state.index.length} total`);
}

async function renderEditor(id) {
  app().innerHTML = `<div class="loading">Loading draft…</div>`;
  let post;
  try { post = await loadPost(id); }
  catch { app().innerHTML = `<div class="empty"><h2>Not found</h2><a href="#/">← Back</a></div>`; return; }

  // flatten any legacy detail_slides into the studio's flat details list
  let details = post.details;
  if (!details && Array.isArray(post.detail_slides))
    details = post.detail_slides.flatMap(d => d.paragraphs || []);

  // working model (defaults fill older drafts)
  const m = {
    title: post.title || "",
    template: post.template || "article",
    headline: post.headline || post.title || "",
    kicker: post.kicker || "",
    summary: post.summary || "",
    details: details || [],
    thank_you: post.thank_you !== false,
    thanks_title: post.thanks_title || "Thank you",
    thanks_brand: post.thanks_brand || "Meta Life AI",
    thanks_at: post.thanks_at || "@metaLifeAI",
    thanks_follow: post.thanks_follow || "Follow us for more\nnews and updates of our work",
    image: post.image || "",
    image_pos: post.image_pos || { x: 50, y: 50, zoom: 100 },
    handle: post.handle || "metalifeai.com",
    post_text: post.post_text || "",
    attach_link: post.attach_link !== false,
  };

  app().innerHTML = `
    <a class="back-link" href="#/">← All posts</a>
    <div class="editor">
      <div class="panel" style="max-height:none">
        <h2>Edit carousel</h2>

        <label class="field">Lead template</label>
        <div class="seg" id="seg-template">
          <button data-t="article" class="${m.template==='article'?'on':''}">Article<small>headline + summary</small></button>
          <button data-t="cover" class="${m.template==='cover'?'on':''}">Cover<small>kicker + big title</small></button>
        </div>

        <div id="fld-kicker" style="${m.template==='cover'?'':'display:none'}">
          <label class="field">Kicker (cover, ALL-CAPS lead-in)</label>
          <input id="f-kicker" type="text" value="${escAttr(m.kicker)}" />
        </div>

        <label class="field" id="lbl-headline">${m.template==='cover'?'Big title':'Headline'}</label>
        <input id="f-headline" type="text" value="${escAttr(m.headline)}" />

        <div id="fld-summary" style="${m.template==='cover'?'display:none':''}">
          <label class="field">Summary (subtext on lead slide)</label>
          <textarea id="f-summary" style="min-height:80px">${esc(m.summary)}</textarea>
        </div>

        <label class="field">Lead image</label>
        <div class="row">
          <button id="btn-upload" class="btn subtle">⬆ Upload image</button>
          <button id="btn-rmimg" class="btn ghost" ${m.image?'':'disabled'}>Remove</button>
          <input id="f-file" type="file" accept="image/*" hidden />
        </div>
        <input id="f-imgurl" type="text" placeholder="…or paste an image URL" value="${m.image && /^https?:/.test(m.image) ? escAttr(m.image):''}" style="margin-top:8px" />
        <div id="img-controls" style="${m.image?'':'display:none'}">
          <label class="rng">Horizontal <input id="f-px" type="range" min="0" max="100" value="${m.image_pos.x}"></label>
          <label class="rng">Vertical <input id="f-py" type="range" min="0" max="100" value="${m.image_pos.y}"></label>
          <label class="rng">Zoom <input id="f-pz" type="range" min="100" max="250" value="${m.image_pos.zoom}"></label>
        </div>

        <label class="field">Full details <small style="font-weight:400;color:var(--muted)">— one paragraph per blank line; auto-flows onto story slides</small></label>
        <textarea id="f-details" style="min-height:160px" placeholder="Paste the full story — paragraphs flow onto extra carousel slides…">${esc((m.details||[]).join("\n\n"))}</textarea>

        <label class="checkbox" style="margin-top:14px"><input id="f-ty" type="checkbox" ${m.thank_you?'checked':''}/> Thank-you end slide</label>
        <div id="fld-thanks" style="${m.thank_you?'':'display:none'}">
          <label class="field">Thank-you title</label>
          <input id="f-tytitle" type="text" value="${escAttr(m.thanks_title)}" />
          <label class="field">Brand name</label>
          <input id="f-tybrand" type="text" value="${escAttr(m.thanks_brand)}" />
          <label class="field">@handle</label>
          <input id="f-tyat" type="text" value="${escAttr(m.thanks_at)}" />
          <label class="field">Follow line</label>
          <textarea id="f-tyfollow" style="min-height:60px">${esc(m.thanks_follow)}</textarea>
        </div>

        <label class="field">Footer handle</label>
        <input id="f-handle" type="text" value="${escAttr(m.handle)}" />

        <label class="field">LinkedIn caption</label>
        <div class="toolbar">
          <button id="btn-polish" class="btn subtle">✦ Polish to LinkedIn style</button>
          <button id="btn-translate" class="btn subtle">🌐 Translate &amp; format</button>
        </div>
        <textarea id="f-text" class="post">${esc(m.post_text)}</textarea>
        <div class="charcount"><span id="cc">0</span> chars</div>
        <label class="checkbox"><input id="f-link" type="checkbox" ${m.attach_link?'checked':''}/> Add source link in the comments note</label>

        <div class="toolbar" style="margin-top:16px">
          <button id="btn-save" class="btn primary">Save changes</button>
          <button id="btn-post" class="btn ok">Post to LinkedIn ▸</button>
        </div>
        <p class="hint" id="ed-status"></p>
        <p class="hint">
          Status: <b>${titleCase(post.status)}</b>${post.linkedin_url && String(post.linkedin_url).startsWith("http") ? ` · <a href="${post.linkedin_url}" target="_blank">view on LinkedIn</a>` : ""} ·
          Source: <a href="${escAttr(post.url)}" target="_blank">${escAttr(post.source)}</a>
          ${post.last_error ? `<br><span style="color:var(--danger)">Last error: ${esc(post.last_error)}</span>` : ""}
        </p>
      </div>

      <div class="panel li-panel">
        <h2>LinkedIn preview</h2>
        <div class="li-card">
          <div class="li-top">
            <div class="li-avatar">in</div>
            <div class="li-meta">
              <div class="li-name">Your Name <span class="li-deg">· 1st</span></div>
              <div class="li-sub">VR · AR · Road-safety</div>
              <div class="li-sub li-time">Now · 🌐</div>
            </div>
            <div class="li-more-dots">···</div>
          </div>
          <div class="li-caption" id="pv-caption"></div>
          <button class="li-seemore" id="li-seemore" hidden>…more</button>
          <div class="li-carousel" id="li-carousel">
            <div class="li-track" id="li-track"></div>
            <button class="li-nav li-prev" id="li-prev" aria-label="Previous">‹</button>
            <button class="li-nav li-next" id="li-next" aria-label="Next">›</button>
            <span class="li-count" id="li-count">1 / 1</span>
          </div>
          <div class="li-dots" id="li-dots"></div>
          <div class="li-stats"><span>👍❤️💡 128</span><span>24 comments · 9 reposts</span></div>
          <div class="li-actions">
            <span>👍 Like</span><span>💬 Comment</span><span>🔁 Repost</span><span>➤ Send</span>
          </div>
        </div>
      </div>
    </div>`;

  const $ = s => document.getElementById(s);
  const edStatus = (t) => $("ed-status").textContent = t;

  let carIndex = 0;       // current carousel slide
  let carCount = 1;

  function renderCaption() {
    const cap = $("pv-caption"), btn = $("li-seemore");
    cap.textContent = m.post_text;
    const expanded = cap.classList.contains("expanded");
    cap.classList.toggle("clamp", !expanded);
    // measure overflow against the clamped (3-line) height, then restore state,
    // so the toggle shows "…more" when collapsed and "show less" when expanded
    requestAnimationFrame(() => {
      cap.classList.add("clamp");
      const overflowing = cap.scrollHeight > cap.clientHeight + 2;
      cap.classList.toggle("clamp", !expanded);
      btn.hidden = !overflowing;
      btn.textContent = expanded ? "show less" : "…more";
    });
  }

  let refreshT;
  function refresh() {
    renderCaption();
    $("cc").textContent = m.post_text.length;
    // debounce: pagination + autofit measure the live DOM, so coalesce keystrokes
    clearTimeout(refreshT);
    refreshT = setTimeout(buildCarousel, 80);
  }

  // build the swipeable LinkedIn-style carousel from the rendered slides
  function buildCarousel() {
    const track = $("li-track");
    const carousel = $("li-carousel");
    window.MLSlides.renderInto(track, m, { handle: m.handle });
    const slides = [...track.querySelectorAll(":scope > .ml-slide")];
    carCount = slides.length || 1;
    if (carIndex >= carCount) carIndex = carCount - 1;
    // size each slide to the (square) carousel viewport and scale the 1080 art
    const vw = carousel.clientWidth || 440;
    const scale = vw / 1080;
    track.style.width = (vw * carCount) + "px";
    slides.forEach(el => {
      const cell = document.createElement("div");
      cell.className = "li-cell";
      cell.style.width = cell.style.height = vw + "px";
      el.style.transform = `scale(${scale})`;
      el.style.transformOrigin = "top left";
      track.insertBefore(cell, el);
      cell.appendChild(el);
    });
    carousel.style.height = vw + "px";
    // dots
    $("li-dots").innerHTML = slides.map((_, i) =>
      `<span class="li-dot${i === carIndex ? " on" : ""}" data-i="${i}"></span>`).join("");
    $("li-dots").querySelectorAll(".li-dot").forEach(d => d.onclick = () => goTo(+d.dataset.i));
    goTo(carIndex);
  }

  function goTo(i) {
    carIndex = Math.max(0, Math.min(carCount - 1, i));
    const vw = $("li-carousel").clientWidth || 440;
    $("li-track").style.transform = `translateX(${-carIndex * vw}px)`;
    $("li-count").textContent = `${carIndex + 1} / ${carCount}`;
    $("li-prev").classList.toggle("hide", carIndex === 0);
    $("li-next").classList.toggle("hide", carIndex === carCount - 1);
    $("li-dots").querySelectorAll(".li-dot").forEach((d, k) => d.classList.toggle("on", k === carIndex));
  }

  // template toggle
  $("seg-template").querySelectorAll("button").forEach(b => b.onclick = () => {
    m.template = b.dataset.t;
    $("seg-template").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.t === m.template));
    $("fld-kicker").style.display = m.template === "cover" ? "" : "none";
    $("fld-summary").style.display = m.template === "cover" ? "none" : "";
    $("lbl-headline").textContent = m.template === "cover" ? "Big title" : "Headline";
    refresh();
  });

  // text fields
  $("f-headline").oninput = e => { m.headline = e.target.value; refresh(); };
  $("f-kicker").oninput = e => { m.kicker = e.target.value; refresh(); };
  $("f-summary").oninput = e => { m.summary = e.target.value; refresh(); };
  $("f-handle").oninput = e => { m.handle = e.target.value; refresh(); };
  $("f-details").oninput = e => { m.details = e.target.value.split(/\n{2,}/).map(s => s.trim()).filter(Boolean); refresh(); };
  $("f-tytitle").oninput = e => { m.thanks_title = e.target.value; refresh(); };
  $("f-tybrand").oninput = e => { m.thanks_brand = e.target.value; refresh(); };
  $("f-tyat").oninput = e => { m.thanks_at = e.target.value; refresh(); };
  $("f-tyfollow").oninput = e => { m.thanks_follow = e.target.value; refresh(); };
  $("f-ty").onchange = e => { m.thank_you = e.target.checked; $("fld-thanks").style.display = e.target.checked ? "" : "none"; refresh(); };

  // image
  $("btn-upload").onclick = () => $("f-file").click();
  $("f-file").onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    m.image = await downscaleToDataUrl(file, 1400);
    $("f-imgurl").value = ""; $("btn-rmimg").disabled = false; $("img-controls").style.display = ""; refresh();
  };
  $("f-imgurl").oninput = e => { m.image = e.target.value.trim(); $("btn-rmimg").disabled = !m.image; $("img-controls").style.display = m.image ? "" : "none"; refresh(); };
  $("btn-rmimg").onclick = () => { m.image = ""; $("f-imgurl").value=""; $("f-file").value=""; $("btn-rmimg").disabled = true; $("img-controls").style.display = "none"; refresh(); };
  $("f-px").oninput = e => { m.image_pos.x = +e.target.value; refresh(); };
  $("f-py").oninput = e => { m.image_pos.y = +e.target.value; refresh(); };
  $("f-pz").oninput = e => { m.image_pos.zoom = +e.target.value; refresh(); };

  // caption
  $("f-text").oninput = e => { m.post_text = e.target.value; refresh(); };
  $("f-link").onchange = e => { m.attach_link = e.target.checked; };
  $("btn-polish").onclick = () => runPolish("");
  $("btn-translate").onclick = () => runPolish("The text may be in another language; translate it to English.");
  $("li-seemore").onclick = () => { $("pv-caption").classList.toggle("expanded"); renderCaption(); };

  // carousel navigation: arrows + swipe/drag
  $("li-prev").onclick = e => { e.stopPropagation(); goTo(carIndex - 1); };
  $("li-next").onclick = e => { e.stopPropagation(); goTo(carIndex + 1); };
  // keep the arrows from starting a drag (which would capture the pointer and
  // swallow their own click)
  [$("li-prev"), $("li-next")].forEach(b => b.addEventListener("pointerdown", e => e.stopPropagation()));

  let dragX = null, dragStart = 0, captured = false, pid = null;
  const car = $("li-carousel");
  car.addEventListener("pointerdown", e => { dragX = e.clientX; dragStart = carIndex; pid = e.pointerId; captured = false; });
  car.addEventListener("pointermove", e => {
    if (dragX === null) return;
    const dx = e.clientX - dragX;
    if (!captured && Math.abs(dx) > 6) { captured = true; try { car.setPointerCapture(pid); } catch (_) {} }
    if (captured) { const vw = car.clientWidth || 440; $("li-track").style.transform = `translateX(${-dragStart * vw + dx}px)`; }
  });
  const endDrag = e => {
    if (dragX === null) return;
    const dx = e.clientX - dragX; const wasDrag = captured;
    dragX = null; captured = false;
    if (wasDrag && Math.abs(dx) > 50) goTo(dragStart + (dx < 0 ? 1 : -1));
    else if (wasDrag) goTo(dragStart);
  };
  car.addEventListener("pointerup", endDrag);
  car.addEventListener("pointercancel", endDrag);
  let rsT; window.addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(buildCarousel, 150); });

  async function runPolish(instruction) {
    edStatus("Polishing with Gemini…");
    try {
      const out = await geminiPolish(m.post_text, instruction);
      m.post_text = out; $("f-text").value = out; refresh();
      edStatus("Rewritten. Review and Save."); toast("Rewritten ✦", "ok");
    } catch (e) { edStatus(e.message); toast(e.message, "err"); }
  }

  const collect = () => ({ ...post, ...m, title: ($("f-headline").value.trim() || post.title) });

  $("btn-save").onclick = async () => {
    edStatus("Saving to GitHub…");
    try { const rec = collect(); await persistPost(rec); post = rec; edStatus("Saved."); toast("Saved to repo", "ok"); }
    catch (e) { edStatus(e.message); toast(e.message, "err"); }
  };

  $("btn-post").onclick = async () => {
    if (!store.liToken || !store.liUrn) {
      edStatus("Add your LinkedIn token + author URN in Settings first.");
      toast("LinkedIn credentials missing — see Settings", "err"); return;
    }
    if (!confirm("Queue this carousel for LinkedIn? The publish workflow renders the slides and posts within a minute.")) return;
    edStatus("Queuing + triggering publish workflow…");
    try {
      const rec = { ...collect(), status: "queued" };
      await persistPost(rec);
      await dispatchWorkflow("publish.yml", { linkedin_token: store.liToken, linkedin_urn: store.liUrn });
      post = rec;
      edStatus("Queued. Posting now — refresh in a minute for the LinkedIn link.");
      toast("Queued for LinkedIn ▸", "ok");
    } catch (e) { edStatus(e.message); toast(e.message, "err"); }
  };

  refresh();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh); // re-fit once slide fonts load
  setPill(`Editing · ${titleCase(post.status)}`);
}

/* downscale an uploaded image and return a JPEG data URL (keeps repo JSON small) */
function downscaleToDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxDim) { const r = maxDim / Math.max(w, h); w = Math.round(w*r); h = Math.round(h*r); }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("could not read image"));
    img.src = URL.createObjectURL(file);
  });
}

/* trigger the generate workflow, passing the browser-held AI keys as one-time
   inputs. New drafts land in the repo a minute later; the user hits Refresh. */
async function triggerGenerate() {
  const keys = store.geminiKeys;
  if (!keys.length && !store.groq) {
    toast("Add a Gemini or Groq key in Settings first", "err"); openSettings(); return;
  }
  const urlEl = document.getElementById("gen-url");
  const url = urlEl ? urlEl.value.trim() : "";
  if (url && !/^https?:\/\//i.test(url)) { toast("That doesn't look like a URL (needs http/https)", "err"); return; }
  try {
    await dispatchWorkflow("generate.yml", {
      gemini_keys: keys.join(","),
      groq_key: store.groq,
      url,
    });
    toast(url ? "Covering your link… draft arrives in ~1 min. Hit ↻ Refresh."
              : "Generating… new drafts arrive in ~1 min. Hit ↻ Refresh.", "ok");
    if (urlEl) urlEl.value = "";
  } catch (e) { toast(e.message, "err"); }
}

/* ---------------- settings + chrome ---------------- */

function openSettings() {
  document.getElementById("set-repo").value = store.repo;
  document.getElementById("set-ghtoken").value = store.ghtoken;
  document.getElementById("set-gemini").value = localStorage.getItem("ls_gemini") || "";
  document.getElementById("set-groq").value = store.groq;
  document.getElementById("set-litoken").value = store.liToken;
  document.getElementById("set-liurn").value = store.liUrn;
  document.getElementById("set-autohour").checked = store.autohour;
  document.getElementById("set-status").textContent = "";
  document.getElementById("settings-modal").classList.remove("hidden");
}
function wireSettings() {
  document.getElementById("settings-btn").onclick = openSettings;
  document.getElementById("set-cancel").onclick = () =>
    document.getElementById("settings-modal").classList.add("hidden");
  document.getElementById("set-save").onclick = () => {
    const v = id => document.getElementById(id).value.trim();
    localStorage.setItem("ls_repo", v("set-repo"));
    localStorage.setItem("ls_ghtoken", v("set-ghtoken"));
    localStorage.setItem("ls_gemini", v("set-gemini"));
    localStorage.setItem("ls_groq", v("set-groq"));
    localStorage.setItem("ls_litoken", v("set-litoken"));
    localStorage.setItem("ls_liurn", v("set-liurn"));
    localStorage.setItem("ls_autohour", document.getElementById("set-autohour").checked ? "1" : "0");
    document.getElementById("settings-modal").classList.add("hidden");
    setupAutoHour();
    toast("Settings saved", "ok");
  };
}

/* hourly auto-generate while the tab is open (opt-in). */
let autoHourTimer = null;
function setupAutoHour() {
  if (autoHourTimer) { clearInterval(autoHourTimer); autoHourTimer = null; }
  if (store.autohour) autoHourTimer = setInterval(triggerGenerate, 60 * 60 * 1000);
}

function setPill(t) { document.getElementById("status-pill").textContent = t; }
let toastTimer;
function toast(msg, kind) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.className = `toast ${kind || ""}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

/* ---------------- helpers ---------------- */

function titleCase(s) { return (s||"").replace(/\b\w/g, c => c.toUpperCase()); }
function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
function fmtDate(s) { if (!s) return ""; const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString(undefined, {month:"short", day:"numeric"}); }

/* ---------------- router ---------------- */

async function route() {
  const h = location.hash;
  const m = h.match(/^#\/post\/(.+)$/);
  if (m) { await renderEditor(m[1]); }
  else { renderList(); }
}

async function boot() {
  wireSettings();
  document.getElementById("refresh-btn").onclick = async () => { await loadIndex(); route(); toast("Refreshed", "ok"); };
  await loadIndex();
  window.addEventListener("hashchange", route);
  route();
  setupAutoHour();
  if (!store.repo || !store.ghtoken) openSettings();
}
boot();

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
`Rewrite the text below as a polished, professional LinkedIn post in English (translate first if it is in another language). Keep every fact exactly as given — invent nothing.

Structure: a strong hook on line 1 that works alone above the fold; blank-line-separated short paragraphs (1-3 sentences); professional but human tone; one closing question; 3-5 hashtags on the final line. 120-220 words. No clickbait or hype words ("game-changer", "revolutionary").
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
    <div class="filters">${topicChips}<span class="spacer"></span>
      <button id="gen-btn" class="btn primary">⚡ Generate now</button>
    </div>
    <div class="filters">${statusChips}</div>
    ${items.length ? `<div class="grid">${cards}</div>`
      : `<div class="empty"><h2>No posts yet</h2>
         <p>Click <b>Generate now</b>, or wait for the hourly run. Drafts appear here for review.</p></div>`}`;

  document.getElementById("gen-btn").onclick = triggerGenerate;

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

  if (post.attach_link === undefined) post.attach_link = true;

  app().innerHTML = `
    <a class="back-link" href="#/">← All posts</a>
    <div class="editor">
      <div class="panel">
        <h2>Edit post</h2>
        <label class="field">Title (internal)</label>
        <input id="f-title" type="text" value="${escAttr(post.title)}" />

        <label class="field">Post text</label>
        <div class="toolbar">
          <button id="btn-polish" class="btn subtle">✦ Polish to LinkedIn style</button>
          <button id="btn-translate" class="btn subtle">🌐 Translate &amp; format</button>
        </div>
        <textarea id="f-text" class="post">${esc(post.post_text)}</textarea>
        <div class="charcount"><span id="cc">0</span> chars</div>

        <label class="checkbox"><input id="f-link" type="checkbox" ${post.attach_link ? "checked":""}/> Attach source link to the post</label>

        <div class="toolbar" style="margin-top:16px">
          <button id="btn-save" class="btn primary">Save changes</button>
          <button id="btn-post" class="btn ok">Post to LinkedIn ▸</button>
        </div>
        <p class="hint" id="ed-status"></p>
      </div>

      <div class="panel">
        <h2>Preview</h2>
        <div class="li-preview">
          <div class="li-head">
            <div class="li-avatar">in</div>
            <div><div class="li-name">Your Name</div><div class="li-sub">VR / Road-safety · Now</div></div>
          </div>
          <div class="li-body" id="pv-body"></div>
          <div class="li-link" id="pv-link">
            <div class="t">${escAttr(post.title)}</div>
            <div class="li-sub">${escAttr(hostOf(post.url))}</div>
          </div>
        </div>
        <p class="hint" style="margin-top:14px">
          Status: <b>${titleCase(post.status)}</b>${post.linkedin_url && post.linkedin_url.startsWith("http") ? ` · <a href="${post.linkedin_url}" target="_blank">view on LinkedIn</a>` : ""}<br>
          Source: <a href="${escAttr(post.url)}" target="_blank">${escAttr(post.source)}</a><br>
          ${post.last_error ? `<span style="color:var(--danger)">Last error: ${esc(post.last_error)}</span>` : ""}
        </p>
      </div>
    </div>`;

  const ta = document.getElementById("f-text");
  const linkBox = document.getElementById("pv-link");
  const updatePreview = () => {
    document.getElementById("pv-body").textContent = ta.value;
    document.getElementById("cc").textContent = ta.value.length;
    linkBox.style.display = document.getElementById("f-link").checked ? "block" : "none";
  };
  ta.oninput = updatePreview;
  document.getElementById("f-link").onchange = updatePreview;
  updatePreview();

  const collect = () => ({
    ...post,
    title: document.getElementById("f-title").value.trim(),
    post_text: ta.value.trim(),
    attach_link: document.getElementById("f-link").checked,
  });
  const edStatus = (m) => document.getElementById("ed-status").textContent = m;

  document.getElementById("btn-polish").onclick = () => runPolish(ta, "");
  document.getElementById("btn-translate").onclick = () => runPolish(ta, "The text may be in another language; translate it to English.");

  async function runPolish(textarea, instruction) {
    edStatus("Polishing with Gemini…");
    try {
      const out = await geminiPolish(textarea.value, instruction);
      textarea.value = out; updatePreview(); edStatus("Done. Review and Save when happy.");
      toast("Rewritten ✦", "ok");
    } catch (e) { edStatus(e.message); toast(e.message, "err"); }
  }

  document.getElementById("btn-save").onclick = async () => {
    const rec = collect(); edStatus("Saving to GitHub…");
    try { await persistPost(rec); post = rec; edStatus("Saved."); toast("Saved to repo", "ok"); }
    catch (e) { edStatus(e.message); toast(e.message, "err"); }
  };

  document.getElementById("btn-post").onclick = async () => {
    if (!store.liToken || !store.liUrn) {
      edStatus("Add your LinkedIn access token and author URN in Settings first.");
      toast("LinkedIn credentials missing — see Settings", "err"); return;
    }
    if (!confirm("Queue this post for LinkedIn? The publish workflow will send it within a minute.")) return;
    const rec = { ...collect(), status: "queued" };
    edStatus("Queuing + triggering publish workflow…");
    try {
      await persistPost(rec);
      await dispatchWorkflow("publish.yml", {
        linkedin_token: store.liToken,
        linkedin_urn: store.liUrn,
      });
      post = rec;
      edStatus("Queued. The workflow is posting it now — refresh in a minute to see the LinkedIn link.");
      toast("Queued for LinkedIn ▸", "ok");
    } catch (e) { edStatus(e.message); toast(e.message, "err"); }
  };
}

/* trigger the generate workflow, passing the browser-held AI keys as one-time
   inputs. New drafts land in the repo a minute later; the user hits Refresh. */
async function triggerGenerate() {
  const keys = store.geminiKeys;
  if (!keys.length && !store.groq) {
    toast("Add a Gemini or Groq key in Settings first", "err"); openSettings(); return;
  }
  try {
    await dispatchWorkflow("generate.yml", {
      gemini_keys: keys.join(","),
      groq_key: store.groq,
    });
    toast("Generating… new drafts arrive in ~1 min. Hit ↻ Refresh.", "ok");
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

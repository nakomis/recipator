// Popup UI. All privileged work (OAuth, API, import) happens in the background
// service worker; the popup just sends messages and renders the results.

const $ = (id) => document.getElementById(id);

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function showStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind}`.trim();
  el.hidden = !text;
}

function showResult(recipe) {
  $("result-title").textContent = recipe.title || "Recipe saved";
  const counts = [];
  if (recipe.ingredients?.length) counts.push(`${recipe.ingredients.length} ingredients`);
  if (recipe.method?.length) counts.push(`${recipe.method.length} steps`);
  $("result-meta").textContent = counts.join(" · ");
  $("result").hidden = false;
}

// Persist the last import's failures so they survive the popup closing (e.g. when
// you click a search link and come back). Re-rendered whenever the popup opens.
const FAILURES_KEY = "lastImportFailures";
const FAILURES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // don't resurface stale lists

async function saveFailures(failed) {
  if (!failed?.length) return chrome.storage.local.remove(FAILURES_KEY);
  return chrome.storage.local.set({
    [FAILURES_KEY]: { at: Date.now(), failures: failed.map((f) => ({ recipeId: f.recipeId, title: f.title })) },
  });
}
async function loadFailures() {
  const rec = (await chrome.storage.local.get(FAILURES_KEY))[FAILURES_KEY];
  if (!rec || Date.now() - rec.at > FAILURES_MAX_AGE_MS) return [];
  return rec.failures ?? [];
}
async function clearFailures() {
  await chrome.storage.local.remove(FAILURES_KEY);
  renderFailures([]);
}
// Drop one failure from the persisted list (when the user ticks it off).
async function removeFailure(recipeId) {
  const rec = (await chrome.storage.local.get(FAILURES_KEY))[FAILURES_KEY];
  if (!rec) return;
  const failures = (rec.failures ?? []).filter((f) => f.recipeId !== recipeId);
  if (failures.length) await chrome.storage.local.set({ [FAILURES_KEY]: { ...rec, failures } });
  else await chrome.storage.local.remove(FAILURES_KEY);
}

async function refresh() {
  const status = await send("getStatus");
  if (!status?.ok) return showStatus("Extension error — try reloading.", "error");

  $("env-badge").textContent = status.env;
  $("signed-out").hidden = status.signedIn;
  $("signed-in").hidden = !status.signedIn;

  // Re-show any unresolved import failures from a previous run (signed-in only).
  renderFailures(status.signedIn ? await loadFailures() : []);
}

// ── Live progress from the importer ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "alexaImportProgress") return;
  const ev = msg.event;
  if (ev.phase === "reading") showStatus("Reading your Amazon saved recipes…");
  else if (ev.phase === "start") showStatus(`Found ${ev.total} saved recipe${ev.total === 1 ? "" : "s"}…`);
  else if (ev.phase === "item") {
    const verb = { importing: "Importing", imported: "Imported", skipped: "Skipped", failed: "Couldn't get" }[ev.status] || "";
    showStatus(`${ev.index}/${ev.total} · ${verb} “${ev.title}”`);
  }
});

function summarise(s) {
  const parts = [`${s.imported.length} imported`];
  if (s.skipped.length) parts.push(`${s.skipped.length} already saved`);
  if (s.failed.length) parts.push(`${s.failed.length} failed`);
  return parts.join(", ") + ".";
}

// Render the failures as links to a BBC Good Food search — the recipe's photo on
// the results page is usually the quickest way to spot the right one by eye.
function renderFailures(failed) {
  const box = $("import-failures");
  box.textContent = "";
  if (!failed?.length) { box.hidden = true; return; }

  const p = document.createElement("p");
  p.className = "muted";
  const n = failed.length;
  p.textContent = n === 1
    ? "Couldn't find this one — search BBC Good Food (match by photo), tick once you've saved it:"
    : `Couldn't find ${n} — search BBC Good Food (match by photo), tick each once you've saved it:`;
  box.appendChild(p);

  const ul = document.createElement("ul");
  for (const f of failed) {
    const li = document.createElement("li");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.title = "Mark as imported — stop showing this";
    cb.addEventListener("change", async () => {
      cb.disabled = true;
      await send("markResolved", { recipeId: f.recipeId });
      await removeFailure(f.recipeId);
      li.remove();
      if (!ul.children.length) box.hidden = true; // last one ticked off
    });

    const a = document.createElement("a");
    a.href = `https://www.bbcgoodfood.com/search?q=${encodeURIComponent(f.title)}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = f.title;

    li.append(cb, a);
    ul.appendChild(li);
  }
  box.appendChild(ul);
  box.hidden = false;
}

// ── Wire up ─────────────────────────────────────────────────────────────────
$("sign-in").addEventListener("click", async () => {
  showStatus("Opening sign-in…");
  const r = await send("signIn");
  showStatus(r.ok ? "" : r.error, r.ok ? "" : "error");
  await refresh();
});

$("sign-out").addEventListener("click", async () => {
  await send("signOut");
  $("result").hidden = true;
  await clearFailures();
  showStatus("");
  await refresh();
});

$("save").addEventListener("click", async () => {
  $("save").disabled = true;
  $("result").hidden = true;
  $("import-failures").hidden = true;
  showStatus("Extracting recipe…");
  const r = await send("saveRecipe");
  if (r.ok) {
    showStatus("Saved to Recipator.", "ok");
    showResult(r.recipe);
  } else if (r.error?.toLowerCase().includes("sign in")) {
    showStatus(r.error, "error");
    await refresh();
  } else {
    showStatus(r.error || "Couldn't save this recipe.", "error");
  }
  $("save").disabled = false;
});

$("import").addEventListener("click", async () => {
  $("import").disabled = true;
  $("save").disabled = true;
  $("result").hidden = true;
  $("import-failures").hidden = true;
  showStatus("Reading your Amazon saved recipes…");
  const r = await send("importAmazon");
  if (r.ok) {
    const s = r.summary;
    showStatus(summarise(s), s.failed.length ? "" : "ok");
    renderFailures(s.failed);
    await saveFailures(s.failed);
  } else if (r.error?.toLowerCase().includes("sign in")) {
    showStatus(r.error, "error");
    await refresh();
  } else {
    showStatus(r.error || "Couldn't import from Amazon.", "error");
  }
  $("import").disabled = false;
  $("save").disabled = false;
});

// Click the env badge to toggle sandbox/production (signs out the other env's session).
$("env-badge").addEventListener("click", async () => {
  const status = await send("getStatus");
  const next = status.env === "production" ? "sandbox" : "production";
  await send("setEnv", { env: next });
  $("result").hidden = true;
  $("import-failures").hidden = true;
  showStatus(`Switched to ${next}.`);
  await refresh();
});

refresh();

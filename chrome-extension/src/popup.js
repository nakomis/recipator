// Popup UI. All privileged work (OAuth, API) happens in the background service
// worker; the popup just sends messages and renders the results.

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

async function refresh() {
  const status = await send("getStatus");
  if (!status?.ok) return showStatus("Extension error — try reloading.", "error");

  $("env-badge").textContent = status.env;
  $("signed-out").hidden = status.signedIn;
  $("signed-in").hidden = !status.signedIn;
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
  showStatus("");
  await refresh();
});

$("save").addEventListener("click", async () => {
  $("save").disabled = true;
  $("result").hidden = true;
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

// Click the env badge to toggle sandbox/production (signs out the other env's session).
$("env-badge").addEventListener("click", async () => {
  const status = await send("getStatus");
  const next = status.env === "production" ? "sandbox" : "production";
  await send("setEnv", { env: next });
  $("result").hidden = true;
  showStatus(`Switched to ${next}.`);
  await refresh();
});

refresh();

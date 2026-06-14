const OPTION_IDS = [
  "enabled",
  "emotes_7tv",
  "emotes_bttv",
  "emotes_ffz",
  "colon_autocomplete",
  "chat_render",
  "hide_kick_native",
  "show_favorites",
];

async function init() {
  const storage = window.STTVKStorage;
  if (!storage) return;

  const options = await storage.getOptions();

  for (const id of OPTION_IDS) {
    const input = document.getElementById(id);
    if (input) input.checked = options[id] !== false;
  }

  document.querySelectorAll(".ch").forEach((input) => {
    input.addEventListener("change", async () => {
      const next = await storage.getOptions();
      next[input.id] = input.checked;
      await storage.setOptions(next);
    });
  });

  await renderFavorites();
}

async function renderFavorites() {
  const storage = window.STTVKStorage;
  if (!storage) return;

  const favorites = await storage.getFavorites();
  const list = document.getElementById("fav-list");
  const hint = document.getElementById("fav-hint");
  const count = document.getElementById("stat-favs");

  count.textContent = String(favorites.length);
  list.innerHTML = "";

  if (!favorites.length) {
    hint.style.display = "block";
    return;
  }

  hint.style.display = "none";
  for (const emote of favorites.slice(0, 10)) {
    const row = document.createElement("div");
    row.className = "emote-chip";
    row.innerHTML = `
      <img src="${emote.url}" alt="" />
      <span class="chip-name">${emote.code}</span>
      <span class="chip-provider">(${emote.provider})</span>
    `;
    list.appendChild(row);
  }
}

document.addEventListener("DOMContentLoaded", init);

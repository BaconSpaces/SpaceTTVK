const DICE_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#26262c"/><circle cx="20" cy="20" r="6" fill="#5b9fd4"/><circle cx="44" cy="44" r="6" fill="#5b9fd4"/><circle cx="32" cy="32" r="6" fill="#53fc18"/></svg>'
  );

async function render() {
  const storage = window.STTVKStorage;
  if (!storage) return;

  const [recent, favorites, stats] = await Promise.all([
    storage.getRecent(),
    storage.getFavorites(),
    storage.getStats(),
  ]);

  document.getElementById("stat-used").textContent = String(stats.emotesUsed || 0);
  document.getElementById("stat-rolls").textContent = String(stats.rouletteRolls || 0);
  document.getElementById("stat-favs").textContent = String(favorites.length);

  renderList("recent-list", recent.slice(0, 6), "No recent emotes yet — pick one in chat!");
  renderList("fav-list", favorites.slice(0, 8), "Alt+click an emote in chat to favorite it ⭐");
}

/**
 * @param {string} containerId
 * @param {Array<{code:string,url:string,provider:string}>} items
 * @param {string} emptyText
 */
function renderList(containerId, items, emptyText) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";

  if (!items.length) {
    el.innerHTML = `<p class="empty">${emptyText}</p>`;
    return;
  }

  for (const emote of items) {
    const row = document.createElement("div");
    row.className = "emote-chip";
    row.innerHTML = `
      <img src="${emote.url}" alt="" />
      <span class="chip-name">${emote.code}</span>
      <span class="chip-provider">(${emote.provider})</span>
    `;
    el.appendChild(row);
  }
}

document.addEventListener("DOMContentLoaded", render);

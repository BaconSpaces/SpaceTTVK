/**
 * Recent & favorite emote persistence for SpaceTTVK.
 * Loaded before content.js in the page context.
 */
(() => {
  "use strict";

  const RECENT_KEY = "sttvk_recent_emotes";
  const FAVORITES_KEY = "sttvk_favorite_emotes";
  const STATS_KEY = "sttvk_stats";
  const MAX_RECENT = 12;
  const MAX_FAVORITES = 36;

  /** @typedef {{ code: string, name: string, url: string, provider: string }} StoredEmote */

  /**
   * @param {StoredEmote} emote
   * @returns {string}
   */
  function emoteKey(emote) {
    return `${emote.provider}:${emote.code}`.toLowerCase();
  }

  /**
   * @param {StoredEmote} emote
   * @returns {StoredEmote}
   */
  function normalize(emote) {
    return {
      code: emote.code,
      name: emote.name || emote.code,
      url: emote.url,
      provider: emote.provider,
    };
  }

  /**
   * @returns {Promise<StoredEmote[]>}
   */
  async function getRecent() {
    const data = await chrome.storage.local.get(RECENT_KEY);
    return data[RECENT_KEY] || [];
  }

  /**
   * @returns {Promise<StoredEmote[]>}
   */
  async function getFavorites() {
    const data = await chrome.storage.local.get(FAVORITES_KEY);
    return data[FAVORITES_KEY] || [];
  }

  /**
   * @param {StoredEmote} emote
   */
  async function addRecent(emote) {
    const entry = normalize(emote);
    const list = await getRecent();
    const next = [entry, ...list.filter((e) => emoteKey(e) !== emoteKey(entry))].slice(0, MAX_RECENT);
    await chrome.storage.local.set({ [RECENT_KEY]: next });
    await bumpStat("emotesUsed");
    return next;
  }

  /**
   * @param {StoredEmote} emote
   * @returns {Promise<{ favorites: StoredEmote[], added: boolean }>}
   */
  async function toggleFavorite(emote) {
    const entry = normalize(emote);
    const list = await getFavorites();
    const exists = list.some((e) => emoteKey(e) === emoteKey(entry));
    const favorites = exists
      ? list.filter((e) => emoteKey(e) !== emoteKey(entry))
      : [entry, ...list].slice(0, MAX_FAVORITES);
    await chrome.storage.local.set({ [FAVORITES_KEY]: favorites });
    if (!exists) await bumpStat("favoritesAdded");
    return { favorites, added: !exists };
  }

  /**
   * @param {StoredEmote[]} stored
   * @param {StoredEmote[]} pool
   * @returns {StoredEmote[]}
   */
  function hydrate(stored, pool) {
    const poolMap = new Map(pool.map((e) => [emoteKey(e), e]));
    return stored.map((e) => poolMap.get(emoteKey(e)) || e);
  }

  /**
   * @param {"emotesUsed"|"rouletteRolls"|"favoritesAdded"} field
   */
  async function bumpStat(field) {
    const data = await chrome.storage.local.get(STATS_KEY);
    const stats = data[STATS_KEY] || { emotesUsed: 0, rouletteRolls: 0, favoritesAdded: 0 };
    stats[field] = (stats[field] || 0) + 1;
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  }

  /**
   * @returns {Promise<Record<string, number>>}
   */
  async function getStats() {
    const data = await chrome.storage.local.get(STATS_KEY);
    return data[STATS_KEY] || { emotesUsed: 0, rouletteRolls: 0, favoritesAdded: 0 };
  }

  window.STTVKStorage = {
    getRecent,
    getFavorites,
    addRecent,
    toggleFavorite,
    hydrate,
    bumpStat,
    getStats,
    emoteKey,
  };
})();

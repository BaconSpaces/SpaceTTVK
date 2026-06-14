/**
 * Favorite emote persistence for SpaceTTVK.
 * Loaded before content.js in the page context.
 */
(() => {
  "use strict";

  const FAVORITES_KEY = "sttvk_favorite_emotes";
  const OPTIONS_KEY = "sttvk_options";
  const MAX_FAVORITES = 36;

  /** @type {Record<string, boolean>} */
  const DEFAULT_OPTIONS = {
    enabled: true,
    emotes_7tv: true,
    emotes_bttv: true,
    emotes_ffz: true,
    colon_autocomplete: true,
    chat_render: true,
    hide_kick_native: true,
    show_favorites: true,
  };

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
  async function getFavorites() {
    const data = await chrome.storage.local.get(FAVORITES_KEY);
    return data[FAVORITES_KEY] || [];
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
   * @returns {Promise<Record<string, boolean>>}
   */
  async function getOptions() {
    const data = await chrome.storage.local.get(OPTIONS_KEY);
    return { ...DEFAULT_OPTIONS, ...(data[OPTIONS_KEY] || {}) };
  }

  /**
   * @param {Record<string, boolean>} options
   */
  async function setOptions(options) {
    await chrome.storage.local.set({ [OPTIONS_KEY]: { ...DEFAULT_OPTIONS, ...options } });
  }

  window.STTVKStorage = {
    getFavorites,
    toggleFavorite,
    hydrate,
    emoteKey,
    getOptions,
    setOptions,
    DEFAULT_OPTIONS,
  };
})();

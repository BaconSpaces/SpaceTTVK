import { CACHE_TTL_MS, cacheKey, fetchAllEmotes } from "./emotes.js";

/** @type {Map<string, { emotes: import('./emotes.js').Emote[], fetchedAt: number }>} */
const memoryCache = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_EMOTES") return false;

  loadEmotes(message.platform, message.channel)
    .then((emotes) => sendResponse({ ok: true, emotes }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));

  return true;
});

/**
 * @param {string} platform
 * @param {string} channel
 */
async function loadEmotes(platform, channel) {
  const key = cacheKey(platform, channel);
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.emotes;
  }

  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];
  if (entry?.emotes && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    memoryCache.set(key, entry);
    return entry.emotes;
  }

  const emotes = await fetchAllEmotes(platform, channel);
  const payload = { emotes, fetchedAt: Date.now() };
  memoryCache.set(key, payload);
  await chrome.storage.local.set({ [key]: payload });
  return emotes;
}

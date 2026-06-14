/**
 * Shared emote fetching and normalization for 7TV, BTTV, and FFZ.
 * Used by the background service worker.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/** @typedef {{ name: string, code: string, url: string, provider: string }} Emote */

/**
 * @param {string} url
 * @returns {Promise<unknown>}
 */
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/**
 * @param {Emote[]} emotes
 * @returns {Emote[]}
 */
function dedupeEmotes(emotes) {
  const seen = new Set();
  const out = [];
  for (const emote of emotes) {
    const key = `${emote.provider}:${emote.code.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(emote);
  }
  return out;
}

/**
 * @param {string} platform - "twitch" | "kick"
 * @param {string} channel
 * @returns {Promise<Emote[]>}
 */
export async function fetchAllEmotes(platform, channel) {
  const channelKey = (channel || "").toLowerCase().trim();
  const results = await Promise.allSettled([
    fetch7tvEmotes(platform, channelKey),
    fetchBttvEmotes(platform, channelKey),
    fetchFfzEmotes(platform, channelKey),
  ]);

  const emotes = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return dedupeEmotes(emotes).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string} platform
 * @param {string} channel
 * @returns {Promise<Emote[]>}
 */
async function fetch7tvEmotes(platform, channel) {
  const emotes = [];

  try {
    const global = await fetchJson("https://7tv.io/v3/emote-sets/global");
    for (const item of global?.emotes || []) {
      const name = item.name || item.data?.name;
      if (!name || !item.id) continue;
      emotes.push({
        name,
        code: name,
        url: `https://cdn.7tv.app/emote/${item.id}/2x.webp`,
        provider: "7TV",
      });
    }
  } catch {
    /* global set optional */
  }

  if (!channel) return emotes;

  const userId = await resolvePlatformUserId(platform, channel);
  if (!userId) return emotes;

  try {
    const user = await fetchJson(`https://7tv.io/v3/users/${platform}/${userId}`);
    const setEmotes = user?.emote_set?.emotes || user?.emote_sets?.[0]?.emotes || [];
    for (const item of setEmotes) {
      const name = item.name || item.data?.name;
      if (!name || !item.id) continue;
      emotes.push({
        name,
        code: name,
        url: `https://cdn.7tv.app/emote/${item.id}/2x.webp`,
        provider: "7TV",
      });
    }
  } catch {
    /* channel may have no 7TV */
  }

  return emotes;
}

/**
 * @param {"twitch" | "kick"} platform
 * @param {string} channel
 * @returns {Promise<string | null>}
 */
async function resolvePlatformUserId(platform, channel) {
  if (platform === "kick") return resolveKickUserId(channel);
  return resolveTwitchUserId(channel);
}

/**
 * @param {string} channel
 * @returns {Promise<string | null>}
 */
async function resolveKickUserId(channel) {
  try {
    const data = await fetchJson(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`);
    const userId = data?.user_id ?? data?.user?.id;
    return userId != null ? String(userId) : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} channel
 * @returns {Promise<string | null>}
 */
async function resolveTwitchUserId(channel) {
  try {
    const room = await fetchJson(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(channel)}`);
    const twitchId = room?.room?.twitch_id;
    if (twitchId != null) return String(twitchId);
  } catch {
    /* try fallback */
  }

  try {
    const res = await fetch(`https://decapi.me/twitch/id/${encodeURIComponent(channel)}`, {
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return /^\d+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * @param {"twitch" | "kick"} platform
 * @param {string} channel
 * @returns {Promise<Emote[]>}
 */
async function fetchBttvEmotes(platform, channel) {
  const emotes = [];

  try {
    const global = await fetchJson("https://api.betterttv.net/3/cached/emotes/global");
    for (const item of global || []) {
      if (!item.code || !item.id) continue;
      emotes.push({
        name: item.code,
        code: item.code,
        url: `https://cdn.betterttv.net/emote/${item.id}/1x`,
        provider: "BTTV",
      });
    }
  } catch {
    /* ignore */
  }

  if (!channel) return emotes;

  const twitchLogin = await resolveTwitchLogin(platform, channel);
  if (!twitchLogin) return emotes;

  const twitchId = await resolveTwitchUserId(twitchLogin);
  if (!twitchId) return emotes;

  try {
    const user = await fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${twitchId}`);
    const lists = [user?.channelEmotes, user?.sharedEmotes].filter(Boolean);
    for (const list of lists) {
      for (const item of list) {
        if (!item.code || !item.id) continue;
        emotes.push({
          name: item.code,
          code: item.code,
          url: `https://cdn.betterttv.net/emote/${item.id}/1x`,
          provider: "BTTV",
        });
      }
    }
  } catch {
    /* ignore */
  }

  return emotes;
}

/**
 * @param {"twitch" | "kick"} platform
 * @param {string} channel
 * @returns {Promise<Emote[]>}
 */
async function fetchFfzEmotes(platform, channel) {
  const emotes = [];

  try {
    const global = await fetchJson("https://api.frankerfacez.com/v1/set/global");
    for (const set of Object.values(global?.sets || {})) {
      for (const item of Object.values(set?.emoticons || {})) {
        if (!item?.name || !item?.id) continue;
        emotes.push({
          name: item.name,
          code: item.name,
          url: ffzImageUrl(item),
          provider: "FFZ",
        });
      }
    }
  } catch {
    /* ignore */
  }

  if (!channel) return emotes;

  const twitchLogin = await resolveTwitchLogin(platform, channel);
  if (!twitchLogin) return emotes;

  try {
    const room = await fetchJson(
      `https://api.frankerfacez.com/v1/room/${encodeURIComponent(twitchLogin)}`
    );
    const beforeCount = emotes.length;
    appendFfzSets(emotes, room);

    if (emotes.length === beforeCount && room?.room?.twitch_id) {
      const byId = await fetchJson(`https://api.frankerfacez.com/v1/room/id/${room.room.twitch_id}`);
      appendFfzSets(emotes, byId);
    }
  } catch {
    /* ignore */
  }

  return emotes;
}

/**
 * Resolve a Twitch login from a Twitch or Kick channel slug.
 * On Kick, tries the slug, username, and any twitch.tv link in the channel bio.
 *
 * @param {"twitch" | "kick"} platform
 * @param {string} channel
 * @returns {Promise<string | null>}
 */
async function resolveTwitchLogin(platform, channel) {
  if (platform === "twitch") return channel || null;

  const candidates = new Set();
  if (channel) candidates.add(channel.toLowerCase());

  try {
    const kick = await fetchJson(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`);
    if (kick?.slug) candidates.add(String(kick.slug).toLowerCase());
    if (kick?.user?.username) candidates.add(String(kick.user.username).toLowerCase());

    const bio = kick?.user?.bio || "";
    const twitchMatch = bio.match(/(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([A-Za-z0-9_]+)/i);
    if (twitchMatch?.[1]) candidates.add(twitchMatch[1].toLowerCase());
  } catch {
    /* keep slug-only candidate */
  }

  for (const login of candidates) {
    try {
      const res = await fetch(`https://decapi.me/twitch/id/${encodeURIComponent(login)}`, {
        headers: { Accept: "text/plain" },
      });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (/^\d+$/.test(text)) return login;
    } catch {
      /* try next candidate */
    }
  }

  return null;
}

/**
 * @param {Emote[]} emotes
 * @param {{ sets?: number[] | Record<string, { emoticons?: Record<string, { id: number, name: string, urls?: Record<string, string> }> }>, set?: Record<string, { emoticons?: Record<string, { id: number, name: string, urls?: Record<string, string> }> }> }} room
 */
function appendFfzSets(emotes, room) {
  const sets = room?.sets;
  if (!sets) return;

  if (Array.isArray(sets)) {
    for (const setId of sets) {
      const set = room.set?.[String(setId)] || room.set?.[setId];
      appendFfzEmoticons(emotes, set?.emoticons || {});
    }
    return;
  }

  for (const set of Object.values(sets)) {
    appendFfzEmoticons(emotes, set?.emoticons || {});
  }
}

/**
 * @param {Emote[]} emotes
 * @param {Record<string, { id: number, name: string, urls?: Record<string, string> }>} emoticons
 */
function appendFfzEmoticons(emotes, emoticons) {
  for (const item of Object.values(emoticons)) {
    if (!item?.name || !item?.id) continue;
    emotes.push({
      name: item.name,
      code: item.name,
      url: ffzImageUrl(item),
      provider: "FFZ",
    });
  }
}

/**
 * @param {{ id: number, urls?: Record<string, string> }} item
 * @returns {string}
 */
function ffzImageUrl(item) {
  if (item.urls?.["1"]) return item.urls["1"];
  if (item.urls?.["2"]) return item.urls["2"];
  return `https://cdn.frankerfacez.com/emoticon/${item.id}`;
}

/**
 * @param {string} platform
 * @param {string} channel
 * @returns {string}
 */
export function cacheKey(platform, channel) {
  return `${platform}:${(channel || "").toLowerCase()}`;
}

export { CACHE_TTL_MS };

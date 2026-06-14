/**
 * Renders 7TV / BTTV / FFZ emote images inside Twitch and Kick chat messages.
 */
(() => {
  "use strict";

  const platform = location.hostname.includes("kick.com") ? "kick" : "twitch";

  const CHAT_ROOT_SELECTORS =
    platform === "kick"
      ? ["#chatroom-messages", "#channel-chatroom", '[data-testid="chat-messages"]', "[data-chat]"]
      : [
          ".chat-scrollable-area__message-container",
          '[data-testid="chat-scrollable-area"]',
          'section[aria-label*="chat" i]',
          '[role="log"]',
        ];

  const MESSAGE_SELECTORS =
    platform === "kick"
      ? ["#chatroom-messages [data-index]", "#chatroom-messages > div[data-index]", '[data-testid="chat-message"]', '[class*="chat-message"]', '[class*="message-entry"]']
      : [
          '[data-testid="chat-line-message"]',
          '[data-a-target="chat-line-message"]',
          ".chat-line__message",
        ];

  /** @type {Map<string, { code: string, url: string, provider: string }>} */
  let emoteExact = new Map();
  /** @type {Map<string, { code: string, url: string, provider: string }>} */
  let emoteLower = new Map();
  let lastChannel = "";
  let chatObserver = null;
  /** @type {Record<string, boolean>} */
  let options = { ...(window.STTVKStorage?.DEFAULT_OPTIONS || {}) };

  init();

  async function loadOptions() {
    if (!window.STTVKStorage) return;
    options = await window.STTVKStorage.getOptions();
  }

  function isChatRenderEnabled() {
    return options.enabled !== false && options.chat_render !== false;
  }

  function init() {
    void loadOptions().then(() => {
      refreshEmotes();
      observeNavigation();
      observeChat();
    });
    setInterval(refreshEmotes, 30000);

    chrome.storage.onChanged.addListener((changes) => {
      if (!changes.sttvk_options) return;
      options = { ...window.STTVKStorage.DEFAULT_OPTIONS, ...changes.sttvk_options.newValue };
      if (isChatRenderEnabled()) scanAllMessages();
    });
  }

  function getChannel() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (platform === "kick") {
      if (parts[0] === "video" && parts[1]) return parts[1];
      return parts[0] || "";
    }
    return parts[0] || "";
  }

  function observeNavigation() {
    let lastUrl = location.href;
    const check = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastChannel = "";
        refreshEmotes();
      }
    };
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", check);
    setInterval(check, 1500);
  }

  function refreshEmotes() {
    const channel = getChannel();
    if (!channel || channel === "directory" || channel === "settings") {
      emoteExact.clear();
      emoteLower.clear();
      return;
    }
    if (channel === lastChannel && emoteExact.size > 0) return;

    lastChannel = channel;
    chrome.runtime.sendMessage({ type: "GET_EMOTES", platform, channel }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) return;
      buildMaps(response.emotes || []);
      scanAllMessages();
    });
  }

  /**
   * @param {Array<{ code: string, url: string, provider: string, name?: string }>} emotes
   */
  function buildMaps(emotes) {
    emoteExact.clear();
    emoteLower.clear();
    for (const emote of emotes) {
      if (!emote?.code || !emote?.url) continue;
      if (emote.provider === "7TV" && options.emotes_7tv === false) continue;
      if (emote.provider === "BTTV" && options.emotes_bttv === false) continue;
      if (emote.provider === "FFZ" && options.emotes_ffz === false) continue;
      emoteExact.set(emote.code, emote);
      emoteLower.set(emote.code.toLowerCase(), emote);
    }
  }

  function observeChat() {
    const attach = () => {
      const root = findChatRoot();
      if (!root || root.dataset.sttvkChatObserved === "1") return;
      root.dataset.sttvkChatObserved = "1";
      scanAllMessages();

      chatObserver?.disconnect();
      chatObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            scanForMessages(node);
          }
        }
      });
      chatObserver.observe(root, { childList: true, subtree: true });
    };

    attach();
    new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
  }

  function findChatRoot() {
    for (const selector of CHAT_ROOT_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function scanAllMessages() {
    const root = findChatRoot() || document;
    scanForMessages(root);
  }

  /**
   * @param {HTMLElement} root
   */
  function scanForMessages(root) {
    const lookup = MESSAGE_SELECTORS.join(",");
    if (root.matches?.(lookup)) {
      renderMessage(root);
    }

    root.querySelectorAll(lookup).forEach((el) => {
      if (el instanceof HTMLElement) renderMessage(el);
    });
  }

  /**
   * @param {HTMLElement} messageEl
   */
  function renderMessage(messageEl) {
    if (!isChatRenderEnabled()) return;
    if (platform !== "kick" && messageEl.dataset.sttvkRendered === "1") return;
    if (messageEl.closest(".sttvk-autocomplete")) return;
    if (emoteExact.size === 0 && emoteLower.size === 0) return;

    const walker = document.createTreeWalker(messageEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".sttvk-chat-emote, .sttvk-autocomplete")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("img, button, a, textarea, input")) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[class*="emote"], [data-emote]')) return NodeFilter.FILTER_REJECT;
        const text = node.textContent || "";
        if (!text.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(/** @type {Text} */ (walker.currentNode));
    }

    for (const node of textNodes) {
      replaceEmotesInTextNode(node);
    }

    if (platform !== "kick") {
      messageEl.dataset.sttvkRendered = "1";
    }
  }

  /**
   * @param {Text} textNode
   */
  function replaceEmotesInTextNode(textNode) {
    const text = textNode.textContent || "";
    const parts = tokenize(text);
    if (!parts.some((p) => p.type === "emote")) return false;

    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (part.type === "text") {
        frag.appendChild(document.createTextNode(part.value));
        continue;
      }
      const span = document.createElement("span");
      span.className = "sttvk-chat-emote";
      span.title = `${part.emote.code} (${part.emote.provider})`;
      const img = document.createElement("img");
      img.src = part.emote.url;
      img.alt = part.emote.code;
      img.loading = "lazy";
      img.decoding = "async";
      span.appendChild(img);
      frag.appendChild(span);
    }

    textNode.parentNode?.replaceChild(frag, textNode);
    return true;
  }

  /**
   * @param {string} text
   */
  function tokenize(text) {
    /** @type {Array<{ type: "text", value: string } | { type: "emote", emote: { code: string, url: string, provider: string } }>} */
    const parts = [];
    const chunks = text.split(/(\s+)/);

    for (const chunk of chunks) {
      if (!chunk) continue;
      if (/^\s+$/.test(chunk)) {
        parts.push({ type: "text", value: chunk });
        continue;
      }

      const leading = chunk.match(/^([("'[\]{}:;,!?.]+)/);
      const trailing = chunk.match(/([)"'[\]{}:;,!?.]+)$/);
      let core = chunk;
      let lead = "";
      let trail = "";

      if (leading) {
        lead = leading[1];
        core = core.slice(lead.length);
      }
      if (trailing && core.length > 0) {
        trail = trailing[1];
        core = core.slice(0, core.length - trail.length);
      }

      if (lead) parts.push({ type: "text", value: lead });

      const emote = lookupEmote(core);
      if (emote) {
        parts.push({ type: "emote", emote });
      } else {
        parts.push({ type: "text", value: core });
      }

      if (trail) parts.push({ type: "text", value: trail });
    }

    return parts;
  }

  /**
   * @param {string} token
   */
  function lookupEmote(token) {
    if (!token) return null;
    return emoteExact.get(token) || emoteLower.get(token.toLowerCase()) || null;
  }
})();

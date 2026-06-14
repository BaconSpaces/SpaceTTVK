(() => {
  "use strict";

  const MAX_RESULTS = 8;
  const TRIGGER = ":";
  const DICE_SVG =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#26262c"/><circle cx="20" cy="20" r="6" fill="#5b9fd4"/><circle cx="44" cy="44" r="6" fill="#5b9fd4"/><circle cx="32" cy="32" r="6" fill="#53fc18"/></svg>'
    );

  /** @type {import('./emotes.js').Emote[] | null} */
  let emotes = null;
  /** @type {string | null} */
  let activeInput = null;
  let selectedIndex = 0;
  let visibleResults = [];
  let dropdown = null;
  let loading = false;
  let lastChannel = "";
  let lastPlatform = "";

  const platform = location.hostname.includes("kick.com") ? "kick" : "twitch";

  const INPUT_SELECTORS = {
    twitch: [
      'textarea[data-a-target="chat-input"]',
      '[data-a-target="chat-input"] textarea',
      'textarea[placeholder*="chat" i]',
    ],
    kick: [
      "#chat-input-wrapper .editor-input",
      '.editor-input[contenteditable="true"]',
      '[data-testid="chat-input"]',
      '[contenteditable="true"].chat-input',
      '.chat-input[contenteditable="true"]',
      '[aria-label*="message" i][contenteditable="true"]',
    ],
  };

  const NATIVE_POPUP_SELECTORS = [
    ".seventv-autocomplete-list",
    "#chat-input-wrapper [role='listbox']",
    "#channel-chatroom [role='listbox']",
    '[data-testid="chat-emote-suggestion-list"]',
    '[data-testid="emote-suggestion-list"]',
    '[class*="emote-suggestion"]',
    '[class*="EmoteSuggestion"]',
    '[class*="emote_suggestion"]',
    '[data-a-target="autocomplete-balloon"]',
    ".chat-input__autocomplete",
    "#emotePopup",
    ".ffz-autocomplete-list",
    ".bttv-emote-autocomplete",
    '[class*="typeahead"]',
    '[class*="Typeahead"]',
  ];

  let nativeSuppressObserver = null;
  let kickNativeBlockerObserver = null;
  let kickDisableTimer = null;

  init();

  function init() {
    createDropdown();
    if (platform === "kick") {
      document.documentElement.classList.add("sttvk-kick");
      startPermanentKickNativeBlocker();
    }
    observeNavigation();
    observeChatInputs();
    disableNativeColonAutocomplete();
    refreshEmotes();
  }

  function getChannel() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (platform === "kick") {
      if (parts[0] === "video" && parts[1]) return parts[1];
      return parts[0] || "";
    }
    return parts[0] || "";
  }

  function refreshEmotes() {
    const channel = getChannel();
    if (!channel || channel === "directory" || channel === "settings") {
      emotes = [];
      return;
    }
    if (channel === lastChannel && emotes) return;

    lastChannel = channel;
    lastPlatform = platform;
    loading = true;

    chrome.runtime.sendMessage(
      { type: "GET_EMOTES", platform, channel },
      (response) => {
        loading = false;
        if (chrome.runtime.lastError || !response?.ok) {
          emotes = [];
          return;
        }
        emotes = response.emotes || [];
      }
    );
  }

  function createDropdown() {
    dropdown = document.createElement("div");
    dropdown.className = "sttvk-autocomplete";
    dropdown.setAttribute("role", "listbox");
    document.documentElement.appendChild(dropdown);

    dropdown.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const item = e.target.closest(".sttvk-autocomplete-item");
      if (!item) return;
      const index = Number(item.dataset.index);
      if (Number.isNaN(index)) return;

      const emote = visibleResults[index];
      if (e.altKey && emote && !emote.isRoulette) {
        void toggleFavoriteEmote(emote, item);
        return;
      }

      selectEmote(index);
    });
  }

  function observeNavigation() {
    let lastUrl = location.href;
    const check = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        emotes = null;
        hideDropdown();
        refreshEmotes();
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", check);
    window.addEventListener("hashchange", check);
    setInterval(check, 1500);
  }

  function observeChatInputs() {
    bindExistingInputs();
    disableNativeColonAutocomplete();
    const observer = new MutationObserver(() => {
      bindExistingInputs();
      disableNativeColonAutocomplete();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function bindExistingInputs() {
    const selectors = INPUT_SELECTORS[platform] || [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => bindInput(el));
    }
  }

  /**
   * @param {HTMLElement} el
   */
  function bindInput(el) {
    if (!(el instanceof HTMLElement) || el.dataset.sttvkBound === "1") return;
    el.dataset.sttvkBound = "1";

    el.addEventListener("input", () => onInput(el));
    el.addEventListener("keyup", () => onInput(el));
    el.addEventListener("keydown", (e) => onKeyDown(e, el), true);
    el.addEventListener("blur", () => {
      setTimeout(hideDropdown, 120);
    });
    el.addEventListener("focus", () => {
      activeInput = el;
      refreshEmotes();
    });
  }

  /**
   * @param {HTMLElement} el
   */
  function onInput(el) {
    activeInput = el;
    refreshEmotes();
    disableNativeColonAutocomplete();

    const match = getTriggerMatch(el);
    if (!match) {
      hideDropdown();
      return;
    }

    hideNativeAutocompletePopups();

    void updateResults(el, match);
  }

  /**
   * @param {HTMLElement} el
   * @param {{ query: string, start: number, end: number }} match
   */
  async function updateResults(el, match) {
    if (!emotes || emotes.length === 0) {
      showDropdown(el, [], match.query);
      return;
    }

    visibleResults = await buildVisibleResults(match.query);
    selectedIndex = 0;
    showDropdown(el, visibleResults, match.query);
  }

  /**
   * @param {string} query
   */
  async function buildVisibleResults(query) {
    const q = query.toLowerCase();
    const storage = window.STTVKStorage;

    if (q === "roll" || q === "surprise") {
      return [createRouletteEntry()];
    }

    if (q === "" && storage) {
      const [recent, favorites] = await Promise.all([storage.getRecent(), storage.getFavorites()]);
      const merged = [
        ...storage.hydrate(favorites, emotes),
        ...storage.hydrate(recent, emotes),
      ];
      const seen = new Set();
      const results = [];

      for (const emote of merged) {
        const key = storage.emoteKey(emote);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          ...emote,
          isFavorite: favorites.some((f) => storage.emoteKey(f) === key),
          isRecent: recent.some((r) => storage.emoteKey(r) === key),
        });
        if (results.length >= MAX_RESULTS) return results;
      }

      for (const emote of emotes) {
        const key = storage.emoteKey(emote);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(emote);
        if (results.length >= MAX_RESULTS) break;
      }
      return results;
    }

    const filtered = emotes
      .filter((e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);

    if ("roll".startsWith(q) || "surprise".startsWith(q)) {
      return [createRouletteEntry(), ...filtered].slice(0, MAX_RESULTS);
    }

    return filtered;
  }

  function createRouletteEntry() {
    return {
      code: "roll",
      name: "Roll a random emote!",
      url: DICE_SVG,
      provider: "SURPRISE",
      isRoulette: true,
    };
  }

  /**
   * @param {KeyboardEvent} e
   * @param {HTMLElement} el
   */
  function onKeyDown(e, el) {
    if (!dropdown?.classList.contains("is-visible")) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        selectedIndex = Math.min(selectedIndex + 1, visibleResults.length - 1);
        renderItems();
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderItems();
        break;
      case "Enter":
      case "Tab":
        if (visibleResults.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          selectEmote(selectedIndex);
        }
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        hideDropdown();
        break;
      default:
        break;
    }
  }

  /**
   * @param {HTMLElement} el
   * @returns {{ query: string, start: number, end: number } | null}
   */
  function getTriggerMatch(el) {
    const text = getInputText(el);
    const caret = getCaretPosition(el);
    const before = text.slice(0, caret);
    const match = before.match(/:([A-Za-z0-9_]{0,32})$/);
    if (!match) return null;
    const query = match[1];
    const start = before.length - query.length - 1;
    return { query, start, end: caret };
  }

  /**
   * @param {HTMLElement} el
   */
  function getInputText(el) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.value;
    }
    return el.textContent || "";
  }

  /**
   * @param {HTMLElement} el
   */
  function getCaretPosition(el) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.selectionStart ?? el.value.length;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return (el.textContent || "").length;

    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return (el.textContent || "").length;

    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  /**
   * @param {HTMLElement} el
   * @param {import('./emotes.js').Emote[]} results
   * @param {string} query
   */
  function showDropdown(el, results, query) {
    visibleResults = results;
    const anchor = getDropdownAnchor(el);
    const rect = anchor.getBoundingClientRect();
    dropdown.style.left = `${Math.max(8, rect.left)}px`;
    dropdown.style.width = `${Math.max(220, Math.min(360, rect.width))}px`;
    dropdown.style.top = `${Math.max(8, rect.top - 8)}px`;
    dropdown.style.transform = "translateY(-100%)";
    dropdown.classList.add("is-visible");
    setNativeSuppressed(true);
    renderItems(query);
  }

  function hideDropdown() {
    dropdown?.classList.remove("is-visible");
    visibleResults = [];
    selectedIndex = 0;
    setNativeSuppressed(false);
  }

  /**
   * @param {HTMLElement} el
   */
  function getDropdownAnchor(el) {
    if (platform === "kick") {
      return (
        el.closest("#chat-input-wrapper") ||
        document.querySelector("#chat-input-wrapper") ||
        el
      );
    }
    return el;
  }

  function setNativeSuppressed(active) {
    document.documentElement.classList.toggle("sttvk-autocomplete-active", active);
    if (active) {
      hideNativeAutocompletePopups();
      if (!nativeSuppressObserver) {
        nativeSuppressObserver = new MutationObserver(hideNativeAutocompletePopups);
        nativeSuppressObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      }
      return;
    }

    nativeSuppressObserver?.disconnect();
    nativeSuppressObserver = null;
  }

  function hideNativeAutocompletePopups() {
    for (const selector of NATIVE_POPUP_SELECTORS) {
      document.querySelectorAll(selector).forEach((node) => {
        hideNativeNode(node);
      });
    }

    if (platform === "kick") {
      hideKickNativeEmoteLists();
    }
  }

  /**
   * @param {Element | null} node
   */
  function hideNativeNode(node) {
    if (!(node instanceof HTMLElement)) return;
    if (node === dropdown || dropdown?.contains(node)) return;
    if (node.classList.contains("sttvk-autocomplete")) return;
    node.dataset.sttvkNativeHidden = "1";
    node.style.setProperty("display", "none", "important");
    node.style.setProperty("visibility", "hidden", "important");
    node.style.setProperty("pointer-events", "none", "important");
    node.setAttribute("aria-hidden", "true");
  }

  /**
   * Kick renders its own colon emote picker as a floating list near chat.
   * Detect and hide those nodes even when Kick changes class names.
   */
  function hideKickNativeEmoteLists() {
    const roots = [
      document.querySelector("#chatroom-footer"),
      document.querySelector("#chat-input-wrapper"),
      document.querySelector("#chat-input-wrapper")?.parentElement,
    ].filter(Boolean);

    for (const root of roots) {
      root.querySelectorAll("div, ul, [role='listbox']").forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.dataset.sttvkNativeHidden === "1") return;
        if (!isKickNativeEmoteList(node)) return;
        hideNativeNode(node);
      });
    }

    document
      .querySelectorAll("#channel-chatroom [data-radix-popper-content-wrapper], body > [data-radix-popper-content-wrapper]")
      .forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.dataset.sttvkNativeHidden === "1") return;
        if (!isKickNativeEmoteList(node)) return;
        hideNativeNode(node);
      });
  }

  /**
   * @param {HTMLElement} node
   */
  function isKickNativeEmoteList(node) {
    if (node === dropdown || node.classList.contains("sttvk-autocomplete")) return false;
    if (node.closest(".sttvk-autocomplete")) return false;
    if (node.closest('[data-testid="chat-messages"], [class*="chat-messages"], [class*="message-list"]')) {
      return false;
    }

    const inInputZone = node.closest(
      "#chatroom-footer, #chat-input-wrapper, [data-testid='chat-input'], [data-testid='chat-input-area']"
    );
    const inPopper =
      node.closest("[data-radix-popper-content-wrapper]") &&
      !node.closest('[data-testid="chat-messages"], [class*="chat-messages"]');

    if (!inInputZone && !inPopper) return false;

    const imgs = node.querySelectorAll("img");
    if (imgs.length === 0) return false;

    const emoteImgs = [...imgs].filter((img) => isKickEmoteImage(img.src));
    if (emoteImgs.length === 0) return false;

    return (
      node.matches("[role='listbox']") ||
      emoteImgs.length >= 2 ||
      Boolean(inPopper) ||
      node.querySelector("button, [role='option']") !== null
    );
  }

  /**
   * @param {string} src
   */
  function isKickEmoteImage(src) {
    return /files\.kick\.com\/emotes|kick\.com\/emotes|cdn\.7tv\.app\/emote/i.test(src);
  }

  function startPermanentKickNativeBlocker() {
    const run = () => {
      disableKickLexicalEmoteSuggestions();
      hideKickNativeEmoteLists();
      hideNativeAutocompletePopups();
    };

    run();

    if (!kickDisableTimer) {
      kickDisableTimer = window.setInterval(run, 350);
      window.setTimeout(() => {
        window.clearInterval(kickDisableTimer);
        kickDisableTimer = null;
      }, 120000);
    }

    if (kickNativeBlockerObserver) return;

    kickNativeBlockerObserver = new MutationObserver(run);
    kickNativeBlockerObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
  }

  /**
   * Kick ships a built-in colon emote list via a Lexical transformer.
   * Remove it so only SpaceTTVK autocomplete is shown (same approach as 7TV).
   */
  function disableNativeColonAutocomplete() {
    if (platform === "kick") {
      disableKickLexicalEmoteSuggestions();
      return;
    }
    disableTwitchNativeColonAutocomplete();
  }

  function disableKickLexicalEmoteSuggestions() {
    document.querySelectorAll("#chat-input-wrapper .editor-input, .editor-input").forEach((input) => {
      if (!(input instanceof HTMLElement)) return;

      const editor = input.__lexicalEditor;
      const textTransforms = editor?._nodes?.get?.("text")?.transforms;
      if (!textTransforms) return;

      let removed = false;
      for (const transformer of [...textTransforms]) {
        if (isKickEmoteSuggestionTransformer(transformer)) {
          textTransforms.delete(transformer);
          removed = true;
        }
      }

      if (removed) input.dataset.sttvkLexicalDisabled = "1";
    });
  }

  /**
   * @param {unknown} transformer
   */
  function isKickEmoteSuggestionTransformer(transformer) {
    if (typeof transformer !== "function") return false;
    const src = transformer.toString();
    return (
      src.includes("chat_emote_suggestion") ||
      src.includes("emote_suggestion_list") ||
      src.includes("EmoteSuggestion") ||
      (src.includes("emote") && src.includes("suggestion"))
    );
  }

  function disableTwitchNativeColonAutocomplete() {
    document.querySelectorAll('textarea[data-a-target="chat-input"]').forEach((textarea) => {
      if (!(textarea instanceof HTMLTextAreaElement) || textarea.dataset.sttvkTwitchDisabled === "1") {
        return;
      }

      textarea.addEventListener(
        "input",
        () => {
          const match = getTriggerMatch(textarea);
          if (match) hideNativeAutocompletePopups();
        },
        true
      );
      textarea.dataset.sttvkTwitchDisabled = "1";
    });
  }

  function renderItems(query = "") {
    dropdown.innerHTML = "";

    if (loading && visibleResults.length === 0) {
      dropdown.innerHTML = '<div class="sttvk-autocomplete-empty">Loading emotes…</div>';
      return;
    }

    if (visibleResults.length === 0) {
      dropdown.innerHTML = `<div class="sttvk-autocomplete-empty">No emotes for :${escapeHtml(query)}</div>`;
      return;
    }

    visibleResults.forEach((emote, index) => {
      const item = document.createElement("div");
      item.className = "sttvk-autocomplete-item";
      if (emote.isRoulette) item.classList.add("is-roulette");
      if (index === selectedIndex) item.classList.add("is-selected");
      item.dataset.index = String(index);
      item.setAttribute("role", "option");

      const img = document.createElement("img");
      img.src = emote.url;
      img.alt = emote.name;
      img.loading = "lazy";

      const name = document.createElement("span");
      name.className = "sttvk-autocomplete-name";
      name.textContent = emote.isRoulette ? "🎲 Roll random emote!" : emote.code;

      const provider = document.createElement("span");
      provider.className = "sttvk-autocomplete-provider";
      provider.textContent = emote.isRoulette ? "(SURPRISE)" : `(${emote.provider})`;

      item.append(img, name, provider);

      if (emote.isFavorite) {
        const badge = document.createElement("span");
        badge.className = "sttvk-autocomplete-badge is-fav";
        badge.textContent = "★ fav";
        item.appendChild(badge);
      } else if (emote.isRecent) {
        const badge = document.createElement("span");
        badge.className = "sttvk-autocomplete-badge is-recent";
        badge.textContent = "recent";
        item.appendChild(badge);
      }

      dropdown.appendChild(item);
    });
  }

  /**
   * @param {object} emote
   * @param {HTMLElement} item
   */
  async function toggleFavoriteEmote(emote, item) {
    const storage = window.STTVKStorage;
    if (!storage) return;

    const { added } = await storage.toggleFavorite(emote);
    const badge = item.querySelector(".sttvk-autocomplete-badge");
    if (added && !badge) {
      const fav = document.createElement("span");
      fav.className = "sttvk-autocomplete-badge is-fav";
      fav.textContent = "★ fav";
      item.appendChild(fav);
      emote.isFavorite = true;
      launchConfetti(item.getBoundingClientRect(), 12);
      return;
    }
    if (!added && badge) {
      badge.remove();
      emote.isFavorite = false;
    }
  }

  function launchConfetti(anchorRect, count = 28) {
    const layer = document.createElement("div");
    layer.className = "sttvk-confetti-layer";
    document.documentElement.appendChild(layer);

    const originX = anchorRect ? anchorRect.left + anchorRect.width / 2 : window.innerWidth / 2;
    const originY = anchorRect ? anchorRect.top : window.innerHeight * 0.7;
    const colors = ["#53fc18", "#5b9fd4", "#ff6b6b", "#ffd166", "#c77dff", "#4cc9f0"];

    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.className = "sttvk-confetti-piece";
      piece.style.left = `${originX}px`;
      piece.style.top = `${originY}px`;
      piece.style.background = colors[i % colors.length];
      const dx = (Math.random() - 0.5) * 260;
      const dy = -80 - Math.random() * 220;
      piece.style.setProperty("--dx", `${dx}px`);
      piece.style.setProperty("--dy", `${dy}px`);
      layer.appendChild(piece);
    }

    setTimeout(() => layer.remove(), 1200);
  }

  /**
   * @param {number} index
   */
  function selectEmote(index) {
    const pick = visibleResults[index];
    const el = activeInput;
    if (!pick || !el) return;

    const match = getTriggerMatch(el);
    if (!match) return;

    if (pick.isRoulette) {
      void insertRouletteEmote(el, match);
      return;
    }

    replaceRange(el, match.start, match.end, pick.code + " ");
    hideDropdown();
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    window.STTVKStorage?.addRecent(pick);
  }

  /**
   * @param {HTMLElement} el
   * @param {{ start: number, end: number }} match
   */
  async function insertRouletteEmote(el, match) {
    if (!emotes?.length) return;

    const winner = emotes[Math.floor(Math.random() * emotes.length)];
    replaceRange(el, match.start, match.end, winner.code + " ");
    hideDropdown();
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));

    const anchor = getDropdownAnchor(el);
    launchConfetti(anchor.getBoundingClientRect(), 36);
    await window.STTVKStorage?.addRecent(winner);
    await window.STTVKStorage?.bumpStat("rouletteRolls");
  }

  /**
   * @param {HTMLElement} el
   * @param {number} start
   * @param {number} end
   * @param {string} text
   */
  function replaceRange(el, start, end, text) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const value = el.value;
      el.value = value.slice(0, start) + text + value.slice(end);
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
      return;
    }

    el.focus();
    const range = document.createRange();
    const startPos = locateTextPosition(el, start);
    const endPos = locateTextPosition(el, end);
    if (!startPos || !endPos) {
      const full = el.textContent || "";
      el.textContent = full.slice(0, start) + text + full.slice(end);
      return;
    }

    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    if (document.queryCommandSupported?.("insertText")) {
      document.execCommand("insertText", false, text);
      return;
    }
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /**
   * @param {HTMLElement} root
   * @param {number} index
   * @returns {{ node: Text, offset: number } | null}
   */
  function locateTextPosition(root, index) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0;
    while (walker.nextNode()) {
      const node = /** @type {Text} */ (walker.currentNode);
      const len = node.textContent?.length || 0;
      if (pos + len >= index) {
        return { node, offset: index - pos };
      }
      pos += len;
    }
    return null;
  }

  /**
   * @param {string} str
   */
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();

(() => {
  "use strict";

  const MAX_RESULTS = 8;
  const TRIGGER = ":";

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
    '[data-testid="chat-emote-suggestion-list"]',
    '[class*="emote-suggestion"]',
    '[class*="EmoteSuggestion"]',
    '[data-a-target="autocomplete-balloon"]',
    ".chat-input__autocomplete",
    "#emotePopup",
    ".ffz-autocomplete-list",
    ".bttv-emote-autocomplete",
  ];

  let nativeSuppressObserver = null;

  init();

  function init() {
    createDropdown();
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
      if (!Number.isNaN(index)) selectEmote(index);
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

    if (!emotes || emotes.length === 0) {
      showDropdown(el, [], match.query);
      return;
    }

    const query = match.query.toLowerCase();
    visibleResults = emotes
      .filter((e) => e.name.toLowerCase().includes(query) || e.code.toLowerCase().includes(query))
      .slice(0, MAX_RESULTS);

    selectedIndex = 0;
    showDropdown(el, visibleResults, match.query);
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
        if (!(node instanceof HTMLElement)) return;
        if (node === dropdown || dropdown?.contains(node)) return;
        node.style.setProperty("display", "none", "important");
        node.style.setProperty("visibility", "hidden", "important");
        node.style.setProperty("pointer-events", "none", "important");
      });
    }
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
      if (!(input instanceof HTMLElement) || input.dataset.sttvkLexicalDisabled === "1") return;

      const editor = input.__lexicalEditor;
      const textTransforms = editor?._nodes?.get?.("text")?.transforms;
      if (!textTransforms) return;

      let removed = false;
      for (const transformer of [...textTransforms]) {
        if (transformer.toString().includes("chat_emote_suggestion_list")) {
          textTransforms.delete(transformer);
          removed = true;
        }
      }

      if (removed) input.dataset.sttvkLexicalDisabled = "1";
    });
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
      if (index === selectedIndex) item.classList.add("is-selected");
      item.dataset.index = String(index);
      item.setAttribute("role", "option");

      const img = document.createElement("img");
      img.src = emote.url;
      img.alt = emote.name;
      img.loading = "lazy";

      const name = document.createElement("span");
      name.className = "sttvk-autocomplete-name";
      name.textContent = emote.code;

      const provider = document.createElement("span");
      provider.className = "sttvk-autocomplete-provider";
      provider.textContent = `(${emote.provider})`;

      item.append(img, name, provider);
      dropdown.appendChild(item);
    });
  }

  /**
   * @param {number} index
   */
  function selectEmote(index) {
    const emote = visibleResults[index];
    const el = activeInput;
    if (!emote || !el) return;

    const match = getTriggerMatch(el);
    if (!match) return;

    replaceRange(el, match.start, match.end, emote.code + " ");
    hideDropdown();
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
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

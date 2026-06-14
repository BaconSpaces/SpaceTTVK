# SpaceTTVK

Chrome extension for **Kick** (and Twitch) inspired by the clean toggle UI of [PolyExtended](https://github.com/PolyExtended/PolyExtended). Adds **7TV**, **BTTV**, and **FFZ** emote autocomplete and chat rendering.

Type `:` followed by an emote name and pick from the dropdown.

![Emote autocomplete preview](https://github.com/user-attachments/assets/8004d3cc-3bf1-4a24-8169-e7870ba02fa2)

## Popup (PolyExtended-style)

Click the extension icon for a white toggle panel with Kick-green accents:

- **SpaceTTVK emotes** — master switch
  - 7TV / BTTV / FFZ sub-toggles
- **Colon autocomplete** — `:` search in chat
- **Emotes in chat** — render third-party emotes as images
- **Hide Kick native picker** — removes Kick's built-in `:` menu
- **Favorites** — starred emotes list (Alt+click in chat)

## Features

- `:` emote search in chat (like the reference UI)
- Emote preview image, name, and provider tag `(7TV)` / `(BTTV)` / `(FFZ)`
- Keyboard navigation: ↑ ↓ to move, Enter or Tab to insert, Esc to close
- Loads global + channel emotes automatically when you open a stream
- Works on Twitch (`twitch.tv`) and Kick (`kick.com`)
- **⭐ Favorites** — Alt+click any emote in the dropdown to save it; type `:` alone to see them first
- **💬 Chat rendering** — 7TV, BTTV & FFZ emotes show as images in chat messages

## Supported providers

| Provider | Twitch | Kick |
|----------|--------|------|
| 7TV      | Yes    | Yes  |
| BTTV     | Yes    | Yes (global + linked Twitch channel) |
| FFZ      | Yes    | Yes (global + linked Twitch channel) |

On Kick, BTTV and FFZ channel emotes are loaded when the streamer has a matching Twitch account (same username, or a `twitch.tv/...` link in their Kick bio). Global BTTV and FFZ emotes always work on Kick.

## Install (developer / unpacked)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `SpaceTTVK`
5. Open a Twitch or Kick stream and type `:` in chat

## Usage

1. Go to any live channel on Twitch or Kick
2. Click the chat input
3. Type `:` and start typing an emote name
4. Use ↑↓ or hover to highlight an emote
5. Press **Enter** or click to insert the emote code

The extension inserts the emote **text code** (for example `LUL` or `pepeLaugh`) and **renders it as an image in chat** for you and other extension users viewing the page.

## Project structure

```
SpaceTTVK/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── icons/
├── src/
│   ├── background.js   # Fetches & caches emotes
│   ├── emotes.js       # 7TV / BTTV / FFZ API helpers
│   ├── content.js      # Chat autocomplete UI
│   ├── chat-render.js  # Emote images in chat messages
│   ├── chat.css
│   ├── storage.js      # Favorites
│   └── autocomplete.css
└── README.md
```

## Backups

Snapshots live in `backup/` before major updates. See `backup/README.md` to restore.

## Permissions

- **storage** — cache emote lists locally for faster loading
- **host_permissions** — Twitch/Kick pages plus 7TV, BTTV, and FFZ APIs/CDNs

## License

MIT

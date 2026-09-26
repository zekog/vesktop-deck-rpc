# vesktop-deck-rpc

A tiny Discord RPC bridge that lets **Stream Deck / OpenDeck control Discord voice (mute / deafen)** while you use **[Vesktop](https://github.com/Vencord/Vesktop)**.

> Tested on Linux with OpenDeck + the `com.hotspot.streamdock.discord` plugin (Mirabox / AJAZZ / StreamDock decks).

---

## The problem

Vesktop bundles **arRPC**, an open implementation of Discord's local RPC servers. But arRPC only implements Rich Presence commands (`SET_ACTIVITY`, `INVITE_BROWSER`, `DEEP_LINK`, …).

Stream Deck Discord plugins don't use Rich Presence for the mute/deafen buttons. They talk to Discord over the local IPC socket (`discord-ipc-0`) and send:

- `AUTHENTICATE`
- `GET_VOICE_SETTINGS`
- `SET_VOICE_SETTINGS`
- `SUBSCRIBE` → `VOICE_SETTINGS_UPDATE`

arRPC speaks none of these, so your deck buttons do nothing and the plugin never finishes logging in.

## The solution

`vesktop-deck-rpc` is a small Node.js daemon that:

1. Listens on `discord-ipc-0` and pretends to be Discord's RPC server for the deck plugin (it accepts any token, so no real OAuth setup is needed).
2. Actually reads/toggles mute & deafen **inside Vesktop** using the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) and Vencord's internals.
3. Pushes `VOICE_SETTINGS_UPDATE` back to the deck so the button icons stay in sync.
4. Forwards Rich Presence (`SET_ACTIVITY`) to Vesktop as well, so you don't lose your "Playing …" status.

```
┌──────────────────────────────┐
│ OpenDeck + Discord plugin    │
│  (mute / deafen buttons)     │
└───────────────┬──────────────┘
                │  Discord IPC  (discord-ipc-0)
                ▼
┌──────────────────────────────┐
│ vesktop-deck-rpc (this)      │
└───────────────┬──────────────┘
                │  CDP  (127.0.0.1:9222)
                ▼
┌──────────────────────────────┐
│ Vesktop renderer              │
│  Vencord → FluxDispatcher /   │
│  MediaEngineStore             │
└──────────────────────────────┘
```

No patching of Vesktop or Vencord is required — it survives updates.

---

## Requirements

- **Linux** (should work on macOS, untested)
- **Node.js ≥ 22** (uses the built-in `fetch` and `WebSocket`; no npm dependencies)
- **[Vesktop](https://github.com/Vencord/Vesktop)**
- **OpenDeck** (or Elgato Stream Deck software) + a Discord plugin that exposes mute/deafen actions
- A Discord application **Client ID + Access Token** typed into the deck plugin's global settings. The value doesn't have to be valid — this bridge accepts anything — but the plugin only tries to connect when both fields are non-empty. You can literally put `1` in both.

---

## Tutorial

### 1. Get the code

```sh
git clone https://github.com/zekog/vesktop-deck-rpc.git
cd vesktop-deck-rpc
```

### 2. Enable remote debugging in Vesktop

Vesktop's launcher reads `~/.config/vesktop-flags.conf`. Add these two lines:

```
--remote-debugging-port=9222
--remote-allow-origins=*
```

> The port is only bound to localhost. If you don't want it always on, you can instead launch Vesktop manually with these flags only when needed.

### 3. Disable Vesktop's built-in arRPC

The bridge needs to own `discord-ipc-0`. Vesktop's arRPC holds it otherwise.

- Open Vesktop → Settings → search **arRPC** → turn **off** "arRPC (Rich Presence)",
  **or** close Vesktop and set `"arRPC": false` in `~/.config/vesktop/settings.json`.

Then **restart Vesktop**.

### 4. Start the bridge

Quick test:

```sh
node src/index.js
```

You should see:

```
[ipc] listening on discord-ipc-0
[cdp] connected to Vesktop: https://discord.com/channels/@me
[main] ready — Stream Deck / OpenDeck can now control Vesktop voice
```

### 5. Restart / reload OpenDeck's Discord plugin

Restart OpenDeck, or remove and re-add a Discord action. The plugin will now log in and its log should contain:

```
Logged in successfully!
Microphone Initialized
Headset Mute Initialized
```

Press your deck's Mute / Deafen buttons — Vesktop reacts, and the icons update.

### 6. Autostart (optional, recommended)

Create `~/.config/systemd/user/vesktop-deck-rpc.service` (adjust paths):

```ini
[Unit]
Description=Discord RPC bridge for Vesktop (Stream Deck voice)
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/node /home/YOUR_USER/vesktop-deck-rpc/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now vesktop-deck-rpc
```

Manage it with:

```sh
systemctl --user status vesktop-deck-rpc
journalctl --user -u vesktop-deck-rpc -f
```

The bridge retries the CDP connection every 2 s, so it's fine if Vesktop starts later than the service.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `[ipc] failed to bind discord-ipc-0` | Vesktop's built-in arRPC is still enabled, or another Discord client owns the socket. Disable arRPC and restart Vesktop. |
| `[cdp] connected to Vesktop` never appears | `--remote-debugging-port=9222` wasn't loaded. Launch Vesktop from a terminal and check `curl http://127.0.0.1:9222/json`. |
| Plugin log says `Login failed` forever | No RPC server is listening on `discord-ipc-0`. Check the bridge is running (`systemctl --user status vesktop-deck-rpc`). |
| Buttons toggle but icon state is wrong | The plugin needs `VOICE_SETTINGS_UPDATE`; make sure only one RPC server is running and the plugin was restarted after the bridge started. |
| Rich Presence stopped working | Rich Presence is forwarded through this bridge to Vencord's `WebRichPresence (arRPC)` plugin. Make sure Vencord is loaded normally in Vesktop. |

Debug the CDP link manually:

```sh
curl http://127.0.0.1:9222/json | grep webSocketDebuggerUrl
```

---

## How the voice control works

Inside the Vesktop renderer the bridge evaluates, via CDP:

```js
const W = Vencord.Webpack;
const A = W.findByProps("toggleSelfMute", "toggleSelfDeaf");
const ME = W.Common.MediaEngineStore;

if (ME.isSelfMute() !== want) A.toggleSelfMute();
```

Discord exposes no reliable absolute `setSelfDeaf`, so the bridge computes the difference and uses the toggle action, then waits for `MediaEngineStore` to reflect the new state. Changes are polled once per second and broadcast to any client subscribed to `VOICE_SETTINGS_UPDATE`.

## Limitations

- Vesktop's built-in **arRPC must stay disabled**; this bridge replaces it (and re-implements its Rich Presence forwarding).
- The CDP debugging port is open on localhost while Vesktop runs with that flag. Any local process could use it to control Vesktop. Remove the flag if you don't want that.
- Only self **mute / deafen** are implemented (plus Rich Presence). Voice channel join, per-user volume, PTT etc. are not.
- Internal Discord module names can change between Discord updates. The lookups use Vencord's `findByProps`, which is fairly resilient, but a major refactor could break it.

## License

[MIT](./LICENSE)

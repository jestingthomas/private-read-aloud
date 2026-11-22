# Private Read Aloud

An offline text-to-speech reader for Windows. Paste or type text, pick a voice, and it reads aloud while highlighting the current word.

**Nothing leaves your computer.** Speech is produced by the voices built into Windows. The app makes no network requests, has no telemetry, and has no auto-update.

## Download

Get the latest `.exe` from the [Releases](../../releases) page:

- `PrivateReadAloud-x.y.z-portable.exe`: double-click to run; nothing is installed.
- `PrivateReadAloud-x.y.z-setup.exe`: installs for your user account (no admin rights needed) and adds a Start menu entry.

> **Windows SmartScreen warning:** the executables are not code-signed, so Windows may show "Windows protected your PC" the first time. Click **More info → Run anyway**. If you'd rather not trust a prebuilt binary, build it yourself from source (below).

Requires Windows 10 or 11 (64-bit).

## Features

- Voice picker listing the local Windows voices only
- Speed slider (0.5×–2.5×) that works while reading
- Play / Pause / Stop, **Ctrl+Enter** to play, **Esc** to stop
- **Read clipboard** button
- Current word highlighted as it is spoken
- Select part of the text to read only that part
- Follows the Windows light/dark theme

## Privacy

- Voices come from Windows' own speech engines (SAPI / OneCore). The voice list is filtered to local voices only, so no cloud voices are ever used.
- Every network request from the app window is blocked except local `file:` content.
- Chromium background networking, component updates and the spell-checker (which downloads dictionaries) are disabled.
- A fallback for OneCore voices runs a small local PowerShell script ([`onecore-bridge.ps1`](onecore-bridge.ps1)) that calls `Windows.Media.SpeechSynthesis`. It never touches the network. Temporary audio files go to your temp folder and are deleted when the app closes.

## Voices

The app uses whatever voices Windows has installed. To add more, go to **Settings → Time & language → Speech → Add voices**.

**Narrator "natural" voices are not supported.** Windows only lets Narrator use them; they aren't exposed through any public speech API.

## Build from source

Requires [Node.js](https://nodejs.org/) 20 or newer.

```powershell
npm install
npm start          # run in development
npm run dist       # build the .exe files into dist\
```

`npm run dist` fails if the project folder's path is very long (NSIS has a 260-character path limit). If that happens, build from a short path such as `C:\src\read-aloud`.

The build is unsigned (`signAndEditExecutable: false`), so no signing certificate is needed.

## Project layout

| File | Purpose |
| --- | --- |
| `main.js` | Electron main process: window, network blocking, clipboard, OneCore bridge |
| `preload.js` | Exposes a minimal API to the page |
| `index.html` | The whole user interface and speech logic |
| `onecore-bridge.ps1` | Local PowerShell bridge to Windows OneCore voices |

## License

[MIT](LICENSE). Provided as is, without warranty.

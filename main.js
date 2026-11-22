const { app, BrowserWindow, ipcMain, clipboard, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

// ---------- Privacy hardening ----------
// No background networking, no Chromium field trials, no component updates.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-features', 'SpellcheckService,AutofillServerCommunication,MediaRouter');
app.commandLine.appendSwitch('no-pings');

// ---------- OneCore bridge (Windows.Media.SpeechSynthesis via local PowerShell) ----------
const bridgeScript = app.isPackaged
  ? path.join(process.resourcesPath, 'onecore-bridge.ps1')
  : path.join(__dirname, 'onecore-bridge.ps1');

const audioDir = path.join(os.tmpdir(), 'private-read-aloud-' + process.pid);
let bridge = null;
let bridgeBuf = '';
let nextId = 1;
const pending = new Map();
let bridgeReady = null;

function startBridge() {
  if (bridgeReady) return bridgeReady;
  bridgeReady = new Promise((resolve, reject) => {
    if (process.platform !== 'win32' || !fs.existsSync(bridgeScript)) {
      return reject(new Error('OneCore bridge unavailable'));
    }
    fs.mkdirSync(audioDir, { recursive: true });
    bridge = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', bridgeScript],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    const timer = setTimeout(() => reject(new Error('OneCore bridge timed out')), 20000);

    bridge.stdout.setEncoding('utf8');
    bridge.stdout.on('data', (chunk) => {
      bridgeBuf += chunk;
      let nl;
      while ((nl = bridgeBuf.indexOf('\n')) >= 0) {
        const line = bridgeBuf.slice(0, nl).trim();
        bridgeBuf = bridgeBuf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 0 && msg.ready) { clearTimeout(timer); resolve(); continue; }
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);
        msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error || 'bridge error'));
      }
    });
    bridge.stderr.on('data', (d) => console.error('[bridge]', d.toString()));
    bridge.on('exit', () => {
      clearTimeout(timer);
      for (const p of pending.values()) p.reject(new Error('OneCore bridge exited'));
      pending.clear();
      bridge = null;
      bridgeReady = null;
      reject(new Error('OneCore bridge exited'));
    });
  });
  return bridgeReady;
}

async function bridgeCall(payload) {
  await startBridge();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    bridge.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
  });
}

ipcMain.handle('onecore:list', async () => {
  try {
    const res = await bridgeCall({ cmd: 'list' });
    return res.voices || [];
  } catch (e) {
    console.error(e.message);
    return [];
  }
});

let fileCounter = 0;
ipcMain.handle('onecore:synth', async (_e, { voiceId, text }) => {
  const outPath = path.join(audioDir, `chunk-${++fileCounter}.wav`);
  const res = await bridgeCall({
    cmd: 'synth',
    voiceId: String(voiceId),
    textB64: Buffer.from(String(text), 'utf8').toString('base64'),
    outPath,
  });
  return { url: pathToFileURL(outPath).href, path: outPath, cues: res.cues || [] };
});

ipcMain.handle('onecore:release', (_e, filePath) => {
  // Only delete files inside our own temp dir.
  const resolved = path.resolve(String(filePath));
  if (resolved.startsWith(audioDir + path.sep)) fs.rm(resolved, { force: true }, () => {});
});

ipcMain.handle('clipboard:read', () => clipboard.readText());

// ---------- Window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 520,
    minHeight: 400,
    title: 'Private Read Aloud',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false, // the spellchecker downloads dictionaries from the internet
    },
  });

  // Never open new windows or navigate away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  // Block every request that isn't local.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const ok = /^(file|devtools|data|blob):/i.test(details.url);
    if (!ok) console.warn('Blocked network request:', details.url);
    cb({ cancel: !ok });
  });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setSpellCheckerEnabled(false);

  createWindow();
  startBridge().catch((e) => console.error(e.message));
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  if (bridge) { try { bridge.stdin.end(); bridge.kill(); } catch {} }
  try { fs.rmSync(audioDir, { recursive: true, force: true }); } catch {}
});

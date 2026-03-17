const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const { spawn, exec } = require('child_process');
const fs     = require('fs');
const os     = require('os');

let mainWindow;
const OUTPUT_DIR = path.join(os.homedir(), 'Music', 'TuneBird');

// ─── Binary detection ────────────────────────────────────────────────────────
function findBinary(name) {
  const candidates = [
    `/opt/homebrew/bin/${name}`,   // Apple Silicon Homebrew
    `/usr/local/bin/${name}`,      // Intel Homebrew
    `/usr/bin/${name}`,
    path.join(app.getPath('userData'), 'bin', name),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return name; // fallback: hope it's in $PATH
}

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111113',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Check dependencies ─────────────────────────────────────────────────
ipcMain.handle('check-deps', async () => {
  const check = (name) => new Promise(resolve => {
    exec(`"${findBinary(name)}" --version 2>&1`, (err) => resolve(!err));
  });
  const [ytdlp, ffmpeg] = await Promise.all([check('yt-dlp'), check('ffmpeg')]);
  return { ytdlp, ffmpeg };
});

// ─── IPC: Search ─────────────────────────────────────────────────────────────
ipcMain.handle('search', async (event, query) => {
  return new Promise((resolve, reject) => {
    const bin  = findBinary('yt-dlp');
    const proc = spawn(bin, [
      `ytsearch15:${query}`,
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      '--quiet',
    ]);

    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {});

    proc.on('close', () => {
      const results = out.trim().split('\n').filter(Boolean).flatMap(line => {
        try {
          const d = JSON.parse(line);
          if (!d.id) return [];
          return [{
            id:        d.id,
            title:     d.title || '(untitled)',
            thumbnail: `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
            duration:  d.duration  || 0,
            channel:   d.uploader  || d.channel || '',
            views:     d.view_count || 0,
          }];
        } catch { return []; }
      });
      resolve(results);
    });

    proc.on('error', () => reject(new Error('yt-dlp not found')));
  });
});

// ─── IPC: Download ────────────────────────────────────────────────────────────
const activeDownloads = new Map();

ipcMain.handle('download', async (event, videoId) => {
  return new Promise((resolve, reject) => {
    try { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); } catch {}

    const bin = findBinary('yt-dlp');
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    // Use videoId as filename so we always know the exact output path
    const outTemplate = path.join(OUTPUT_DIR, `${videoId}.%(ext)s`);

    const proc = spawn(bin, [
      '-x',
      '--audio-format',    'mp3',
      '--audio-quality',   '0',
      '--embed-thumbnail',
      '--add-metadata',
      '--convert-thumbnails', 'jpg',
      '--no-playlist',
      '--newline',
      '-o', outTemplate,
      url,
    ]);

    activeDownloads.set(videoId, proc);

    const send = (percent, phase) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('dl-progress', { videoId, percent, phase });
      }
    };

    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const dlPct = line.match(/\[download\]\s+([\d.]+)%/);
        if (dlPct) { send(parseFloat(dlPct[1]) * 0.72, 'downloading'); continue; }
        if (line.includes('[ExtractAudio]'))   { send(78, 'converting'); continue; }
        if (line.includes('[EmbedThumbnail]')) { send(90, 'artwork');    continue; }
        if (line.includes('[Metadata]'))       { send(95, 'metadata');   continue; }
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('close', async (code) => {
      activeDownloads.delete(videoId);
      if (code !== 0 && code !== null) {
        return reject(new Error(`yt-dlp exited with code ${code}`));
      }

      const mp3 = path.join(OUTPUT_DIR, `${videoId}.mp3`);
      if (!fs.existsSync(mp3)) {
        return reject(new Error('MP3 not found after download'));
      }

      send(97, 'adding');

      // Add to Music.app via AppleScript (write to temp file to avoid escaping issues)
      const scpt = path.join(os.tmpdir(), `tr_${Date.now()}.scpt`);
      fs.writeFileSync(scpt,
        `tell application "Music"\nadd POSIX file ${JSON.stringify(mp3)}\nend tell`
      );

      exec(`osascript "${scpt}"`, (err) => {
        try { fs.unlinkSync(scpt); } catch {}
        send(100, 'done');
        resolve({ success: true, path: mp3, addedToMusic: !err });
      });
    });

    proc.on('error', () => {
      activeDownloads.delete(videoId);
      reject(new Error('yt-dlp not found. Install it: brew install yt-dlp ffmpeg'));
    });
  });
});

ipcMain.handle('cancel-download', (_, videoId) => {
  const proc = activeDownloads.get(videoId);
  if (proc) { proc.kill('SIGTERM'); activeDownloads.delete(videoId); }
});

ipcMain.handle('open-folder', () => {
  shell.openPath(OUTPUT_DIR);
});

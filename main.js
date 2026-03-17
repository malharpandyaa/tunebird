const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const { spawn, exec } = require('child_process');
const fs     = require('fs');
const os     = require('os');

let mainWindow;
const OUTPUT_DIR    = path.join(os.homedir(), 'Music', 'TuneBird');
const HOMEBREW_PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;

function findBinary(name) {
  for (const p of [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    path.join(app.getPath('userData'), 'bin', name),
  ]) { try { if (fs.existsSync(p)) return p; } catch {} }
  return name;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160, height: 760, minWidth: 920, minHeight: 620,
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
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Check deps ────────────────────────────────────────────────────────────────
ipcMain.handle('check-deps', async () => {
  const check = n => fs.existsSync(`/opt/homebrew/bin/${n}`);
  return { ytdlp: check('yt-dlp'), ffmpeg: check('ffmpeg') };
});

// ── Search songs ──────────────────────────────────────────────────────────────
ipcMain.handle('search-songs', async (_, query) => {
  return new Promise((resolve, reject) => {
    const bin  = findBinary('yt-dlp');
    // ytsearch returns reliable structured data with standard thumbnail URLs
    const proc = spawn(bin, [
      `ytsearch15:${query}`,
      '--flat-playlist', '--dump-json', '--no-warnings', '--quiet',
    ], { env: { ...process.env, PATH: HOMEBREW_PATH } });

    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', () => {
      const results = out.trim().split('\n').filter(Boolean).flatMap(line => {
        try {
          const d = JSON.parse(line);
          if (!d.id) return [];
          return [{ type: 'song', id: d.id, title: d.title || '(untitled)',
            thumbnail: `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
            duration: d.duration || 0, channel: d.uploader || d.channel || '',
            views: d.view_count || 0 }];
        } catch { return []; }
      });
      resolve(results);
    });
    proc.on('error', () => reject(new Error('yt-dlp not found')));
  });
});

// ── Search playlists ──────────────────────────────────────────────────────────
// Strategy:
// 1. Search music.youtube.com for the query
// 2. From search results, grab the UC channel IDs
// 3. Fetch one song from each channel to discover the REAL YouTube channel_id
// 4. Browse real_channel/releases to get OLAK5uy_ album IDs — full discography
// 5. Fetch each album for metadata, sort by title match
ipcMain.handle('search-playlists', async (_, query) => {
  return new Promise((resolve, reject) => {
    const bin = findBinary('yt-dlp');

    const doSearch = (url) => new Promise(res => {
      const proc = spawn(bin, [
        url, '--flat-playlist', '--dump-json', '--no-warnings', '--quiet',
      ], { env: { ...process.env, PATH: HOMEBREW_PATH } });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', () => {});
      proc.on('close', () => res(out));
      proc.on('error', () => res(''));
    });

    // Get real channel_id by fetching first song from a music channel
    const getRealChannelId = (musicChannelId) => new Promise(res => {
      const proc = spawn(bin, [
        `https://music.youtube.com/browse/${musicChannelId}`,
        '--flat-playlist', '--dump-json', '--no-warnings', '--quiet',
        '--playlist-items', '1',
      ], { env: { ...process.env, PATH: HOMEBREW_PATH } });
      let buf = '';
      proc.stdout.on('data', d => { buf += d.toString(); });
      proc.stderr.on('data', () => {});
      proc.on('close', () => {
        try {
          const d = JSON.parse(buf.trim().split('\n')[0]);
          // channel_id is the real YouTube channel, different from the Music browse ID
          res(d.channel_id || null);
        } catch { res(null); }
      });
      proc.on('error', () => res(null));
    });

    // Browse real YouTube channel's releases page for OLAK5uy_ album IDs
    const browseReleases = (channelId) => new Promise(res => {
      const proc = spawn(bin, [
        `https://music.youtube.com/browse/${channelId}/releases`,
        '--flat-playlist', '--dump-json', '--no-warnings', '--quiet',
      ], { env: { ...process.env, PATH: HOMEBREW_PATH } });
      let buf = '';
      proc.stdout.on('data', d => { buf += d.toString(); });
      proc.stderr.on('data', () => {});
      proc.on('close', () => {
        const ids = buf.trim().split('\n').filter(Boolean).flatMap(l => {
          try {
            const d = JSON.parse(l);
            const id = d.id || '';
            return (id.startsWith('OLAK5uy_') || id.startsWith('MPREb_')) ? [id] : [];
          } catch { return []; }
        });
        res([...new Set(ids)]);
      });
      proc.on('error', () => res([]));
    });

    // Fetch album metadata via its first track
    const fetchAlbum = (id) => new Promise(res => {
      // OLAK5uy_ IDs use playlist URL, MPREb_ use browse URL
      const url = id.startsWith('OLAK5uy_')
        ? `https://music.youtube.com/playlist?list=${id}`
        : `https://music.youtube.com/browse/${id}`;
      const proc = spawn(bin, [
        url, '--flat-playlist', '--dump-json', '--no-warnings', '--quiet',
        '--playlist-items', '1',
      ], { env: { ...process.env, PATH: HOMEBREW_PATH } });
      let buf = '';
      proc.stdout.on('data', d => { buf += d.toString(); });
      proc.stderr.on('data', () => {});
      proc.on('close', () => {
        try {
          const d = JSON.parse(buf.trim().split('\n')[0]);
          const thumbs = d.thumbnails || [];
          const thumb  = thumbs.length
            ? thumbs[thumbs.length - 1].url
            : (d.id ? `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg` : '');
          const rawTitle = d.playlist_title || d.playlist || '(untitled)';
          const title = rawTitle.replace(/^(Album|EP|Single)\s*-\s*/i, '').trim();
          res({
            type: 'playlist', id,
            url:        url,
            title,
            thumbnail:  thumb,
            channel:    d.playlist_uploader || d.playlist_channel || '',
            trackCount: d.n_entries || null,
          });
        } catch { res(null); }
      });
      proc.on('error', () => res(null));
    });

    (async () => {
      // Step 1: search for the query, collect Music UC channel IDs
      const raw = await doSearch(`https://music.youtube.com/search?q=${encodeURIComponent(query)}`);
      const musicChannelIds = [];
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        try {
          const d = JSON.parse(line);
          const id = d.id || '';
          if (id.startsWith('UC') && !musicChannelIds.includes(id)) musicChannelIds.push(id);
        } catch {}
      }

      if (!musicChannelIds.length) { resolve([]); return; }

      // Step 2: resolve real channel IDs from Music channel IDs (top 2)
      const realChannelIds = (await Promise.all(
        musicChannelIds.slice(0, 2).map(getRealChannelId)
      )).filter(Boolean);

      const uniqueRealIds = [...new Set(realChannelIds)];
      if (!uniqueRealIds.length) { resolve([]); return; }

      // Step 3: browse each real channel's releases page
      const albumIdArrays = await Promise.all(uniqueRealIds.map(browseReleases));
      const allIds = [...new Set(albumIdArrays.flat())];

      if (!allIds.length) { resolve([]); return; }

      // Step 4: fetch metadata for all albums in batches
      const results = [];
      const batchSize = 8;
      for (let i = 0; i < allIds.length; i += batchSize) {
        const batch = await Promise.all(allIds.slice(i, i + batchSize).map(fetchAlbum));
        results.push(...batch.filter(Boolean));
      }

      // Step 5: sort — strip artist name from query words, score by remaining words
      const stopWords = new Set(['the','a','an','and','or','of','in','on','by','ft','feat','with']);
      const artistWords = new Set(
        (results[0]?.channel || '').toLowerCase().split(/\s+/).filter(w => w.length > 1)
      );
      const allQueryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
      const albumWords    = allQueryWords.filter(w => !artistWords.has(w));
      const scoreWords    = albumWords.length ? albumWords : allQueryWords;

      const score = (album) => {
        const t = album.title.toLowerCase();
        const phrase = scoreWords.join(' ');
        if (phrase && t === phrase)          return 1000;
        if (phrase && t.includes(phrase))    return 500;
        return scoreWords.filter(w => t.includes(w)).length;
      };

      results.sort((a, b) => score(b) - score(a));
      resolve(results);
    })().catch(e => { console.error(e); reject(new Error('Search failed')); });
  });
});

// ── Fetch playlist tracks ─────────────────────────────────────────────────────
ipcMain.handle('fetch-playlist', async (_, url) => {
  return new Promise((resolve, reject) => {
    const bin  = findBinary('yt-dlp');
    const proc = spawn(bin, [
      url, '--flat-playlist', '--dump-json', '--no-warnings', '--quiet',
    ], { env: { ...process.env, PATH: HOMEBREW_PATH } });

    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', code => {
      if (code !== 0 && !out.trim()) return reject(new Error('Could not fetch playlist.'));
      const lines  = out.trim().split('\n').filter(Boolean);
      const tracks = [];
      let plTitle = '', plThumb = '', channel = '', downloadUrl = url;
      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          if (!plTitle) {
            plTitle  = d.playlist_title || d.playlist || d.title || 'Playlist';
            channel  = d.playlist_uploader || d.uploader || d.channel || '';
            // Capture the OLAK5uy_ playlist ID for downloading — it's more reliable than MPREb_
            const plId = d.playlist_id || '';
            if (plId.startsWith('OLAK5uy_')) {
              downloadUrl = `https://music.youtube.com/playlist?list=${plId}`;
            } else if (plId.startsWith('MPREb_')) {
              downloadUrl = `https://music.youtube.com/browse/${plId}`;
            }
          }
          const id = d.id || d.url?.split('v=')[1]?.split('&')[0];
          if (!id) continue;
          const thumb = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
          if (!plThumb) plThumb = thumb;
          tracks.push({ id, title: d.title || '(untitled)', duration: d.duration || 0, thumbnail: thumb });
        } catch {}
      }
      if (!tracks.length) return reject(new Error('No tracks found.'));
      resolve({ title: plTitle, thumbnail: plThumb, channel, tracks, downloadUrl });
    });
    proc.on('error', () => reject(new Error('yt-dlp not found')));
  });
});

// ── Download single track ─────────────────────────────────────────────────────
const activeDownloads = new Map();

ipcMain.handle('download', async (_, videoId) => {
  return new Promise((resolve, reject) => {
    try { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); } catch {}
    const bin = findBinary('yt-dlp');
    const proc = spawn(bin, [
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '--embed-thumbnail', '--add-metadata', '--convert-thumbnails', 'jpg',
      '--no-playlist', '--newline',
      '-o', path.join(OUTPUT_DIR, `${videoId}.%(ext)s`),
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { env: { ...process.env, PATH: HOMEBREW_PATH } });

    activeDownloads.set(videoId, proc);
    const send = (percent, phase) => {
      mainWindow?.webContents.send('dl-progress', { videoId, percent, phase });
    };

    let buf = '';
    const onData = chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        const pct = line.match(/\[download\]\s+([\d.]+)%/);
        if (pct) { send(parseFloat(pct[1]) * 0.72, 'downloading'); continue; }
        if (line.includes('[ExtractAudio]'))   { send(78, 'converting'); continue; }
        if (line.includes('[EmbedThumbnail]')) { send(90, 'artwork');    continue; }
        if (line.includes('[Metadata]'))       { send(95, 'metadata');   continue; }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('close', code => {
      activeDownloads.delete(videoId);
      if (code !== 0 && code !== null) return reject(new Error(`yt-dlp exited with code ${code}`));
      const mp3 = path.join(OUTPUT_DIR, `${videoId}.mp3`);
      if (!fs.existsSync(mp3)) return reject(new Error('MP3 not found'));
      send(97, 'adding');
      const scpt = path.join(os.tmpdir(), `tb_${Date.now()}.scpt`);
      fs.writeFileSync(scpt, `tell application "Music"\nadd POSIX file ${JSON.stringify(mp3)}\nend tell`);
      exec(`osascript "${scpt}"`, err => {
        try { fs.unlinkSync(scpt); } catch {}
        send(100, 'done');
        resolve({ success: true, addedToMusic: !err });
      });
    });
    proc.on('error', () => { activeDownloads.delete(videoId); reject(new Error('yt-dlp not found')); });
  });
});

// ── Download full playlist ────────────────────────────────────────────────────
ipcMain.handle('download-playlist', async (_, { url, title, trackCount }) => {
  return new Promise((resolve, reject) => {
    const safeName = title.replace(/[/\\:*?"<>|]/g, '-').trim() || 'Playlist';
    const albumDir = path.join(OUTPUT_DIR, safeName);
    try { fs.mkdirSync(albumDir, { recursive: true }); } catch {}

    const bin  = findBinary('yt-dlp');
    const proc = spawn(bin, [
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '--embed-thumbnail', '--add-metadata', '--convert-thumbnails', 'jpg',
      '--yes-playlist', '--newline',
      '--parse-metadata', 'playlist_title:%(album)s',
      '--parse-metadata', 'playlist_index:%(track_number)s',
      '-o', path.join(albumDir, '%(playlist_index)s - %(title)s.%(ext)s'),
      url,
    ], { env: { ...process.env, PATH: HOMEBREW_PATH } });

    activeDownloads.set(url, proc);
    const send = (percent, phase, trackIndex) => {
      mainWindow?.webContents.send('playlist-progress', { url, percent, phase, trackIndex });
    };

    let buf = '', currentTrack = 0;
    const onData = chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        const tm = line.match(/\[download\] Downloading item (\d+) of \d+/);
        if (tm) { currentTrack = parseInt(tm[1]); send(((currentTrack-1)/trackCount)*85, 'downloading', currentTrack); continue; }
        const pm = line.match(/\[download\]\s+([\d.]+)%/);
        if (pm) { send((((currentTrack-1)+parseFloat(pm[1])/100)/trackCount)*85, 'downloading', currentTrack); continue; }
        if (line.includes('[ExtractAudio]'))   { send(((currentTrack-0.3)/trackCount)*85, 'converting', currentTrack); continue; }
        if (line.includes('[EmbedThumbnail]')) { send(((currentTrack-0.1)/trackCount)*85, 'artwork',    currentTrack); continue; }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('close', code => {
      activeDownloads.delete(url);
      send(90, 'adding', trackCount);
      // Don't reject on non-zero exit — yt-dlp exits with code 1 if even one track
      // is unavailable, but the rest may have downloaded fine. Check for MP3s first.
      let mp3s = [];
      try { mp3s = fs.readdirSync(albumDir).filter(f => f.toLowerCase().endsWith('.mp3')).sort().map(f => path.join(albumDir, f)); } catch {}
      if (!mp3s.length) return reject(new Error(`Download failed — no tracks saved (code ${code})`));
      const scpt = path.join(os.tmpdir(), `tb_pl_${Date.now()}.scpt`);
      fs.writeFileSync(scpt, `tell application "Music"\n${mp3s.map(p => `add POSIX file ${JSON.stringify(p)}`).join('\n')}\nend tell`);
      exec(`osascript "${scpt}"`, err => {
        try { fs.unlinkSync(scpt); } catch {}
        send(100, 'done', trackCount);
        resolve({ success: true, trackCount: mp3s.length, addedToMusic: !err });
      });
    });
    proc.on('error', () => { activeDownloads.delete(url); reject(new Error('yt-dlp not found')); });
  });
});

ipcMain.handle('cancel-download', (_, id) => {
  const p = activeDownloads.get(id);
  if (p) { p.kill('SIGTERM'); activeDownloads.delete(id); }
});

ipcMain.handle('open-folder', () => shell.openPath(OUTPUT_DIR));

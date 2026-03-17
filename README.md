# TuneBird 🎵

Browse YouTube, click "Add to Music" — it downloads, converts to MP3, embeds album art, and drops it straight into your Music.app library. From there it syncs to your iPhone automatically via iCloud Music Library.

---

## Developer Setup (first time)

### 1. Install yt-dlp and ffmpeg (one-time)
```bash
brew install yt-dlp ffmpeg
```

### 2. Install Node dependencies
```bash
cd tunebird
npm install
```

### 3. Run the app
```bash
npm start
```

---

## Build a distributable .dmg (to give to others)

```bash
npm run build
```

This produces `dist/TuneBird-1.0.0.dmg`. The app **includes everything except yt-dlp and ffmpeg** — those must be installed once by the user via Homebrew. The app shows a setup screen automatically if they're missing.

> **Signing note**: macOS will warn "unidentified developer" unless you sign the app. To fix this, users right-click → Open, or you can sign with a free Apple Developer account using `electron-builder --mac --sign`.

---

## How it works

1. **Search** — Uses `yt-dlp ytsearch15:...` to query YouTube without any API key
2. **Download** — `yt-dlp -x --audio-format mp3 --embed-thumbnail` grabs audio and embeds the YouTube thumbnail as album art via ffmpeg
3. **Add to Music** — AppleScript: `tell application "Music" to add POSIX file "..."`
4. **iPhone sync** — Music.app syncs to iPhone via iCloud Music Library (or USB)

### iPhone Setup (for end users)
- **Automatic (iCloud)**: Settings → Music → turn on **Sync Library** on iPhone + Music.app → Settings → General → turn on **Sync Library** on Mac
- **USB**: Plug in iPhone → Finder → iPhone → Music tab → Sync

---

## Files land here
`~/Music/TuneBird/` — named by YouTube video ID, with full metadata embedded

---

## Troubleshooting

| Issue | Fix |
|---|---|
| App shows setup screen | Run `brew install yt-dlp ffmpeg` in Terminal |
| "yt-dlp not found" error | Make sure Homebrew is in `/opt/homebrew` (M1/M2) or `/usr/local` (Intel) |
| Download fails | Video may be private, age-restricted, or geo-blocked |
| Music.app didn't get the file | Open Music.app first, then retry |
| macOS blocks the app | Right-click the .app → Open → Open anyway |

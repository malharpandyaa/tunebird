const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkDeps:        ()      => ipcRenderer.invoke('check-deps'),
  searchSongs:      q       => ipcRenderer.invoke('search-songs', q),
  searchPlaylists:  q       => ipcRenderer.invoke('search-playlists', q),
  fetchPlaylist:    url     => ipcRenderer.invoke('fetch-playlist', url),
  download:         id      => ipcRenderer.invoke('download', id),
  downloadPlaylist: opts    => ipcRenderer.invoke('download-playlist', opts),
  cancelDownload:   id      => ipcRenderer.invoke('cancel-download', id),
  openFolder:       ()      => ipcRenderer.invoke('open-folder'),

  onProgress: cb => {
    ipcRenderer.removeAllListeners('dl-progress');
    ipcRenderer.on('dl-progress', (_, d) => cb(d));
  },
  onPlaylistProgress: cb => {
    ipcRenderer.removeAllListeners('playlist-progress');
    ipcRenderer.on('playlist-progress', (_, d) => cb(d));
  },
});

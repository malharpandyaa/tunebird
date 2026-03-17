const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkDeps:    ()          => ipcRenderer.invoke('check-deps'),
  search:       (query)     => ipcRenderer.invoke('search', query),
  download:     (videoId)   => ipcRenderer.invoke('download', videoId),
  cancelDownload:(videoId)  => ipcRenderer.invoke('cancel-download', videoId),
  openFolder:   ()          => ipcRenderer.invoke('open-folder'),

  onProgress: (cb) => {
    ipcRenderer.removeAllListeners('dl-progress');
    ipcRenderer.on('dl-progress', (_, data) => cb(data));
  },
});

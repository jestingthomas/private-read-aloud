const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  onecore: {
    list: () => ipcRenderer.invoke('onecore:list'),
    synth: (voiceId, text) => ipcRenderer.invoke('onecore:synth', { voiceId, text }),
    release: (filePath) => ipcRenderer.invoke('onecore:release', filePath),
  },
});

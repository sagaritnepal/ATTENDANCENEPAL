// Exposes a narrow, specific API to settings.html instead of giving it
// direct Node/IPC access — contextIsolation stays on for the same reason
// the main window keeps it on (this is still displaying/handling
// credentials, worth keeping the same discipline).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridgeAPI', {
  save: (email, password) => ipcRenderer.invoke('bridge:save', { email, password }),
  getStatus: () => ipcRenderer.invoke('bridge:status'),
  getSaved: () => ipcRenderer.invoke('bridge:get-saved'),
});

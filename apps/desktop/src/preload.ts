import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agentron", {
  onUpdateAvailable(callback: (data: { version: string; releaseNotes?: string }) => void): void {
    ipcRenderer.on("agentron:update-available", (_event, data: { version: string; releaseNotes?: string }) => callback(data));
  },
  onUpdateDownloaded(callback: (data: { version: string }) => void): void {
    ipcRenderer.on("agentron:update-downloaded", (_event, data: { version: string }) => callback(data));
  },
  installUpdate(): Promise<void> {
    return ipcRenderer.invoke("agentron:install-update");
  },
  checkForUpdates(): void {
    ipcRenderer.send("agentron:check-for-updates");
  },
});

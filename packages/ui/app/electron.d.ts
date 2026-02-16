/** Desktop (Electron) API exposed via preload contextBridge. Only present when running inside the desktop app. */
export {};

declare global {
  interface Window {
    agentron?: {
      onUpdateAvailable(callback: (data: { version: string; releaseNotes?: string }) => void): void;
      onUpdateDownloaded(callback: (data: { version: string }) => void): void;
      installUpdate(): Promise<void>;
      checkForUpdates(): void;
    };
  }
}

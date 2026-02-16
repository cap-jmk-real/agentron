"use client";

import { useEffect, useState, useCallback } from "react";

const DISMISSED_KEY = "agentron-update-dismissed";

type UpdateState =
  | { show: false }
  | { show: true; version: string; status: "available" | "downloaded"; url?: string; releaseNotes?: string };

function isElectron(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window).agentron);
}

export default function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({ show: false });

  const dismiss = useCallback((version: string) => {
    setState({ show: false });
    try {
      localStorage.setItem(DISMISSED_KEY, version);
    } catch {
      // ignore
    }
  }, []);

  const installUpdate = useCallback(() => {
    if (!(typeof window !== "undefined" && window.agentron?.installUpdate)) return;
    void window.agentron.installUpdate();
  }, []);

  // Electron: subscribe to IPC update events
  useEffect(() => {
    if (!isElectron() || !window.agentron) return;
    window.agentron.onUpdateAvailable((data) => {
      const version = data.version;
      try {
        if (localStorage.getItem(DISMISSED_KEY) === version) return;
      } catch {
        // ignore
      }
      setState({
        show: true,
        version,
        status: "available",
        releaseNotes: data.releaseNotes,
      });
    });
    window.agentron.onUpdateDownloaded((data) => {
      const version = data.version;
      try {
        if (localStorage.getItem(DISMISSED_KEY) === version) return;
      } catch {
        // ignore
      }
      setState({
        show: true,
        version: data.version,
        status: "downloaded",
      });
    });
  }, []);

  // Web: poll /api/update-check
  useEffect(() => {
    if (isElectron()) return;
    const check = () => {
      fetch("/api/update-check")
        .then((r) => r.json())
        .then((data: { available?: boolean; version?: string; url?: string; releaseNotes?: string }) => {
          if (!data.available || !data.version) return;
          try {
            if (localStorage.getItem(DISMISSED_KEY) === data.version) return;
          } catch {
            // ignore
          }
          setState({
            show: true,
            version: data.version,
            status: "available",
            url: data.url,
            releaseNotes: data.releaseNotes,
          });
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 24 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!state.show) return null;
  const { version, status, url } = state;
  const isDesktop = isElectron();

  return (
    <div className="update-notification" role="alert">
      <div className="update-notification-inner">
        <div className="update-notification-text">
          <strong>Update available</strong>
          <span>
            {status === "downloaded"
              ? `Version ${version} is ready. Restart to install.`
              : `Version ${version} is available.`}
          </span>
        </div>
        <div className="update-notification-actions">
          {isDesktop ? (
            <button
              type="button"
              className="update-notification-primary"
              onClick={installUpdate}
            >
              {status === "downloaded" ? "Restart to install" : "Install now"}
            </button>
          ) : (
            url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="update-notification-primary"
              >
                Download
              </a>
            )
          )}
          <button
            type="button"
            className="update-notification-secondary"
            onClick={() => dismiss(version)}
          >
            Later
          </button>
        </div>
        <button
          type="button"
          className="update-notification-dismiss"
          onClick={() => dismiss(version)}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

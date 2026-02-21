"use client";

import React, { useState, useEffect } from "react";

function detectPlatform() {
  if (typeof window === "undefined") return "linux";
  const ua = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform?.toLowerCase() || "";
  if (ua.includes("win") || platform.includes("win")) return "windows";
  if (ua.includes("mac") || platform.includes("mac")) return "macos";
  return "linux";
}

function mapAssetToPlatform(
  name: string,
  url: string
): { platform: string; name: string; url: string } | null {
  const n = name.toLowerCase();
  if (n.endsWith(".exe") || n.includes("windows") || n.includes("win-"))
    return { platform: "windows", name, url };
  if (n.endsWith(".dmg") || n.endsWith(".pkg") || n.includes("mac") || n.includes("darwin"))
    return { platform: "macos", name, url };
  if (n.endsWith(".appimage") || n.includes("linux") || n.includes(".deb") || n.includes(".rpm"))
    return { platform: "linux", name, url };
  return null;
}

const PLATFORMS: { id: string; label: string; logoSrc: string }[] = [
  { id: "windows", label: "Windows", logoSrc: "/img/windows.svg" },
  { id: "macos", label: "macOS", logoSrc: "/img/apple.svg" },
  { id: "linux", label: "Linux", logoSrc: "/img/linux.svg" },
];

export function DownloadLinks({ repo = "cap-jmk-real/agentron" }: { repo?: string }) {
  const [release, setRelease] = useState<{
    tag: string;
    byPlatform: Record<string, { name: string; url: string } | null>;
    releasesUrl: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState("windows");

  useEffect(() => {
    setSelectedPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const url = `https://api.github.com/repos/${repo}/releases/latest`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("No release found");
        return res.json();
      })
      .then(
        (data: {
          tag_name: string;
          assets: { name: string; browser_download_url: string }[];
          html_url: string;
        }) => {
          if (cancelled) return;
          const assets = (data.assets || [])
            .map((a) => mapAssetToPlatform(a.name, a.browser_download_url))
            .filter(Boolean);
          const byPlatform: Record<string, { name: string; url: string } | null> = {
            windows: null,
            macos: null,
            linux: null,
          };
          assets.forEach((a) => {
            if (a && byPlatform[a.platform] === null) byPlatform[a.platform] = a;
          });
          setRelease({
            tag: data.tag_name,
            byPlatform,
            releasesUrl: data.html_url,
          });
        }
      )
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const releasesPageUrl = `https://github.com/${repo}/releases`;

  if (loading) {
    return (
      <div className="download-section">
        <p className="download-section-loading">Loading latest release…</p>
      </div>
    );
  }

  if (error || !release) {
    return (
      <div className="download-section">
        <p className="download-section-error">
          <a
            href={releasesPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            View releases on GitHub
          </a>{" "}
          to download the desktop app.
        </p>
      </div>
    );
  }

  const { byPlatform, tag, releasesUrl } = release;
  const current = byPlatform[selectedPlatform];
  const platformLabel = PLATFORMS.find((p) => p.id === selectedPlatform)?.label ?? selectedPlatform;

  return (
    <div className="download-section">
      <p className="download-section-tagline">Latest: {tag}</p>

      <div className="download-platform">
        <p className="download-platform-label">Choose your platform</p>
        <div className="download-platform-cards" role="tablist" aria-label="Platform">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={selectedPlatform === p.id}
              className={`download-platform-card ${selectedPlatform === p.id ? "download-platform-card--active" : ""}`}
              onClick={() => setSelectedPlatform(p.id)}
            >
              <span className="download-platform-card-icon">
                <img
                  src={p.logoSrc}
                  alt=""
                  width={20}
                  height={20}
                  className="download-platform-os-logo"
                />
              </span>
              <span className="download-platform-card-label">{p.label}</span>
            </button>
          ))}
        </div>

        {current ? (
          <div className="download-cta">
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-lg"
            >
              Download for {platformLabel}
            </a>
            <p className="download-cta-filename">{current.name}</p>
          </div>
        ) : (
          <p className="download-unavailable">
            No installer for {platformLabel} in this release.{" "}
            <a href={releasesUrl} target="_blank" rel="noopener noreferrer">
              See all assets
            </a>
          </p>
        )}

        <p className="download-all">
          <a
            href={releasesPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            All releases
          </a>
        </p>
      </div>
    </div>
  );
}

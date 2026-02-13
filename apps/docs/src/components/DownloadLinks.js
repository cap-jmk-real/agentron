import React, { useState, useEffect } from 'react';

function detectPlatform() {
  if (typeof window === 'undefined') return 'linux';
  const ua = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform?.toLowerCase() || '';
  if (ua.includes('win') || platform.includes('win')) return 'windows';
  if (ua.includes('mac') || platform.includes('mac')) return 'macos';
  return 'linux';
}

function mapAssetToPlatform(name, url) {
  const n = name.toLowerCase();
  if (n.endsWith('.exe') || n.includes('windows') || n.includes('win-')) return { platform: 'windows', name, url };
  if (n.endsWith('.dmg') || n.endsWith('.pkg') || n.includes('mac') || n.includes('darwin')) return { platform: 'macos', name, url };
  if (n.endsWith('.appimage') || n.includes('linux') || n.includes('.deb') || n.includes('.rpm')) return { platform: 'linux', name, url };
  return null;
}

export function DownloadLinks({ repo = 'cap-jmk-real/agentron' }) {
  const githubRepo = repo;
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPlatform, setSelectedPlatform] = useState('windows');

  useEffect(() => {
    setSelectedPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const repoUrl = githubRepo;
    const url = `https://api.github.com/repos/${repoUrl}/releases/latest`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('No release found');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const assets = (data.assets || []).map((a) => mapAssetToPlatform(a.name, a.browser_download_url)).filter(Boolean);
        const byPlatform = { windows: null, macos: null, linux: null };
        assets.forEach((a) => {
          if (a && byPlatform[a.platform] === null) byPlatform[a.platform] = a;
        });
        setRelease({ tag: data.tag_name, byPlatform, releasesUrl: data.html_url });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [githubRepo]);

  if (loading) {
    return <p>Loading latest release…</p>;
  }

  const releasesPageUrl = `https://github.com/${githubRepo}/releases`;

  if (error || !release) {
    return (
      <p>
        <a href={releasesPageUrl} target="_blank" rel="noopener noreferrer">View all releases on GitHub</a> to download the desktop app.
      </p>
    );
  }

  const { byPlatform, tag, releasesUrl } = release;
  const current = byPlatform[selectedPlatform];

  return (
    <div>
      <p>
        <strong>Latest release:</strong> {tag}
      </p>
      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="platform-select" style={{ marginRight: '0.5rem' }}>Platform:</label>
        <select
          id="platform-select"
          value={selectedPlatform}
          onChange={(e) => setSelectedPlatform(e.target.value)}
          className="download-platform-select"
        >
          <option value="windows">Windows</option>
          <option value="macos">macOS</option>
          <option value="linux">Linux</option>
        </select>
      </div>
      {current ? (
        <p>
          <a href={current.url} target="_blank" rel="noopener noreferrer" className="button button--primary">
            Download for {selectedPlatform === 'windows' ? 'Windows' : selectedPlatform === 'macos' ? 'macOS' : 'Linux'}
          </a>
          <span style={{ marginLeft: '0.5rem', fontSize: '0.9rem', color: 'var(--ifm-color-content-secondary)' }}>
            ({current.name})
          </span>
        </p>
      ) : (
        <p>
          No installer for this platform in the latest release.{' '}
          <a href={releasesUrl} target="_blank" rel="noopener noreferrer">See all assets</a>.
        </p>
      )}
      <p>
        <a href={releasesPageUrl} target="_blank" rel="noopener noreferrer">All releases</a>
      </p>
    </div>
  );
}

export default DownloadLinks;

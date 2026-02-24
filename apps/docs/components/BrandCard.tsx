"use client";

import React, { useState, useEffect } from "react";

const COLORS_LIGHT = [
  { name: "Primary", hex: "#5b7cfa" },
  { name: "Primary strong", hex: "#4f46e5" },
  { name: "Background", hex: "#f5f6fa" },
  { name: "Surface", hex: "#ffffff" },
  { name: "Text", hex: "#0f172a" },
  { name: "Text muted", hex: "#64748b" },
] as const;

const COLORS_DARK = [
  { name: "Primary", hex: "#7c3aed" },
  { name: "Primary strong", hex: "#5b7cfa" },
  { name: "Background", hex: "#0b1120" },
  { name: "Surface", hex: "#111827" },
  { name: "Text", hex: "#f1f5f9" },
  { name: "Text muted", hex: "#94a3b8" },
] as const;

function Swatch({ hex, label }: { hex: string; label: string }) {
  const lightBg = ["#ffffff", "#f5f6fa", "#f1f5f9", "#e2e8f0"].includes(hex);
  return (
    <div className="brand-card-swatch" style={{ backgroundColor: hex }} title={`${label} ${hex}`}>
      <span
        className="brand-card-swatch-hex"
        style={{
          color: lightBg ? "#0f172a" : "#fff",
          textShadow: lightBg ? "0 0 1px rgba(0,0,0,0.2)" : "0 0 1px rgba(0,0,0,0.5)",
        }}
      >
        {hex}
      </span>
    </div>
  );
}

export default function BrandCard() {
  const [basePath, setBasePath] = useState("");
  useEffect(() => {
    const path =
      (typeof document !== "undefined" && document.body?.getAttribute?.("data-base-path")) || "";
    setBasePath(path.replace(/\/+$/, ""));
  }, []);

  const logoSrc = `${basePath}/img/logo.svg`;

  return (
    <div className="brand-card">
      <div className="brand-card-inner">
        <div className="brand-card-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="Agentron logo" width={72} height={72} />
          <div className="brand-card-typo">
            <span className="brand-card-label">Typography</span>
            <span className="brand-card-sans">Space Grotesk</span>
            <span className="brand-card-mono">Space Mono</span>
          </div>
        </div>
        <div className="brand-card-themes">
          <div className="brand-card-theme brand-card-theme-light">
            <span className="brand-card-label">Light mode</span>
            <div className="brand-card-swatches">
              {COLORS_LIGHT.map((c) => (
                <Swatch key={c.hex} hex={c.hex} label={c.name} />
              ))}
            </div>
          </div>
          <div className="brand-card-theme brand-card-theme-dark">
            <span className="brand-card-label">Dark mode</span>
            <div className="brand-card-swatches">
              {COLORS_DARK.map((c) => (
                <Swatch key={c.hex} hex={c.hex} label={c.name} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

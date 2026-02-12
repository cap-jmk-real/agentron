"use client";

import { useId } from "react";

/** Agentron A→T→A logo loading animation. Use during initial load or when the assistant is thinking. */
export default function LogoLoading({ size = 64, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const gradA = `logo-loading-a-${id}`;
  const gradT = `logo-loading-t-${id}`;

  return (
    <div
      className={`logo-loading-stage ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div
        className="logo-loading-inner"
        style={{ width: size, height: size }}
      >
        <svg
          className="logo-loading-front"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 64 64"
          style={{ width: size, height: size }}
        >
          <defs>
            <linearGradient id={gradA} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
          <path d="M32 10 L14 54 H22 L28 38 H36 L42 54 H50 Z" fill={`url(#${gradA})`} />
          <circle cx="32" cy="38" r="5.5" fill="#EEF2FF" />
          <circle cx="32" cy="38" r="2.8" fill="#4f46e5" />
        </svg>
        <svg
          className="logo-loading-back"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 64 64"
          style={{ width: size, height: size }}
        >
          <defs>
            <linearGradient id={gradT} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
          <path d="M10 30 H54 V38 H36 V54 H28 V38 H10 V30 Z" fill={`url(#${gradT})`} />
          <circle cx="32" cy="38" r="5.5" fill="#EEF2FF" />
          <circle cx="32" cy="38" r="2.8" fill="#4f46e5" />
        </svg>
      </div>
    </div>
  );
}

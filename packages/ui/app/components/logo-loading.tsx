"use client";

/** Agentron A→T→A logo loading animation. Uses public/icon.svg and public/icon-t.svg. */
export default function LogoLoading({ size = 64, className = "" }: { size?: number; className?: string }) {
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
        <img
          src="/icon.svg"
          alt=""
          className="logo-loading-front"
          width={size}
          height={size}
        />
        <img
          src="/icon-t.svg"
          alt=""
          className="logo-loading-back"
          width={size}
          height={size}
        />
      </div>
    </div>
  );
}

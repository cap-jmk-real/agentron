"use client";

/** Agentron A→T→A logo loading animation. Circle stays fixed; only letters (A/T) rotate. */
export default function LogoLoading({
  size = 64,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`logo-loading-stage ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div className="logo-loading-inner" style={{ width: size, height: size }}>
        <div className="logo-loading-letters" style={{ width: size, height: size }}>
          <img
            src="/icon-a-letter.svg"
            alt=""
            className="logo-loading-front"
            width={size}
            height={size}
          />
          <img
            src="/icon-t-letter.svg"
            alt=""
            className="logo-loading-back"
            width={size}
            height={size}
          />
        </div>
        <img
          src="/icon-circle.svg"
          alt=""
          className="logo-loading-circle"
          width={size}
          height={size}
        />
      </div>
    </div>
  );
}

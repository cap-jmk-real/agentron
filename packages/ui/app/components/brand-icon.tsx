"use client";

/** Agentron logo. Uses single source of truth: public/icon.svg (served at /icon.svg). */
export default function BrandIcon({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return <img src="/icon.svg" alt="" width={size} height={size} className={className} />;
}

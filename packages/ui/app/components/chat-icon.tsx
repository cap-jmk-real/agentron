"use client";

/**
 * Chat assistant icon: Notion-inspired (blocks, clean) but distinct.
 * Stacked document blocks with a leading accent to suggest AI/assistant.
 */
type Props = { size?: number; className?: string };

export default function ChatIcon({ size = 24, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {/* Stacked blocks (document feel, not Notion’s “n”) */}
      <rect x="4" y="4" width="16" height="3" rx="1" fill="currentColor" opacity="0.9" />
      <rect x="4" y="9" width="16" height="2.5" rx="0.5" fill="currentColor" opacity="0.7" />
      <rect x="4" y="13.5" width="12" height="2.5" rx="0.5" fill="currentColor" opacity="0.5" />
      <circle cx="18" cy="15.5" r="2.5" fill="currentColor" />
    </svg>
  );
}

"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export type StyledSelectOption = {
  value: string;
  label: string;
  title?: string;
};

const DROPDOWN_Z_INDEX = 10002; /* above FAB panel (10000) and modals (10001) */

type Props = {
  value: string;
  options: StyledSelectOption[];
  onChange: (value: string) => void;
  leftIcon?: React.ReactNode;
  placeholder?: string;
  "aria-label": string;
  className?: string;
  triggerClassName?: string;
  maxWidth?: string;
  /** Optional: render in "pill" context (e.g. chat input) so list uses same styling */
  variant?: "default" | "pill";
  /** When true, trigger shows only icon + chevron (no label text) */
  iconOnly?: boolean;
};

export function StyledSelect({
  value,
  options,
  onChange,
  leftIcon,
  placeholder = "Select…",
  "aria-label": ariaLabel,
  className,
  triggerClassName,
  maxWidth = "12rem",
  variant = "default",
  iconOnly = false,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder;

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({
      top: rect.bottom,
      left: rect.left,
      width: Math.max(rect.width, 160),
    });
  }, []);

  const openDropdown = useCallback(() => {
    updatePosition();
    setOpen(true);
    setHighlightedIndex(options.findIndex((o) => o.value === value));
  }, [options, value, updatePosition]);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setHighlightedIndex(-1);
  }, []);

  const select = useCallback(
    (option: StyledSelectOption) => {
      onChange(option.value);
      closeDropdown();
    },
    [onChange, closeDropdown]
  );

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      closeDropdown();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDropdown();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => (i < options.length - 1 ? i + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => (i > 0 ? i - 1 : options.length - 1));
      } else if (e.key === "Enter" && highlightedIndex >= 0 && options[highlightedIndex]) {
        e.preventDefault();
        select(options[highlightedIndex]);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, closeDropdown, options, highlightedIndex, select]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => {
      updatePosition();
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePosition]);

  const listContent = open && (
    <div
      ref={listRef}
      className={`styled-select-list styled-select-list--${variant}`}
      role="listbox"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        minWidth: position.width,
        zIndex: DROPDOWN_Z_INDEX,
      }}
    >
      {options.length === 0 ? (
        <div className="styled-select-option styled-select-option--empty">{placeholder}</div>
      ) : (
        options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={opt.value === value}
            title={opt.title}
            className={`styled-select-option ${opt.value === value ? "styled-select-option--selected" : ""} ${i === highlightedIndex ? "styled-select-option--highlighted" : ""}`}
            onClick={() => select(opt)}
            onMouseEnter={() => setHighlightedIndex(i)}
          >
            {opt.label}
          </button>
        ))
      )}
    </div>
  );

  return (
    <div
      className={className ?? undefined}
      style={maxWidth ? { maxWidth } : undefined}
      data-icon-only={iconOnly ? "" : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? "styled-select-trigger"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={
          iconOnly ? (selectedOption?.label ?? selectedOption?.title ?? placeholder) : undefined
        }
        onClick={() => (open ? closeDropdown() : openDropdown())}
      >
        {leftIcon != null && <span className="styled-select-trigger-icon">{leftIcon}</span>}
        {!iconOnly && <span className="styled-select-trigger-label">{displayLabel}</span>}
        <ChevronDown
          size={iconOnly ? 12 : 14}
          className={`styled-select-chevron ${open ? "styled-select-chevron--open" : ""}`}
        />
      </button>
      {typeof document !== "undefined" && createPortal(listContent, document.body)}
    </div>
  );
}

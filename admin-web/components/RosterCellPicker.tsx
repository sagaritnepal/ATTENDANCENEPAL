'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type RosterCellOption = { id: string; label: string; sub?: string };

/** Replaces a plain <select> for the roster grids' day/weekday cells. A
 * native <select>'s CLOSED-state display is always exactly one line — the
 * browser clips whatever doesn't fit, it can't wrap — so a shift name plus
 * its time range ("Night Duty (22:00–06:00)") had nowhere to actually be
 * read once picked, in a column only ~80px wide. This renders as a real
 * button instead (so its label and time can wrap onto their own lines),
 * with the option menu portaled to <body> and positioned from the button's
 * own screen coordinates — not absolutely positioned inside the table —
 * so it isn't clipped by the roster grid's horizontal-scroll container the
 * way a plain absolute-positioned child would be. */
export default function RosterCellPicker({
  value,
  options,
  onChange,
  disabled,
  buttonClassName,
}: {
  value: string;
  options: RosterCellOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
  buttonClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.id === value) ?? options[0];

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 150) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // Repositions/closes on scroll instead of drifting away from the
    // button — the table this sits in scrolls horizontally, and a stale
    // fixed-position menu would otherwise stay put while its trigger moves.
    function handleScroll() {
      setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        title={selected?.sub ? `${selected.label} (${selected.sub})` : selected?.label}
        className={`flex w-full flex-col items-center gap-0.5 whitespace-normal break-words px-1 py-1 text-center text-xs leading-tight transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
      >
        <span className="w-full break-words">{selected?.label}</span>
        {selected?.sub && <span className="w-full break-words text-[10px] opacity-80">{selected.sub}</span>}
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            className="z-50 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {options.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`block w-full px-2.5 py-1.5 text-left hover:bg-accent/5 ${o.id === value ? 'bg-accent/10' : ''}`}
              >
                <span className="block whitespace-normal break-words text-xs font-medium text-ink">{o.label}</span>
                {o.sub && <span className="block whitespace-normal break-words text-[10px] text-slate-400">{o.sub}</span>}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

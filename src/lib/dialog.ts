'use client';
import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What a modal owes a keyboard or screen-reader user: focus moves into it when it opens, Tab stays inside it,
 * and focus goes back to where it was when it closes. The element needs tabIndex={-1}.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const before = document.activeElement as HTMLElement | null;
    el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || at === el || !el.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !el.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.({ preventScroll: true }); };
  }, [ref, active]);
}

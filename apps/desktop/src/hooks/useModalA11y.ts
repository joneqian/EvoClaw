/**
 * Modal accessibility hook — M15 PR-U5
 *
 * Bundles four behaviors every dialog needs:
 *  1. `Escape` 关闭
 *  2. Focus trap：Tab / Shift+Tab 在 modal 内循环
 *  3. 自动 focus 第一个可聚焦元素
 *  4. 关闭后还原原 active element 的焦点
 *
 * 用法：
 * ```tsx
 * const ref = useModalA11y<HTMLDivElement>({ isOpen, onClose });
 * return <div ref={ref} role="dialog" aria-modal="true">...</div>;
 * ```
 */

import { useEffect, useRef } from 'react';

interface UseModalA11yOptions {
  isOpen: boolean;
  onClose: () => void;
  /** 关闭后是否还原焦点（默认 true） */
  restoreFocus?: boolean;
  /** 是否在打开时自动聚焦（默认 true） */
  autoFocus?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalA11y<T extends HTMLElement>(options: UseModalA11yOptions) {
  const { isOpen, onClose, restoreFocus = true, autoFocus = true } = options;
  const containerRef = useRef<T | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (!container) return;

    if (autoFocus) {
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0];
      if (first) first.focus();
      else container.focus();
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusables.length === 0) return;

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (restoreFocus && previouslyFocusedRef.current) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen, onClose, autoFocus, restoreFocus]);

  return containerRef;
}

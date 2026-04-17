/**
 * 全局键盘快捷键 hook（M3-T3c）
 *
 * 支持 `mod+X`（mac 上为 Cmd，win/linux 上为 Ctrl）。在输入元素聚焦时仍然
 * 触发（这是命令面板 Cmd+K 的预期行为）；如需排除输入框，请在回调中自行判断。
 */

import { useEffect } from 'react';

/** 快捷键组合：`mod+k` / `mod+shift+p` / `escape` 等 */
export type HotkeyCombo = string;

function parseCombo(combo: HotkeyCombo) {
  const parts = combo.toLowerCase().split('+').map(s => s.trim());
  const key = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1));
  return { key, modifiers };
}

export function useGlobalHotkey(combo: HotkeyCombo, handler: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    const { key, modifiers } = parseCombo(combo);

    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key) return;
      const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
      const wantMod = modifiers.has('mod');
      const wantShift = modifiers.has('shift');
      const wantAlt = modifiers.has('alt');
      const wantMeta = modifiers.has('meta') || modifiers.has('cmd');
      const wantCtrl = modifiers.has('ctrl');

      const modOk = !wantMod || (isMac ? e.metaKey : e.ctrlKey);
      const shiftOk = wantShift === e.shiftKey;
      const altOk = wantAlt === e.altKey;
      const metaOk = !wantMeta || e.metaKey;
      const ctrlOk = !wantCtrl || e.ctrlKey;

      if (modOk && shiftOk && altOk && metaOk && ctrlOk) {
        handler(e);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, handler]);
}

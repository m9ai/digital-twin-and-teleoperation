import { useEffect } from 'react';
import { triggerEmergencyStop } from '@/lib/emergencyStop';

/** Elements where Space must keep its native meaning (typing / text editing). */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.closest('[data-estop-passthrough]'));
}

/**
 * Global E-Stop hotkey.
 *
 * Space is captured in the capture phase so it latches the stop regardless of
 * which panel has focus, but it is ignored while the operator is typing so it
 * never swallows a space in a URL or URDF editor.
 */
export function useEStopHotkey(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntry(event.target)) return;

      // Stop the browser from scrolling or re-activating the focused button.
      event.preventDefault();
      event.stopPropagation();
      triggerEmergencyStop('Space');
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);
}

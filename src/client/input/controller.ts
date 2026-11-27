export type InputCallbacks = {
  readonly isVictoryOpen: () => boolean;
  /** The opt-in how-to-play guide: while open it owns every press and key except browser chords. */
  readonly isHelpOpen: () => boolean;
  readonly onCloseHelp: () => void;
  readonly onPointerGesture?: () => void;
  readonly onPrimaryAction: () => void;
  readonly onRestart: () => void;
  readonly onSelectDayIndex: (index: number) => void;
  readonly onNextIsland: () => void;
  readonly onReplay: () => void;
  readonly onHoverNormalized: (nx: number, ny: number) => void;
  readonly onHoverLeave: () => void;
  readonly onCameraDrag: (dx: number, dy: number) => void;
  readonly onRecenterCamera?: () => void;
};

export type InputController = {
  readonly dispose: () => void;
};

export const DRAG_THRESHOLD_PX = 8;

export function createInputController(
  canvasWrap: HTMLElement,
  callbacks: InputCallbacks
): InputController {
  let active = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let isDrag = false;
  // Last input modality before the current key: a pointer press anywhere vs. any other key press.
  let pointerModality = false;

  const isInteractiveFocusedControl = (el: Element | null): boolean => {
    if (!(el instanceof HTMLElement) || el.id === 'primary-btn') return false;
    const isControl =
      el instanceof HTMLButtonElement ||
      el instanceof HTMLAnchorElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement ||
      el.getAttribute('role') === 'tab';
    if (!isControl) return false;
    if (
      el.closest(
        '[inert], [aria-hidden="true"], #victory-overlay:not(.open), #help-overlay:not(.open)'
      ) !== null ||
      (document.body.classList.contains('is-rolling') && el.closest('.hud-left') !== null)
    ) {
      return false;
    }
    if (typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.pointerEvents === 'none'
      ) {
        return false;
      }
    }
    // The guide button gets focus back when the guide closes. Only a keyboard user should re-open
    // it with Space/Enter; after a mouse/touch close those keys go back to Launch/Clack.
    if (el.id === 'btn-help' && pointerModality) return false;
    return true;
  };

  const onPointerDown = (e: PointerEvent): void => {
    callbacks.onPointerGesture?.();
    // A second finger landing mid-gesture must never hijack the active drag or fire a ghost tap.
    if (active) return;
    if (callbacks.isVictoryOpen() || callbacks.isHelpOpen()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    active = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    isDrag = false;
    try {
      canvasWrap.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic or unsupported pointer capture errors
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    // Smooth damped hover parallax on desktop mouse movement
    if (!active && e.pointerType === 'mouse') {
      const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      const ny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      callbacks.onHoverNormalized(nx, ny);
      return;
    }

    if (!active || e.pointerId !== pointerId) return;

    const totalDx = e.clientX - startX;
    const totalDy = e.clientY - startY;
    if (!isDrag && Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD_PX) {
      isDrag = true;
    }

    if (isDrag) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      callbacks.onCameraDrag(dx, dy);
    }

    lastX = e.clientX;
    lastY = e.clientY;
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!active || e.pointerId !== pointerId) return;
    const wasDrag = isDrag || Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD_PX;
    active = false;
    pointerId = null;
    isDrag = false;
    try {
      canvasWrap.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore release errors
    }

    // Only count as tap/clack if pointer moved <= 8px
    if (!wasDrag) {
      callbacks.onPrimaryAction();
    }
  };

  const onPointerCancel = (e: PointerEvent): void => {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    pointerId = null;
    isDrag = false;
  };

  const onPointerLeave = (): void => {
    callbacks.onHoverLeave();
  };

  const onWindowPointerDown = (): void => {
    pointerModality = true;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    handleKeyDown(e);
    pointerModality = false;
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    // Leave browser/system chords (Cmd/Ctrl+R reload, Ctrl+C copy, Cmd/Ctrl+1..5 tabs) untouched.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (callbacks.isHelpOpen()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        callbacks.onCloseHelp();
      } else if (e.code === 'Space' || e.code === 'Enter') {
        // Let the focused Close button activate natively; never launch from behind the guide.
        if (isInteractiveFocusedControl(document.activeElement)) return;
        e.preventDefault();
      }
      return;
    }

    if (callbacks.isVictoryOpen()) {
      if (e.code === 'Space' || e.code === 'Enter') {
        if (isInteractiveFocusedControl(document.activeElement)) return;
        e.preventDefault();
        callbacks.onNextIsland();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        callbacks.onReplay();
      }
      return;
    }

    if (e.code === 'Space' || e.code === 'Enter') {
      // Allow keyboard users who tabbed onto a visible secondary HUD control (Mute, Restart, Biome tabs)
      // to activate that control normally instead of hijacking Enter/Space for Launch/Clack.
      const activeEl = document.activeElement;
      if (isInteractiveFocusedControl(activeEl)) {
        return;
      }
      if (
        activeEl instanceof HTMLElement &&
        activeEl !== document.body &&
        activeEl.id !== 'primary-btn'
      ) {
        activeEl.blur();
      }
      e.preventDefault();
      callbacks.onPrimaryAction();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      callbacks.onRestart();
    } else if (e.key === 'c' || e.key === 'C' || e.key === '0') {
      e.preventDefault();
      callbacks.onRecenterCamera?.();
    } else if (e.key.length === 1 && e.key >= '1' && e.key <= '5') {
      callbacks.onSelectDayIndex(Number(e.key) - 1);
    }
  };

  canvasWrap.addEventListener('pointerdown', onPointerDown);
  canvasWrap.addEventListener('pointermove', onPointerMove);
  canvasWrap.addEventListener('pointerup', onPointerUp);
  canvasWrap.addEventListener('pointercancel', onPointerCancel);
  canvasWrap.addEventListener('lostpointercapture', onPointerCancel);
  canvasWrap.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', onWindowPointerDown, true);

  return {
    dispose: () => {
      canvasWrap.removeEventListener('pointerdown', onPointerDown);
      canvasWrap.removeEventListener('pointermove', onPointerMove);
      canvasWrap.removeEventListener('pointerup', onPointerUp);
      canvasWrap.removeEventListener('pointercancel', onPointerCancel);
      canvasWrap.removeEventListener('lostpointercapture', onPointerCancel);
      canvasWrap.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onWindowPointerDown, true);
    },
  };
}

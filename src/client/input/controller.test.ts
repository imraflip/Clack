// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createInputController, DRAG_THRESHOLD_PX } from './controller';
import type { InputCallbacks, InputController } from './controller';

type Spies = {
  readonly onPointerGesture: Mock<() => void>;
  readonly onPrimaryAction: Mock<() => void>;
  readonly onRestart: Mock<() => void>;
  readonly onSelectDayIndex: Mock<(index: number) => void>;
  readonly onNextIsland: Mock<() => void>;
  readonly onReplay: Mock<() => void>;
  readonly onHoverNormalized: Mock<(nx: number, ny: number) => void>;
  readonly onHoverLeave: Mock<() => void>;
  readonly onCameraDrag: Mock<(dx: number, dy: number) => void>;
  readonly onRecenterCamera: Mock<() => void>;
  readonly onCloseHelp: Mock<() => void>;
};

type PointerInit = {
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly x?: number;
  readonly y?: number;
  readonly button?: number;
};

// jsdom has no PointerEvent: build a MouseEvent and attach the pointer fields the controller reads.
function pointer(type: string, init: PointerInit = {}): MouseEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    button: init.button ?? 0,
  });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'touch' });
  return ev;
}

type KeyInit = {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
};

function press(init: KeyInit): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: init.key,
    code: init.code ?? '',
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    repeat: init.repeat ?? false,
  });
  window.dispatchEvent(ev);
  return ev;
}

const HUD_MARKUP = `
  <div id="canvas-wrap"></div>
  <div id="hud">
    <div class="hud-left">
      <div id="biome-bar" role="tablist">
        <button type="button" class="biome-btn" role="tab" id="tab-0">Cedar</button>
      </div>
    </div>
    <div class="hud-right">
      <button type="button" id="btn-help">?</button>
      <button type="button" id="btn-restart">R</button>
      <button type="button" id="btn-mute">M</button>
    </div>
    <button type="button" id="primary-btn">Launch</button>
  </div>
  <div id="victory-overlay" role="dialog">
    <div class="victory-card" tabindex="-1">
      <button type="button" id="btn-copy-result">Copy</button>
      <button type="button" id="btn-replay">Replay</button>
      <button type="button" id="btn-next">Next</button>
    </div>
  </div>
  <div id="help-overlay" role="dialog">
    <div class="help-card" tabindex="-1">
      <button type="button" id="btn-help-close">Close</button>
    </div>
  </div>
`;

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLElement)) throw new Error(`missing #${id}`);
  return el;
}

describe('createInputController', () => {
  let canvasWrap: HTMLElement;
  let spies: Spies;
  let victoryOpen: boolean;
  let helpOpen: boolean;
  let ctrl: InputController;

  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = HUD_MARKUP;
    canvasWrap = byId('canvas-wrap');
    victoryOpen = false;
    helpOpen = false;
    spies = {
      onPointerGesture: vi.fn<() => void>(),
      onPrimaryAction: vi.fn<() => void>(),
      onRestart: vi.fn<() => void>(),
      onSelectDayIndex: vi.fn<(index: number) => void>(),
      onNextIsland: vi.fn<() => void>(),
      onReplay: vi.fn<() => void>(),
      onHoverNormalized: vi.fn<(nx: number, ny: number) => void>(),
      onHoverLeave: vi.fn<() => void>(),
      onCameraDrag: vi.fn<(dx: number, dy: number) => void>(),
      onRecenterCamera: vi.fn<() => void>(),
      onCloseHelp: vi.fn<() => void>(),
    };
    const callbacks: InputCallbacks = {
      isVictoryOpen: () => victoryOpen,
      isHelpOpen: () => helpOpen,
      onCloseHelp: spies.onCloseHelp,
      onPointerGesture: spies.onPointerGesture,
      onPrimaryAction: spies.onPrimaryAction,
      onRestart: spies.onRestart,
      onSelectDayIndex: spies.onSelectDayIndex,
      onNextIsland: spies.onNextIsland,
      onReplay: spies.onReplay,
      onHoverNormalized: spies.onHoverNormalized,
      onHoverLeave: spies.onHoverLeave,
      onCameraDrag: spies.onCameraDrag,
      onRecenterCamera: spies.onRecenterCamera,
    };
    ctrl = createInputController(canvasWrap, callbacks);
  });

  afterEach(() => {
    ctrl.dispose();
    document.body.innerHTML = '';
  });

  describe('canvas tap vs drag threshold', () => {
    it('treats movement of exactly the threshold as a tap and fires one primary action', () => {
      canvasWrap.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
      canvasWrap.dispatchEvent(pointer('pointermove', { x: 100 + DRAG_THRESHOLD_PX, y: 100 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { x: 100 + DRAG_THRESHOLD_PX, y: 100 }));
      expect(DRAG_THRESHOLD_PX).toBe(8);
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(1);
      expect(spies.onCameraDrag).not.toHaveBeenCalled();
    });

    it('orbits the camera without launching once movement exceeds the threshold', () => {
      canvasWrap.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
      canvasWrap.dispatchEvent(pointer('pointermove', { x: 106, y: 106 }));
      canvasWrap.dispatchEvent(pointer('pointermove', { x: 130, y: 110 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { x: 130, y: 110 }));
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect(spies.onCameraDrag).toHaveBeenCalledTimes(2);
      expect(spies.onCameraDrag).toHaveBeenLastCalledWith(24, 4);
    });

    it('checks the release coordinates even without a pointermove', () => {
      canvasWrap.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { x: 109, y: 100 }));
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
    });

    it('ignores non-primary mouse buttons and taps while the victory card is open', () => {
      canvasWrap.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', button: 2 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { pointerType: 'mouse', button: 2 }));
      victoryOpen = true;
      canvasWrap.dispatchEvent(pointer('pointerdown'));
      canvasWrap.dispatchEvent(pointer('pointerup'));
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect(spies.onPointerGesture).toHaveBeenCalledTimes(2);
    });

    it('feeds hover parallax from idle mouse movement only', () => {
      canvasWrap.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', x: 0, y: 0 }));
      expect(spies.onHoverNormalized).toHaveBeenCalledWith(-1, -1);
      canvasWrap.dispatchEvent(pointer('pointerleave'));
      expect(spies.onHoverLeave).toHaveBeenCalledTimes(1);
    });
  });

  describe('multi-touch isolation', () => {
    it('ignores a second finger so it neither steals the drag nor fires a ghost tap', () => {
      canvasWrap.dispatchEvent(pointer('pointerdown', { pointerId: 1, x: 50, y: 50 }));
      canvasWrap.dispatchEvent(pointer('pointerdown', { pointerId: 2, x: 300, y: 300 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { pointerId: 2, x: 300, y: 300 }));
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();

      canvasWrap.dispatchEvent(pointer('pointermove', { pointerId: 1, x: 80, y: 50 }));
      expect(spies.onCameraDrag).toHaveBeenCalledWith(30, 0);
      canvasWrap.dispatchEvent(pointer('pointerup', { pointerId: 1, x: 80, y: 50 }));
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
    });

    it('keeps the first finger tap intact when a secondary pointer is cancelled', () => {
      canvasWrap.dispatchEvent(pointer('pointerdown', { pointerId: 1 }));
      canvasWrap.dispatchEvent(pointer('pointercancel', { pointerId: 2 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { pointerId: 1 }));
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(1);
    });

    it('drops the gesture entirely when the active pointer is cancelled', () => {
      canvasWrap.dispatchEvent(pointer('pointerdown', { pointerId: 1 }));
      canvasWrap.dispatchEvent(pointer('pointercancel', { pointerId: 1 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { pointerId: 1 }));
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
    });

    it('accepts the next gesture after losing pointer capture without clacking on the old release', () => {
      canvasWrap.dispatchEvent(pointer('pointerdown', { pointerId: 1 }));
      canvasWrap.dispatchEvent(pointer('lostpointercapture', { pointerId: 1 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { pointerId: 1 }));
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();

      canvasWrap.dispatchEvent(pointer('pointerdown', { pointerId: 2 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { pointerId: 2 }));
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard shortcuts', () => {
    it('maps Space and Enter to the primary action and prevents default scrolling', () => {
      const space = press({ key: ' ', code: 'Space' });
      press({ key: 'Enter', code: 'Enter' });
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(2);
      expect(space.defaultPrevented).toBe(true);
    });

    it('ignores auto-repeat so a held key cannot machine-gun clacks', () => {
      press({ key: ' ', code: 'Space', repeat: true });
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
    });

    it('maps R to restart, C and 0 to recenter, and 1-5 to day tabs', () => {
      press({ key: 'r' });
      press({ key: 'R' });
      press({ key: 'c' });
      press({ key: 'C' });
      press({ key: '0' });
      for (const k of ['1', '2', '3', '4', '5']) press({ key: k });
      press({ key: '6' });
      press({ key: 'F1' });
      expect(spies.onRestart).toHaveBeenCalledTimes(2);
      expect(spies.onRecenterCamera).toHaveBeenCalledTimes(3);
      expect(spies.onSelectDayIndex.mock.calls).toEqual([[0], [1], [2], [3], [4]]);
    });

    const modifierChords: ReadonlyArray<readonly [string, Partial<KeyInit>]> = [
      ['ctrlKey', { ctrlKey: true }],
      ['metaKey', { metaKey: true }],
      ['altKey', { altKey: true }],
    ];
    it.each(modifierChords)('passes %s chords through to the browser untouched', (_name, mods) => {
      const reload = press({ key: 'r', ...mods });
      const copy = press({ key: 'c', ...mods });
      const tab = press({ key: '1', ...mods });
      const space = press({ key: ' ', code: 'Space', ...mods });
      expect(spies.onRestart).not.toHaveBeenCalled();
      expect(spies.onRecenterCamera).not.toHaveBeenCalled();
      expect(spies.onSelectDayIndex).not.toHaveBeenCalled();
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect([reload, copy, tab, space].some((e) => e.defaultPrevented)).toBe(false);
    });

    it('lets modifier chords through while the victory card is open too', () => {
      victoryOpen = true;
      press({ key: 'r', metaKey: true });
      press({ key: 'Enter', code: 'Enter', ctrlKey: true });
      expect(spies.onReplay).not.toHaveBeenCalled();
      expect(spies.onNextIsland).not.toHaveBeenCalled();
    });
  });

  describe('focus-safe Space/Enter', () => {
    it('lets a focused visible HUD control (Mute) handle Space itself', () => {
      byId('btn-mute').focus();
      const ev = press({ key: ' ', code: 'Space' });
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(false);
    });

    it('lets a focused visible biome tab handle Enter itself', () => {
      byId('tab-0').focus();
      press({ key: 'Enter', code: 'Enter' });
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
    });

    it('does not let a stale focus inside the hidden rolling .hud-left swallow Space', () => {
      const tab = byId('tab-0');
      tab.focus();
      document.body.classList.add('is-rolling');
      press({ key: ' ', code: 'Space' });
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(1);
      expect(document.activeElement).not.toBe(tab);
    });

    it('treats controls inside an inert or aria-hidden subtree as not interactive', () => {
      const restart = byId('btn-restart');
      restart.focus();
      byId('hud').setAttribute('inert', '');
      press({ key: ' ', code: 'Space' });
      byId('hud').removeAttribute('inert');
      restart.focus();
      byId('hud').setAttribute('aria-hidden', 'true');
      press({ key: 'Enter', code: 'Enter' });
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(2);
    });

    it('treats display:none and visibility:hidden controls as not interactive', () => {
      const restart = byId('btn-restart');
      restart.focus();
      restart.style.visibility = 'hidden';
      press({ key: ' ', code: 'Space' });
      restart.style.visibility = '';
      restart.focus();
      restart.style.display = 'none';
      press({ key: ' ', code: 'Space' });
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(2);
    });

    it('keeps focus on #primary-btn and routes Space through the shared primary action', () => {
      const primary = byId('primary-btn');
      primary.focus();
      const ev = press({ key: ' ', code: 'Space' });
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(1);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(primary);
    });
  });

  describe('victory-open key routing', () => {
    beforeEach(() => {
      victoryOpen = true;
      byId('victory-overlay').classList.add('open');
    });

    it('routes Space/Enter on the focused card to Next Island and R to Replay', () => {
      byId('victory-overlay').querySelector<HTMLElement>('.victory-card')?.focus();
      press({ key: ' ', code: 'Space' });
      press({ key: 'Enter', code: 'Enter' });
      press({ key: 'R' });
      expect(spies.onNextIsland).toHaveBeenCalledTimes(2);
      expect(spies.onReplay).toHaveBeenCalledTimes(1);
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect(spies.onRestart).not.toHaveBeenCalled();
    });

    it('lets a focused victory button activate itself instead of Next', () => {
      for (const id of ['btn-copy-result', 'btn-replay', 'btn-next']) {
        byId(id).focus();
        const ev = press({ key: 'Enter', code: 'Enter' });
        expect(ev.defaultPrevented).toBe(false);
      }
      expect(spies.onNextIsland).not.toHaveBeenCalled();
    });

    it('swallows gameplay shortcuts while the card is open', () => {
      press({ key: 'c' });
      press({ key: '2' });
      expect(spies.onRecenterCamera).not.toHaveBeenCalled();
      expect(spies.onSelectDayIndex).not.toHaveBeenCalled();
    });

    it('ignores a still-focused closed overlay button once the card hides', () => {
      victoryOpen = false;
      byId('victory-overlay').classList.remove('open');
      byId('btn-next').focus();
      press({ key: ' ', code: 'Space' });
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('help guide isolation', () => {
    const openGuide = (): void => {
      helpOpen = true;
      byId('help-overlay').classList.add('open');
    };

    it('closes the guide on Escape and prevents the default', () => {
      openGuide();
      const ev = press({ key: 'Escape', code: 'Escape' });
      expect(spies.onCloseHelp).toHaveBeenCalledTimes(1);
      expect(ev.defaultPrevented).toBe(true);
    });

    it('ignores Escape while the guide is closed and on auto-repeat', () => {
      press({ key: 'Escape', code: 'Escape' });
      openGuide();
      press({ key: 'Escape', code: 'Escape', repeat: true });
      expect(spies.onCloseHelp).not.toHaveBeenCalled();
    });

    it('swallows Launch/Clack, restart, recenter and island hotkeys while open', () => {
      openGuide();
      byId('help-overlay').querySelector<HTMLElement>('.help-card')?.focus();
      const space = press({ key: ' ', code: 'Space' });
      const enter = press({ key: 'Enter', code: 'Enter' });
      press({ key: 'r' });
      press({ key: 'c' });
      press({ key: '0' });
      press({ key: '3' });
      expect(space.defaultPrevented).toBe(true);
      expect(enter.defaultPrevented).toBe(true);
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect(spies.onRestart).not.toHaveBeenCalled();
      expect(spies.onRecenterCamera).not.toHaveBeenCalled();
      expect(spies.onSelectDayIndex).not.toHaveBeenCalled();
      expect(spies.onNextIsland).not.toHaveBeenCalled();
      expect(spies.onReplay).not.toHaveBeenCalled();
    });

    it('lets the focused Close button activate itself with Space/Enter', () => {
      openGuide();
      byId('btn-help-close').focus();
      const space = press({ key: ' ', code: 'Space' });
      const enter = press({ key: 'Enter', code: 'Enter' });
      expect(space.defaultPrevented).toBe(false);
      expect(enter.defaultPrevented).toBe(false);
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(byId('btn-help-close'));
    });

    it('blocks canvas taps and drags behind the open guide', () => {
      openGuide();
      canvasWrap.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
      canvasWrap.dispatchEvent(pointer('pointermove', { x: 160, y: 100 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { x: 160, y: 100 }));
      canvasWrap.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
      canvasWrap.dispatchEvent(pointer('pointerup', { x: 100, y: 100 }));
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect(spies.onCameraDrag).not.toHaveBeenCalled();
    });

    it('passes browser chords through untouched while open', () => {
      openGuide();
      const reload = press({ key: 'r', metaKey: true });
      const esc = press({ key: 'Escape', code: 'Escape', ctrlKey: true });
      expect([reload, esc].some((e) => e.defaultPrevented)).toBe(false);
      expect(spies.onCloseHelp).not.toHaveBeenCalled();
    });

    it('resumes normal gameplay keys and taps once the guide closes', () => {
      openGuide();
      press({ key: ' ', code: 'Space' });
      helpOpen = false;
      byId('help-overlay').classList.remove('open');
      press({ key: ' ', code: 'Space' });
      canvasWrap.dispatchEvent(pointer('pointerdown'));
      canvasWrap.dispatchEvent(pointer('pointerup'));
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(2);
    });

    it('ignores a stale focus on the closed guide Close button', () => {
      byId('btn-help-close').focus();
      press({ key: ' ', code: 'Space' });
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(1);
    });

    it('lets keyboard focus on the guide button open it, but not a focus restored after a press', () => {
      const btnHelp = byId('btn-help');

      press({ key: 'Tab', code: 'Tab' });
      btnHelp.focus();
      const keyboard = press({ key: ' ', code: 'Space' });
      expect(keyboard.defaultPrevented).toBe(false);
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();

      // Mouse/touch closed the guide (pointerdown anywhere), then focus was restored to the button.
      document.body.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
      btnHelp.focus();
      const pointerRestored = press({ key: ' ', code: 'Space' });
      expect(pointerRestored.defaultPrevented).toBe(true);
      expect(spies.onPrimaryAction).toHaveBeenCalledTimes(1);
      expect(document.activeElement).not.toBe(btnHelp);
    });
  });

  describe('dispose', () => {
    it('removes every pointer and keyboard listener', () => {
      const canvasRemove = vi.spyOn(canvasWrap, 'removeEventListener');
      const windowRemove = vi.spyOn(window, 'removeEventListener');
      ctrl.dispose();

      const canvasTypes = canvasRemove.mock.calls.map((c) => c[0]).sort();
      expect(canvasTypes).toEqual(
        ['lostpointercapture', 'pointercancel', 'pointerdown', 'pointerleave', 'pointermove', 'pointerup']
      );
      expect(windowRemove.mock.calls.map((c) => c[0])).toEqual(
        expect.arrayContaining(['keydown', 'pointerdown'])
      );

      canvasWrap.dispatchEvent(pointer('pointerdown'));
      canvasWrap.dispatchEvent(pointer('pointerup'));
      press({ key: ' ', code: 'Space' });
      press({ key: 'r' });
      expect(spies.onPrimaryAction).not.toHaveBeenCalled();
      expect(spies.onRestart).not.toHaveBeenCalled();
      expect(spies.onPointerGesture).not.toHaveBeenCalled();
      canvasRemove.mockRestore();
      windowRemove.mockRestore();
    });
  });
});

import type { CommunityDayStats } from '../../shared/api';
import type { GateState, LevelDef } from '../../shared/levels';
import type { SimPhase } from '../../shared/sim';
import { BIOME_GATE_THEMES } from '../scene/biomes';
import { SVG_ICONS } from './icons';
import { UI_TEXTS } from './texts';

export type HudSnapshot = {
  readonly islandIndex: number;
  readonly level: LevelDef;
  readonly phase: SimPhase;
  readonly gateState: GateState;
  readonly clacks: number;
  readonly keysCollected: number;
  readonly muted: boolean;
  readonly completedDays: ReadonlySet<number>;
};

export type HudCallbacks = {
  readonly onSelectIsland: (index: number) => void;
  readonly onPrimaryAction: () => void;
  readonly onRestart: () => void;
  readonly onToggleMute: () => void;
  readonly onCopyResult: () => void;
  readonly onReplay: () => void;
  readonly onNextIsland: () => void;
};

export type HudController = {
  readonly primaryButton: HTMLButtonElement;
  readonly render: (snapshot: HudSnapshot) => void;
  readonly showHint: (message?: string) => void;
  readonly hideHint: () => void;
  /** Pass `null` to keep the toast up until `hideToast()` (e.g. a failed run held on Tap to Retry). */
  readonly showToast: (message: string, durationMs?: number | null) => void;
  readonly hideToast: () => void;
  readonly openVictory: (
    level: LevelDef,
    islandIndex: number,
    totalIslands: number,
    clacks: number,
    runCount: number,
    communityStats?: CommunityDayStats | null
  ) => void;
  readonly updateVictoryCommunityStats: (stats: CommunityDayStats | null) => void;
  readonly closeVictory: () => void;
  readonly isVictoryOpen: () => boolean;
  readonly openHelp: () => void;
  readonly closeHelp: () => void;
  readonly isHelpOpen: () => boolean;
  readonly pulsePrimaryButton: () => void;
  readonly dispose: () => void;
};

function requireElement<T extends HTMLElement>(
  id: string,
  ctor: new (...args: never[]) => T
): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) {
    throw new Error(`Missing or invalid HUD element: #${id}`);
  }
  return el;
}

function makeEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function makeIcon(svg: string, className: string): HTMLSpanElement {
  const el = makeEl('span', className);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = svg;
  return el;
}

function makeKbd(label: string, extraClass = ''): HTMLElement {
  return makeEl('kbd', extraClass ? `help-kbd ${extraClass}` : 'help-kbd', label);
}

/** Builds the two visual steps of the opt-in guide: emblem/hazard diagrams over one short caption each. */
function buildHelpSteps(list: HTMLElement): void {
  list.innerHTML = '';

  // Step 1: Circle (A) <-> Diamond (B) enamel tiles + Space / Tap chips.
  const flip = makeEl('li', 'help-step');
  const flipVisual = makeEl('div', 'help-visual');
  flipVisual.setAttribute('role', 'img');
  flipVisual.setAttribute('aria-label', UI_TEXTS.helpGateDiagramLabel);
  const gate = (svg: string, tag: string): HTMLElement => {
    const wrap = makeEl('span', 'help-gate');
    wrap.append(makeIcon(svg, 'help-gate-tile'), makeEl('span', 'help-gate-tag', tag));
    return wrap;
  };
  flipVisual.append(
    gate(SVG_ICONS.circle, UI_TEXTS.helpStateA),
    makeIcon(SVG_ICONS.swap, 'help-flow'),
    gate(SVG_ICONS.diamond, UI_TEXTS.helpStateB)
  );
  const flipCopy = makeEl('div', 'help-copy');
  const flipChips = makeEl('span', 'help-chips');
  const keyboardOnly = makeEl('span', 'help-kbd-only');
  keyboardOnly.append(makeKbd(UI_TEXTS.helpKeySpace, 'wide'), makeEl('span', 'help-or', UI_TEXTS.helpOr));
  flipChips.append(keyboardOnly, makeEl('span', 'help-chip', UI_TEXTS.helpTap));
  flipCopy.append(
    makeEl('span', 'help-step-num', '1'),
    makeEl('p', 'help-caption', UI_TEXTS.helpStepFlip),
    flipChips
  );
  flip.append(flipVisual, flipCopy);

  // Step 2: brass key -> crossed trapdoor pit -> bell.
  const goal = makeEl('li', 'help-step');
  const goalVisual = makeEl('div', 'help-visual');
  goalVisual.setAttribute('role', 'img');
  goalVisual.setAttribute('aria-label', UI_TEXTS.helpGoalDiagramLabel);
  goalVisual.append(
    makeIcon(SVG_ICONS.key, 'help-glyph is-brass'),
    makeIcon(SVG_ICONS.arrowRight, 'help-flow'),
    makeIcon(SVG_ICONS.trapdoor, 'help-glyph is-pit'),
    makeIcon(SVG_ICONS.arrowRight, 'help-flow'),
    makeIcon(SVG_ICONS.bell, 'help-glyph is-brass')
  );
  const goalCopy = makeEl('div', 'help-copy');
  goalCopy.append(
    makeEl('span', 'help-step-num', '2'),
    makeEl('p', 'help-caption', UI_TEXTS.helpStepGoal)
  );
  goal.append(goalVisual, goalCopy);

  list.append(flip, goal);
}

/** Builds the compact controls strip: Drag (tilt), C (recenter), R (restart), 1-5 (islands). */
function buildHelpControls(list: HTMLElement): void {
  list.innerHTML = '';
  list.setAttribute('aria-label', UI_TEXTS.helpControlsAriaLabel);

  const item = (cap: HTMLElement, label: string, keyboardOnly: boolean): HTMLLIElement => {
    const li = makeEl('li', keyboardOnly ? 'help-control help-kbd-only' : 'help-control');
    li.append(cap, makeEl('span', 'help-control-label', label));
    return li;
  };

  const dragCap = makeEl('span', 'help-kbd wide help-drag');
  dragCap.append(makeIcon(SVG_ICONS.drag, 'help-drag-icon'), makeEl('span', '', UI_TEXTS.helpDragChip));

  list.append(
    item(dragCap, UI_TEXTS.helpDragLabel, false),
    item(makeKbd('C'), UI_TEXTS.helpRecenterLabel, true),
    item(makeKbd('R'), UI_TEXTS.helpRestartLabel, true),
    item(makeKbd('1\u20135', 'wide'), UI_TEXTS.helpIslandsLabel, true)
  );
}

export function createHudController(
  islands: readonly LevelDef[],
  callbacks: HudCallbacks
): HudController {
  const hudRoot = requireElement('hud', HTMLElement);
  const biomeBar = requireElement('biome-bar', HTMLElement);
  const hudLeft = hudRoot.querySelector('.hud-left');
  if (!(hudLeft instanceof HTMLElement)) {
    throw new Error('Missing or invalid HUD element: .hud-left');
  }
  const hudDay = requireElement('hud-day', HTMLElement);
  const hudName = requireElement('hud-name', HTMLElement);
  const hudParTag = requireElement('hud-par-tag', HTMLElement);
  const hudKeys = requireElement('hud-keys', HTMLElement);
  const hudClacksLabel = requireElement('hud-clacks-label', HTMLElement);
  const hudClacks = requireElement('hud-clacks', HTMLElement);
  const hudPar = requireElement('hud-par', HTMLElement);
  const btnRestart = requireElement('btn-restart', HTMLButtonElement);
  const btnMute = requireElement('btn-mute', HTMLButtonElement);
  const btnHelp = requireElement('btn-help', HTMLButtonElement);
  const helpOverlay = requireElement('help-overlay', HTMLElement);
  const helpCardEl = helpOverlay.querySelector('.help-card');
  if (!(helpCardEl instanceof HTMLElement)) {
    throw new Error('Missing or invalid HUD element: .help-card');
  }
  const helpCard: HTMLElement = helpCardEl;
  const helpBadge = requireElement('help-badge', HTMLElement);
  const helpTitle = requireElement('help-title', HTMLElement);
  const btnHelpClose = requireElement('btn-help-close', HTMLButtonElement);
  const helpSteps = requireElement('help-steps', HTMLElement);
  const helpControls = requireElement('help-controls', HTMLElement);
  const hintEl = requireElement('hint-banner', HTMLElement);
  const toastEl = requireElement('toast-banner', HTMLElement);
  const primaryBtn = requireElement('primary-btn', HTMLButtonElement);
  const primaryMark = requireElement('primary-mark', HTMLElement);
  const primaryLabel = requireElement('primary-label', HTMLElement);

  const victoryOverlay = requireElement('victory-overlay', HTMLElement);
  const victoryStatus = requireElement('victory-status', HTMLElement);
  const victoryCard = victoryOverlay.querySelector('.victory-card');
  if (!(victoryCard instanceof HTMLElement)) {
    throw new Error('Missing or invalid HUD element: .victory-card');
  }
  const victoryBadgeIcon = requireElement('victory-badge-icon', HTMLElement);
  const victoryRating = requireElement('victory-rating', HTMLElement);
  const victoryTitle = requireElement('victory-title', HTMLElement);
  const victorySub = requireElement('victory-sub', HTMLElement);
  const vClacksLabel = requireElement('v-clacks-label', HTMLElement);
  const vParLabel = requireElement('v-par-label', HTMLElement);
  const vClacks = requireElement('v-clacks', HTMLElement);
  const vPar = requireElement('v-par', HTMLElement);
  const victoryCommunity = requireElement('victory-community', HTMLElement);
  const btnCopyResult = requireElement('btn-copy-result', HTMLButtonElement);
  const btnCopyIcon = requireElement('btn-copy-icon', HTMLElement);
  const btnCopyLabel = requireElement('btn-copy-label', HTMLElement);
  const btnReplay = requireElement('btn-replay', HTMLButtonElement);
  const btnReplayIcon = requireElement('btn-replay-icon', HTMLElement);
  const btnReplayLabel = requireElement('btn-replay-label', HTMLElement);
  const btnNext = requireElement('btn-next', HTMLButtonElement);
  const btnNextLabel = requireElement('btn-next-label', HTMLElement);
  const btnNextIcon = requireElement('btn-next-icon', HTMLElement);

  // Hydrate static strings and inline SVG icons from centralized texts/icons modules
  biomeBar.setAttribute('aria-label', UI_TEXTS.biomeTabsAriaLabel);
  hudKeys.setAttribute('aria-label', UI_TEXTS.keysAriaLabel);
  hudClacksLabel.textContent = UI_TEXTS.clacksLabel;
  btnRestart.title = UI_TEXTS.restartTitle;
  btnRestart.setAttribute('aria-label', UI_TEXTS.restartAriaLabel);
  btnRestart.innerHTML = SVG_ICONS.restart;

  btnMute.title = UI_TEXTS.muteTitle;
  btnMute.setAttribute('aria-label', UI_TEXTS.muteAriaLabel);
  btnMute.innerHTML = SVG_ICONS.soundOn;

  btnHelp.title = UI_TEXTS.helpAriaLabel;
  btnHelp.setAttribute('aria-label', UI_TEXTS.helpAriaLabel);
  btnHelp.innerHTML = SVG_ICONS.help;

  helpBadge.innerHTML = SVG_ICONS.help;
  helpTitle.textContent = UI_TEXTS.helpTitle;
  btnHelpClose.title = UI_TEXTS.helpCloseAriaLabel;
  btnHelpClose.setAttribute('aria-label', UI_TEXTS.helpCloseAriaLabel);
  btnHelpClose.innerHTML = SVG_ICONS.close;
  buildHelpSteps(helpSteps);
  buildHelpControls(helpControls);
  helpOverlay.setAttribute('aria-hidden', 'true');
  helpOverlay.inert = true;
  // Programmatic focus target on open: screen readers start at the dialog, Tab reaches Close.
  helpCard.tabIndex = -1;

  hintEl.textContent = UI_TEXTS.hintFirstGate;

  victoryBadgeIcon.innerHTML = SVG_ICONS.bell;
  victoryTitle.textContent = UI_TEXTS.victoryTitle;
  vClacksLabel.textContent = UI_TEXTS.clacksLabel;
  vParLabel.textContent = UI_TEXTS.parLabel;
  btnCopyIcon.innerHTML = SVG_ICONS.copy;
  btnCopyLabel.textContent = UI_TEXTS.copyResultLabel;
  btnReplayIcon.innerHTML = SVG_ICONS.restartSmall;
  btnReplayLabel.textContent = UI_TEXTS.replayLabel;
  btnNextIcon.innerHTML = SVG_ICONS.chevronRight;

  victoryOverlay.setAttribute('aria-hidden', 'true');
  victoryOverlay.inert = true;
  // Programmatic focus target so screen readers enter the dialog and Tab advances to its buttons.
  victoryCard.tabIndex = -1;

  // Build 3 key slots
  hudKeys.innerHTML = '';
  const keySlots: HTMLElement[] = [];
  for (let i = 0; i < 3; i++) {
    const slot = document.createElement('span');
    slot.className = 'key-slot';
    slot.dataset.key = String(i);
    slot.innerHTML = SVG_ICONS.key;
    hudKeys.appendChild(slot);
    keySlots.push(slot);
  }

  const listeners = new AbortController();
  const listenerOptions = { signal: listeners.signal };

  // Build biome switcher tabs
  biomeBar.innerHTML = '';
  const biomeButtons: HTMLButtonElement[] = [];
  islands.forEach((isl, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'biome-btn';
    btn.setAttribute('role', 'tab');
    btn.dataset.idx = String(idx);

    const dot = document.createElement('span');
    dot.className = 'biome-dot';
    dot.style.background = isl.dotColor;

    const label = document.createElement('span');
    label.textContent = isl.shortLabel;

    const check = document.createElement('span');
    check.className = 'biome-check';
    check.setAttribute('aria-hidden', 'true');
    check.innerHTML = SVG_ICONS.check;

    btn.append(dot, label, check);
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    }, listenerOptions);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.detail > 0) {
        btn.blur();
      }
      callbacks.onSelectIsland(idx);
    }, listenerOptions);
    biomeBar.appendChild(btn);
    biomeButtons.push(btn);
  });

  // Stop pointerdown propagation on non-primary HUD controls so they never count as clacks
  btnRestart.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  btnRestart.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail > 0) {
      btnRestart.blur();
    }
    callbacks.onRestart();
  }, listenerOptions);

  btnMute.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  btnMute.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail > 0) {
      btnMute.blur();
    }
    callbacks.onToggleMute();
  }, listenerOptions);

  btnHelp.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  btnHelp.addEventListener('click', (e) => {
    e.stopPropagation();
    openHelp();
  }, listenerOptions);

  btnHelpClose.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  btnHelpClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeHelp();
  }, listenerOptions);

  // Nothing under the open guide may react to a press; a press on the backdrop itself closes it.
  helpOverlay.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) closeHelp();
  }, listenerOptions);

  btnCopyResult.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  btnCopyResult.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onCopyResult();
  }, listenerOptions);

  btnReplay.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  btnReplay.addEventListener('click', (e) => {
    e.stopPropagation();
    btnReplay.blur();
    callbacks.onReplay();
  }, listenerOptions);

  btnNext.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  btnNext.addEventListener('click', (e) => {
    e.stopPropagation();
    btnNext.blur();
    callbacks.onNextIsland();
  }, listenerOptions);

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
    if (isHelpOpen()) {
      // Close is the guide's only control: Tab and Shift+Tab both stay on it.
      event.preventDefault();
      btnHelpClose.focus();
      return;
    }
    if (!isVictoryOpen()) return;
    const focused = document.activeElement;
    const atBoundary = event.shiftKey
      ? focused === victoryCard || focused === btnCopyResult
      : focused === btnNext;
    if (victoryCard.contains(focused) && !atBoundary) return;
    event.preventDefault();
    (event.shiftKey ? btnNext : btnCopyResult).focus();
  }, listenerOptions);

  // Pointer input fires immediately. Assistive technologies can activate with click.
  let pulseTimer: number | null = null;
  const pulsePrimaryButton = (): void => {
    primaryBtn.classList.add('pressed');
    if (pulseTimer !== null) {
      window.clearTimeout(pulseTimer);
    }
    pulseTimer = window.setTimeout(() => {
      primaryBtn.classList.remove('pressed');
      pulseTimer = null;
    }, 110);
  };

  primaryBtn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== primaryBtn) {
      document.activeElement.blur();
    }
    callbacks.onPrimaryAction();
  }, listenerOptions);

  primaryBtn.addEventListener('click', (event) => {
    if (event.detail !== 0) return;
    callbacks.onPrimaryAction();
  }, listenerOptions);

  let toastTimer: number | null = null;
  let lastMuted: boolean | null = null;
  let lastPrimaryMode: string | null = null;
  let lastBiome: LevelDef['biome'] | null = null;
  let lastRolling: boolean | null = null;

  const blurIfInside = (container: HTMLElement): void => {
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && container.contains(activeEl)) {
      activeEl.blur();
    }
  };

  const applyRollingIsolation = (rolling: boolean): void => {
    if (lastRolling === rolling) return;
    const wasRolling = lastRolling === true;
    lastRolling = rolling;
    document.body.classList.toggle('is-rolling', rolling);
    biomeBar.inert = rolling;
    hudLeft.inert = rolling;
    if (rolling) {
      hudLeft.setAttribute('aria-hidden', 'true');
      blurIfInside(hudLeft);
    } else {
      hudLeft.removeAttribute('aria-hidden');
      if (wasRolling) blurIfInside(btnRestart);
    }
    if (rolling) {
      blurIfInside(btnHelp);
      closeHelp();
    }
  };

  const render = (snapshot: HudSnapshot): void => {
    const {
      islandIndex,
      level,
      phase,
      gateState,
      clacks,
      keysCollected,
      muted,
      completedDays,
    } = snapshot;

    if (lastBiome !== level.biome) {
      lastBiome = level.biome;
      const gateTheme = BIOME_GATE_THEMES[level.biome];
      document.documentElement.style.setProperty('--gate-accent', gateTheme.hex);
      document.documentElement.style.setProperty('--gate-accent-dark', gateTheme.darkHex);
      document.documentElement.style.setProperty('--gate-accent-shadow', gateTheme.shadowRgba);
    }

    hudDay.textContent = UI_TEXTS.dayTag(level.day);
    hudName.textContent = level.name;
    hudParTag.textContent = UI_TEXTS.parTag(level.par);
    hudClacks.textContent = String(clacks);
    hudPar.textContent = UI_TEXTS.parRatio(level.par);

    applyRollingIsolation(phase === 'rolling');

    biomeButtons.forEach((btn, idx) => {
      const active = idx === islandIndex;
      const isl = islands[idx];
      const solved = isl !== undefined && completedDays.has(isl.day);
      btn.classList.toggle('active', active);
      btn.classList.toggle('solved', solved);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    keySlots.forEach((slot, idx) => {
      slot.classList.toggle('collected', idx < keysCollected);
    });

    if (lastMuted !== muted) {
      lastMuted = muted;
      btnMute.innerHTML = muted ? SVG_ICONS.soundOff : SVG_ICONS.soundOn;
      btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    }

    const isRetryPhase = phase === 'falling' || phase === 'locked';
    const modeKey =
      phase === 'ready' ? 'ready' : isRetryPhase ? 'retry' : `rolling-${gateState}`;
    if (lastPrimaryMode !== modeKey) {
      lastPrimaryMode = modeKey;
      primaryBtn.classList.toggle('is-clack', !isRetryPhase && phase !== 'ready');
      primaryBtn.classList.toggle('is-retry', isRetryPhase);
      if (phase === 'ready') {
        primaryLabel.textContent = UI_TEXTS.launchLabel;
        primaryMark.innerHTML = SVG_ICONS.play;
        primaryBtn.setAttribute('aria-label', UI_TEXTS.launchAriaLabel);
      } else if (isRetryPhase) {
        primaryLabel.textContent = UI_TEXTS.retryLabel;
        primaryMark.innerHTML = SVG_ICONS.restartSmall;
        primaryBtn.setAttribute('aria-label', UI_TEXTS.retryAriaLabel);
      } else {
        primaryLabel.textContent = UI_TEXTS.clackLabel;
        if (gateState === 'A') {
          primaryMark.innerHTML = SVG_ICONS.circle;
          primaryBtn.setAttribute('aria-label', UI_TEXTS.clackStateAAriaLabel);
        } else {
          primaryMark.innerHTML = SVG_ICONS.diamond;
          primaryBtn.setAttribute('aria-label', UI_TEXTS.clackStateBAriaLabel);
        }
      }
    }
  };

  const showHint = (message?: string): void => {
    const text = message ?? hintEl.textContent;
    // Called every sim tick while the condition holds: only touch the live region when it changes.
    if (hintEl.classList.contains('visible') && hintEl.textContent === text) return;
    if (hintEl.textContent !== text) {
      hintEl.textContent = text;
    }
    hintEl.classList.add('visible');
  };

  const hideHint = (): void => {
    hintEl.classList.remove('visible');
  };

  const hideToast = (): void => {
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastEl.classList.remove('visible');
    victoryStatus.textContent = '';
  };

  const showToast = (message: string, durationMs: number | null = 1800): void => {
    hideToast();
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    if (isVictoryOpen()) victoryStatus.textContent = message;
    if (durationMs !== null) toastTimer = window.setTimeout(hideToast, durationMs);
  };

  const updateVictoryCommunityStats = (stats: CommunityDayStats | null): void => {
    if (stats && stats.parRatePercent !== null && stats.totalClears > 0) {
      victoryCommunity.textContent = UI_TEXTS.communityParRate(
        stats.parRatePercent,
        stats.totalClears
      );
    } else {
      victoryCommunity.textContent = '';
    }
  };

  const openVictory = (
    level: LevelDef,
    islandIndex: number,
    totalIslands: number,
    clacks: number,
    runCount: number,
    communityStats: CommunityDayStats | null = null
  ): void => {
    let rating: string = UI_TEXTS.ratingCleared;
    if (clacks <= level.par && runCount === 1) {
      rating = UI_TEXTS.ratingCleanClack;
    } else if (clacks <= level.par) {
      rating = UI_TEXTS.ratingParMaster;
    }

    victoryRating.textContent = rating;
    victoryTitle.textContent = UI_TEXTS.victoryTitle;
    victorySub.textContent = UI_TEXTS.victorySummary(level.name, clacks);
    vClacks.textContent = String(clacks);
    vPar.textContent = String(level.par);
    updateVictoryCommunityStats(communityStats);
    btnNextLabel.textContent =
      islandIndex < totalIslands - 1 ? UI_TEXTS.nextIslandLabel : UI_TEXTS.backToDayOneLabel;
    blurIfInside(hudRoot);
    hudRoot.inert = true;
    hudRoot.setAttribute('aria-hidden', 'true');
    victoryOverlay.inert = false;
    victoryOverlay.setAttribute('aria-hidden', 'false');
    victoryOverlay.classList.add('open');
    victoryCard.focus({ preventScroll: true });
  };

  const closeVictory = (): void => {
    if (!isVictoryOpen()) return;
    hudRoot.inert = false;
    hudRoot.removeAttribute('aria-hidden');
    primaryBtn.focus({ preventScroll: true });
    victoryOverlay.classList.remove('open');
    victoryOverlay.setAttribute('aria-hidden', 'true');
    victoryOverlay.inert = true;
  };

  const isVictoryOpen = (): boolean => victoryOverlay.classList.contains('open');

  const isHelpOpen = (): boolean => helpOverlay.classList.contains('open');

  function openHelp(): void {
    // Opt-in guide for idle moments only: never over the victory card or an active roll.
    if (isHelpOpen() || isVictoryOpen() || document.body.classList.contains('is-rolling')) return;
    hudRoot.inert = true;
    hudRoot.setAttribute('aria-hidden', 'true');
    btnHelp.setAttribute('aria-expanded', 'true');
    helpOverlay.inert = false;
    helpOverlay.setAttribute('aria-hidden', 'false');
    helpOverlay.classList.add('open');
    helpCard.focus({ preventScroll: true });
  }

  function closeHelp(): void {
    if (!isHelpOpen()) return;
    helpOverlay.classList.remove('open');
    helpOverlay.setAttribute('aria-hidden', 'true');
    helpOverlay.inert = true;
    btnHelp.setAttribute('aria-expanded', 'false');
    hudRoot.inert = false;
    hudRoot.removeAttribute('aria-hidden');
    if (!document.body.classList.contains('is-rolling')) {
      btnHelp.focus({ preventScroll: true });
    }
  }

  return {
    primaryButton: primaryBtn,
    render,
    showHint,
    hideHint,
    showToast,
    hideToast,
    openVictory,
    updateVictoryCommunityStats,
    closeVictory,
    isVictoryOpen,
    openHelp,
    closeHelp,
    isHelpOpen,
    pulsePrimaryButton,
    dispose: () => {
      listeners.abort();
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      if (pulseTimer !== null) window.clearTimeout(pulseTimer);
    },
  };
}

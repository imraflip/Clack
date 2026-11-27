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
  readonly showToast: (message: string, durationMs?: number) => void;
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

export function createHudController(
  islands: readonly LevelDef[],
  callbacks: HudCallbacks
): HudController {
  const biomeBar = requireElement('biome-bar', HTMLElement);
  const hudDay = requireElement('hud-day', HTMLElement);
  const hudName = requireElement('hud-name', HTMLElement);
  const hudParTag = requireElement('hud-par-tag', HTMLElement);
  const hudKeys = requireElement('hud-keys', HTMLElement);
  const hudClacksLabel = requireElement('hud-clacks-label', HTMLElement);
  const hudClacks = requireElement('hud-clacks', HTMLElement);
  const hudPar = requireElement('hud-par', HTMLElement);
  const btnRestart = requireElement('btn-restart', HTMLButtonElement);
  const btnMute = requireElement('btn-mute', HTMLButtonElement);
  const hintEl = requireElement('hint-banner', HTMLElement);
  const toastEl = requireElement('toast-banner', HTMLElement);
  const primaryBtn = requireElement('primary-btn', HTMLButtonElement);
  const primaryMark = requireElement('primary-mark', HTMLElement);
  const primaryLabel = requireElement('primary-label', HTMLElement);

  const victoryOverlay = requireElement('victory-overlay', HTMLElement);
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

  btnCopyResult.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  }, listenerOptions);
  btnCopyResult.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail > 0) {
      btnCopyResult.blur();
    }
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
    pulsePrimaryButton();
    callbacks.onPrimaryAction();
  }, listenerOptions);

  primaryBtn.addEventListener('click', (event) => {
    if (event.detail !== 0) return;
    pulsePrimaryButton();
    callbacks.onPrimaryAction();
  }, listenerOptions);

  let toastTimer: number | null = null;
  let lastMuted: boolean | null = null;
  let lastPrimaryMode: string | null = null;
  let lastBiome: LevelDef['biome'] | null = null;

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

    document.body.classList.toggle('is-rolling', phase === 'rolling');
    biomeBar.inert = phase === 'rolling';
    if (
      phase === 'rolling' &&
      document.activeElement instanceof HTMLElement &&
      biomeBar.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }

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
    if (message) {
      hintEl.textContent = message;
    }
    hintEl.classList.add('visible');
  };

  const hideHint = (): void => {
    hintEl.classList.remove('visible');
  };

  const showToast = (message: string, durationMs = 1800): void => {
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      toastEl.classList.remove('visible');
      toastTimer = null;
    }, durationMs);
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
    victoryOverlay.inert = false;
    victoryOverlay.setAttribute('aria-hidden', 'false');
    victoryOverlay.classList.add('open');
  };

  const closeVictory = (): void => {
    if (
      document.activeElement instanceof HTMLElement &&
      victoryOverlay.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
    victoryOverlay.classList.remove('open');
    victoryOverlay.setAttribute('aria-hidden', 'true');
    victoryOverlay.inert = true;
  };

  const isVictoryOpen = (): boolean => victoryOverlay.classList.contains('open');

  return {
    primaryButton: primaryBtn,
    render,
    showHint,
    hideHint,
    showToast,
    openVictory,
    updateVictoryCommunityStats,
    closeVictory,
    isVictoryOpen,
    pulsePrimaryButton,
    dispose: () => {
      listeners.abort();
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      if (pulseTimer !== null) window.clearTimeout(pulseTimer);
    },
  };
}

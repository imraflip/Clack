import { showToast as devvitShowToast } from '@devvit/web/client';
import type {
  CommunityDayStats,
  RunSubmissionRequest,
  RunSubmissionResponse,
} from '../shared/api';
import { isDayResponse, isRunSubmissionResponse, readDayList } from '../shared/api';
import { getIslandByIndex, ISLANDS } from '../shared/levels';
import type { LevelDef } from '../shared/levels';
import {
  BOOST_DURATION_TICKS,
  createInitialState,
  launchSim,
  SIM_HZ,
  SIM_UNITS_PER_WORLD,
  step,
} from '../shared/sim';
import type { SimEvent, SimState } from '../shared/sim';
import { createClackAudio } from './audio/synth';
import { createInputController } from './input/controller';
import {
  buildIslandDiorama,
  createCameraController,
  createStage,
} from './scene';
import type { IslandDiorama } from './scene';
import { createHudController } from './ui/hud';
import { UI_TEXTS } from './ui/texts';

const FIXED_DT = 1 / SIM_HZ;
const MAX_FRAME_DT = 0.05;
const FALL_INITIAL_VEL_Y = -1.2;
const FALL_GRAVITY = 14.5;
// Below this depth the marble is deep inside the pit: hide it and stop integrating the fall.
const FALL_HIDE_Y = -8;

function getReducedMotionPreference(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function submitRunToServer(req: RunSubmissionRequest): Promise<RunSubmissionResponse | null> {
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isRunSubmissionResponse(body) ? body : null;
  } catch {
    // Local standalone Vite preview has no Devvit backend; ignore network errors cleanly.
    return null;
  }
}

function bootstrap(): void {
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!(canvasWrap instanceof HTMLElement)) {
    throw new Error('Missing #canvas-wrap container');
  }

  let reducedMotion = getReducedMotionPreference();
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onMotionChange = (ev: MediaQueryListEvent): void => {
    reducedMotion = ev.matches;
  };
  motionQuery.addEventListener('change', onMotionChange);

  const audio = createClackAudio();
  const cameraCtrl = createCameraController(window.innerWidth, window.innerHeight);
  const stage = createStage(canvasWrap, {
    onContextRestored: () => {
      cameraCtrl.resize(window.innerWidth, window.innerHeight);
      stage.resize(window.innerWidth, window.innerHeight);
    },
  });

  let islandIndex = 0;
  let currentLevel: LevelDef = getIslandByIndex(0);
  let diorama: IslandDiorama | null = null;
  let simState: SimState = createInitialState(currentLevel);
  let pendingClacks = 0;
  let visualGateState = currentLevel.startState;
  let runCount = 0;
  let elapsed = 0;
  let accumulator = 0;
  let fallVelY = 0;
  let hasClackedEverOnDay1 = false;
  let userInteracted = false;
  let victoryOpenTimer: number | null = null;
  let disposed = false;
  let rafId = 0;
  // Ephemeral per-session cache hydrated from /api/day and /api/run (Redis is authoritative).
  const completedDays = new Set<number>();
  const addCompletedDays = (raw: unknown): void => {
    for (const d of readDayList(raw)) {
      if (d <= ISLANDS.length) completedDays.add(d);
    }
  };
  const communityStatsByDay = new Map<number, CommunityDayStats>();
  const bestClacksByDay = new Map<number, number>();
  const addBestClacks = (raw: Readonly<Record<number, number>>): void => {
    for (const island of ISLANDS) {
      const best = raw[island.day];
      if (typeof best === 'number' && Number.isSafeInteger(best) && best >= 0) {
        bestClacksByDay.set(island.day, best);
      }
    }
  };
  // Hydrated progression snapshot for upcoming result/launch cards (not rendered yet).
  const placement: { streak: number; userRank: number | null; totalPlayers: number } = {
    streak: 0,
    userRank: null,
    totalPlayers: 0,
  };
  let lastVictoryShareText = '';

  const clearVictoryTimer = (): void => {
    if (victoryOpenTimer !== null) {
      window.clearTimeout(victoryOpenTimer);
      victoryOpenTimer = null;
    }
  };

  const renderHud = (): void => {
    hud.render({
      islandIndex,
      level: currentLevel,
      phase: simState.phase,
      gateState: simState.gateState,
      clacks: simState.clacks,
      keysCollected: simState.keysCollected,
      muted: audio.isMuted(),
      completedDays,
    });
  };

  const resetRun = (incrementRun: boolean): void => {
    clearVictoryTimer();
    if (incrementRun) {
      runCount += 1;
    }
    simState = createInitialState(currentLevel);
    pendingClacks = 0;
    visualGateState = currentLevel.startState;
    accumulator = 0;
    fallVelY = 0;

    const startNode = currentLevel.nodes['start'];
    if (diorama && startNode) {
      diorama.pieces.resetVisuals(startNode.pos, currentLevel.startState);
    }

    hud.hideHint();
    hud.hideToast();
    hud.closeVictory();
    renderHud();
  };

  const loadIsland = (nextIndex: number): void => {
    clearVictoryTimer();
    const normalized = ((nextIndex % ISLANDS.length) + ISLANDS.length) % ISLANDS.length;
    islandIndex = normalized;
    currentLevel = getIslandByIndex(normalized);
    runCount = 0;
    hasClackedEverOnDay1 = false;

    if (diorama) {
      diorama.dispose();
      diorama = null;
    }

    stage.applyBiomePalette(currentLevel.palette);
    diorama = buildIslandDiorama(stage.scene, currentLevel);
    cameraCtrl.recenter();
    resetRun(false);
  };

  const triggerPrimaryAction = (): void => {
    // The bell has rung (or the guide is open): only that dialog's own controls may act until it closes.
    if (hud.isVictoryOpen() || hud.isHelpOpen() || simState.phase === 'won') return;
    userInteracted = true;
    audio.unlock();
    // One shared press pulse for the button, canvas taps and Space/Enter alike.
    hud.pulsePrimaryButton();
    if (simState.phase === 'falling' || simState.phase === 'locked') {
      // A failed run holds on Tap to Retry until the player deliberately retries.
      resetRun(false);
      return;
    }
    if (simState.phase === 'ready') {
      const launched = launchSim(simState);
      simState = launched.state;
      visualGateState = simState.gateState;
      runCount += 1;
      audio.playLaunch();
      renderHud();
    } else if (simState.phase === 'rolling') {
      pendingClacks += 1;
      visualGateState = visualGateState === 'A' ? 'B' : 'A';
      if (currentLevel.day === 1) {
        hasClackedEverOnDay1 = true;
        hud.hideHint();
      }
      if (diorama) {
        diorama.pieces.syncGates(visualGateState, false);
      }
      // Play synchronously inside the user gesture (pointerdown/pointerup/keydown) for zero-latency reliable audio
      audio.playClack(visualGateState);
      hud.render({
        islandIndex,
        level: currentLevel,
        phase: simState.phase,
        gateState: visualGateState,
        clacks: simState.clacks + pendingClacks,
        keysCollected: simState.keysCollected,
        muted: audio.isMuted(),
        completedDays,
      });
    }
  };

  const notifyClipboardToast = (message: string): void => {
    try {
      devvitShowToast(message);
    } catch {
      // Standalone preview outside Reddit WebView
    }
    hud.showToast(message, 1700);
  };

  const hud = createHudController(ISLANDS, {
    onSelectIsland: (idx) => {
      userInteracted = true;
      audio.unlock();
      loadIsland(idx);
    },
    onPrimaryAction: triggerPrimaryAction,
    onRestart: () => {
      audio.unlock();
      resetRun(simState.phase === 'rolling');
    },
    onToggleMute: () => {
      audio.toggleMute();
      renderHud();
    },
    onCopyResult: () => {
      if (!lastVictoryShareText || !hud.isVictoryOpen()) return;
      const wonState = simState;
      const reportCopy = (message: string): void => {
        if (!disposed && simState === wonState && hud.isVictoryOpen()) notifyClipboardToast(message);
      };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        void navigator.clipboard
          .writeText(lastVictoryShareText)
          .then(() => {
            reportCopy(UI_TEXTS.copyResultToast);
          })
          .catch(() => {
            reportCopy(UI_TEXTS.copyResultFailedToast);
          });
      } else {
        reportCopy(UI_TEXTS.copyResultFailedToast);
      }
    },
    onReplay: () => {
      audio.unlock();
      resetRun(false);
    },
    onNextIsland: () => {
      audio.unlock();
      loadIsland(islandIndex + 1);
    },
  });

  const inputCtrl = createInputController(canvasWrap, {
    isVictoryOpen: () => hud.isVictoryOpen(),
    isHelpOpen: () => hud.isHelpOpen(),
    onCloseHelp: () => {
      hud.closeHelp();
    },
    onPointerGesture: () => {
      audio.unlock();
    },
    onPrimaryAction: triggerPrimaryAction,
    onRestart: () => {
      audio.unlock();
      resetRun(simState.phase === 'rolling');
    },
    onSelectDayIndex: (idx) => {
      userInteracted = true;
      audio.unlock();
      loadIsland(idx);
    },
    onNextIsland: () => {
      audio.unlock();
      loadIsland(islandIndex + 1);
    },
    onReplay: () => {
      audio.unlock();
      resetRun(false);
    },
    onHoverNormalized: (nx, ny) => {
      cameraCtrl.setHoverNormalized(nx, ny);
    },
    onHoverLeave: () => {
      cameraCtrl.clearHover();
    },
    onCameraDrag: (dx, dy) => {
      cameraCtrl.applyDragDelta(dx, dy);
    },
    onRecenterCamera: () => {
      cameraCtrl.recenter();
    },
  });

  const handleSimEvents = (events: readonly SimEvent[]): void => {
    if (!diorama) return;

    for (const ev of events) {
      switch (ev.type) {
        case 'clack':
          // Audio & same-frame gate swing already fired synchronously inside triggerPrimaryAction()
          if (pendingClacks === 0) {
            visualGateState = ev.toState;
            renderHud();
          }
          break;
        case 'key':
          diorama.pieces.triggerKeyPickup(ev.keyId, reducedMotion);
          audio.playKey(ev.keysCollected);
          renderHud();
          break;
        case 'spring':
          diorama.pieces.triggerSpringPop(ev.springId, reducedMotion);
          audio.playSpring();
          break;
        case 'trapdoor':
          fallVelY = FALL_INITIAL_VEL_Y;
          diorama.pieces.contactShadow.visible = false;
          audio.playTrapdoor();
          // Persistent: the reason stays readable until the player taps Tap to Retry (resetRun hides it).
          hud.showToast(UI_TEXTS.toastTrapdoor, null);
          renderHud();
          break;
        case 'locked':
          diorama.pieces.triggerBellLocked();
          audio.playLockedBell();
          hud.showToast(UI_TEXTS.toastLockedBell, null);
          renderHud();
          break;
        case 'win': {
          diorama.pieces.triggerBellRing(reducedMotion);
          audio.playVictoryBell();

          completedDays.add(currentLevel.day);
          renderHud();

          const wonLevel = currentLevel;
          const wonIndex = islandIndex;
          const wonClacks = ev.clacks;
          const wonRuns = runCount;
          const wonKeys = simState.keysCollected;
          const rating =
            wonClacks <= wonLevel.par && wonRuns === 1
              ? UI_TEXTS.ratingCleanClack
              : wonClacks <= wonLevel.par
                ? UI_TEXTS.ratingParMaster
                : UI_TEXTS.ratingCleared;
          lastVictoryShareText = UI_TEXTS.shareResultText(
            wonLevel.day,
            wonLevel.name,
            rating,
            wonClacks,
            wonLevel.par,
            wonKeys,
            wonLevel.totalKeys
          );

          void submitRunToServer({
            day: wonLevel.day,
            clackTicks: simState.clackTicks,
            endTick: simState.tick,
          }).then((res) => {
            if (!res || disposed) return;
            addCompletedDays(res.completedDays);
            communityStatsByDay.set(res.day, res.communityStats);
            if (res.bestClacks !== null) bestClacksByDay.set(res.day, res.bestClacks);
            placement.streak = res.streak;
            placement.userRank = res.rank;
            placement.totalPlayers = res.totalPlayers;
            renderHud();
            if (hud.isVictoryOpen() && currentLevel.day === res.day) {
              hud.updateVictoryCommunityStats(res.communityStats);
            }
          });

          clearVictoryTimer();
          victoryOpenTimer = window.setTimeout(() => {
            hud.openVictory(
              wonLevel,
              wonIndex,
              ISLANDS.length,
              wonClacks,
              wonRuns,
              communityStatsByDay.get(wonLevel.day) ?? null
            );
            victoryOpenTimer = null;
          }, 520);
          break;
        }
        case 'auto-reset-ready':
          // Never auto-reset: the run holds on Tap to Retry so a mashed tap cannot become a launch.
          break;
        case 'gate-pass':
          diorama.pieces.triggerGatePass(ev.nodeId);
          audio.playGatePass();
          break;
        case 'launch':
          break;
      }
    }
  };

  // Day 1 renders instantly; the server then hydrates the post's bound day + progress.
  loadIsland(0);

  void fetch('/api/day')
    .then(async (res) => {
      if (!res.ok || disposed) return;
      const body: unknown = await res.json();
      if (!isDayResponse(body) || disposed) return;

      addCompletedDays(body.completedDays);
      communityStatsByDay.set(body.day, body.communityStats);
      addBestClacks(body.bestClacksByDay);
      placement.streak = body.streak;
      placement.userRank = body.userRank;
      placement.totalPlayers = body.totalPlayers;

      if (
        !userInteracted &&
        body.day >= 1 &&
        body.day <= ISLANDS.length &&
        body.day !== currentLevel.day
      ) {
        loadIsland(body.day - 1);
      } else {
        renderHud();
      }
    })
    .catch(() => {
      // Standalone preview without backend; local defaults already loaded.
    });

  const onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    cameraCtrl.resize(w, h);
    stage.resize(w, h);
  };
  window.addEventListener('resize', onResize);

  let lastTime = performance.now();

  const animate = (now: number): void => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(animate);

    const frameMs = now - lastTime;
    lastTime = now;
    if (stage.isContextLost()) {
      return;
    }
    stage.recordFrameMs(frameMs);

    const dt = Math.min(MAX_FRAME_DT, Math.max(0, frameMs / 1000));
    elapsed += dt;

    if (diorama) {
      diorama.updateAmbient(dt, elapsed, reducedMotion);

      if (
        simState.phase === 'rolling' ||
        simState.phase === 'falling' ||
        simState.phase === 'locked'
      ) {
        accumulator += dt;
        let rolledWorldDist = 0;

        while (accumulator >= FIXED_DT) {
          accumulator -= FIXED_DT;
          const clackNow = pendingClacks > 0;
          if (clackNow) {
            pendingClacks -= 1;
          }

          const out = step(currentLevel, simState, clackNow);
          simState = out.state;

          if (simState.phase === 'rolling') {
            rolledWorldDist += simState.lastStepSim / SIM_UNITS_PER_WORLD;

            // Gentle first-gate hint on Day 1 before first clack
            if (
              currentLevel.day === 1 &&
              !hasClackedEverOnDay1 &&
              simState.currentEdgeId === 'e_m1_g1' &&
              simState.edgeDistSim > 120
            ) {
              hud.showHint(UI_TEXTS.hintFirstGate);
            }
          }

          handleSimEvents(out.events);

          if (simState.phase === 'ready' || simState.phase === 'won') {
            accumulator = 0;
            break;
          }
        }

        if (simState.phase === 'rolling') {
          const sample = diorama.tracks.positionAt(simState.currentEdgeId, simState.edgeDistSim);
          const boostFrac = simState.boostTicks / BOOST_DURATION_TICKS;
          diorama.pieces.placeMarble(
            sample.position,
            sample.tangent,
            rolledWorldDist,
            boostFrac,
            reducedMotion
          );
        } else if (simState.phase === 'falling' && diorama.pieces.marble.visible) {
          fallVelY -= FALL_GRAVITY * dt;
          diorama.pieces.marble.position.y += fallVelY * dt;
          if (diorama.pieces.marble.position.y < FALL_HIDE_Y) {
            // resetVisuals() restores visibility on retry.
            diorama.pieces.marble.visible = false;
          }
        }
      }
    }

    cameraCtrl.update(dt, reducedMotion);
    stage.renderer.render(stage.scene, cameraCtrl.camera);
  };

  rafId = window.requestAnimationFrame(animate);

  const teardown = (): void => {
    if (disposed) return;
    disposed = true;
    window.cancelAnimationFrame(rafId);
    clearVictoryTimer();
    window.removeEventListener('resize', onResize);
    motionQuery.removeEventListener('change', onMotionChange);
    inputCtrl.dispose();
    hud.dispose();
    audio.dispose();
    diorama?.dispose();
    diorama = null;
    stage.dispose();
  };
  const onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) return;
    window.removeEventListener('pagehide', onPageHide);
    teardown();
  };
  window.addEventListener('pagehide', onPageHide);
}

bootstrap();

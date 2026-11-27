import { requestExpandedMode } from '@devvit/web/client';
import type { CommunityDayStats } from '../shared/api';
import { isDayResponse } from '../shared/api';
import { getIslandByDay, getIslandByIndex } from '../shared/levels';
import type { LevelDef } from '../shared/levels';
import { SVG_ICONS } from './ui/icons';
import { UI_TEXTS } from './ui/texts';

function requireEl<T extends HTMLElement>(id: string, ctor: new (...args: never[]) => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) {
    throw new Error(`Missing splash element: #${id}`);
  }
  return el;
}

function renderSplash(level: LevelDef, communityStats: CommunityDayStats | null = null): void {
  const dayEl = requireEl('splash-day', HTMLElement);
  const dotEl = requireEl('splash-dot', HTMLElement);
  const biomeLabelEl = requireEl('splash-biome-label', HTMLElement);
  const thumbEl = requireEl('splash-thumb', HTMLImageElement);
  const titleEl = requireEl('splash-title', HTMLElement);
  const parEl = requireEl('splash-par', HTMLElement);
  const communityEl = requireEl('splash-community', HTMLElement);
  const subtitleEl = requireEl('splash-subtitle', HTMLElement);
  const playLabelEl = requireEl('splash-play-label', HTMLElement);
  const playIconEl = requireEl('splash-play-icon', HTMLElement);

  document.documentElement.style.setProperty('--sky-center', level.palette.skyCenter);
  document.documentElement.style.setProperty('--sky-edge', level.palette.skyEdge);

  dayEl.textContent = UI_TEXTS.dayTag(level.day);
  dotEl.style.background = level.dotColor;
  biomeLabelEl.textContent = UI_TEXTS.biomeBadge(level.biome);
  thumbEl.src = `./thumbs/${level.id}.png`;
  thumbEl.alt = `Clack ${level.name} floating island preview`;
  titleEl.textContent = level.name;
  parEl.textContent = UI_TEXTS.parTag(level.par);
  if (communityStats && communityStats.parRatePercent !== null && communityStats.totalClears > 0) {
    communityEl.textContent = UI_TEXTS.communityParRate(
      communityStats.parRatePercent,
      communityStats.totalClears
    );
  } else {
    communityEl.textContent = '';
  }
  subtitleEl.textContent = UI_TEXTS.splashSubtitle;
  playLabelEl.textContent = UI_TEXTS.splashPlayLabel;
  playIconEl.innerHTML = SVG_ICONS.play;
}

function initSplash(): void {
  renderSplash(getIslandByIndex(0));

  const playBtn = requireEl('splash-play-btn', HTMLButtonElement);
  playBtn.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (Reflect.get(globalThis, 'devvit')) {
      requestExpandedMode(event, 'game');
      return;
    }
    const previewLink = document.createElement('a');
    previewLink.href = './game.html';
    previewLink.click();
  });

  // Hydrate the post's bound day from the server; geometry always comes from the bundled catalogue.
  void fetch('/api/day')
    .then(async (res) => {
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (!isDayResponse(body)) return;
      const level = getIslandByDay(body.day);
      if (level) {
        renderSplash(level, body.communityStats);
      }
    })
    .catch(() => {
      // Standalone preview without backend; default island already rendered.
    });
}

initSplash();

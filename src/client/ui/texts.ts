import type { BiomeId } from '../../shared/levels';

export const UI_TEXTS = {
  appTitle: 'CLACK',
  canvasAriaLabel: 'Clack floating diorama canvas',
  biomeTabsAriaLabel: 'Daily biome islands',
  keysAriaLabel: 'Collected keys',
  counterAriaLabel: 'Clacks used and par',
  clacksLabel: 'Clacks',
  parLabel: 'Par',
  launchLabel: 'Launch',
  clackLabel: 'CLACK',
  retryLabel: 'Tap to Retry',
  launchAriaLabel: 'Launch marble',
  clackStateAAriaLabel: 'Clack to flip gates, position A',
  clackStateBAriaLabel: 'Clack to flip gates, position B',
  retryAriaLabel: 'Retry island immediately',
  restartTitle: 'Restart (R)',
  restartAriaLabel: 'Restart island (R)',
  muteTitle: 'Toggle sound',
  muteAriaLabel: 'Toggle sound',
  helpTitle: 'How to play',
  helpAriaLabel: 'How to play',
  helpCloseAriaLabel: 'Close guide',
  helpStepFlip: 'Launch & flip every gate',
  helpStepGoal: 'Collect all keys, avoid pits, ring the bell',
  helpStateA: 'A',
  helpStateB: 'B',
  helpGateDiagramLabel: 'Gates swap between Circle A and Diamond B',
  helpGoalDiagramLabel: 'Key, then avoid the trapdoor pit, then the bell',
  helpOr: 'or',
  helpTap: 'Tap',
  helpKeySpace: 'Space',
  helpDragChip: 'Drag',
  helpDragLabel: 'Tilt view',
  helpRecenterLabel: 'Recenter',
  helpRestartLabel: 'Restart',
  helpIslandsLabel: 'Islands',
  helpControlsAriaLabel: 'Controls',
  hintFirstGate: 'Tap or press Space to flip every gate',
  toastTrapdoor: 'Fell into the trapdoor',
  toastLockedBell: 'Collect all 3 keys first',
  victoryTitle: 'Bell Rung',
  ratingCleanClack: 'Clean Clack',
  ratingParMaster: 'Par Master',
  ratingCleared: 'Cleared',
  replayLabel: 'Replay',
  nextIslandLabel: 'Next Island',
  backToDayOneLabel: 'Back to Day 1',
  copyResultLabel: 'Copy Result',
  copyResultToast: 'Result copied to clipboard',
  copyResultFailedToast: 'Could not access clipboard',
  splashPlayLabel: 'Play Today',
  splashSubtitle: 'One button flips every gate. Collect all three keys and ring the brass bell.',
  dayTag: (day: number): string => `DAY ${day}`,
  parTag: (par: number): string => `Par ${par}`,
  parRatio: (par: number): string => `/ ${par}`,
  victorySummary: (islandName: string, clacks: number): string =>
    `${islandName} cleared in ${clacks} ${clacks === 1 ? 'clack' : 'clacks'}.`,
  communityParRate: (parRatePercent: number, totalClears: number): string =>
    `${parRatePercent}% cleared at Par (${totalClears} ${totalClears === 1 ? 'clear' : 'clears'})`,
  shareResultText: (
    day: number,
    islandName: string,
    rating: string,
    clacks: number,
    par: number,
    keysCollected: number,
    totalKeys: number
  ): string =>
    `CLACK — Day ${day} · ${islandName}\n${rating} · ${clacks}/${par} Clacks · ${keysCollected}/${totalKeys} Keys`,
  biomeBadge: (biome: BiomeId): string => {
    switch (biome) {
      case 'cedar':
        return 'Cedar Biome';
      case 'mossy':
        return 'Mossy Mill Biome';
      case 'amber':
        return 'Amber Viaduct Biome';
      case 'frosty':
        return 'Frosty Terrace Biome';
      case 'dusk':
        return 'Highland Dusk Biome';
    }
  },
} as const;

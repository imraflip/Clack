import type { GateState } from '../levels';

export type SimPhase = 'ready' | 'rolling' | 'falling' | 'locked' | 'won';

export type SimEvent =
  | { readonly type: 'launch'; readonly tick: number }
  | { readonly type: 'clack'; readonly tick: number; readonly toState: GateState }
  | {
      readonly type: 'key';
      readonly tick: number;
      readonly keyId: number;
      readonly edgeId: string;
      readonly keysCollected: number;
    }
  | {
      readonly type: 'spring';
      readonly tick: number;
      readonly springId: string;
      readonly edgeId: string;
    }
  | {
      readonly type: 'gate-pass';
      readonly tick: number;
      readonly nodeId: string;
      readonly branch: GateState;
      readonly nextEdgeId: string;
    }
  | { readonly type: 'trapdoor'; readonly tick: number; readonly nodeId: string }
  | {
      readonly type: 'locked';
      readonly tick: number;
      readonly nodeId: string;
      readonly keysCollected: number;
    }
  | { readonly type: 'win'; readonly tick: number; readonly clacks: number; readonly par: number }
  | { readonly type: 'auto-reset-ready'; readonly tick: number };

export type SimState = {
  readonly tick: number;
  readonly phase: SimPhase;
  readonly gateState: GateState;
  readonly clacks: number;
  readonly clackTicks: readonly number[];
  readonly keysMask: number;
  readonly keysCollected: number;
  readonly currentEdgeId: string;
  readonly edgeDistSim: number;
  readonly lastStepSim: number;
  readonly speedPerSecSim: number;
  readonly speedRemainder: number;
  readonly boostTicks: number;
  readonly stateTimerTicks: number;
  /** Travel direction along the current edge (flipped by Pop-Up Bumpers). */
  readonly edgeDirection: 1 | -1;
  /** Bitmask of flipped 'single-use' gates (indexed by LevelNode.gateIndex). */
  readonly jammedGateMask: number;
  /** Bitmask of counterweight scale-pan balance flips. */
  readonly scaleMask: number;
  readonly portalHoldTicks: number;
  readonly portalTargetNodeId: string | null;
  readonly jumpArcTicksRemaining: number;
  readonly jumpTargetEdgeId: string | null;
  readonly jumpTargetSimPos: number;
  /** Last trigger tick per spring/bumper id (cooldown bookkeeping). */
  readonly itemCooldownTick: Readonly<Record<string, number>>;
};

export type StepOutput = {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
};

export type SimResult = {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
  readonly won: boolean;
  readonly finishTick: number;
  readonly clacks: number;
  readonly hash: string;
};

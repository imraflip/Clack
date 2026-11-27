export type Vec3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type GateState = 'A' | 'B';

export type GateBehavior = 'standard' | 'single-use' | 'inverted';

export type TrackMode = 'timber' | 'canal';

export type IslandLayout = 'single' | 'split';

export type BiomeId = 'cedar' | 'mossy' | 'amber' | 'frosty' | 'dusk';

export type IslandId = string;

export type LevelCategory = 'daily' | 'vault';

export type NodeType =
  | 'start'
  | 'merge'
  | 'gate'
  | 'trapdoor'
  | 'bell'
  | 'portal'
  | 'drawbridge'
  | 'shutter-grate'
  | 'scale-pan'
  | 'timing-lift'
  | 'turntable'
  | 'swing-bridge';

export type LevelNode = {
  readonly id: string;
  readonly pos: Vec3;
  readonly type: NodeType;
  /** Defaults to 'standard'. */
  readonly gateBehavior?: GateBehavior;
  /** Bit index into SimState.jammedGateMask for 'single-use' gates. */
  readonly gateIndex?: number;
  /** Destination portal node id. */
  readonly portalPairId?: string;
  /** Exact integer hold ticks inside a portal. */
  readonly portalDelayTicks?: number;
  /** Gate state that closes a 'shutter-grate'. */
  readonly closedOnState?: GateState;
  /** Paired 'scale-pan' node id. */
  readonly scalePairId?: string;
  /** Integer period for a 'timing-lift'. */
  readonly liftCycleTicks?: number;
  /** Inclusive aligned tick-modulo window start. */
  readonly liftWindowStart?: number;
  /** Inclusive aligned tick-modulo window end. */
  readonly liftWindowEnd?: number;
  readonly liftMode?: 'cycle' | 'clack-step';
  readonly turntableStartQuarter?: 0 | 1 | 2 | 3;
};

type EdgeItemBase = {
  readonly u: number;
  readonly simPos: number;
  readonly triggerRadiusSim: number;
};

export type EdgeItemKey = EdgeItemBase & {
  readonly type: 'key';
  readonly keyId: number;
};

export type EdgeItemSpring = EdgeItemBase & {
  readonly type: 'spring';
  readonly springId: string;
};

export type EdgeItemBumper = EdgeItemBase & {
  readonly type: 'bumper';
  readonly bumperId: string;
  readonly activeOnState: GateState;
};

export type EdgeItemJumpRamp = EdgeItemBase & {
  readonly type: 'jump-ramp';
  readonly rampId: string;
  readonly activeOnState: GateState;
  readonly targetEdgeId: string;
  readonly targetSimPos: number;
  readonly arcTicks: number;
};

export type EdgeItem = EdgeItemKey | EdgeItemSpring | EdgeItemBumper | EdgeItemJumpRamp;

export type LevelEdge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly branch: GateState | null;
  /** Outgoing routing quarter for 'turntable' nodes. */
  readonly portQuarter?: 0 | 1 | 2 | 3;
  readonly bridge?: boolean;
  /** Defaults to 'timber'; 'canal' enables the Float water trough. */
  readonly trackMode?: TrackMode;
  /** Integer percent (default 100). */
  readonly speedMultiplierPct?: number;
  readonly lengthSim: number;
  readonly pts: readonly Vec3[];
  readonly items: readonly EdgeItem[];
};

export type BiomePalette = {
  readonly skyCenter: string;
  readonly skyEdge: string;
  readonly deck: number;
  readonly bevel: number;
  readonly collar: number;
  readonly cliffTop: number;
  readonly cliffBottom: number;
  readonly groove: number;
  readonly rail: number;
  readonly sunColor: number;
  readonly sunIntensity: number;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly hemiIntensity: number;
};

export type PropType =
  | 'pineCluster'
  | 'pineSolo'
  | 'broadleafCluster'
  | 'broadleafSolo'
  | 'cairn'
  | 'waterwheel'
  | 'mapleCluster'
  | 'mapleSolo'
  | 'sandPost'
  | 'leaves'
  | 'spruceCluster'
  | 'spruceSolo'
  | 'iceCluster'
  | 'snowMound'
  | 'cypressCluster'
  | 'cypressSolo'
  | 'stoneLantern'
  | 'lanternPost'
  | 'boulder'
  | 'flowers'
  | 'heather';

export type PropSpec = {
  readonly type: PropType;
  readonly x: number;
  readonly z: number;
  readonly s?: number;
  readonly color?: number;
  readonly light?: boolean;
};

export type LevelDef = {
  readonly id: IslandId;
  /** Positive integer for daily islands; vault maps use their own registry tag. */
  readonly day: number;
  readonly category: LevelCategory;
  readonly shortLabel: string;
  readonly name: string;
  /** Concise one-line twist badge (e.g. 'Portals'). */
  readonly twistTag?: string;
  readonly par: number;
  /** Locked Clack Budget twist. */
  readonly maxClacks?: number;
  /** Rare Closing-Bell twist. */
  readonly closingBellTicks?: number;
  readonly totalKeys: number;
  readonly startState: GateState;
  readonly seed: number;
  readonly dotColor: string;
  readonly biome: BiomeId;
  /** Defaults to 'single'; 'split' for the Swinging Bridge. */
  readonly islandLayout?: IslandLayout;
  readonly palette: BiomePalette;
  readonly nodes: Readonly<Record<string, LevelNode>>;
  readonly edges: readonly LevelEdge[];
  readonly props: readonly PropSpec[];
};

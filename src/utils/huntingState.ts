export type HunterStatus =
  | 'NOT_IN_STAND'
  | 'IN_STAND'
  | 'READY'
  | 'SHOT_FIRED'
  | 'HARVEST'
  | 'WOUNDED';

export type ShotOutcome = 'HARVEST' | 'MISS' | 'WOUNDED';

export interface ShotRecord {
  outcome: ShotOutcome;
  timestamp: number;
  standId: string | null;
}

export interface HunterState {
  hunterName: string;
  currentStandId: string | null;
  standName: string | null;
  status: HunterStatus;
  lastShot: ShotRecord | null;
  previousStatus: HunterStatus | null;
}

export function createInitialHunterState(hunterName: string): HunterState {
  return {
    hunterName,
    currentStandId: null,
    standName: null,
    status: 'NOT_IN_STAND',
    lastShot: null,
    previousStatus: null,
  };
}

export function selectStand(state: HunterState, standId: string, standName: string): HunterState {
  return {
    ...state,
    currentStandId: standId,
    standName,
    status: 'IN_STAND',
    previousStatus: state.status,
  };
}

export function setHunterReady(state: HunterState): HunterState {
  return {
    ...state,
    status: 'READY',
    previousStatus: state.status,
  };
}

export function reportShotFired(state: HunterState): HunterState {
  return {
    ...state,
    previousStatus: state.status,
    status: 'SHOT_FIRED',
  };
}

export function resolveShotOutcome(state: HunterState, outcome: ShotOutcome): HunterState {
  const shotRecord: ShotRecord = {
    outcome,
    timestamp: Date.now(),
    standId: state.currentStandId,
  };

  let nextStatus: HunterStatus;
  if (outcome === 'HARVEST') {
    nextStatus = 'HARVEST';
  } else if (outcome === 'WOUNDED') {
    nextStatus = 'WOUNDED';
  } else {
    // MISS palauttaa passin valmiustilaan
    nextStatus = 'READY';
  }

  return {
    ...state,
    status: nextStatus,
    lastShot: shotRecord,
    previousStatus: state.status,
  };
}

export function cancelShotReport(state: HunterState): HunterState {
  return {
    ...state,
    status: state.previousStatus && state.previousStatus !== 'SHOT_FIRED' ? state.previousStatus : 'READY',
    lastShot: null,
  };
}

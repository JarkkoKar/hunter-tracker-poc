import { describe, it, expect } from '@jest/globals';
import {
  createInitialHunterState,
  selectStand,
  setHunterReady,
  reportShotFired,
  resolveShotOutcome,
  cancelShotReport,
} from '../src/utils/huntingState';

describe('Hunting State & Shot Outcome Machine', () => {
  it('alustaa metsästäjän alkutilaan', () => {
    const state = createInitialHunterState('Metsästäjä 1');
    expect(state.hunterName).toBe('Metsästäjä 1');
    expect(state.currentStandId).toBeNull();
    expect(state.status).toBe('NOT_IN_STAND');
    expect(state.lastShot).toBeNull();
  });

  it('päivittää tilan kun passi valitaan ja kuitataan valmiiksi', () => {
    let state = createInitialHunterState('Metsästäjä 1');
    state = selectStand(state, 'p4', 'P4 Kuusikko');
    
    expect(state.currentStandId).toBe('p4');
    expect(state.standName).toBe('P4 Kuusikko');
    expect(state.status).toBe('IN_STAND');

    state = setHunterReady(state);
    expect(state.status).toBe('READY');
  });

  it('käsittelee laukauksen ilmoituksen ja kaatokuittauksen oikein', () => {
    let state = createInitialHunterState('Metsästäjä 1');
    state = selectStand(state, 'p4', 'P4 Kuusikko');
    state = setHunterReady(state);

    state = reportShotFired(state);
    expect(state.status).toBe('SHOT_FIRED');

    state = resolveShotOutcome(state, 'HARVEST');
    expect(state.status).toBe('HARVEST');
    expect(state.lastShot?.outcome).toBe('HARVEST');
    expect(state.lastShot?.standId).toBe('p4');
  });

  it('ohilaukaus palauttaa passin READY-tilaan', () => {
    let state = createInitialHunterState('Metsästäjä 1');
    state = selectStand(state, 'p4', 'P4 Kuusikko');
    state = setHunterReady(state);
    state = reportShotFired(state);

    state = resolveShotOutcome(state, 'MISS');
    expect(state.status).toBe('READY');
    expect(state.lastShot?.outcome).toBe('MISS');
  });

  it('haavakko asettaa hälytystilan WOUNDED', () => {
    let state = createInitialHunterState('Metsästäjä 1');
    state = selectStand(state, 'p4', 'P4 Kuusikko');
    state = setHunterReady(state);
    state = reportShotFired(state);

    state = resolveShotOutcome(state, 'WOUNDED');
    expect(state.status).toBe('WOUNDED');
    expect(state.lastShot?.outcome).toBe('WOUNDED');
  });

  it('peruuta-painike palauttaa laukausilmoituksen edelliseen tilaan', () => {
    let state = createInitialHunterState('Metsästäjä 1');
    state = selectStand(state, 'p4', 'P4 Kuusikko');
    state = setHunterReady(state);
    state = reportShotFired(state);

    state = cancelShotReport(state);
    expect(state.status).toBe('READY');
    expect(state.lastShot).toBeNull();
  });
});

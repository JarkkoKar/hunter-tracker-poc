export enum RadioTxMode {
  NORMAL = 'NORMAL',
  BURST_MANUAL = 'BURST_MANUAL',
  RX_ONLY = 'RX_ONLY',
}

export interface EmconState {
  mode: RadioTxMode;
  lastTransitionAt: number;
  blockedTxAttempts: number;
}

export function createInitialEmconState(): EmconState {
  return {
    mode: RadioTxMode.NORMAL,
    lastTransitionAt: Date.now(),
    blockedTxAttempts: 0,
  };
}

/**
 * Vaihtaa radiokurin tilaa.
 * Siirtyminen pois RX_ONLY-tilasta (kohti lähetystä) vaatii tietoisen vahvistuksen
 * (confirmed === true, esim. 2s pitkä painallus tai Slide-to-Transmit).
 */
export function setRadioTxMode(
  currentState: EmconState,
  targetMode: RadioTxMode,
  confirmed: boolean = false
): EmconState {
  if (currentState.mode === targetMode) {
    return currentState;
  }

  // Siirtyminen RX_ONLY-tilaan (radiohiljaisuus) on aina sallittu välittömästi yhdellä painalluksella
  if (targetMode === RadioTxMode.RX_ONLY) {
    return {
      ...currentState,
      mode: RadioTxMode.RX_ONLY,
      lastTransitionAt: Date.now(),
    };
  }

  // Poistuminen RX_ONLY-tilasta vaatii tietoisen vahvistuksen
  if (currentState.mode === RadioTxMode.RX_ONLY && !confirmed) {
    return currentState;
  }

  return {
    ...currentState,
    mode: targetMode,
    lastTransitionAt: Date.now(),
  };
}

/**
 * Palauttaa true, jos ulospäin suuntautuva RF-lähetys on sallittu nykyisessä tilassa.
 */
export function canTransmitPacket(state: EmconState): boolean {
  return state.mode !== RadioTxMode.RX_ONLY;
}

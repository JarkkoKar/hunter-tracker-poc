export interface ZeroizeState {
  coverOpen: boolean;
  sliderPercent: number;
  wiped: boolean;
  activeSecretKey: string;
  duressPin: string;
  localRecordsCount: number;
  loraRadioCommand: string | null;
  wipedAt: number | null;
}

export function createInitialZeroizeState(
  initialSecretKey: string = 'HTL-DEFAULT-E2EE-KEY',
  duressPin: string = '9911'
): ZeroizeState {
  return {
    coverOpen: false,
    sliderPercent: 0,
    wiped: false,
    activeSecretKey: initialSecretKey,
    duressPin,
    localRecordsCount: 14,
    loraRadioCommand: null,
    wipedAt: null,
  };
}

export function setZeroizeCoverOpen(
  state: ZeroizeState,
  open: boolean
): ZeroizeState {
  if (state.wiped) return state;
  return {
    ...state,
    coverOpen: open,
    sliderPercent: open ? state.sliderPercent : 0,
  };
}

/**
 * Suorittaa kriittisen muistin, avainten ja LoRa-kanavan tyhjennyksen.
 */
export function wipeAllSensitiveData(state: ZeroizeState): ZeroizeState {
  return {
    ...state,
    coverOpen: true,
    sliderPercent: 100,
    wiped: true,
    activeSecretKey: '',
    localRecordsCount: 0,
    loraRadioCommand: 'ADMIN_CMD:ZEROIZE_CHANNEL_PSK',
    wipedAt: Date.now(),
  };
}

/**
 * Vaatii virtuaalisen suojakannen avaamisen JA yli 85 % vetopituuden liukukytkimeltä.
 */
export function attemptSlideToZeroize(
  state: ZeroizeState,
  sliderPercent: number
): ZeroizeState {
  if (state.wiped) return state;
  if (!state.coverOpen || sliderPercent <= 85) {
    return {
      ...state,
      sliderPercent: state.coverOpen ? sliderPercent : 0,
    };
  }
  return wipeAllSensitiveData(state);
}

/**
 * Lukitusnäytön hätä-PIN (Duress PIN) -laukaisu.
 */
export function triggerDuressPinZeroize(
  state: ZeroizeState,
  enteredPin: string
): ZeroizeState {
  if (state.wiped) return state;
  if (enteredPin.trim() !== state.duressPin) {
    return state;
  }
  return wipeAllSensitiveData(state);
}

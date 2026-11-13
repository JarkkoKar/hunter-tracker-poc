/**
 * Silent Hunt Audio Interlock: kuulosuojainten (Bluetooth) äänivaroitus, kun
 * katsesuuntakeila osuu naapuripassin kieltokulmaan.
 *
 * Puhtaita funktioita (Jest-testattavissa ilman natiivimoduuleja):
 * - `shouldPlayAudioWarning`: hälytyspäätös + cooldown + hystereesi + muistutus.
 * - `generateToneWav`: merkkiääni 16-bit mono PCM WAV -tavuina (ei binääriassetteja repoon).
 * - `bytesToBase64`: tiedoston kirjoitukseen expo-file-systemillä.
 *
 * Äänivaroitus on paikallinen vastaanottimen turvatoiminto: EMCON-tila (myös
 * RX_ONLY) ei vaikuta siihen, koska mitään ei lähetetä radioteitse.
 */
import { RadioTxMode } from './emconState';

export enum AudioWarningLevel {
  /** Siirtymä vaarasektorille: kaksoispiippaus. */
  DANGER_SECTOR_ENTER = 'DANGER_SECTOR_ENTER',
  /** Vaarassa pysyminen: yksittäinen muistutuspiippaus. */
  DANGER_REMINDER = 'DANGER_REMINDER',
}

export interface ToneSpec {
  frequencyHz: number;
  beepCount: number;
  beepMs: number;
  gapMs: number;
  /** 0..1 */
  volume: number;
}

/** Matala ja lyhyt: ei peitä ympäristön ääniä (riistan liikettä) kohtuuttomasti. */
export const AUDIO_WARNING_TONES: Record<AudioWarningLevel, ToneSpec> = {
  [AudioWarningLevel.DANGER_SECTOR_ENTER]: {
    frequencyHz: 660,
    beepCount: 2,
    beepMs: 110,
    gapMs: 90,
    volume: 0.6,
  },
  [AudioWarningLevel.DANGER_REMINDER]: {
    frequencyHz: 660,
    beepCount: 1,
    beepMs: 110,
    gapMs: 0,
    volume: 0.5,
  },
};

export const DEFAULT_AUDIO_COOLDOWN_MS = 2500;
/** Muistutusväli, kun keila pysyy yhtäjaksoisesti kieltokulmassa. */
export const DEFAULT_AUDIO_REMINDER_MS = 10_000;
const TONE_FILE_VERSION = 1;

export interface AudioInterlockState {
  enabled: boolean;
  lastAlertAt: number | null;
  cooldownMs: number;
  reminderIntervalMs: number;
  /** Hystereesi: tuloääni sallitaan vain viritettynä (turvalliselta sektorilta tultaessa). */
  armed: boolean;
}

export function createAudioInterlockState(
  options: Partial<Pick<AudioInterlockState, 'enabled' | 'cooldownMs' | 'reminderIntervalMs'>> = {}
): AudioInterlockState {
  return {
    enabled: options.enabled ?? true,
    cooldownMs: options.cooldownMs ?? DEFAULT_AUDIO_COOLDOWN_MS,
    reminderIntervalMs: options.reminderIntervalMs ?? DEFAULT_AUDIO_REMINDER_MS,
    lastAlertAt: null,
    armed: true,
  };
}

export function setAudioWarningEnabled(state: AudioInterlockState, enabled: boolean): AudioInterlockState {
  return { ...state, enabled };
}

export interface AudioWarningInput {
  isDanger: boolean;
  nowMs: number;
  /** Ei vaikuta päätökseen (paikallinen turvatoiminto); mukana dokumentaationa ja testejä varten. */
  radioMode?: RadioTxMode;
}

export interface AudioWarningDecision {
  play: boolean;
  level: AudioWarningLevel | null;
  state: AudioInterlockState;
}

/**
 * Hälytyspäätös:
 * - Turvallinen suunta virittää (armed) seuraavan tuloäänen.
 * - Viritettynä vaarassa: tuloääni, jos cooldown on kulunut; muuten odotetaan
 *   (pysyy viritettynä, joten ääni tulee heti ajastimen nollauduttua, jos vaara jatkuu).
 * - Yhtäjaksoisesti vaarassa: muistutus `reminderIntervalMs` välein.
 * - Kytkin pois: ei ääniä.
 */
export function shouldPlayAudioWarning(
  state: AudioInterlockState,
  input: AudioWarningInput
): AudioWarningDecision {
  const silent = (next: AudioInterlockState): AudioWarningDecision => ({
    play: false,
    level: null,
    state: next,
  });

  if (!input.isDanger) return silent({ ...state, armed: true });
  if (!state.enabled) return silent({ ...state });

  const sinceLast = state.lastAlertAt === null ? Infinity : input.nowMs - state.lastAlertAt;

  if (state.armed) {
    if (sinceLast < state.cooldownMs) return silent({ ...state });
    return {
      play: true,
      level: AudioWarningLevel.DANGER_SECTOR_ENTER,
      state: { ...state, armed: false, lastAlertAt: input.nowMs },
    };
  }

  if (sinceLast >= state.reminderIntervalMs && sinceLast >= state.cooldownMs) {
    return {
      play: true,
      level: AudioWarningLevel.DANGER_REMINDER,
      state: { ...state, lastAlertAt: input.nowMs },
    };
  }

  return silent({ ...state });
}

// ---------------------------------------------------------------------------
// Merkkiäänen generointi (16-bit mono PCM WAV)
// ---------------------------------------------------------------------------

export function getToneDurationMs(tone: ToneSpec): number {
  return tone.beepCount * tone.beepMs + Math.max(0, tone.beepCount - 1) * tone.gapMs;
}

export function buildToneFileName(level: AudioWarningLevel): string {
  return `huntertracker_${level.toLowerCase()}_v${TONE_FILE_VERSION}.wav`;
}

/** Häivytys piippauksen alkuun ja loppuun (estää naksahdukset). */
const FADE_MS = 8;

export function generateToneWav(tone: ToneSpec, sampleRate: number = 22050): Uint8Array {
  const totalSamples = Math.round((getToneDurationMs(tone) * sampleRate) / 1000);
  const beepSamples = Math.round((tone.beepMs * sampleRate) / 1000);
  const fadeSamples = Math.max(1, Math.round((FADE_MS * sampleRate) / 1000));
  const amplitude = Math.max(0, Math.min(1, tone.volume)) * 32767;

  const bytes = new Uint8Array(44 + totalSamples * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt-lohkon koko
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // tavua / s
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bittiä / näyte
  writeAscii(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  for (let b = 0; b < tone.beepCount; b++) {
    const start = Math.round(((b * (tone.beepMs + tone.gapMs)) * sampleRate) / 1000);
    for (let i = 0; i < beepSamples && start + i < totalSamples; i++) {
      const envelope = Math.min(1, i / fadeSamples, (beepSamples - 1 - i) / fadeSamples);
      const value = Math.sin((2 * Math.PI * tone.frequencyHz * i) / sampleRate) * amplitude * envelope;
      view.setInt16(44 + (start + i) * 2, Math.round(value), true);
    }
  }
  return bytes;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triple >> 18) & 63];
    out += BASE64_ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '=';
  }
  return out;
}

/**
 * Koko näytön karttanäkymän (tiketti #60) puhdas logiikka.
 *
 * Asettelu itse tarkistetaan puhelimessa; tänne kootaan päätökset, jotka
 * voidaan testata ilman natiivimoduuleja: alapaneelin painikkeiden tila,
 * suuntavaroituksen näkyvyys ja kerrosjärjestys sekä yläpalkin tekstit.
 */
import type { HunterStatus } from './huntingState';

/** VALMIS- ja LAUKAUS-painikkeiden minimikorkeus (px), käsineillä painettava. */
export const PRIMARY_BUTTON_MIN_HEIGHT = 58;

/**
 * Kerrosjärjestys (zIndex). Kartta alimpana; suuntavaroitus ylimpänä, jotta
 * se ei koskaan jää yläpalkin, alapaneelin tai avatun paneelin taakse.
 */
export const MAP_SCREEN_LAYERS = {
  map: 0,
  fab: 10,
  bottomPanel: 20,
  sheet: 30,
  statusBar: 40,
  headingWarning: 50,
} as const;

/** Pikavalinnoista avattavat paneelit. SOS ei avaa paneelia vaan lähettää hälytyksen. */
export type MapSheetId = 'AREA' | 'RADIO' | 'MORE';

export interface BottomPanelState {
  readyEnabled: boolean;
  /** true = VALMIS-painike toimii paluuna valmiuteen (kaato / haavakko). */
  readyIsReturn: boolean;
  shotEnabled: boolean;
  showOutcomeChoices: boolean;
  outcomeEnabled: boolean;
  cancelEnabled: boolean;
  /** Lyhyt ohje käyttäjälle, tyhjä jos ei tarvita. */
  hint: string;
}

export function getBottomPanelState(
  status: HunterStatus,
  txAllowed: boolean
): BottomPanelState {
  const readyPossible =
    status === 'IN_STAND' || status === 'HARVEST' || status === 'WOUNDED';
  const shotPossible = status === 'READY';
  const showOutcomeChoices = status === 'SHOT_FIRED';

  let hint = '';
  if (!txAllowed) {
    hint = 'Lähetys estetty (RX_ONLY)';
  } else if (status === 'NOT_IN_STAND') {
    hint = 'Valitse passi kartalta tai Alue-paneelista';
  }

  return {
    readyEnabled: readyPossible && txAllowed,
    readyIsReturn: status === 'HARVEST' || status === 'WOUNDED',
    shotEnabled: shotPossible && txAllowed,
    showOutcomeChoices,
    outcomeEnabled: showOutcomeChoices && txAllowed,
    cancelEnabled: showOutcomeChoices,
    hint,
  };
}

/** Suuntavaroitus näkyy aina vaaratilanteessa, riippumatta avoimesta paneelista. */
export function shouldShowHeadingWarning(
  isDanger: boolean,
  _openSheet: MapSheetId | null
): boolean {
  return isDanger;
}

/** Saman pikavalinnan uusi painallus sulkee paneelin, toinen vaihtaa sen. */
export function toggleSheet(
  current: MapSheetId | null,
  requested: MapSheetId
): MapSheetId | null {
  return current === requested ? null : requested;
}

export function formatGpsAccuracy(accuracy: number | null | undefined): string {
  if (accuracy === null || accuracy === undefined || !Number.isFinite(accuracy)) {
    return '±-- m';
  }
  return `±${Math.round(accuracy)} m`;
}

export function formatAreaSummary(
  areaName: string | null | undefined,
  parcelCount: number
): string {
  const name = areaName && areaName.trim().length > 0 ? areaName.trim() : 'Alue 1';
  const unit = parcelCount === 1 ? 'palsta' : 'palstaa';
  return `${name} · ${parcelCount} ${unit}`;
}

export type StatusLevel = 'ok' | 'warn' | 'silent' | 'danger';

const BEARER_LABELS: Record<string, string> = {
  CELLULAR_IP: '4G/5G',
  LORA_MESH_BLE: 'LoRa BLE',
  LORA_USB_SERIAL: 'LoRa USB',
  NONE: 'EI YHTEYTTÄ',
};

/**
 * Radion tila yläpalkkiin. Parametrit merkkijonoina, jotta funktio ei riipu
 * enumien toteutuksesta (TransportBearer, RadioTxMode).
 */
export function formatRadioStatus(
  activeBearer: string,
  emconMode: string,
  _cellularAvailable: boolean
): { label: string; level: StatusLevel } {
  const base = BEARER_LABELS[activeBearer] ?? activeBearer;
  if (emconMode === 'RX_ONLY') {
    return { label: `${base} · RX_ONLY`, level: 'silent' };
  }
  const label = emconMode === 'BURST_MANUAL' ? `${base} · BURST` : base;
  return { label, level: activeBearer === 'NONE' ? 'warn' : 'ok' };
}

/** Suunnan tila alapaneelin tilanneriville. */
export function formatHeadingStatus(
  safety: { isDanger: boolean; conflictingStandName?: string },
  compassAvailable: boolean | null,
  heading: number | null
): { label: string; level: StatusLevel } {
  if (safety.isDanger) {
    const who = safety.conflictingStandName ? ` (${safety.conflictingStandName})` : '';
    return { label: `SUUNTA: VAARA${who}`, level: 'danger' };
  }
  if (compassAvailable === false) {
    return { label: 'Kompassi N/A', level: 'warn' };
  }
  if (heading === null || !Number.isFinite(heading)) {
    return { label: 'SUUNTA ---', level: 'warn' };
  }
  const deg = Math.round(heading) % 360;
  return { label: `SUUNTA OK ${deg}°`, level: 'ok' };
}

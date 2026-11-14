/**
 * Koko näytön karttanäkymä, osa 2 (tiketti #61): Lisää-paneelin puhdas logiikka.
 *
 * Alue-, Radio- ja Lisää-pikavalinnat avaavat saman paneelin; Alue ja Radio
 * vierittävät paneelin suoraan omaan osioonsa. Asettelu tarkistetaan
 * puhelimessa, tänne kootaan testattavat päätökset.
 */
import type { MapSheetId } from './mapScreenLayout';
import { hasMmlApiKey, type MapLayerChoice } from './mapLayerPreference';
import { RadioTxMode } from './emconState';

export type MorePanelSectionId =
  | 'AREA'
  | 'MAP_LAYER'
  | 'RADIO'
  | 'PROFILE'
  | 'ZEROIZE'
  | 'SECTOR_SAFETY'
  | 'SAR'
  | 'GPS_TEST';

/** Osioiden järjestys ylhäältä alas (luonnos, näkymä 3). Testaustoiminnot lopussa. */
export const MORE_PANEL_SECTIONS: readonly MorePanelSectionId[] = [
  'AREA',
  'MAP_LAYER',
  'RADIO',
  'PROFILE',
  'ZEROIZE',
  'SECTOR_SAFETY',
  'SAR',
  'GPS_TEST',
];

/** Mihin osioon paneeli avautuu. null = paneelin alku (tai paneeli kiinni). */
export function getMorePanelFocusSection(
  sheet: MapSheetId | null
): MorePanelSectionId | null {
  if (sheet === 'AREA') return 'AREA';
  if (sheet === 'RADIO') return 'RADIO';
  return null;
}

/**
 * Vierityskohta (px) paneelin sisällössä. 0 = alku; null = osiota ei ole vielä
 * mitattu, joten vieritystä odotetaan seuraavaan asettelukierrokseen.
 */
export function getMorePanelScrollOffset(
  offsets: Partial<Record<MorePanelSectionId, number>>,
  focus: MorePanelSectionId | null
): number | null {
  if (focus === null) return 0;
  const y = offsets[focus];
  if (y === undefined || !Number.isFinite(y)) return null;
  return Math.max(0, y);
}

export interface MapLayerSegment {
  id: MapLayerChoice;
  label: string;
  selected: boolean;
  enabled: boolean;
}

const MAP_LAYER_LABELS: { id: MapLayerChoice; label: string }[] = [
  { id: 'opentopomap', label: 'OpenTopoMap' },
  { id: 'mml-maastokartta', label: 'MML Maasto' },
  { id: 'offline', label: 'Offline' },
];

/** Karttatason kolmiosainen valinta. MML näkyy aina, mutta toimii vain API-avaimella. */
export function getMapLayerSegments(
  current: MapLayerChoice,
  apiKey?: string | null
): MapLayerSegment[] {
  const mmlOk = hasMmlApiKey(apiKey);
  return MAP_LAYER_LABELS.map(({ id, label }) => ({
    id,
    label,
    selected: id === current,
    enabled: id !== 'mml-maastokartta' || mmlOk,
  }));
}

/** RX_ONLY-tilasta poistuminen: pitkän painalluksen kesto (sama kuin ennen #61). */
export const EMCON_UNLOCK_LONG_PRESS_MS = 2000;

export interface EmconSegment {
  mode: RadioTxMode;
  label: string;
  selected: boolean;
  /** true = valinta vaatii tietoisen pitkän painalluksen (pois RX_ONLY-tilasta). */
  requiresLongPress: boolean;
}

const EMCON_LABELS: { mode: RadioTxMode; label: string }[] = [
  { mode: RadioTxMode.NORMAL, label: 'NORMAL' },
  { mode: RadioTxMode.BURST_MANUAL, label: 'BURST' },
  { mode: RadioTxMode.RX_ONLY, label: 'RX_ONLY' },
];

export function getEmconSegments(current: RadioTxMode): EmconSegment[] {
  return EMCON_LABELS.map(({ mode, label }) => ({
    mode,
    label,
    selected: mode === current,
    requiresLongPress: current === RadioTxMode.RX_ONLY && mode !== RadioTxMode.RX_ONLY,
  }));
}

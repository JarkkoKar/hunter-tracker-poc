import { Coordinates } from './safetySector';

export enum ActiveProfile {
  HUNTER = 'HUNTER',
  SAR = 'SAR',
  TACTICAL = 'TACTICAL',
}

export type CoordinateSystemType = 'WGS84' | 'MGRS';

export interface ProfileConfig {
  id: ActiveProfile;
  label: string;
  accentColor: string;
  coordinateSystem: CoordinateSystemType;
  nodeLabel: string;
  areaLabel: string;
  readyActionLabel: string;
  alertActionLabel: string;
}

const PROFILE_CONFIGS: Record<ActiveProfile, ProfileConfig> = {
  [ActiveProfile.HUNTER]: {
    id: ActiveProfile.HUNTER,
    label: 'Metsästys (Hunter)',
    accentColor: '#4CAF50',
    coordinateSystem: 'WGS84',
    nodeLabel: 'Passipaikka',
    areaLabel: 'Jahtialue',
    readyActionLabel: '[VALMIS PASSIIN]',
    alertActionLabel: '[LAUKAUS AMMUTTU]',
  },
  [ActiveProfile.SAR]: {
    id: ActiveProfile.SAR,
    label: 'Pelastuspalvelu (SAR)',
    accentColor: '#FF9800',
    coordinateSystem: 'WGS84',
    nodeLabel: 'Etsintäpiste',
    areaLabel: 'Etsintälohko',
    readyActionLabel: '[PARTIO VALMIS]',
    alertActionLabel: '[HAVAINTO / SOS]',
  },
  [ActiveProfile.TACTICAL]: {
    id: ActiveProfile.TACTICAL,
    label: 'Taktinen (Tactical)',
    accentColor: '#00BCD4',
    coordinateSystem: 'MGRS',
    nodeLabel: 'Tarkkailupiste (OP)',
    areaLabel: 'Toiminta-alue (AO)',
    readyActionLabel: '[ASEMISSA]',
    alertActionLabel: '[TULIKOSKETUS / ILMOITUS]',
  },
};

export function getProfileConfig(profile: ActiveProfile): ProfileConfig {
  return PROFILE_CONFIGS[profile];
}

/**
 * Muuntaa WGS84-koordinaatit likimääräiseen MGRS-ruudukkomuotoon (10 m tarkkuus)
 * taktista näyttöä varten ilman raskaita ulkoisia kirjastoja.
 */
function toApproxMgrs(coords: Coordinates): string {
  const lat = coords.latitude;
  const lon = coords.longitude;

  // UTM-vyöhyke (Suomessa pääosin 34V / 35V / 36V)
  const zoneNumber = Math.floor((lon + 180) / 6) + 1;
  const latBands = 'CDEFGHJKLMNPQRSTUVWX';
  const bandIndex = Math.min(
    latBands.length - 1,
    Math.max(0, Math.floor((lat + 80) / 8))
  );
  const latBand = latBands[bandIndex];

  // Yksinkertaistettu UTM-projektio (WGS84) ruudukkonäyttöä varten
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = 2 * f - f * f;
  const ePrime2 = e2 / (1 - e2);

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const lonOrigin = ((zoneNumber - 1) * 6 - 180 + 3) * (Math.PI / 180);

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = ePrime2 * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lonOrigin);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * ePrime2) * A ** 5) / 120) +
    500000.0;

  let northing =
    k0 *
    (M +
      N *
        Math.tan(latRad) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ePrime2) * A ** 6) / 720));

  if (lat < 0) northing += 10000000.0;

  // 100 km ruututunnus (esim. MH / MJ / NH)
  const e100kLetters = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  const n100kLetters = 'ABCDEFGHJKLMNPQRSTUV';
  const setIdx = (zoneNumber - 1) % 3;
  const eIdx = Math.floor(easting / 100000) - 1;
  const nIdx = Math.floor(northing / 100000) % 20;

  const colLetter = e100kLetters[setIdx][Math.max(0, Math.min(7, eIdx))];
  const rowLetter = n100kLetters[Math.max(0, Math.min(19, nIdx))];

  const eRem = Math.floor((easting % 100000) / 10)
    .toString()
    .padStart(4, '0');
  const nRem = Math.floor((northing % 100000) / 10)
    .toString()
    .padStart(4, '0');

  return `${zoneNumber}${latBand} ${colLetter}${rowLetter} ${eRem} ${nRem}`;
}

export function formatCoordinatesForProfile(
  coords: Coordinates,
  profile: ActiveProfile
): string {
  const config = getProfileConfig(profile);
  if (config.coordinateSystem === 'MGRS') {
    return toApproxMgrs(coords);
  }
  return `${coords.latitude.toFixed(5)}° N, ${coords.longitude.toFixed(5)}° E`;
}

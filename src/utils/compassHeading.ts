import { Coordinates, generateSectorPolygonCoordinates } from './safetySector';

/**
 * Kartan suuntatila.
 * - NORTH_UP: pohjoinen aina ylhäällä.
 * - HEADING_UP: kartta kääntyy niin, että katsesuunta on ylhäällä.
 */
export enum MapOrientationMode {
  NORTH_UP = 'NORTH_UP',
  HEADING_UP = 'HEADING_UP',
}

export interface MagnetometerXY {
  x: number;
  y: number;
}

/** Katsesuuntakeilan oletusleveys asteina (±10°). */
export const DEFAULT_VIEW_CONE_WIDTH_DEG = 20;
/** Katsesuuntakeilan oletuspituus metreinä. */
export const DEFAULT_VIEW_CONE_LENGTH_M = 150;
/** Pehmennyskerroin: pienempi = rauhallisempi, suurempi = nopeampi reagointi. */
export const DEFAULT_HEADING_SMOOTHING_ALPHA = 0.2;

export function normalizeDegrees(deg: number): number {
  const n = deg % 360;
  const result = n < 0 ? n + 360 : n;
  // Estetään -0 ja liukulukupyöristyksestä syntyvä tasan 360
  return result >= 360 || Object.is(result, -0) ? 0 : result;
}

/**
 * Muuntaa magnetometrin x/y-lukemat kompassisuunnaksi (atsimuutti 0–360°).
 *
 * Oletus: puhelin on vaakatasossa näyttö ylöspäin. Laitteen y-akseli osoittaa
 * yläreunaan ja x-akseli oikealle. Kun yläreuna osoittaa pohjoiseen, kentän
 * vaakakomponentti on +y; kun yläreuna osoittaa itään, pohjoinen on vasemmalla (-x).
 * Siksi heading = atan2(-x, y).
 *
 * Huom: ei kallistuskompensaatiota – tarkkuus heikkenee, jos puhelin on pystyssä.
 *
 * @param declinationDeg Valinnainen eranto (itäinen positiivinen), jolla
 *   magneettinen suunta korjataan tosisuunnaksi (Suomessa n. +8…+12°).
 */
export function calculateHeadingFromMagnetometer(
  reading: MagnetometerXY,
  declinationDeg: number = 0
): number {
  const headingRad = Math.atan2(-reading.x, reading.y);
  const headingDeg = (headingRad * 180) / Math.PI;
  return normalizeDegrees(headingDeg + declinationDeg);
}

/**
 * Kulmille sopiva low-pass-suodin. Kulkee aina lyhintä reittiä, joten
 * 350° -> 10° siirtymä ei pyörähdä 180°:n kautta.
 *
 * @param previous Edellinen pehmennetty arvo (null = ei vielä arvoa).
 * @param next Uusi raakalukema.
 * @param alpha 0..1, osuus jolla siirrytään kohti uutta lukemaa.
 */
export function smoothHeading(
  previous: number | null,
  next: number,
  alpha: number = DEFAULT_HEADING_SMOOTHING_ALPHA
): number {
  if (previous === null || !Number.isFinite(previous)) {
    return normalizeDegrees(next);
  }
  const a = Math.min(1, Math.max(0, alpha));
  // Lyhin kulmaero välillä [-180, 180)
  const delta = ((next - previous + 540) % 360) - 180;
  return normalizeDegrees(previous + a * delta);
}

/**
 * Muodostaa katsesuuntakeilan polygonin omasta sijainnista kompassin suuntaan.
 * Palauttaa suljetun polygonin: [origin, ...kaaren pisteet, origin].
 */
export function generateViewConeCoordinates(
  origin: Coordinates,
  headingDeg: number,
  widthDeg: number = DEFAULT_VIEW_CONE_WIDTH_DEG,
  lengthMeters: number = DEFAULT_VIEW_CONE_LENGTH_M,
  stepDegrees: number = 5
): Coordinates[] {
  const half = widthDeg / 2;
  const start = normalizeDegrees(headingDeg - half);
  const end = normalizeDegrees(headingDeg + half);
  return generateSectorPolygonCoordinates(origin, start, end, lengthMeters, stepDegrees);
}

/** Kameran heading valitun tilan mukaan. */
export function getCameraHeadingForMode(
  mode: MapOrientationMode,
  compassHeading: number | null
): number {
  if (mode === MapOrientationMode.HEADING_UP && compassHeading !== null) {
    return normalizeDegrees(compassHeading);
  }
  return 0;
}

export function toggleMapOrientationMode(mode: MapOrientationMode): MapOrientationMode {
  return mode === MapOrientationMode.NORTH_UP
    ? MapOrientationMode.HEADING_UP
    : MapOrientationMode.NORTH_UP;
}

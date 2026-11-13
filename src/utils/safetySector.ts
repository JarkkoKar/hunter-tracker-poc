export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface DangerZone {
  standId: string;
  standName: string;
  centerAngle: number;
  startAngle: number;
  endAngle: number;
}

export interface NearestStandResult<T extends Coordinates = Coordinates> {
  stand: T;
  distanceMeters: number;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * Laskee kahden maantieteellisen koordinaatin et‰isyyden metrein‰ (Haversine).
 */
export function calculateDistanceMeters(coord1: Coordinates, coord2: Coordinates): number {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(coord2.latitude - coord1.latitude);
  const dLon = toRadians(coord2.longitude - coord1.longitude);

  const lat1 = toRadians(coord1.latitude);
  const lat2 = toRadians(coord2.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

/**
 * Etsii annettujen passien joukosta k‰ytt‰j‰‰ l‰himm‰n passin.
 * Jos l‰hin passi on kauempana kuin maxDistanceMeters, palauttaa null.
 */
export function findNearestStand<T extends Coordinates>(
  userLocation: Coordinates,
  stands: T[],
  maxDistanceMeters: number = 50
): NearestStandResult<T> | null {
  if (stands.length === 0) return null;

  let nearest: T | null = null;
  let minDistance = Infinity;

  for (const stand of stands) {
    const dist = calculateDistanceMeters(userLocation, stand);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = stand;
    }
  }

  if (nearest && minDistance <= maxDistanceMeters) {
    return {
      stand: nearest,
      distanceMeters: minDistance,
    };
  }

  return null;
}

/**
 * Laskee kompassisuuntiman (atsimuutin 0-360 astetta) pisteest‰ A pisteeseen B.
 */
export function calculateBearing(start: Coordinates, end: Coordinates): number {
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const dLon = toRadians(end.longitude - start.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  let bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * Laskee naapuripasseille +-15 asteen kieltokulmat.
 */
export function calculateDangerZones(
  currentStand: Coordinates & { id: string; name?: string },
  neighbors: Array<Coordinates & { id: string; name: string }>,
  bufferDegrees: number = 15
): DangerZone[] {
  return neighbors
    .filter((n) => n.id !== currentStand.id)
    .map((neighbor) => {
      const centerAngle = calculateBearing(currentStand, neighbor);
      const startAngle = (centerAngle - bufferDegrees + 360) % 360;
      const endAngle = (centerAngle + bufferDegrees) % 360;

      return {
        standId: neighbor.id,
        standName: neighbor.name,
        centerAngle,
        startAngle,
        endAngle,
      };
    });
}

/**
 * Tarkistaa osuuko annettu ampumasuunta (0-360 astetta) mihink‰‰n kieltokulmaan.
 */
export function isDirectionSafe(angle: number, dangerZones: DangerZone[]): boolean {
  const normalizedAngle = (angle + 360) % 360;

  for (const zone of dangerZones) {
    if (zone.startAngle > zone.endAngle) {
      if (normalizedAngle >= zone.startAngle || normalizedAngle <= zone.endAngle) {
        return false;
      }
    } else {
      if (normalizedAngle >= zone.startAngle && normalizedAngle <= zone.endAngle) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Laskee uuden koordinaattipisteen et‰isyyden ja suuntiman perusteella.
 */
function destinationPoint(
  start: Coordinates,
  distanceMeters: number,
  bearingDegrees: number
): Coordinates {
  const earthRadius = 6371000;
  const angularDist = distanceMeters / earthRadius;
  const bearingRad = toRadians(bearingDegrees);
  const lat1 = toRadians(start.latitude);
  const lon1 = toRadians(start.longitude);

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDist) +
    Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearingRad);
  const lat2 = Math.asin(sinLat2);
  const y = Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1);
  const x = Math.cos(angularDist) - Math.sin(lat1) * sinLat2;
  const lon2 = lon1 + Math.atan2(y, x);

  return {
    latitude: toDegrees(lat2),
    longitude: toDegrees(lon2),
  };
}

/**
 * Muodostaa kartalle piirrett‰v‰n sektorin (Polygon) koordinaatit.
 */
export function generateSectorPolygonCoordinates(
  center: Coordinates,
  startAngle: number,
  endAngle: number,
  radiusMeters: number = 300,
  stepDegrees: number = 5
): Coordinates[] {
  const points: Coordinates[] = [{ ...center }];

  let diff = (endAngle - startAngle + 360) % 360;
  if (diff === 0) diff = 360;

  const steps = Math.max(2, Math.ceil(diff / stepDegrees));
  for (let i = 0; i <= steps; i++) {
    const angle = (startAngle + (diff * i) / steps) % 360;
    points.push(destinationPoint(center, radiusMeters, angle));
  }

  points.push({ ...center });

  return points;
}

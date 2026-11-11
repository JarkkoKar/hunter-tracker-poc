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

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * Laskee kompassisuuntiman (atsimuutin 0-360 astetta) pisteestä A pisteeseen B.
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
    .filter(n => n.id !== currentStand.id)
    .map(neighbor => {
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
 * Tarkistaa osuuko annettu ampumasuunta (0-360 astetta) mihinkään kieltokulmaan.
 */
export function isDirectionSafe(angle: number, dangerZones: DangerZone[]): boolean {
  const normalizedAngle = (angle + 360) % 360;

  for (const zone of dangerZones) {
    if (zone.startAngle > zone.endAngle) {
      // Ylittää pohjoissuunnan (0 astetta), esim. 345 -> 15
      if (normalizedAngle >= zone.startAngle || normalizedAngle <= zone.endAngle) {
        return false;
      }
    } else {
      // Normaali väli, esim. 75 -> 105
      if (normalizedAngle >= zone.startAngle && normalizedAngle <= zone.endAngle) {
        return false;
      }
    }
  }

  return true;
}

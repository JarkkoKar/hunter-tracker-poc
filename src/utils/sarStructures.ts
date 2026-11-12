import { Coordinates, calculateDistanceMeters } from './safetySector';
import { PacketType } from './wireProtocol';

export interface TrackDeltaPacket {
  unitId: number;
  points: Coordinates[];
  binaryFrame: Uint8Array;
}

export interface SearchSectorPacket {
  sectorName: string;
  vertices: Coordinates[];
  binaryFrame: Uint8Array;
}

export interface SosAlertPacket {
  senderId: number;
  location: Coordinates;
  overrideSilentMode: boolean;
  lockSenderOnMap: boolean;
  timestamp: number;
  binaryFrame: Uint8Array;
}

/**
 * Tiivist‰‰ j‰ljen 3ñ5 merkitt‰v‰n vektoripisteen nipuksi ja pakkaa sen < 60 B kehykseen.
 */
export function compressTrackDelta(
  unitId: number,
  rawTrack: Coordinates[],
  minStepMeters: number = 25
): TrackDeltaPacket {
  const filtered: Coordinates[] = [];

  for (const pt of rawTrack) {
    if (filtered.length === 0) {
      filtered.push(pt);
    } else {
      const prev = filtered[filtered.length - 1];
      if (calculateDistanceMeters(prev, pt) >= minStepMeters) {
        filtered.push(pt);
      }
    }
  }

  // Otetaan enint‰‰n 5 tuoreinta pistett‰, v‰hint‰‰n mit‰ saatavilla (tavoite 3-5)
  const selected = filtered.slice(-5);

  // Pakataan bin‰‰rikehykseen: header (4 B) + 8 B per piste (max 4 + 40 = 44 B < 60 B)
  const frame = new Uint8Array(4 + selected.length * 8);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 0x48);
  view.setUint8(1, PacketType.TRACK_DELTA);
  view.setUint8(2, unitId & 0xff);
  view.setUint8(3, selected.length);

  selected.forEach((p, idx) => {
    const offset = 4 + idx * 8;
    view.setInt32(offset, Math.round(p.latitude * 1e6), false);
    view.setInt32(offset + 4, Math.round(p.longitude * 1e6), false);
  });

  return {
    unitId,
    points: selected,
    binaryFrame: frame,
  };
}

/**
 * Pakkaa 6ñ8 kulmapisteen etsint‰lohkopolygonin yhdeksi kompaktiksi paketiksi.
 */
export function packSearchSector(
  sectorName: string,
  vertices: Coordinates[]
): SearchSectorPacket {
  if (vertices.length < 6 || vertices.length > 8) {
    throw new Error('SEARCH_SECTOR vaatii 6ñ8 kulmapistett‰.');
  }

  // Header (4 B) + 6 B per k‰rkipiste (3 B lat, 3 B lon -> 4 + 48 = 52 B)
  const frame = new Uint8Array(4 + vertices.length * 6);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 0x48);
  view.setUint8(1, PacketType.SEARCH_SECTOR);
  view.setUint8(2, vertices.length);
  view.setUint8(3, 0x01);

  vertices.forEach((v, idx) => {
    const offset = 4 + idx * 6;
    const latInt = Math.round(v.latitude * 1e5);
    const lonInt = Math.round(v.longitude * 1e5);
    frame[offset] = (latInt >> 16) & 0xff;
    frame[offset + 1] = (latInt >> 8) & 0xff;
    frame[offset + 2] = latInt & 0xff;
    frame[offset + 3] = (lonInt >> 16) & 0xff;
    frame[offset + 4] = (lonInt >> 8) & 0xff;
    frame[offset + 5] = lonInt & 0xff;
  });

  return {
    sectorName,
    vertices,
    binaryFrame: frame,
  };
}

/**
 * Muodostaa priorisoidun SOS-h‰t‰paketin, joka ohittaa ‰‰nettˆm‰n tilan.
 */
export function createPrioritySosAlert(
  senderId: number,
  location: Coordinates
): SosAlertPacket {
  const frame = new Uint8Array(16);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 0x48);
  view.setUint8(1, PacketType.SOS_ALERT);
  view.setUint16(2, senderId & 0xffff, false);
  view.setInt32(4, Math.round(location.latitude * 1e7), false);
  view.setInt32(8, Math.round(location.longitude * 1e7), false);
  view.setUint8(12, 0xff); // Priority / Silent Override flag

  return {
    senderId,
    location,
    overrideSilentMode: true,
    lockSenderOnMap: true,
    timestamp: Date.now(),
    binaryFrame: frame,
  };
}

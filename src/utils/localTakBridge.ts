import { PacketType, WireFramePayload } from './wireProtocol';
import { ActiveProfile } from './profileEngine';

export enum TakTargetEndpoint {
  ATAK_MULTICAST = 'ATAK_MULTICAST',
  ATAK_LOCALHOST = 'ATAK_LOCALHOST',
}

export interface TakUdpEnvelope {
  host: string;
  port: number;
  protocol: 'UDP';
  xmlPayload: string;
}

function getCotTypeForPacket(
  packetType: PacketType,
  profile: ActiveProfile
): string {
  if (packetType === PacketType.SOS_ALERT) {
    return 'b-a-o-tbl'; // CoT Emergency / Distress
  }
  if (packetType === PacketType.SHOT_ALERT) {
    return 'b-m-p-w-GOTO'; // CoT Event / Contact marker
  }
  if (profile === ActiveProfile.TACTICAL) {
    return 'a-f-G-U-C'; // Friendly Ground Unit Combat
  }
  return 'a-f-G-E-V-C'; // Friendly Ground Civilian / SAR / Hunter
}

/**
 * Muuntaa puretun viestikehyksen standardiksi Cursor on Target (CoT) 2.0 XML:ksi
 * samassa laitteessa pyörivää ATAK-sovellusta varten.
 */
export function convertFrameToCotXml(
  payload: WireFramePayload,
  profile: ActiveProfile
): string {
  const startIso = new Date(payload.timestampSec * 1000).toISOString();
  const staleIso = new Date((payload.timestampSec + 300) * 1000).toISOString();
  const cotType = getCotTypeForPacket(payload.packetType, profile);
  const uid = `HTL-UNIT-${payload.senderId}`;
  const callsign = `${profile}-${payload.senderId}`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<event version="2.0" uid="${uid}" type="${cotType}" how="m-g" time="${startIso}" start="${startIso}" stale="${staleIso}">`,
    `  <point lat="${payload.latitude.toFixed(6)}" lon="${payload.longitude.toFixed(6)}" hae="0.0" ce="10.0" le="10.0" />`,
    `  <detail>`,
    `    <contact callsign="${callsign}" />`,
    `    <remarks>HTL PacketType=${payload.packetType} Status=${payload.statusCode}</remarks>`,
    `  </detail>`,
    `</event>`,
  ].join('\n');
}

export function buildTakDispatchEnvelope(
  cotXml: string,
  target: TakTargetEndpoint = TakTargetEndpoint.ATAK_MULTICAST
): TakUdpEnvelope {
  if (target === TakTargetEndpoint.ATAK_LOCALHOST) {
    return {
      host: '127.0.0.1',
      port: 4242,
      protocol: 'UDP',
      xmlPayload: cotXml,
    };
  }

  return {
    host: '239.2.3.1',
    port: 6969,
    protocol: 'UDP',
    xmlPayload: cotXml,
  };
}

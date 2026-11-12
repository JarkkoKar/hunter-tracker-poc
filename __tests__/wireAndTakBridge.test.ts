import { describe, it, expect } from '@jest/globals';
import {
  PacketType,
  encodeEncryptedFrame,
  decodeAndVerifyFrame,
} from '../src/utils/wireProtocol';
import {
  TakTargetEndpoint,
  convertFrameToCotXml,
  buildTakDispatchEnvelope,
} from '../src/utils/localTakBridge';
import { ActiveProfile } from '../src/utils/profileEngine';

describe('Compact Wire Protocol (< 60 B), E2EE & LocalTakBridge (CoT/ATAK)', () => {
  const sharedKey = 'HUNTER-ALPHA-2026-SECRET-KEY';

  it('pakkaa viestin alle 60 tavun binäärikehykseen, salaa ja purkaa sen oikein', () => {
    const frameBytes = encodeEncryptedFrame(
      {
        senderId: 42,
        packetType: PacketType.SHOT_ALERT,
        latitude: 61.05123,
        longitude: 24.05456,
        statusCode: 2, // SHOT_FIRED
        timestampSec: 1794526000,
      },
      sharedKey
    );

    // LoRa duty-cycle -vaatimus: alle 60 tavua
    expect(frameBytes.byteLength).toBeLessThan(60);
    expect(frameBytes.byteLength).toBe(44);

    // Purku oikealla avaimella onnistuu
    const decoded = decodeAndVerifyFrame(frameBytes, sharedKey);
    expect(decoded.valid).toBe(true);
    expect(decoded.payload?.senderId).toBe(42);
    expect(decoded.payload?.packetType).toBe(PacketType.SHOT_ALERT);
    expect(decoded.payload?.latitude).toBeCloseTo(61.05123, 4);
    expect(decoded.payload?.longitude).toBeCloseTo(24.05456, 4);

    // Purku väärällä avaimella tai muokatulla paketilla hylätään
    const tampered = new Uint8Array(frameBytes);
    tampered[15] ^= 0xff;
    const failed = decodeAndVerifyFrame(tampered, sharedKey);
    expect(failed.valid).toBe(false);
  });

  it('muuntaa puretun viestikehyksen Cursor on Target (CoT) XML -muotoon ATAKille', () => {
    const cotXml = convertFrameToCotXml(
      {
        senderId: 7,
        packetType: PacketType.SOS_ALERT,
        latitude: 61.05,
        longitude: 24.05,
        statusCode: 9,
        timestampSec: 1794526000,
      },
      ActiveProfile.TACTICAL
    );

    expect(cotXml).toContain('<event version="2.0"');
    expect(cotXml).toContain('uid="HTL-UNIT-7"');
    expect(cotXml).toContain('type="b-a-o-tbl"'); // Hätäilmoituksen CoT-koodi
    expect(cotXml).toContain('lat="61.050000"');
    expect(cotXml).toContain('lon="24.050000"');

    const envelope = buildTakDispatchEnvelope(cotXml, TakTargetEndpoint.ATAK_MULTICAST);
    expect(envelope.host).toBe('239.2.3.1');
    expect(envelope.port).toBe(6969);
  });
});

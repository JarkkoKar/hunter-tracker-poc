import { describe, it, expect } from '@jest/globals';
import {
  TransportBearer,
  createInitialTransportState,
  connectUsbSerial,
  disconnectUsbSerial,
  setCellularHealth,
  routeOutgoingPacket,
} from '../src/utils/transportManager';
import { createInitialEmconState, setRadioTxMode, RadioTxMode } from '../src/utils/emconState';

describe('ITransportManager: Hybrid (4G/5G -> LoRa) & Zero-RF (USB-C Serial)', () => {
  const samplePayload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

  it('käyttää ensisijaisesti 4G/5G-yhteyttä ja pudottaa LoRa Meshiin yhteyden katketessa', () => {
    let transport = createInitialTransportState();
    const emcon = createInitialEmconState();

    // 1. 4G/5G toimii normaalisti
    const res1 = routeOutgoingPacket(transport, emcon, samplePayload);
    expect(res1.dispatched).toBe(true);
    expect(res1.bearerUsed).toBe(TransportBearer.CELLULAR_IP);

    // 2. Matkapuhelinverkko katkeaa / timeout -> saumaton vaihto 868 MHz LoRa Meshiin
    transport = setCellularHealth(transport, false, 5000);
    const res2 = routeOutgoingPacket(transport, emcon, samplePayload);
    expect(res2.dispatched).toBe(true);
    expect(res2.bearerUsed).toBe(TransportBearer.LORA_MESH_BLE);
  });

  it('aktivoi Zero-RF USB-C Serial -tilan (115200 bps) ja sammuttaa radion BLE-lähettimen', () => {
    let transport = createInitialTransportState();
    const emcon = createInitialEmconState();

    // Kytketään USB-C-kaapeli LoRa-radioon
    const usbResult = connectUsbSerial(transport, 115200);
    transport = usbResult.state;

    expect(transport.usbSerialConnected).toBe(true);
    expect(transport.baudRate).toBe(115200);
    expect(transport.radioBleDisabled).toBe(true);
    expect(usbResult.adminCommand).toBe('ADMIN_CMD:DISABLE_BLE_RADIO');

    // Paketti reitittyy nyt suoraan kaapelia pitkin ilman 2.4 GHz Bluetoothia
    const res = routeOutgoingPacket(transport, emcon, samplePayload);
    expect(res.dispatched).toBe(true);
    expect(res.bearerUsed).toBe(TransportBearer.LORA_USB_SERIAL);

    // Kaapelin irrotus palauttaa BLE-valmiuden
    transport = disconnectUsbSerial(transport);
    expect(transport.usbSerialConnected).toBe(false);
    expect(transport.radioBleDisabled).toBe(false);
  });

  it('estää kaikki lähetykset kaikilla väylillä, kun EMCON on RX_ONLY', () => {
    const transport = createInitialTransportState();
    const rxOnlyEmcon = setRadioTxMode(
      createInitialEmconState(),
      RadioTxMode.RX_ONLY,
      true
    );

    const res = routeOutgoingPacket(transport, rxOnlyEmcon, samplePayload);
    expect(res.dispatched).toBe(false);
    expect(res.reason).toBe('EMCON_RX_ONLY_BLOCKED');
  });
});

import { describe, it, expect } from '@jest/globals';
import {
  TransportBearer,
  createInitialTransportState,
  applyMeshtasticLink,
  setCellularHealth,
} from '../src/utils/transportManager';

describe('transportManager + Meshtastic-silta (#24)', () => {
  it('kättelyn aikana USB-väylä on aktiivinen, mutta BLE OFF vasta radion kuittauksesta', () => {
    const s = applyMeshtasticLink(createInitialTransportState(), {
      state: 'HANDSHAKING',
      bluetoothDisabled: false,
    });
    expect(s.usbSerialConnected).toBe(true);
    expect(s.activeBearer).toBe(TransportBearer.LORA_USB_SERIAL);
    expect(s.radioBleDisabled).toBe(false);
    expect(s.baudRate).toBe(115200);
  });

  it('CONNECTED + BLE pois -> radioBleDisabled', () => {
    const s = applyMeshtasticLink(createInitialTransportState(), {
      state: 'CONNECTED',
      bluetoothDisabled: true,
    });
    expect(s.radioBleDisabled).toBe(true);
    expect(s.activeBearer).toBe(TransportBearer.LORA_USB_SERIAL);
  });

  it('DISCONNECTED/ERROR -> pudotus 4G:hen tai LoRa Meshiin', () => {
    const on = applyMeshtasticLink(createInitialTransportState(), { state: 'CONNECTED', bluetoothDisabled: true });
    const off = applyMeshtasticLink(on, { state: 'DISCONNECTED', bluetoothDisabled: true });
    expect(off.usbSerialConnected).toBe(false);
    expect(off.radioBleDisabled).toBe(false);
    expect(off.activeBearer).toBe(TransportBearer.CELLULAR_IP);
    const noCell = setCellularHealth(on, false);
    const err = applyMeshtasticLink(noCell, { state: 'ERROR', bluetoothDisabled: false });
    expect(err.usbSerialConnected).toBe(false);
    expect(err.activeBearer).toBe(TransportBearer.LORA_MESH_BLE);
  });
});

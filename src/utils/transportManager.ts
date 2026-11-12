import { EmconState, canTransmitPacket } from './emconState';

export enum TransportBearer {
  CELLULAR_IP = 'CELLULAR_IP',
  LORA_MESH_BLE = 'LORA_MESH_BLE',
  LORA_USB_SERIAL = 'LORA_USB_SERIAL',
  NONE = 'NONE',
}

export interface TransportState {
  cellularAvailable: boolean;
  cellularLatencyMs: number;
  loraMeshAvailable: boolean;
  usbSerialConnected: boolean;
  baudRate: number;
  radioBleDisabled: boolean;
  activeBearer: TransportBearer;
}

export interface UsbConnectResult {
  state: TransportState;
  adminCommand: string;
}

export interface PacketRouteResult {
  dispatched: boolean;
  bearerUsed: TransportBearer;
  payloadBytes: number;
  reason?: string;
}

const CELLULAR_TIMEOUT_THRESHOLD_MS = 2500;

export function createInitialTransportState(): TransportState {
  return {
    cellularAvailable: true,
    cellularLatencyMs: 85,
    loraMeshAvailable: true,
    usbSerialConnected: false,
    baudRate: 115200,
    radioBleDisabled: false,
    activeBearer: TransportBearer.CELLULAR_IP,
  };
}

/**
 * Kytkee Zero-RF USB-C Serial -yhteyden (115200 bps) ja muodostaa
 * admin-komennon LoRa-radion oman 2.4 GHz BLE-radion sammuttamiseksi.
 */
export function connectUsbSerial(
  state: TransportState,
  baudRate: number = 115200
): UsbConnectResult {
  return {
    state: {
      ...state,
      usbSerialConnected: true,
      baudRate,
      radioBleDisabled: true,
      activeBearer: TransportBearer.LORA_USB_SERIAL,
    },
    adminCommand: 'ADMIN_CMD:DISABLE_BLE_RADIO',
  };
}

export function disconnectUsbSerial(state: TransportState): TransportState {
  const nextBearer = state.cellularAvailable
    ? TransportBearer.CELLULAR_IP
    : TransportBearer.LORA_MESH_BLE;

  return {
    ...state,
    usbSerialConnected: false,
    radioBleDisabled: false,
    activeBearer: nextBearer,
  };
}

export function setCellularHealth(
  state: TransportState,
  available: boolean,
  latencyMs: number = 100
): TransportState {
  const healthy = available && latencyMs <= CELLULAR_TIMEOUT_THRESHOLD_MS;
  let nextBearer = state.activeBearer;

  if (state.usbSerialConnected) {
    nextBearer = TransportBearer.LORA_USB_SERIAL;
  } else if (healthy) {
    nextBearer = TransportBearer.CELLULAR_IP;
  } else if (state.loraMeshAvailable) {
    nextBearer = TransportBearer.LORA_MESH_BLE;
  } else {
    nextBearer = TransportBearer.NONE;
  }

  return {
    ...state,
    cellularAvailable: healthy,
    cellularLatencyMs: latencyMs,
    activeBearer: nextBearer,
  };
}

/**
 * Reitittää paketin aktiiviselle siirtoväylälle kunnioittaen EMCON-radiokuria.
 */
export function routeOutgoingPacket(
  transport: TransportState,
  emcon: EmconState,
  payload: Uint8Array
): PacketRouteResult {
  if (!canTransmitPacket(emcon)) {
    return {
      dispatched: false,
      bearerUsed: TransportBearer.NONE,
      payloadBytes: payload.byteLength,
      reason: 'EMCON_RX_ONLY_BLOCKED',
    };
  }

  if (transport.usbSerialConnected) {
    return {
      dispatched: true,
      bearerUsed: TransportBearer.LORA_USB_SERIAL,
      payloadBytes: payload.byteLength,
    };
  }

  if (
    transport.cellularAvailable &&
    transport.cellularLatencyMs <= CELLULAR_TIMEOUT_THRESHOLD_MS
  ) {
    return {
      dispatched: true,
      bearerUsed: TransportBearer.CELLULAR_IP,
      payloadBytes: payload.byteLength,
    };
  }

  if (transport.loraMeshAvailable) {
    return {
      dispatched: true,
      bearerUsed: TransportBearer.LORA_MESH_BLE,
      payloadBytes: payload.byteLength,
    };
  }

  return {
    dispatched: false,
    bearerUsed: TransportBearer.NONE,
    payloadBytes: payload.byteLength,
    reason: 'NO_AVAILABLE_BEARER',
  };
}

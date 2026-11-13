/**
 * Android USB-C OTG / USB-CDC -sarjaporttiajuri 868 MHz LoRa-radioille
 * (Heltec V3, RAK4631, LilyGO T-Beam).
 *
 * Tiedosto on puhdas: natiivi USB-kirjasto injektoidaan
 * `NativeUsbSerialModule`-rajapintana. Näin logiikka (laitetunnistus, luvat,
 * tilakone, kaapelin irrotus, pudotus loopbackiin) on testattavissa Jestissä
 * ilman natiivimoduuleja, ja Expo Go:ssa sovellus putoaa hallitusti
 * `LoopbackSerialDriver`-tilaan.
 *
 * `createUsbSerialportAdapter` sovittaa kirjaston
 * `react-native-usb-serialport-for-android` (0.5.x) UsbSerialManagerin tähän
 * rajapintaan. Kirjastoa ei ole vielä asennettu (vaatii Dev Buildin
 * uudelleenkäännöksen ja käyttäjän hyväksynnän, ks. tiketti #25).
 */

import {
  ISerialPortDriver,
  ListenerSet,
  LoopbackSerialDriver,
  SerialDataListener,
  SerialDriverKind,
  SerialDriverStatus,
  SerialOpenResult,
  SerialStatusListener,
} from './serialPortDriver';

// --- Natiivirajapinta -------------------------------------------------------

export interface UsbDeviceDescriptor {
  deviceId: number;
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
}

export interface SerialPortSettings {
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'odd' | 'even';
}

/** Meshtastic-laitteiden sarjaportti: 115200 bps, 8N1. */
export const LORA_SERIAL_SETTINGS: SerialPortSettings = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
};

export interface NativeSerialConnection {
  write(data: Uint8Array): Promise<void>;
  onData(listener: (chunk: Uint8Array) => void): () => void;
  /** Valinnainen: natiivikerroksen ilmoitus laitteen irrotuksesta. */
  onDisconnect?(listener: () => void): () => void;
  close(): Promise<void>;
}

export interface NativeUsbSerialModule {
  listDevices(): Promise<UsbDeviceDescriptor[]>;
  /** Androidin UsbManager.requestPermission – true, jos lupa on myönnetty. */
  requestPermission(deviceId: number): Promise<boolean>;
  open(deviceId: number, settings: SerialPortSettings): Promise<NativeSerialConnection>;
}

// --- Laitetunnistus (VID/PID) -----------------------------------------------

export type UsbChip =
  | 'CP210x'
  | 'CH34x/CH9102'
  | 'FTDI'
  | 'ESP32-S3 USB-CDC'
  | 'nRF52840'
  | 'UNKNOWN';

export interface UsbDeviceIdentity {
  supported: boolean;
  chip: UsbChip;
  boardHint: string;
}

interface ChipEntry {
  chip: Exclude<UsbChip, 'UNKNOWN'>;
  boardHint: string;
}

/** Yleisimpien LoRa-kehitysalustojen USB-piirit Vendor ID:n mukaan. */
export const LORA_USB_VENDORS: Record<number, ChipEntry> = {
  0x10c4: { chip: 'CP210x', boardHint: 'Heltec V3 / T-Beam' },
  0x1a86: { chip: 'CH34x/CH9102', boardHint: 'LilyGO T-Beam' },
  0x0403: { chip: 'FTDI', boardHint: 'FTDI USB-UART' },
  0x303a: { chip: 'ESP32-S3 USB-CDC', boardHint: 'ESP32-S3 (Heltec / T-Beam Supreme)' },
  0x239a: { chip: 'nRF52840', boardHint: 'RAK4631' },
};

const PRODUCT_NAME_HINTS: Array<{ pattern: RegExp; board: string }> = [
  { pattern: /rak\s*4631|wisblock|\brak\b/i, board: 'RAK4631' },
  { pattern: /t-?beam/i, board: 'LilyGO T-Beam' },
  { pattern: /heltec/i, board: 'Heltec V3' },
];

export function identifyUsbDevice(device: UsbDeviceDescriptor): UsbDeviceIdentity {
  const entry = LORA_USB_VENDORS[device.vendorId];
  if (!entry) return { supported: false, chip: 'UNKNOWN', boardHint: 'Tuntematon USB-laite' };

  const name = `${device.productName ?? ''} ${device.manufacturerName ?? ''}`;
  const hint = PRODUCT_NAME_HINTS.find((h) => h.pattern.test(name));
  return { supported: true, chip: entry.chip, boardHint: hint ? hint.board : entry.boardHint };
}

export function selectLoraDevice(
  devices: UsbDeviceDescriptor[],
): { device: UsbDeviceDescriptor; identity: UsbDeviceIdentity } | null {
  for (const device of devices) {
    const identity = identifyUsbDevice(device);
    if (identity.supported) return { device, identity };
  }
  return null;
}

export function formatDriverLabel(
  kind: SerialDriverKind,
  boardHint?: string,
  baudRate?: number,
  fallbackReason?: SerialDriverStatus,
): string {
  if (kind === 'USB_OTG') return `USB-OTG: ${boardHint ?? 'LoRa'} @ ${baudRate ?? LORA_SERIAL_SETTINGS.baudRate} bps`;
  return fallbackReason ? `LOOPBACK-SIM (${fallbackReason})` : 'LOOPBACK-SIM';
}

// --- Ajuri --------------------------------------------------------------------

export class AndroidUsbOtgDriver implements ISerialPortDriver {
  readonly kind: SerialDriverKind = 'USB_OTG';
  private status: SerialDriverStatus = 'IDLE';
  private connection: NativeSerialConnection | null = null;
  private identity: UsbDeviceIdentity | null = null;
  private unsubscribers: Array<() => void> = [];
  private readonly data = new ListenerSet<Uint8Array>();
  private readonly statusListeners = new ListenerSet<SerialDriverStatus>();

  constructor(
    private readonly native: NativeUsbSerialModule | null,
    private readonly settings: SerialPortSettings = LORA_SERIAL_SETTINGS,
  ) {}

  async open(): Promise<SerialOpenResult> {
    if (!this.native) return this.fail('NO_NATIVE_MODULE', 'Natiivia USB-sarjaporttikirjastoa ei ole (Expo Go).');

    let devices: UsbDeviceDescriptor[];
    try {
      devices = await this.native.listDevices();
    } catch (e) {
      return this.fail('ERROR', `USB-laitteiden listaus epäonnistui: ${errorText(e)}`);
    }
    if (devices.length === 0) return this.fail('NO_DEVICE', 'USB-OTG-laitetta ei ole kytketty.');

    const selected = selectLoraDevice(devices);
    if (!selected) return this.fail('UNSUPPORTED_DEVICE', 'Kytketty USB-laite ei ole tunnettu LoRa-radio.');

    try {
      const granted = await this.native.requestPermission(selected.device.deviceId);
      if (!granted) return this.fail('PERMISSION_DENIED', 'USB-lupaa ei myönnetty.');
    } catch (e) {
      return this.fail('PERMISSION_DENIED', `USB-luvan pyyntö epäonnistui: ${errorText(e)}`);
    }

    let conn: NativeSerialConnection;
    try {
      conn = await this.native.open(selected.device.deviceId, this.settings);
    } catch (e) {
      return this.fail('ERROR', `Sarjaportin avaus epäonnistui: ${errorText(e)}`);
    }

    this.connection = conn;
    this.identity = selected.identity;
    this.unsubscribers.push(
      conn.onData((chunk) => {
        if (this.status === 'CONNECTED') this.data.emit(chunk);
      }),
    );
    if (conn.onDisconnect) this.unsubscribers.push(conn.onDisconnect(() => this.markDisconnected()));
    this.setStatus('CONNECTED');
    return { ok: true, status: 'CONNECTED' };
  }

  async write(data: Uint8Array): Promise<boolean> {
    if (this.status !== 'CONNECTED' || !this.connection) return false;
    try {
      await this.connection.write(data);
      return true;
    } catch {
      // Kaapeli irrotettu kesken ajon: ei kaadeta sovellusta.
      this.markDisconnected();
      return false;
    }
  }

  onData(listener: SerialDataListener): () => void {
    return this.data.add(listener);
  }

  onStatusChange(listener: SerialStatusListener): () => void {
    return this.statusListeners.add(listener);
  }

  async close(): Promise<void> {
    const conn = this.connection;
    this.detach();
    if (conn) {
      try {
        await conn.close();
      } catch {
        // Laite on jo irti – sulku on silloin no-op.
      }
    }
    this.setStatus('DISCONNECTED');
  }

  getStatus(): SerialDriverStatus {
    return this.status;
  }

  getIdentity(): UsbDeviceIdentity | null {
    return this.identity;
  }

  getLabel(): string {
    return formatDriverLabel('USB_OTG', this.identity?.boardHint, this.settings.baudRate);
  }

  private markDisconnected(): void {
    this.detach();
    this.setStatus('DISCONNECTED');
  }

  private detach(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.connection = null;
  }

  private fail(status: SerialDriverStatus, message: string): SerialOpenResult {
    this.setStatus(status);
    return { ok: false, status, message };
  }

  private setStatus(next: SerialDriverStatus): void {
    if (next === this.status) return;
    this.status = next;
    this.statusListeners.emit(next);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- Yhdistäminen ja hallittu pudotus -------------------------------------------

export interface LoraSerialConnectResult {
  driver: ISerialPortDriver;
  /** CONNECTED tai syy, jonka vuoksi pudottiin loopbackiin. */
  status: SerialDriverStatus;
  fallback: boolean;
  label: string;
  message?: string;
}

/**
 * Yrittää fyysistä USB-OTG-radiota ja putoaa hallitusti
 * LoopbackSerialDriveriin. `capabilityMode` tulee nativeRuntime.ts:n
 * `resolveNativeCapability('usbSerial', ...)`-funktiosta.
 */
export async function connectLoraSerial(
  native: NativeUsbSerialModule | null,
  capabilityMode: 'native' | 'simulation',
): Promise<LoraSerialConnectResult> {
  let reason: SerialDriverStatus = 'NO_NATIVE_MODULE';
  let message: string | undefined = 'Natiivi USB-sarjaportti ei ole käytössä tässä ajoympäristössä.';

  if (capabilityMode === 'native' && native) {
    const otg = new AndroidUsbOtgDriver(native);
    const res = await otg.open();
    if (res.ok) return { driver: otg, status: res.status, fallback: false, label: otg.getLabel() };
    reason = res.status;
    message = res.message;
  }

  const loopback = new LoopbackSerialDriver(reason);
  await loopback.open();
  return {
    driver: loopback,
    status: reason,
    fallback: true,
    label: formatDriverLabel('LOOPBACK', undefined, undefined, reason),
    message,
  };
}

// --- Sovitin: react-native-usb-serialport-for-android ----------------------------

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out.toUpperCase();
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Kirjaston `UsbSerialManager`-rajapinta (tarkistettu paketin 0.5.0 .d.ts:stä). */
export interface UsbSerialportManagerLike {
  list(): Promise<Array<{ deviceId: number; vendorId: number; productId: number }>>;
  tryRequestPermission(deviceId: number): Promise<boolean>;
  open(
    deviceId: number,
    options: { baudRate: number; parity: number; dataBits: number; stopBits: number },
  ): Promise<{
    send(hexStr: string): Promise<unknown>;
    onReceived(listener: (event: { deviceId: number; data: string }) => void): { remove(): void };
    close(): Promise<unknown>;
  }>;
}

const PARITY_CODES: Record<SerialPortSettings['parity'], number> = { none: 0, odd: 1, even: 2 };

export function createUsbSerialportAdapter(manager: UsbSerialportManagerLike): NativeUsbSerialModule {
  return {
    listDevices: () => manager.list(),
    // Kirjasto palauttaa false, jos lupaa ei vielä ole ja dialogi avattiin:
    // käyttäjä hyväksyy dialogin ja painaa "Kytke USB-C" uudelleen.
    requestPermission: (deviceId) => manager.tryRequestPermission(deviceId),
    async open(deviceId, settings) {
      const serial = await manager.open(deviceId, {
        baudRate: settings.baudRate,
        parity: PARITY_CODES[settings.parity],
        dataBits: settings.dataBits,
        stopBits: settings.stopBits,
      });
      return {
        async write(data) {
          await serial.send(bytesToHex(data));
        },
        onData(listener) {
          const sub = serial.onReceived((event) => listener(hexToBytes(event.data)));
          return () => sub.remove();
        },
        async close() {
          await serial.close();
        },
      };
    },
  };
}

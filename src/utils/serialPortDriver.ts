/**
 * Abstrahoitu sarjaporttirajapinta LoRa-radioille (Meshtastic, 868 MHz).
 *
 * Meshtastic-silta (#24, `meshtasticSerialBridge.ts`) käyttää tätä
 * rajapintaa: se kirjoittaa kehystetyt tavut `write`-metodilla ja saa
 * vastaanotetun, mahdollisesti pilkkoutuneen tavuvirran `onData`-kuuntelijalle
 * muuttumattomana. Toteutukset:
 *  - `AndroidUsbOtgDriver` (androidUsbOtgDriver.ts): fyysinen USB-C OTG -radio
 *  - `LoopbackSerialDriver` (tämä tiedosto): deterministinen kaiku testeihin
 *    ja kehitykseen ilman kytkettyä radiota (Expo Go).
 */

export type SerialDriverKind = 'USB_OTG' | 'LOOPBACK';

export type SerialDriverStatus =
  | 'IDLE'
  | 'CONNECTED'
  | 'LOOPBACK'
  | 'DISCONNECTED'
  | 'NO_NATIVE_MODULE'
  | 'NO_DEVICE'
  | 'UNSUPPORTED_DEVICE'
  | 'PERMISSION_DENIED'
  | 'ERROR';

export interface SerialOpenResult {
  ok: boolean;
  status: SerialDriverStatus;
  message?: string;
}

export type SerialDataListener = (chunk: Uint8Array) => void;
export type SerialStatusListener = (status: SerialDriverStatus) => void;

export interface ISerialPortDriver {
  readonly kind: SerialDriverKind;
  open(): Promise<SerialOpenResult>;
  /** Palauttaa false (ei heitä), jos kirjoitus ei onnistu. */
  write(data: Uint8Array): Promise<boolean>;
  /** Palauttaa kuuntelijan poistofunktion. */
  onData(listener: SerialDataListener): () => void;
  onStatusChange(listener: SerialStatusListener): () => void;
  close(): Promise<void>;
  getStatus(): SerialDriverStatus;
  getLabel(): string;
}

/** Pieni apuri kuuntelijalistoille. */
export class ListenerSet<T> {
  private listeners: Array<(value: T) => void> = [];

  add(listener: (value: T) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(value: T): void {
    for (const l of [...this.listeners]) l(value);
  }

  clear(): void {
    this.listeners = [];
  }
}

export class LoopbackSerialDriver implements ISerialPortDriver {
  readonly kind: SerialDriverKind = 'LOOPBACK';
  private status: SerialDriverStatus = 'IDLE';
  private readonly data = new ListenerSet<Uint8Array>();
  private readonly statusListeners = new ListenerSet<SerialDriverStatus>();

  /** @param reason tilakoodi, jonka vuoksi loopbackiin pudottiin (näytetään tunnisteessa) */
  constructor(readonly fallbackReason?: SerialDriverStatus) {}

  async open(): Promise<SerialOpenResult> {
    this.setStatus('LOOPBACK');
    return { ok: true, status: 'LOOPBACK' };
  }

  async write(data: Uint8Array): Promise<boolean> {
    if (this.status !== 'LOOPBACK') return false;
    this.data.emit(new Uint8Array(data));
    return true;
  }

  onData(listener: SerialDataListener): () => void {
    return this.data.add(listener);
  }

  onStatusChange(listener: SerialStatusListener): () => void {
    return this.statusListeners.add(listener);
  }

  async close(): Promise<void> {
    this.setStatus('DISCONNECTED');
  }

  getStatus(): SerialDriverStatus {
    return this.status;
  }

  getLabel(): string {
    return 'LOOPBACK-SIM';
  }

  private setStatus(next: SerialDriverStatus): void {
    if (next === this.status) return;
    this.status = next;
    this.statusListeners.emit(next);
  }
}

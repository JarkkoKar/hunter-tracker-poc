/**
 * Meshtastic-sarjasilta (#24): 0x94 0xC3 -kehystys, minimaalinen protobuf-
 * koodaus, kättelyn tilakone, PRIVATE_APP-kapselointi ja Zero-RF-/hätätyhjennys-
 * admin-komennot. Puhdas TypeScript, ei natiiviriippuvuuksia.
 *
 * Kenttänumerot: github.com/meshtastic/protobufs (meshtastic/mesh.proto,
 * admin.proto, config.proto, channel.proto, portnums.proto).
 *  - ToRadio:      packet=1, want_config_id=3, disconnect=4
 *  - FromRadio:    packet=2, my_info=3, config_complete_id=7, rebooted=8
 *  - MeshPacket:   from=1 (fixed32), to=2 (fixed32), channel=3, decoded=4, id=6 (fixed32), want_ack=10
 *  - Data:         portnum=1, payload=2, want_response=3, request_id=6 (fixed32)
 *  - MyNodeInfo:   my_node_num=1
 *  - AdminMessage: get_config_request=5, get_config_response=6, set_channel=33,
 *                  set_config=34, session_passkey=101
 *  - Config:       bluetooth=7; BluetoothConfig: enabled=1
 *  - Channel:      index=1, settings=2, role=3 (PRIMARY=1); ChannelSettings: psk=2
 */
import { ISerialPortDriver, ListenerSet, SerialDriverStatus, SerialOpenResult } from './serialPortDriver';

export const MESHTASTIC_START1 = 0x94;
export const MESHTASTIC_START2 = 0xc3;
export const MESHTASTIC_MAX_PAYLOAD = 512;
export const MESHTASTIC_BAUD_RATE = 115200;
export const PORTNUM_TEXT_MESSAGE_APP = 1;
export const PORTNUM_ADMIN_APP = 6;
export const PORTNUM_PRIVATE_APP = 256;
export const BROADCAST_NODE_NUM = 0xffffffff;
/** AdminMessage.ConfigType.BLUETOOTH_CONFIG */
export const CONFIG_TYPE_BLUETOOTH = 6;
/** Channel.Role.PRIMARY */
export const CHANNEL_ROLE_PRIMARY = 1;

// ---------------------------------------------------------------------------
// Sarjakehys
// ---------------------------------------------------------------------------

export function encodeSerialFrame(payload: Uint8Array): Uint8Array {
  if (payload.length > MESHTASTIC_MAX_PAYLOAD) {
    throw new Error(`Meshtastic-hyötykuorma liian suuri: ${payload.length} > ${MESHTASTIC_MAX_PAYLOAD}`);
  }
  const out = new Uint8Array(payload.length + 4);
  out[0] = MESHTASTIC_START1;
  out[1] = MESHTASTIC_START2;
  out[2] = (payload.length >> 8) & 0xff;
  out[3] = payload.length & 0xff;
  out.set(payload, 4);
  return out;
}

/**
 * Puskuripurkain: yhdistää pilkkoutuneet tavuvirrat kokonaisiksi
 * protobuf-hyötykuormiksi. Kehysten väliin tuleva tavu (esim. radion
 * debug-lokiteksti) ohitetaan, ja virheellinen pituus aiheuttaa resynkronoinnin.
 */
export class MeshtasticFrameDecoder {
  private buf: number[] = [];

  push(chunk: Uint8Array): Uint8Array[] {
    for (let i = 0; i < chunk.length; i++) this.buf.push(chunk[i]);
    const out: Uint8Array[] = [];
    for (;;) {
      // Etsi otsikon ensimmäinen tavu.
      let start = this.buf.indexOf(MESHTASTIC_START1);
      if (start < 0) {
        this.buf = [];
        break;
      }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < 2) break;
      if (this.buf[1] !== MESHTASTIC_START2) {
        this.buf.shift();
        continue;
      }
      if (this.buf.length < 4) break;
      const len = (this.buf[2] << 8) | this.buf[3];
      if (len > MESHTASTIC_MAX_PAYLOAD) {
        this.buf.shift();
        continue;
      }
      if (this.buf.length < 4 + len) break;
      out.push(Uint8Array.from(this.buf.slice(4, 4 + len)));
      this.buf.splice(0, 4 + len);
    }
    return out;
  }

  reset(): void {
    this.buf = [];
  }
}

// ---------------------------------------------------------------------------
// Minimaalinen protobuf
// ---------------------------------------------------------------------------

const WT_VARINT = 0;
const WT_FIXED64 = 1;
const WT_LEN = 2;
const WT_FIXED32 = 5;

class PbWriter {
  private bytes: number[] = [];

  varint(value: number): this {
    let v = Math.floor(value);
    if (v < 0) throw new Error('Negatiivista varintia ei tueta');
    while (v >= 0x80) {
      this.bytes.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.bytes.push(v);
    return this;
  }

  tag(field: number, wireType: number): this {
    return this.varint(field * 8 + wireType);
  }

  uint(field: number, value: number): this {
    return this.tag(field, WT_VARINT).varint(value);
  }

  bool(field: number, value: boolean): this {
    return this.uint(field, value ? 1 : 0);
  }

  fixed32(field: number, value: number): this {
    const v = value >>> 0;
    this.tag(field, WT_FIXED32);
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }

  lenDelimited(field: number, data: Uint8Array): this {
    this.tag(field, WT_LEN).varint(data.length);
    for (let i = 0; i < data.length; i++) this.bytes.push(data[i]);
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

interface PbField {
  field: number;
  wireType: number;
  num?: number;
  bytes?: Uint8Array;
}

function readFields(buf: Uint8Array): PbField[] {
  const fields: PbField[] = [];
  let pos = 0;
  const readVarint = (): number => {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      if (pos >= buf.length) throw new Error('Katkennut varint');
      const b = buf[pos++];
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 0x80;
    }
    throw new Error('Liian pitkä varint');
  };
  while (pos < buf.length) {
    const key = readVarint();
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (field === 0) throw new Error('Virheellinen kenttänumero');
    if (wireType === WT_VARINT) {
      fields.push({ field, wireType, num: readVarint() });
    } else if (wireType === WT_FIXED32) {
      if (pos + 4 > buf.length) throw new Error('Katkennut fixed32');
      const v = (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
      pos += 4;
      fields.push({ field, wireType, num: v });
    } else if (wireType === WT_FIXED64) {
      if (pos + 8 > buf.length) throw new Error('Katkennut fixed64');
      fields.push({ field, wireType, bytes: buf.slice(pos, pos + 8) });
      pos += 8;
    } else if (wireType === WT_LEN) {
      const len = readVarint();
      if (pos + len > buf.length) throw new Error('Katkennut pituuskenttä');
      fields.push({ field, wireType, bytes: buf.slice(pos, pos + len) });
      pos += len;
    } else {
      throw new Error(`Tukematon wire type ${wireType}`);
    }
  }
  return fields;
}

function numField(fields: PbField[], field: number): number | undefined {
  const f = fields.filter((x) => x.field === field && x.num !== undefined).pop();
  return f?.num;
}

function bytesField(fields: PbField[], field: number): Uint8Array | undefined {
  const f = fields.filter((x) => x.field === field && x.wireType === WT_LEN).pop();
  return f?.bytes;
}

// ---------------------------------------------------------------------------
// MeshPacket / Data
// ---------------------------------------------------------------------------

export interface MeshData {
  portnum: number;
  payload: Uint8Array;
  wantResponse: boolean;
  requestId?: number;
}

export interface MeshPacketInfo {
  from: number;
  to: number;
  channel: number;
  id: number;
  decoded?: MeshData;
}

export interface MeshPacketInput {
  from?: number;
  to: number;
  id: number;
  channel?: number;
  portnum: number;
  payload: Uint8Array;
  wantResponse?: boolean;
  wantAck?: boolean;
  requestId?: number;
}

function encodeData(p: MeshPacketInput): Uint8Array {
  const w = new PbWriter().uint(1, p.portnum).lenDelimited(2, p.payload);
  if (p.wantResponse) w.bool(3, true);
  if (p.requestId) w.fixed32(6, p.requestId);
  return w.finish();
}

function encodeMeshPacket(p: MeshPacketInput): Uint8Array {
  const w = new PbWriter();
  if (p.from) w.fixed32(1, p.from);
  w.fixed32(2, p.to);
  if (p.channel) w.uint(3, p.channel);
  w.lenDelimited(4, encodeData(p));
  w.fixed32(6, p.id);
  if (p.wantAck) w.bool(10, true);
  return w.finish();
}

function decodeMeshPacket(buf: Uint8Array): MeshPacketInfo {
  const f = readFields(buf);
  const info: MeshPacketInfo = {
    from: numField(f, 1) ?? 0,
    to: numField(f, 2) ?? 0,
    channel: numField(f, 3) ?? 0,
    id: numField(f, 6) ?? 0,
  };
  const data = bytesField(f, 4);
  if (data) {
    const d = readFields(data);
    info.decoded = {
      portnum: numField(d, 1) ?? 0,
      payload: bytesField(d, 2) ?? new Uint8Array(0),
      wantResponse: (numField(d, 3) ?? 0) !== 0,
      requestId: numField(d, 6),
    };
  }
  return info;
}

// ---------------------------------------------------------------------------
// ToRadio / FromRadio
// ---------------------------------------------------------------------------

export interface ToRadioInfo {
  packet?: MeshPacketInfo;
  wantConfigId?: number;
  disconnect?: boolean;
}

export interface FromRadioInfo {
  packet?: MeshPacketInfo;
  myNodeNum?: number;
  configCompleteId?: number;
  rebooted?: boolean;
}

export function encodeToRadioWantConfig(nonce: number): Uint8Array {
  return new PbWriter().uint(3, nonce >>> 0).finish();
}

export function encodeToRadioDisconnect(): Uint8Array {
  return new PbWriter().bool(4, true).finish();
}

export function encodeToRadioPacket(p: MeshPacketInput): Uint8Array {
  return new PbWriter().lenDelimited(1, encodeMeshPacket(p)).finish();
}

/** Kapseloi 44 tavun E2EE-kehyksen (wireProtocol.ts) PRIVATE_APP-broadcastiksi. */
export function encodeToRadioPrivateApp(
  frame: Uint8Array,
  opts: { packetId: number; channel?: number; to?: number }
): Uint8Array {
  return encodeToRadioPacket({
    to: opts.to ?? BROADCAST_NODE_NUM,
    id: opts.packetId,
    channel: opts.channel,
    portnum: PORTNUM_PRIVATE_APP,
    payload: frame,
  });
}

export function decodeToRadio(buf: Uint8Array): ToRadioInfo {
  const f = readFields(buf);
  const out: ToRadioInfo = {};
  const pkt = bytesField(f, 1);
  if (pkt) out.packet = decodeMeshPacket(pkt);
  const want = f.find((x) => x.field === 3 && x.wireType === WT_VARINT);
  if (want) out.wantConfigId = want.num;
  const disc = f.find((x) => x.field === 4 && x.wireType === WT_VARINT);
  if (disc) out.disconnect = disc.num !== 0;
  return out;
}

export function decodeFromRadio(buf: Uint8Array): FromRadioInfo {
  const f = readFields(buf);
  const out: FromRadioInfo = {};
  const pkt = f.find((x) => x.field === 2 && x.wireType === WT_LEN);
  if (pkt?.bytes) out.packet = decodeMeshPacket(pkt.bytes);
  const myInfo = f.find((x) => x.field === 3 && x.wireType === WT_LEN);
  if (myInfo?.bytes) out.myNodeNum = numField(readFields(myInfo.bytes), 1);
  const done = f.find((x) => x.field === 7 && x.wireType === WT_VARINT);
  if (done) out.configCompleteId = done.num;
  const reb = f.find((x) => x.field === 8 && x.wireType === WT_VARINT);
  if (reb) out.rebooted = reb.num !== 0;
  return out;
}

// Radion suuntaiset viestit (simulaattori ja testit).
export function encodeFromRadioPacket(p: MeshPacketInput): Uint8Array {
  return new PbWriter().lenDelimited(2, encodeMeshPacket(p)).finish();
}

export function encodeFromRadioMyInfo(myNodeNum: number): Uint8Array {
  return new PbWriter().lenDelimited(3, new PbWriter().uint(1, myNodeNum >>> 0).finish()).finish();
}

export function encodeFromRadioConfigComplete(nonce: number): Uint8Array {
  return new PbWriter().uint(7, nonce >>> 0).finish();
}

export function encodeFromRadioRebooted(): Uint8Array {
  return new PbWriter().bool(8, true).finish();
}

// ---------------------------------------------------------------------------
// AdminMessage
// ---------------------------------------------------------------------------

export interface AdminMessageInfo {
  getConfigRequest?: number;
  /** set_config.bluetooth.enabled (vain jos set_config sisältää bluetooth-osan) */
  setBluetoothEnabled?: boolean;
  /** get_config_response.bluetooth.enabled */
  bluetoothEnabled?: boolean;
  setChannel?: { index: number; role: number; psk: number[] };
  sessionPasskey?: Uint8Array;
}

function withPasskey(w: PbWriter, passkey?: Uint8Array): Uint8Array {
  if (passkey && passkey.length > 0) w.lenDelimited(101, passkey);
  return w.finish();
}

export function encodeAdminGetBluetoothConfig(): Uint8Array {
  return new PbWriter().uint(5, CONFIG_TYPE_BLUETOOTH).finish();
}

/**
 * set_config: BluetoothConfig, jossa enabled=false. proto3 ei sarjallista
 * oletusarvoja, joten BluetoothConfig on tyhjä viesti (enabled=false,
 * mode=RANDOM_PIN, fixed_pin=0). Radio tallentaa asetuksen ja käynnistyy uudelleen.
 */
export function encodeAdminDisableBluetooth(passkey?: Uint8Array): Uint8Array {
  const config = new PbWriter().lenDelimited(7, new Uint8Array(0)).finish();
  return withPasskey(new PbWriter().lenDelimited(34, config), passkey);
}

/**
 * set_channel: kanavan 0 (PRIMARY) PSK korvataan uudella avaimella.
 * Tyhjä PSK tarkoittaisi Meshtasticissa salaamatonta kanavaa, joten se estetään.
 */
export function encodeAdminZeroizeChannel(newPsk: Uint8Array, passkey?: Uint8Array): Uint8Array {
  if (newPsk.length !== 16 && newPsk.length !== 32) {
    throw new Error('PSK:n pitää olla 16 tai 32 tavua (tyhjä PSK = salaamaton kanava)');
  }
  const settings = new PbWriter().lenDelimited(2, newPsk).finish();
  const channel = new PbWriter().lenDelimited(2, settings).uint(3, CHANNEL_ROLE_PRIMARY).finish();
  return withPasskey(new PbWriter().lenDelimited(33, channel), passkey);
}

/** get_config_response (radion vastaus, simulaattori ja testit). */
export function encodeAdminBluetoothConfigResponse(enabled: boolean, passkey?: Uint8Array): Uint8Array {
  const bt = new PbWriter();
  if (enabled) bt.bool(1, true);
  const config = new PbWriter().lenDelimited(7, bt.finish()).finish();
  return withPasskey(new PbWriter().lenDelimited(6, config), passkey);
}

export function decodeAdminMessage(buf: Uint8Array): AdminMessageInfo {
  const f = readFields(buf);
  const out: AdminMessageInfo = {};
  const getReq = f.find((x) => x.field === 5 && x.wireType === WT_VARINT);
  if (getReq) out.getConfigRequest = getReq.num;
  const readBt = (configBytes: Uint8Array | undefined): boolean | undefined => {
    if (!configBytes) return undefined;
    const bt = bytesField(readFields(configBytes), 7);
    if (!bt) return undefined;
    return (numField(readFields(bt), 1) ?? 0) !== 0;
  };
  const setBt = readBt(bytesField(f, 34));
  if (setBt !== undefined) out.setBluetoothEnabled = setBt;
  const respBt = readBt(bytesField(f, 6));
  if (respBt !== undefined) out.bluetoothEnabled = respBt;
  const ch = bytesField(f, 33);
  if (ch) {
    const cf = readFields(ch);
    const settings = bytesField(cf, 2);
    const psk = settings ? bytesField(readFields(settings), 2) : undefined;
    out.setChannel = {
      index: numField(cf, 1) ?? 0,
      role: numField(cf, 3) ?? 0,
      psk: Array.from(psk ?? new Uint8Array(0)),
    };
  }
  const pk = bytesField(f, 101);
  if (pk) out.sessionPasskey = pk;
  return out;
}

// ---------------------------------------------------------------------------
// Silta
// ---------------------------------------------------------------------------

export type MeshtasticLinkState = 'DISCONNECTED' | 'HANDSHAKING' | 'CONNECTED' | 'ERROR';
export type MeshtasticAdminResult =
  | 'SENT'
  | 'ALREADY_OFF'
  | 'NOT_CONNECTED'
  | 'NO_NODE_NUM'
  | 'WRITE_FAILED';

export interface MeshtasticCounters {
  framesSent: number;
  framesReceived: number;
}

export interface MeshtasticBridgeOptions {
  /** want_config_id-nonce (oletus satunnainen, ei 0). */
  nonce?: () => number;
  /** MeshPacket.id (oletus satunnainen, ei 0). */
  packetId?: () => number;
  /** Satunnaistavut uudelle PSK:lle. */
  randomBytes?: (n: number) => Uint8Array;
  handshakeTimeoutMs?: number;
  adminTimeoutMs?: number;
}

function randomUint32NonZero(): number {
  return (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
}

export function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(out);
    return out;
  }
  // Varakeino (ei kryptografisesti vahva): hätätyhjennyksen tarkoitus on
  // hävittää vanha avain, joten uusi avain ei saa olla vanha eikä tyhjä.
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

type Timer = ReturnType<typeof setTimeout>;

function unrefTimer(t: Timer): Timer {
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}

export class MeshtasticSerialBridge {
  private state: MeshtasticLinkState = 'DISCONNECTED';
  private readonly decoder = new MeshtasticFrameDecoder();
  private readonly stateListeners = new ListenerSet<MeshtasticLinkState>();
  private readonly privateAppListeners = new ListenerSet<Uint8Array>();
  private readonly counters: MeshtasticCounters = { framesSent: 0, framesReceived: 0 };
  private unsubscribers: Array<() => void> = [];
  private nonce = 0;
  private myNodeNum: number | undefined;
  private handshakeTimer: Timer | null = null;
  private pendingAdmin: { id: number; resolve: (m: AdminMessageInfo | null) => void; timer: Timer } | null = null;
  private bluetoothDisabled = false;
  private readonly opts: Required<MeshtasticBridgeOptions>;

  constructor(private readonly driver: ISerialPortDriver, opts: MeshtasticBridgeOptions = {}) {
    this.opts = {
      nonce: opts.nonce ?? randomUint32NonZero,
      packetId: opts.packetId ?? randomUint32NonZero,
      randomBytes: opts.randomBytes ?? defaultRandomBytes,
      handshakeTimeoutMs: opts.handshakeTimeoutMs ?? 8000,
      adminTimeoutMs: opts.adminTimeoutMs ?? 3000,
    };
  }

  getState(): MeshtasticLinkState {
    return this.state;
  }

  getMyNodeNum(): number | undefined {
    return this.myNodeNum;
  }

  getCounters(): MeshtasticCounters {
    return { ...this.counters };
  }

  isBluetoothDisabled(): boolean {
    return this.bluetoothDisabled;
  }

  getDriverLabel(): string {
    return this.driver.getLabel();
  }

  onStateChange(listener: (s: MeshtasticLinkState) => void): () => void {
    return this.stateListeners.add(listener);
  }

  /** Vastaanotetut PRIVATE_APP-hyötykuormat (44 tavun E2EE-kehykset). */
  onPrivateApp(listener: (payload: Uint8Array) => void): () => void {
    return this.privateAppListeners.add(listener);
  }

  /** Avaa ajurin tarvittaessa ja aloittaa want_config_id-kättelyn. */
  async connect(): Promise<MeshtasticLinkState> {
    this.detach();
    this.decoder.reset();
    this.unsubscribers.push(this.driver.onData((chunk) => this.handleData(chunk)));
    this.unsubscribers.push(this.driver.onStatusChange((s) => this.handleDriverStatus(s)));
    const status = this.driver.getStatus();
    if (status !== 'CONNECTED' && status !== 'LOOPBACK') {
      const res: SerialOpenResult = await this.driver.open();
      if (!res.ok) {
        this.setState('ERROR');
        return this.state;
      }
    }
    await this.startHandshake();
    return this.state;
  }

  async sendPrivateApp(frame: Uint8Array): Promise<boolean> {
    if (this.state !== 'CONNECTED') return false;
    return this.writeToRadio(encodeToRadioPrivateApp(frame, { packetId: this.opts.packetId() }));
  }

  /** Zero-RF: sammuttaa radion oman 2.4 GHz BLE-radion. */
  async disableBluetooth(): Promise<MeshtasticAdminResult> {
    const pre = this.adminPrecheck();
    if (pre) return pre;
    const info = await this.fetchBluetoothConfig();
    if (this.state !== 'CONNECTED') return 'NOT_CONNECTED';
    if (info?.bluetoothEnabled === false) {
      this.bluetoothDisabled = true;
      return 'ALREADY_OFF';
    }
    const ok = await this.sendAdmin(encodeAdminDisableBluetooth(info?.sessionPasskey), false);
    if (!ok) return 'WRITE_FAILED';
    this.bluetoothDisabled = true;
    return 'SENT';
  }

  /** Hätätyhjennys: kanavan 0 PSK korvataan satunnaisella 32 tavun avaimella. */
  async zeroizeChannelPsk(): Promise<MeshtasticAdminResult> {
    const pre = this.adminPrecheck();
    if (pre) return pre;
    const info = await this.fetchBluetoothConfig();
    if (this.state !== 'CONNECTED') return 'NOT_CONNECTED';
    const psk = this.opts.randomBytes(32);
    const ok = await this.sendAdmin(encodeAdminZeroizeChannel(psk, info?.sessionPasskey), false);
    return ok ? 'SENT' : 'WRITE_FAILED';
  }

  async close(): Promise<void> {
    if (this.state === 'CONNECTED' || this.state === 'HANDSHAKING') {
      await this.writeToRadio(encodeToRadioDisconnect());
    }
    this.detach();
    this.clearTimers();
    this.setState('DISCONNECTED');
    await this.driver.close();
  }

  // --- sisäiset ---------------------------------------------------------

  private adminPrecheck(): MeshtasticAdminResult | null {
    if (this.state !== 'CONNECTED') return 'NOT_CONNECTED';
    if (this.myNodeNum === undefined) return 'NO_NODE_NUM';
    return null;
  }

  private sendAdmin(admin: Uint8Array, wantResponse: boolean, packetId = this.opts.packetId()): Promise<boolean> {
    return this.writeToRadio(
      encodeToRadioPacket({
        to: this.myNodeNum ?? 0,
        id: packetId,
        portnum: PORTNUM_ADMIN_APP,
        payload: admin,
        wantResponse,
      })
    );
  }

  /** Hakee BluetoothConfigin; vastauksessa tulee session_passkey set-komentoja varten. */
  private fetchBluetoothConfig(): Promise<AdminMessageInfo | null> {
    if (this.pendingAdmin) {
      clearTimeout(this.pendingAdmin.timer);
      this.pendingAdmin.resolve(null);
      this.pendingAdmin = null;
    }
    const id = this.opts.packetId();
    const wait = new Promise<AdminMessageInfo | null>((resolve) => {
      const timer = unrefTimer(
        setTimeout(() => {
          if (this.pendingAdmin?.id === id) {
            this.pendingAdmin = null;
            resolve(null);
          }
        }, this.opts.adminTimeoutMs)
      );
      this.pendingAdmin = { id, resolve, timer };
    });
    // Kirjoitus käynnistetään synkronisesti, jotta vastaus ehtii kuuntelijaan.
    void this.sendAdmin(encodeAdminGetBluetoothConfig(), true, id).then((ok) => {
      if (!ok && this.pendingAdmin?.id === id) {
        const p = this.pendingAdmin;
        this.pendingAdmin = null;
        clearTimeout(p.timer);
        p.resolve(null);
      }
    });
    return wait;
  }

  private async startHandshake(): Promise<void> {
    this.clearHandshakeTimer();
    this.nonce = this.opts.nonce() >>> 0;
    const nonce = this.nonce;
    this.setState('HANDSHAKING');
    this.handshakeTimer = unrefTimer(
      setTimeout(() => {
        if (this.state === 'HANDSHAKING' && this.nonce === nonce) this.setState('ERROR');
      }, this.opts.handshakeTimeoutMs)
    );
    const ok = await this.writeToRadio(encodeToRadioWantConfig(nonce));
    if (!ok && this.state === 'HANDSHAKING' && this.nonce === nonce) {
      this.clearHandshakeTimer();
      this.setState('ERROR');
    }
  }

  private async writeToRadio(toRadio: Uint8Array): Promise<boolean> {
    let ok = false;
    try {
      ok = await this.driver.write(encodeSerialFrame(toRadio));
    } catch {
      ok = false;
    }
    if (ok) this.counters.framesSent++;
    return ok;
  }

  private handleData(chunk: Uint8Array): void {
    for (const payload of this.decoder.push(chunk)) {
      this.counters.framesReceived++;
      let msg: FromRadioInfo;
      try {
        msg = decodeFromRadio(payload);
      } catch {
        continue; // rikkinäinen protobuf ohitetaan
      }
      this.handleFromRadio(msg);
    }
  }

  private handleFromRadio(msg: FromRadioInfo): void {
    if (msg.rebooted && this.state !== 'DISCONNECTED') {
      void this.startHandshake();
      return;
    }
    if (msg.myNodeNum !== undefined) this.myNodeNum = msg.myNodeNum;
    if (msg.configCompleteId !== undefined && this.state === 'HANDSHAKING' && msg.configCompleteId === this.nonce) {
      this.clearHandshakeTimer();
      this.setState('CONNECTED');
    }
    const d = msg.packet?.decoded;
    if (!d) return;
    if (d.portnum === PORTNUM_PRIVATE_APP) {
      this.privateAppListeners.emit(new Uint8Array(d.payload));
    } else if (d.portnum === PORTNUM_ADMIN_APP && this.pendingAdmin) {
      if (d.requestId !== undefined && d.requestId !== this.pendingAdmin.id) return;
      let info: AdminMessageInfo;
      try {
        info = decodeAdminMessage(d.payload);
      } catch {
        return;
      }
      const p = this.pendingAdmin;
      this.pendingAdmin = null;
      clearTimeout(p.timer);
      p.resolve(info);
    }
  }

  private handleDriverStatus(status: SerialDriverStatus): void {
    if (status === 'DISCONNECTED') {
      this.clearTimers();
      this.setState('DISCONNECTED');
    } else if (status === 'ERROR') {
      this.clearTimers();
      this.setState('ERROR');
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private clearTimers(): void {
    this.clearHandshakeTimer();
    if (this.pendingAdmin) {
      const p = this.pendingAdmin;
      this.pendingAdmin = null;
      clearTimeout(p.timer);
      p.resolve(null);
    }
  }

  private detach(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }

  private setState(next: MeshtasticLinkState): void {
    if (next === this.state) return;
    this.state = next;
    this.stateListeners.emit(next);
  }
}

// ---------------------------------------------------------------------------
// Simuloitu radio (LOOPBACK-SIM, Expo Go ja testit)
// ---------------------------------------------------------------------------

/**
 * Deterministinen Meshtastic-radion simulaattori: vastaa kättelyyn
 * (my_info + config_complete_id), admin-pyyntöihin (session_passkey,
 * BluetoothConfig) ja kaiuttaa PRIVATE_APP-paketit takaisin ikään kuin ne
 * olisi vastaanotettu toiselta solmulta.
 */
export class MeshtasticRadioSimulator implements ISerialPortDriver {
  readonly kind = 'LOOPBACK' as const;
  static readonly NODE_NUM = 0x48540001;
  static readonly PEER_NODE_NUM = 0x48540002;
  private status: SerialDriverStatus = 'IDLE';
  private readonly data = new ListenerSet<Uint8Array>();
  private readonly statusListeners = new ListenerSet<SerialDriverStatus>();
  private readonly decoder = new MeshtasticFrameDecoder();
  private bluetoothEnabled = true;
  private channelPsk: Uint8Array = Uint8Array.from([1]);
  private readonly passkey = Uint8Array.from([0x53, 0x49, 0x4d, 0x31]);
  private nextId = 1;

  constructor(readonly fallbackReason?: SerialDriverStatus) {}

  async open(): Promise<SerialOpenResult> {
    this.setStatus('LOOPBACK');
    return { ok: true, status: 'LOOPBACK' };
  }

  async write(bytes: Uint8Array): Promise<boolean> {
    if (this.status !== 'LOOPBACK') return false;
    for (const payload of this.decoder.push(bytes)) {
      let msg: ToRadioInfo;
      try {
        msg = decodeToRadio(payload);
      } catch {
        continue;
      }
      this.handle(msg);
    }
    return true;
  }

  onData(listener: (chunk: Uint8Array) => void): () => void {
    return this.data.add(listener);
  }

  onStatusChange(listener: (s: SerialDriverStatus) => void): () => void {
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

  isBluetoothEnabled(): boolean {
    return this.bluetoothEnabled;
  }

  getChannelPsk(): Uint8Array {
    return new Uint8Array(this.channelPsk);
  }

  private emit(fromRadio: Uint8Array): void {
    this.data.emit(encodeSerialFrame(fromRadio));
  }

  private handle(msg: ToRadioInfo): void {
    if (msg.wantConfigId !== undefined) {
      this.emit(encodeFromRadioMyInfo(MeshtasticRadioSimulator.NODE_NUM));
      this.emit(encodeFromRadioConfigComplete(msg.wantConfigId));
      return;
    }
    const pkt = msg.packet;
    const d = pkt?.decoded;
    if (!pkt || !d) return;
    if (d.portnum === PORTNUM_PRIVATE_APP) {
      this.emit(
        encodeFromRadioPacket({
          from: MeshtasticRadioSimulator.PEER_NODE_NUM,
          to: BROADCAST_NODE_NUM,
          id: this.nextId++,
          portnum: PORTNUM_PRIVATE_APP,
          payload: d.payload,
        })
      );
    } else if (d.portnum === PORTNUM_ADMIN_APP) {
      const admin = decodeAdminMessage(d.payload);
      if (admin.getConfigRequest === CONFIG_TYPE_BLUETOOTH) {
        this.emit(
          encodeFromRadioPacket({
            from: MeshtasticRadioSimulator.NODE_NUM,
            to: MeshtasticRadioSimulator.NODE_NUM,
            id: this.nextId++,
            portnum: PORTNUM_ADMIN_APP,
            payload: encodeAdminBluetoothConfigResponse(this.bluetoothEnabled, this.passkey),
            requestId: pkt.id,
          })
        );
      } else if (admin.setBluetoothEnabled !== undefined) {
        this.bluetoothEnabled = admin.setBluetoothEnabled;
        // Oikea radio tallentaa asetuksen ja käynnistyy uudelleen.
        this.emit(encodeFromRadioRebooted());
      } else if (admin.setChannel) {
        this.channelPsk = Uint8Array.from(admin.setChannel.psk);
      }
    }
  }

  private setStatus(next: SerialDriverStatus): void {
    if (next === this.status) return;
    this.status = next;
    this.statusListeners.emit(next);
  }
}

// ---------------------------------------------------------------------------
// Siirtokortin tilarivi
// ---------------------------------------------------------------------------

export function describeMeshtasticLink(link: {
  state: MeshtasticLinkState;
  framesSent: number;
  framesReceived: number;
}): string {
  const parts = [`Meshtastic: ${link.state}`];
  if (link.state === 'CONNECTED') parts.push('PRIVATE_APP');
  parts.push(`TX ${link.framesSent} / RX ${link.framesReceived}`);
  return parts.join(' | ');
}

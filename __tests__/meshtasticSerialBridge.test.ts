import { describe, it, expect, jest } from '@jest/globals';
import {
  MESHTASTIC_START1,
  MESHTASTIC_START2,
  MESHTASTIC_MAX_PAYLOAD,
  PORTNUM_PRIVATE_APP,
  PORTNUM_ADMIN_APP,
  BROADCAST_NODE_NUM,
  encodeSerialFrame,
  MeshtasticFrameDecoder,
  encodeToRadioWantConfig,
  encodeToRadioPrivateApp,
  decodeToRadio,
  decodeFromRadio,
  encodeFromRadioPacket,
  encodeFromRadioConfigComplete,
  encodeFromRadioMyInfo,
  encodeFromRadioRebooted,
  encodeAdminGetBluetoothConfig,
  encodeAdminDisableBluetooth,
  encodeAdminZeroizeChannel,
  decodeAdminMessage,
  encodeAdminBluetoothConfigResponse,
  MeshtasticSerialBridge,
  MeshtasticRadioSimulator,
  describeMeshtasticLink,
} from '../src/utils/meshtasticSerialBridge';
import { ListenerSet, ISerialPortDriver, SerialDriverStatus } from '../src/utils/serialPortDriver';
import { encodeEncryptedFrame, decodeAndVerifyFrame, PacketType } from '../src/utils/wireProtocol';

const KEY = 'TEST-KEY-1234';

function sampleFrame(): Uint8Array {
  return encodeEncryptedFrame(
    {
      senderId: 7,
      packetType: PacketType.POSITION,
      latitude: 61.015,
      longitude: 24.535,
      statusCode: 3,
      timestampSec: 1794652000,
    },
    KEY
  );
}

/** Ajuri, joka tallentaa kirjoitukset ja jolla testi voi syöttää tavuja. */
class RecordingDriver implements ISerialPortDriver {
  readonly kind = 'USB_OTG' as const;
  written: Uint8Array[] = [];
  private status: SerialDriverStatus = 'IDLE';
  private readonly data = new ListenerSet<Uint8Array>();
  private readonly statusL = new ListenerSet<SerialDriverStatus>();
  failWrites = false;
  async open() {
    this.status = 'CONNECTED';
    this.statusL.emit('CONNECTED');
    return { ok: true, status: 'CONNECTED' as SerialDriverStatus };
  }
  async write(d: Uint8Array) {
    if (this.failWrites) return false;
    this.written.push(new Uint8Array(d));
    return true;
  }
  onData(l: (c: Uint8Array) => void) {
    return this.data.add(l);
  }
  onStatusChange(l: (s: SerialDriverStatus) => void) {
    return this.statusL.add(l);
  }
  async close() {
    this.status = 'DISCONNECTED';
    this.statusL.emit('DISCONNECTED');
  }
  getStatus() {
    return this.status;
  }
  getLabel() {
    return 'TEST';
  }
  feed(bytes: Uint8Array) {
    this.data.emit(bytes);
  }
  unplug() {
    this.status = 'DISCONNECTED';
    this.statusL.emit('DISCONNECTED');
  }
  /** Puretaan kaikki kirjoitetut ToRadio-viestit. */
  toRadios() {
    const dec = new MeshtasticFrameDecoder();
    return this.written.flatMap((w) => dec.push(w)).map((p) => decodeToRadio(p));
  }
}

describe('Meshtastic-sarjakehys 0x94 0xC3', () => {
  it('pakkaa otsikon ja big-endian-pituuden', () => {
    const payload = new Uint8Array(300).fill(0xab);
    const frame = encodeSerialFrame(payload);
    expect(frame[0]).toBe(0x94);
    expect(frame[1]).toBe(0xc3);
    expect(MESHTASTIC_START1).toBe(0x94);
    expect(MESHTASTIC_START2).toBe(0xc3);
    expect(frame[2]).toBe(0x01);
    expect(frame[3]).toBe(0x2c);
    expect(frame.length).toBe(304);
  });

  it('hylkää yli 512 tavun hyötykuorman', () => {
    expect(MESHTASTIC_MAX_PAYLOAD).toBe(512);
    expect(() => encodeSerialFrame(new Uint8Array(513))).toThrow();
  });

  it('yhdistää pilkkoutuneen tavuvirran ja ohittaa debug-tekstin', () => {
    const a = encodeSerialFrame(Uint8Array.from([1, 2, 3]));
    const b = encodeSerialFrame(Uint8Array.from([9, 8]));
    const noise = new TextEncoder().encode('INFO | boot ok\r\n');
    const stream = new Uint8Array([...noise, ...a, ...noise, ...b]);
    const dec = new MeshtasticFrameDecoder();
    const out: Uint8Array[] = [];
    for (let i = 0; i < stream.length; i++) out.push(...dec.push(stream.subarray(i, i + 1)));
    expect(out.map((p) => Array.from(p))).toEqual([[1, 2, 3], [9, 8]]);
  });

  it('resynkronoi, jos pituuskenttä on virheellinen (> 512)', () => {
    const good = encodeSerialFrame(Uint8Array.from([5]));
    const bad = Uint8Array.from([0x94, 0xc3, 0x7f, 0xff]);
    const dec = new MeshtasticFrameDecoder();
    const out = dec.push(new Uint8Array([...bad, ...good]));
    expect(out.map((p) => Array.from(p))).toEqual([[5]]);
  });

  it('palauttaa useita kehyksiä yhdestä palasta', () => {
    const a = encodeSerialFrame(Uint8Array.from([1]));
    const b = encodeSerialFrame(Uint8Array.from([2]));
    const dec = new MeshtasticFrameDecoder();
    expect(dec.push(new Uint8Array([...a, ...b])).length).toBe(2);
  });
});

describe('PRIVATE_APP-kapselointi', () => {
  it('44 tavun E2EE-kehys kulkee ToRadio-paketissa muuttumattomana', () => {
    const frame = sampleFrame();
    expect(frame.length).toBe(44);
    const toRadio = encodeToRadioPrivateApp(frame, { packetId: 0x1234 });
    const decoded = decodeToRadio(toRadio);
    expect(decoded.packet).toBeDefined();
    expect(decoded.packet!.to).toBe(BROADCAST_NODE_NUM);
    expect(decoded.packet!.id).toBe(0x1234);
    expect(decoded.packet!.decoded!.portnum).toBe(PORTNUM_PRIVATE_APP);
    expect(PORTNUM_PRIVATE_APP).toBe(256);
    expect(Array.from(decoded.packet!.decoded!.payload)).toEqual(Array.from(frame));
    const back = decodeAndVerifyFrame(decoded.packet!.decoded!.payload, KEY);
    expect(back.valid).toBe(true);
    expect(back.payload!.senderId).toBe(7);
  });

  it('FromRadio-paketin PRIVATE_APP-hyötykuorma puretaan', () => {
    const frame = sampleFrame();
    const fr = decodeFromRadio(
      encodeFromRadioPacket({ from: 0xa1b2c3d4, to: BROADCAST_NODE_NUM, id: 5, portnum: PORTNUM_PRIVATE_APP, payload: frame })
    );
    expect(fr.packet!.from).toBe(0xa1b2c3d4);
    expect(Array.from(fr.packet!.decoded!.payload)).toEqual(Array.from(frame));
  });

  it('want_config_id koodautuu kenttään 3', () => {
    expect(decodeToRadio(encodeToRadioWantConfig(424242)).wantConfigId).toBe(424242);
    expect(decodeToRadio(encodeToRadioWantConfig(0xfffffffe)).wantConfigId).toBe(0xfffffffe);
  });

  it('FromRadio: my_info, config_complete_id ja rebooted', () => {
    expect(decodeFromRadio(encodeFromRadioMyInfo(0x11223344)).myNodeNum).toBe(0x11223344);
    expect(decodeFromRadio(encodeFromRadioConfigComplete(77)).configCompleteId).toBe(77);
    expect(decodeFromRadio(encodeFromRadioRebooted()).rebooted).toBe(true);
  });
});

describe('AdminMessage (ADMIN_APP)', () => {
  it('get_config_request(BLUETOOTH_CONFIG = 6)', () => {
    const msg = decodeAdminMessage(encodeAdminGetBluetoothConfig());
    expect(msg.getConfigRequest).toBe(6);
  });

  it('set_config.bluetooth.enabled = false session_passkeyllä', () => {
    const pk = Uint8Array.from([1, 2, 3, 4]);
    const msg = decodeAdminMessage(encodeAdminDisableBluetooth(pk));
    expect(msg.setBluetoothEnabled).toBe(false);
    expect(Array.from(msg.sessionPasskey!)).toEqual([1, 2, 3, 4]);
  });

  it('set_channel: indeksi 0, PRIMARY, uusi 32 tavun PSK (ei tyhjä)', () => {
    const psk = new Uint8Array(32).fill(0x5a);
    const msg = decodeAdminMessage(encodeAdminZeroizeChannel(psk));
    expect(msg.setChannel).toEqual({ index: 0, role: 1, psk: Array.from(psk) });
    expect(() => encodeAdminZeroizeChannel(new Uint8Array(0))).toThrow();
  });

  it('get_config_response tulkitaan (passkey + bluetooth.enabled)', () => {
    const msg = decodeAdminMessage(encodeAdminBluetoothConfigResponse(true, Uint8Array.from([9, 9])));
    expect(msg.bluetoothEnabled).toBe(true);
    expect(Array.from(msg.sessionPasskey!)).toEqual([9, 9]);
  });
});

describe('MeshtasticSerialBridge: kättely ja tilakone', () => {
  it('lähettää want_config_id:n ja siirtyy CONNECTED-tilaan oikealla noncella', async () => {
    const drv = new RecordingDriver();
    const bridge = new MeshtasticSerialBridge(drv, { nonce: () => 1000 });
    const states: string[] = [];
    bridge.onStateChange((s) => states.push(s));
    expect(bridge.getState()).toBe('DISCONNECTED');
    await bridge.connect();
    expect(bridge.getState()).toBe('HANDSHAKING');
    expect(drv.toRadios()[0].wantConfigId).toBe(1000);

    drv.feed(encodeSerialFrame(encodeFromRadioMyInfo(0xdeadbeef)));
    drv.feed(encodeSerialFrame(encodeFromRadioConfigComplete(999))); // väärä nonce
    expect(bridge.getState()).toBe('HANDSHAKING');
    drv.feed(encodeSerialFrame(encodeFromRadioConfigComplete(1000)));
    expect(bridge.getState()).toBe('CONNECTED');
    expect(bridge.getMyNodeNum()).toBe(0xdeadbeef);
    expect(states).toEqual(['HANDSHAKING', 'CONNECTED']);
  });

  it('kättelyn aikakatkaisu -> ERROR', async () => {
    jest.useFakeTimers();
    try {
      const drv = new RecordingDriver();
      const bridge = new MeshtasticSerialBridge(drv, { nonce: () => 1, handshakeTimeoutMs: 5000 });
      await bridge.connect();
      jest.advanceTimersByTime(5001);
      expect(bridge.getState()).toBe('ERROR');
    } finally {
      jest.useRealTimers();
    }
  });

  it('radion uudelleenkäynnistys (rebooted) aloittaa kättelyn alusta', async () => {
    const drv = new RecordingDriver();
    let n = 10;
    const bridge = new MeshtasticSerialBridge(drv, { nonce: () => n++ });
    await bridge.connect();
    drv.feed(encodeSerialFrame(encodeFromRadioConfigComplete(10)));
    expect(bridge.getState()).toBe('CONNECTED');
    drv.feed(encodeSerialFrame(encodeFromRadioRebooted()));
    expect(bridge.getState()).toBe('HANDSHAKING');
    const wants = drv.toRadios().filter((t) => t.wantConfigId !== undefined).map((t) => t.wantConfigId);
    expect(wants).toEqual([10, 11]);
  });

  it('kaapelin irrotus -> DISCONNECTED ilman kaatumista', async () => {
    const drv = new RecordingDriver();
    const bridge = new MeshtasticSerialBridge(drv, { nonce: () => 1 });
    await bridge.connect();
    drv.feed(encodeSerialFrame(encodeFromRadioConfigComplete(1)));
    drv.unplug();
    expect(bridge.getState()).toBe('DISCONNECTED');
    expect(await bridge.sendPrivateApp(sampleFrame())).toBe(false);
  });

  it('PRIVATE_APP-lähetys ja -vastaanotto sekä kehyslaskurit', async () => {
    const drv = new RecordingDriver();
    const bridge = new MeshtasticSerialBridge(drv, { nonce: () => 1 });
    const received: Uint8Array[] = [];
    bridge.onPrivateApp((p) => received.push(p));
    expect(await bridge.sendPrivateApp(sampleFrame())).toBe(false); // ei vielä yhdistetty
    await bridge.connect();
    drv.feed(encodeSerialFrame(encodeFromRadioConfigComplete(1)));
    expect(await bridge.sendPrivateApp(sampleFrame())).toBe(true);
    const sent = drv.toRadios().find((t) => t.packet)!;
    expect(sent.packet!.decoded!.portnum).toBe(PORTNUM_PRIVATE_APP);

    const frame = sampleFrame();
    drv.feed(encodeSerialFrame(encodeFromRadioPacket({ from: 3, to: BROADCAST_NODE_NUM, id: 9, portnum: PORTNUM_PRIVATE_APP, payload: frame })));
    drv.feed(encodeSerialFrame(encodeFromRadioPacket({ from: 3, to: BROADCAST_NODE_NUM, id: 10, portnum: 1, payload: Uint8Array.from([65]) })));
    expect(received.length).toBe(1);
    expect(Array.from(received[0])).toEqual(Array.from(frame));
    const c = bridge.getCounters();
    expect(c.framesSent).toBe(2); // want_config + packet
    expect(c.framesReceived).toBe(3); // config_complete + 2 packets
  });
});

describe('MeshtasticSerialBridge: Zero-RF ja hätätyhjennys', () => {
  async function connected() {
    const drv = new RecordingDriver();
    let id = 500;
    const bridge = new MeshtasticSerialBridge(drv, {
      nonce: () => 1,
      packetId: () => id++,
      randomBytes: (n) => new Uint8Array(n).fill(0x42),
      adminTimeoutMs: 50,
    });
    await bridge.connect();
    drv.feed(encodeSerialFrame(encodeFromRadioMyInfo(0x0a0b0c0d)));
    drv.feed(encodeSerialFrame(encodeFromRadioConfigComplete(1)));
    return { drv, bridge };
  }

  function adminReply(drv: RecordingDriver, enabled: boolean, requestId: number) {
    const payload = encodeAdminBluetoothConfigResponse(enabled, Uint8Array.from([7, 7, 7]));
    drv.feed(
      encodeSerialFrame(
        encodeFromRadioPacket({ from: 0x0a0b0c0d, to: 0x0a0b0c0d, id: 1, portnum: PORTNUM_ADMIN_APP, payload, requestId })
      )
    );
  }

  it('BLE pois: get_config -> passkey -> set_config.bluetooth.enabled=false omalle solmulle', async () => {
    const { drv, bridge } = await connected();
    const p = bridge.disableBluetooth();
    const get = drv.toRadios().filter((t) => t.packet).pop()!;
    expect(get.packet!.to).toBe(0x0a0b0c0d);
    expect(get.packet!.decoded!.portnum).toBe(PORTNUM_ADMIN_APP);
    expect(get.packet!.decoded!.wantResponse).toBe(true);
    expect(decodeAdminMessage(get.packet!.decoded!.payload).getConfigRequest).toBe(6);
    adminReply(drv, true, get.packet!.id);
    const res = await p;
    expect(res).toBe('SENT');
    const set = drv.toRadios().filter((t) => t.packet).pop()!;
    const admin = decodeAdminMessage(set.packet!.decoded!.payload);
    expect(admin.setBluetoothEnabled).toBe(false);
    expect(Array.from(admin.sessionPasskey!)).toEqual([7, 7, 7]);
    expect(bridge.isBluetoothDisabled()).toBe(true);
  });

  it('BLE jo pois -> set_config ohitetaan (ei uudelleenkäynnistyssilmukkaa)', async () => {
    const { drv, bridge } = await connected();
    const p = bridge.disableBluetooth();
    const get = drv.toRadios().filter((t) => t.packet).pop()!;
    adminReply(drv, false, get.packet!.id);
    expect(await p).toBe('ALREADY_OFF');
    const sets = drv.toRadios().filter((t) => t.packet && decodeAdminMessage(t.packet.decoded!.payload).setBluetoothEnabled !== undefined);
    expect(sets.length).toBe(0);
    expect(bridge.isBluetoothDisabled()).toBe(true);
  });

  it('ei vastausta -> komento lähetetään ilman passkeytä', async () => {
    const { drv, bridge } = await connected();
    expect(await bridge.disableBluetooth()).toBe('SENT');
    const set = drv.toRadios().filter((t) => t.packet).pop()!;
    const admin = decodeAdminMessage(set.packet!.decoded!.payload);
    expect(admin.setBluetoothEnabled).toBe(false);
    expect(admin.sessionPasskey).toBeUndefined();
  });

  it('ZEROIZE: kanavan 0 PSK korvataan satunnaisavaimella sarjaportin kautta', async () => {
    const { drv, bridge } = await connected();
    const p = bridge.zeroizeChannelPsk();
    const get = drv.toRadios().filter((t) => t.packet).pop()!;
    adminReply(drv, false, get.packet!.id);
    expect(await p).toBe('SENT');
    const set = drv.toRadios().filter((t) => t.packet).pop()!;
    const admin = decodeAdminMessage(set.packet!.decoded!.payload);
    expect(admin.setChannel).toEqual({ index: 0, role: 1, psk: new Array(32).fill(0x42) });
  });

  it('kirjoitusvirhe kesken admin-komennon ei jää roikkumaan', async () => {
    const { drv, bridge } = await connected();
    drv.failWrites = true;
    expect(await bridge.disableBluetooth()).toBe('WRITE_FAILED');
    expect(bridge.isBluetoothDisabled()).toBe(false);
  });

  it('admin-komento ilman yhteyttä palauttaa NOT_CONNECTED', async () => {
    const bridge = new MeshtasticSerialBridge(new RecordingDriver(), { nonce: () => 1 });
    expect(await bridge.disableBluetooth()).toBe('NOT_CONNECTED');
    expect(await bridge.zeroizeChannelPsk()).toBe('NOT_CONNECTED');
  });
});

describe('MeshtasticRadioSimulator (LOOPBACK-SIM)', () => {
  it('kättely, BLE pois ja PRIVATE_APP-kaiku toimivat päästä päähän', async () => {
    const sim = new MeshtasticRadioSimulator();
    const bridge = new MeshtasticSerialBridge(sim, { nonce: () => 31337 });
    const rx: Uint8Array[] = [];
    bridge.onPrivateApp((p) => rx.push(p));
    await bridge.connect();
    expect(bridge.getState()).toBe('CONNECTED');
    expect(sim.getLabel()).toBe('LOOPBACK-SIM');
    expect(await bridge.disableBluetooth()).toBe('SENT');
    expect(sim.isBluetoothEnabled()).toBe(false);
    const frame = sampleFrame();
    expect(await bridge.sendPrivateApp(frame)).toBe(true);
    expect(Array.from(rx[0])).toEqual(Array.from(frame));
    expect(await bridge.zeroizeChannelPsk()).toBe('SENT');
    expect(sim.getChannelPsk().length).toBe(32);
    await bridge.close();
    expect(bridge.getState()).toBe('DISCONNECTED');
  });
});

describe('describeMeshtasticLink', () => {
  it('muodostaa siirtokortin tilarivin', () => {
    expect(
      describeMeshtasticLink({ state: 'CONNECTED', framesSent: 3, framesReceived: 5 })
    ).toBe('Meshtastic: CONNECTED | PRIVATE_APP | TX 3 / RX 5');
    expect(
      describeMeshtasticLink({ state: 'HANDSHAKING', framesSent: 1, framesReceived: 0 })
    ).toBe('Meshtastic: HANDSHAKING | TX 1 / RX 0');
  });
});

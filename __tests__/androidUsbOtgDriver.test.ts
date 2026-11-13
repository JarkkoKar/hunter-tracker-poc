import { describe, it, expect } from '@jest/globals';
import {
  LoopbackSerialDriver,
  ISerialPortDriver,
} from '../src/utils/serialPortDriver';
import {
  LORA_SERIAL_SETTINGS,
  identifyUsbDevice,
  selectLoraDevice,
  AndroidUsbOtgDriver,
  NativeUsbSerialModule,
  NativeSerialConnection,
  UsbDeviceDescriptor,
  connectLoraSerial,
  formatDriverLabel,
  bytesToHex,
  hexToBytes,
  createUsbSerialportAdapter,
} from '../src/utils/androidUsbOtgDriver';

// --- Testiapurit -----------------------------------------------------------

const HELTEC_V3: UsbDeviceDescriptor = {
  deviceId: 1001,
  vendorId: 0x10c4,
  productId: 0xea60,
  productName: 'CP2102 USB to UART Bridge Controller',
};
const RAK4631: UsbDeviceDescriptor = { deviceId: 1002, vendorId: 0x239a, productId: 0x8029 };
const TBEAM_CH9102: UsbDeviceDescriptor = { deviceId: 1003, vendorId: 0x1a86, productId: 0x55d4 };
const UNKNOWN_MOUSE: UsbDeviceDescriptor = { deviceId: 1004, vendorId: 0x046d, productId: 0xc077 };

interface FakeConnection extends NativeSerialConnection {
  written: Uint8Array[];
  emit(chunk: Uint8Array): void;
  unplug(): void;
  closed: boolean;
}

function fakeConnection(): FakeConnection {
  const listeners: Array<(c: Uint8Array) => void> = [];
  let unplugged = false;
  const conn: FakeConnection = {
    written: [],
    closed: false,
    async write(data: Uint8Array) {
      if (unplugged) throw new Error('SEND_FAILED: device detached');
      conn.written.push(new Uint8Array(data));
    },
    onData(cb) {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    async close() {
      if (unplugged) throw new Error('DEVICE_NOT_OPEN_OR_CLOSED');
      conn.closed = true;
    },
    emit(chunk) {
      listeners.forEach((l) => l(chunk));
    },
    unplug() {
      unplugged = true;
    },
  };
  return conn;
}

function fakeNative(opts: {
  devices?: UsbDeviceDescriptor[];
  permission?: boolean;
  openFails?: boolean;
  connection?: FakeConnection;
}) {
  const calls = { permission: [] as number[], open: [] as Array<{ id: number; s: unknown }> };
  const conn = opts.connection ?? fakeConnection();
  const native: NativeUsbSerialModule = {
    async listDevices() {
      return opts.devices ?? [];
    },
    async requestPermission(deviceId) {
      calls.permission.push(deviceId);
      return opts.permission ?? true;
    },
    async open(deviceId, settings) {
      calls.open.push({ id: deviceId, s: settings });
      if (opts.openFails) throw new Error('OPEN_FAILED');
      return conn;
    },
  };
  return { native, calls, conn };
}

// --- Laitetunnistus ---------------------------------------------------------

describe('identifyUsbDevice – VID/PID-tunnistus', () => {
  it('tunnistaa Heltec V3:n CP210x-piirin', () => {
    const id = identifyUsbDevice(HELTEC_V3);
    expect(id.supported).toBe(true);
    expect(id.chip).toBe('CP210x');
    expect(id.boardHint).toContain('Heltec');
  });

  it('tunnistaa RAK4631:n (nRF52840, VID 0x239A)', () => {
    const id = identifyUsbDevice(RAK4631);
    expect(id.supported).toBe(true);
    expect(id.chip).toBe('nRF52840');
    expect(id.boardHint).toBe('RAK4631');
  });

  it('tunnistaa LilyGO T-Beamin CH9102-piirin (VID 0x1A86)', () => {
    const id = identifyUsbDevice(TBEAM_CH9102);
    expect(id.supported).toBe(true);
    expect(id.chip).toBe('CH34x/CH9102');
    expect(id.boardHint).toContain('T-Beam');
  });

  it('tunnistaa FTDI- ja Espressif USB-CDC -piirit', () => {
    expect(identifyUsbDevice({ deviceId: 1, vendorId: 0x0403, productId: 0x6001 }).chip).toBe('FTDI');
    expect(identifyUsbDevice({ deviceId: 2, vendorId: 0x303a, productId: 0x1001 }).chip).toBe(
      'ESP32-S3 USB-CDC',
    );
  });

  it('käyttää tuotenimeä tarkentamaan levyn', () => {
    const id = identifyUsbDevice({ ...TBEAM_CH9102, productName: 'RAK4631 Meshtastic' });
    expect(id.boardHint).toBe('RAK4631');
  });

  it('hylkää tuntemattoman laitteen', () => {
    const id = identifyUsbDevice(UNKNOWN_MOUSE);
    expect(id.supported).toBe(false);
    expect(id.chip).toBe('UNKNOWN');
  });

  it('selectLoraDevice valitsee ensimmäisen tuetun laitteen', () => {
    expect(selectLoraDevice([UNKNOWN_MOUSE, RAK4631, HELTEC_V3])?.device.deviceId).toBe(1002);
    expect(selectLoraDevice([UNKNOWN_MOUSE])).toBeNull();
    expect(selectLoraDevice([])).toBeNull();
  });
});

// --- Sarjaportin avaus ja luvat ----------------------------------------------

describe('AndroidUsbOtgDriver – avaus, luvat ja 115200 8N1', () => {
  it('sarjaporttiasetukset ovat 115200 bps 8N1', () => {
    expect(LORA_SERIAL_SETTINGS).toEqual({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' });
  });

  it('pyytää USB-luvan ja avaa portin 115200 8N1 -asetuksilla', async () => {
    const { native, calls } = fakeNative({ devices: [RAK4631] });
    const driver = new AndroidUsbOtgDriver(native);
    const res = await driver.open();
    expect(res.ok).toBe(true);
    expect(res.status).toBe('CONNECTED');
    expect(calls.permission).toEqual([1002]);
    expect(calls.open).toEqual([{ id: 1002, s: LORA_SERIAL_SETTINGS }]);
    expect(driver.kind).toBe('USB_OTG');
    expect(driver.getLabel()).toBe('USB-OTG: RAK4631 @ 115200 bps');
  });

  it('palauttaa NO_NATIVE_MODULE, jos natiivikirjastoa ei ole (Expo Go)', async () => {
    const driver = new AndroidUsbOtgDriver(null);
    const res = await driver.open();
    expect(res).toMatchObject({ ok: false, status: 'NO_NATIVE_MODULE' });
  });

  it('palauttaa NO_DEVICE, jos OTG-laitetta ei ole kytketty', async () => {
    const { native } = fakeNative({ devices: [] });
    expect((await new AndroidUsbOtgDriver(native).open()).status).toBe('NO_DEVICE');
  });

  it('palauttaa UNSUPPORTED_DEVICE, jos kytketty laite ei ole LoRa-radio', async () => {
    const { native } = fakeNative({ devices: [UNKNOWN_MOUSE] });
    expect((await new AndroidUsbOtgDriver(native).open()).status).toBe('UNSUPPORTED_DEVICE');
  });

  it('palauttaa PERMISSION_DENIED eikä avaa porttia, jos lupa evätään', async () => {
    const { native, calls } = fakeNative({ devices: [HELTEC_V3], permission: false });
    const res = await new AndroidUsbOtgDriver(native).open();
    expect(res.status).toBe('PERMISSION_DENIED');
    expect(calls.open).toHaveLength(0);
  });

  it('palauttaa ERROR, jos portin avaus epäonnistuu', async () => {
    const { native } = fakeNative({ devices: [HELTEC_V3], openFails: true });
    const res = await new AndroidUsbOtgDriver(native).open();
    expect(res.status).toBe('ERROR');
    expect(res.ok).toBe(false);
  });
});

// --- Tavuvirta ja katkeaminen -------------------------------------------------

describe('AndroidUsbOtgDriver – tavuvirta ja kaapelin irrotus', () => {
  it('välittää vastaanotetut tavut muuttumattomina kuuntelijoille (pilkkoutunut virta)', async () => {
    const { native, conn } = fakeNative({ devices: [RAK4631] });
    const driver = new AndroidUsbOtgDriver(native);
    await driver.open();
    const received: number[] = [];
    driver.onData((chunk) => received.push(...chunk));
    // Meshtastic-kehys 0x94 0xC3 + pituus, saapuu kahdessa palassa
    conn.emit(new Uint8Array([0x94, 0xc3, 0x00]));
    conn.emit(new Uint8Array([0x02, 0x08, 0x01]));
    expect(received).toEqual([0x94, 0xc3, 0x00, 0x02, 0x08, 0x01]);
  });

  it('kirjoittaa tavut sarjaporttiin muuttumattomina', async () => {
    const { native, conn } = fakeNative({ devices: [RAK4631] });
    const driver = new AndroidUsbOtgDriver(native);
    await driver.open();
    const frame = new Uint8Array([0x94, 0xc3, 0x00, 0x02, 0x18, 0x01]);
    expect(await driver.write(frame)).toBe(true);
    expect(Array.from(conn.written[0])).toEqual(Array.from(frame));
  });

  it('kirjoitus ennen avausta palauttaa false kaatumatta', async () => {
    const { native } = fakeNative({ devices: [RAK4631] });
    expect(await new AndroidUsbOtgDriver(native).write(new Uint8Array([1]))).toBe(false);
  });

  it('kaapelin irrotus kesken ajon -> DISCONNECTED ilman kaatumista', async () => {
    const { native, conn } = fakeNative({ devices: [HELTEC_V3] });
    const driver = new AndroidUsbOtgDriver(native);
    await driver.open();
    const statuses: string[] = [];
    driver.onStatusChange((s) => statuses.push(s));
    conn.unplug();
    await expect(driver.write(new Uint8Array([1, 2, 3]))).resolves.toBe(false);
    expect(driver.getStatus()).toBe('DISCONNECTED');
    expect(statuses).toEqual(['DISCONNECTED']);
    // Sulku irrotetulle laitteelle ei saa heittää virhettä
    await expect(driver.close()).resolves.toBeUndefined();
  });

  it('close() lopettaa datan välityksen ja asettaa tilan DISCONNECTED', async () => {
    const { native, conn } = fakeNative({ devices: [RAK4631] });
    const driver = new AndroidUsbOtgDriver(native);
    await driver.open();
    const received: number[] = [];
    driver.onData((c) => received.push(...c));
    await driver.close();
    conn.emit(new Uint8Array([9]));
    expect(received).toEqual([]);
    expect(conn.closed).toBe(true);
    expect(driver.getStatus()).toBe('DISCONNECTED');
  });
});

// --- Loopback-ajuri -------------------------------------------------------------

describe('LoopbackSerialDriver', () => {
  it('kaiuttaa kirjoitetut tavut takaisin deterministisesti', async () => {
    const driver: ISerialPortDriver = new LoopbackSerialDriver();
    const res = await driver.open();
    expect(res).toMatchObject({ ok: true, status: 'LOOPBACK' });
    const received: number[] = [];
    driver.onData((c) => received.push(...c));
    expect(await driver.write(new Uint8Array([0x94, 0xc3]))).toBe(true);
    expect(received).toEqual([0x94, 0xc3]);
    expect(driver.kind).toBe('LOOPBACK');
    expect(driver.getLabel()).toBe('LOOPBACK-SIM');
  });

  it('ei välitä dataa suljettuna', async () => {
    const driver = new LoopbackSerialDriver();
    await driver.open();
    await driver.close();
    expect(await driver.write(new Uint8Array([1]))).toBe(false);
    expect(driver.getStatus()).toBe('DISCONNECTED');
  });
});

// --- Hallittu pudotus ja tunniste ------------------------------------------------

describe('connectLoraSerial – hallittu pudotus LoopbackSerialDriveriin', () => {
  it('käyttää USB-OTG-ajuria, kun natiivi moduuli ja radio ovat saatavilla', async () => {
    const { native } = fakeNative({ devices: [RAK4631] });
    const res = await connectLoraSerial(native, 'native');
    expect(res.fallback).toBe(false);
    expect(res.driver.kind).toBe('USB_OTG');
    expect(res.status).toBe('CONNECTED');
    expect(res.label).toBe('USB-OTG: RAK4631 @ 115200 bps');
  });

  it('putoaa loopbackiin Expo Go:ssa (simulation-tila) koskematta natiiviin', async () => {
    const { native, calls } = fakeNative({ devices: [RAK4631] });
    const res = await connectLoraSerial(native, 'simulation');
    expect(res.fallback).toBe(true);
    expect(res.driver.kind).toBe('LOOPBACK');
    expect(res.status).toBe('NO_NATIVE_MODULE');
    expect(res.label).toBe('LOOPBACK-SIM (NO_NATIVE_MODULE)');
    expect(calls.permission).toHaveLength(0);
  });

  it('putoaa loopbackiin selkeällä tilakoodilla, jos radiota ei ole kytketty', async () => {
    const { native } = fakeNative({ devices: [] });
    const res = await connectLoraSerial(native, 'native');
    expect(res.fallback).toBe(true);
    expect(res.status).toBe('NO_DEVICE');
    expect(res.label).toBe('LOOPBACK-SIM (NO_DEVICE)');
    expect(res.driver.getStatus()).toBe('LOOPBACK');
  });

  it('putoaa loopbackiin, jos natiivimoduuli puuttuu', async () => {
    const res = await connectLoraSerial(null, 'native');
    expect(res.status).toBe('NO_NATIVE_MODULE');
    expect(res.fallback).toBe(true);
  });

  it('formatDriverLabel muotoilee tunnisteen', () => {
    expect(formatDriverLabel('USB_OTG', 'Heltec V3 / T-Beam', 115200)).toBe(
      'USB-OTG: Heltec V3 / T-Beam @ 115200 bps',
    );
    expect(formatDriverLabel('LOOPBACK')).toBe('LOOPBACK-SIM');
    expect(formatDriverLabel('LOOPBACK', undefined, undefined, 'NO_DEVICE')).toBe('LOOPBACK-SIM (NO_DEVICE)');
  });
});

// --- Sovitin react-native-usb-serialport-for-android -kirjastolle ----------------

describe('createUsbSerialportAdapter', () => {
  it('muuntaa tavut heksaksi ja takaisin', () => {
    expect(bytesToHex(new Uint8Array([0x94, 0xc3, 0x00, 0x0f]))).toBe('94C3000F');
    expect(Array.from(hexToBytes('94c3000F'))).toEqual([0x94, 0xc3, 0x00, 0x0f]);
    expect(Array.from(hexToBytes(''))).toEqual([]);
  });

  it('kytkee kirjaston Managerin NativeUsbSerialModule-rajapintaan', async () => {
    const sent: string[] = [];
    let listener: ((e: { deviceId: number; data: string }) => void) | null = null;
    let removed = false;
    const manager = {
      list: async () => [{ deviceId: 7, vendorId: 0x239a, productId: 0x8029 }],
      tryRequestPermission: async (_id: number) => true,
      open: async (deviceId: number, options: { baudRate: number; parity: number; dataBits: number; stopBits: number }) => {
        expect(deviceId).toBe(7);
        expect(options).toEqual({ baudRate: 115200, parity: 0, dataBits: 8, stopBits: 1 });
        return {
          send: async (hex: string) => {
            sent.push(hex);
            return null;
          },
          onReceived: (l: (e: { deviceId: number; data: string }) => void) => {
            listener = l;
            return { remove: () => (removed = true) };
          },
          close: async () => null,
        };
      },
    };
    const native = createUsbSerialportAdapter(manager);
    const driver = new AndroidUsbOtgDriver(native);
    const res = await driver.open();
    expect(res.status).toBe('CONNECTED');
    await driver.write(new Uint8Array([0x94, 0xc3]));
    expect(sent).toEqual(['94C3']);
    const got: number[] = [];
    driver.onData((c) => got.push(...c));
    listener!({ deviceId: 7, data: '94C30001' });
    expect(got).toEqual([0x94, 0xc3, 0x00, 0x01]);
    await driver.close();
    expect(removed).toBe(true);
  });

  it('tryRequestPermission=false tulkitaan evätyksi (lupadialogi auki)', async () => {
    const manager = {
      list: async () => [{ deviceId: 7, vendorId: 0x10c4, productId: 0xea60 }],
      tryRequestPermission: async () => false,
      open: async () => {
        throw new Error('ei pidä kutsua');
      },
    };
    const res = await new AndroidUsbOtgDriver(createUsbSerialportAdapter(manager as any)).open();
    expect(res.status).toBe('PERMISSION_DENIED');
  });
});

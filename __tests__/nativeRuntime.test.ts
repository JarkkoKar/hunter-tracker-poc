import { describe, it, expect } from '@jest/globals';
import {
  detectRuntime,
  isExpoGo,
  isDevelopmentBuild,
  supportsNativeModules,
  resolveNativeCapability,
  resolveAllCapabilities,
  REQUIRED_ANDROID_PERMISSIONS,
  REQUIRED_ANDROID_FEATURES,
  validateAndroidManifestConfig,
  validateEasConfig,
} from '../src/utils/nativeRuntime';

import appJson from '../app.json';
import easJson from '../eas.json';
import packageJson from '../package.json';
import * as usbPlugin from '../plugins/withUsbHostFeature';

const JSON_FILES: Record<string, any> = {
  'app.json': appJson,
  'eas.json': easJson,
  'package.json': packageJson,
};
const readJson = (file: string): any => JSON_FILES[file];

describe('detectRuntime – ympäristön tunnistus', () => {
  it('tunnistaa Expo Go:n (executionEnvironment storeClient)', () => {
    expect(detectRuntime({ executionEnvironment: 'storeClient' })).toBe('expo-go');
  });

  it('tunnistaa Expo Go:n vanhasta appOwnership-kentästä', () => {
    expect(detectRuntime({ appOwnership: 'expo' })).toBe('expo-go');
  });

  it('tunnistaa Development Buildin (bare + expo-dev-client)', () => {
    expect(
      detectRuntime({ executionEnvironment: 'bare', hasDevClient: true }),
    ).toBe('development-build');
  });

  it('tunnistaa standalone-APK:n (EAS preview / tuotanto)', () => {
    expect(detectRuntime({ executionEnvironment: 'standalone' })).toBe('standalone');
  });

  it('bare ilman dev clientia on natiivikäännös (standalone)', () => {
    expect(detectRuntime({ executionEnvironment: 'bare', hasDevClient: false })).toBe(
      'standalone',
    );
  });

  it('palauttaa unknown, kun tieto puuttuu', () => {
    expect(detectRuntime({})).toBe('unknown');
    expect(detectRuntime(undefined)).toBe('unknown');
  });

  it('isExpoGo / isDevelopmentBuild / supportsNativeModules', () => {
    expect(isExpoGo({ executionEnvironment: 'storeClient' })).toBe(true);
    expect(isDevelopmentBuild({ executionEnvironment: 'storeClient' })).toBe(false);
    expect(isDevelopmentBuild({ executionEnvironment: 'bare', hasDevClient: true })).toBe(true);
    expect(supportsNativeModules('expo-go')).toBe(false);
    expect(supportsNativeModules('unknown')).toBe(false);
    expect(supportsNativeModules('development-build')).toBe(true);
    expect(supportsNativeModules('standalone')).toBe(true);
  });
});

describe('resolveNativeCapability – fallback-reititys', () => {
  it('Expo Go ohjaa USB-OTG Serialin simulaatioon', () => {
    const r = resolveNativeCapability('usbSerial', 'expo-go');
    expect(r.mode).toBe('simulation');
    expect(r.reason).toMatch(/Expo Go/);
  });

  it('Expo Go ohjaa taustapaikannuksen simulaatioon', () => {
    expect(resolveNativeCapability('backgroundLocation', 'expo-go').mode).toBe('simulation');
  });

  it('Development Build käyttää natiivia, kun moduuli on saatavilla', () => {
    const r = resolveNativeCapability('usbSerial', 'development-build', {
      usbSerial: true,
    });
    expect(r.mode).toBe('native');
  });

  it('natiivikäännös putoaa simulaatioon, jos natiivimoduuli puuttuu', () => {
    const r = resolveNativeCapability('usbSerial', 'development-build', {
      usbSerial: false,
    });
    expect(r.mode).toBe('simulation');
    expect(r.reason).toMatch(/moduuli/);
  });

  it('natiivikäännös olettaa moduulin olevan saatavilla, jos tietoa ei anneta', () => {
    expect(resolveNativeCapability('backgroundLocation', 'standalone').mode).toBe('native');
  });

  it('tuntematon ympäristö on aina simulaatio (turvallinen oletus)', () => {
    expect(resolveNativeCapability('usbSerial', 'unknown').mode).toBe('simulation');
  });

  it('resolveAllCapabilities palauttaa kaikki ominaisuudet', () => {
    const all = resolveAllCapabilities('expo-go');
    expect(Object.keys(all).sort()).toEqual(['backgroundLocation', 'usbSerial']);
    expect(all.usbSerial.mode).toBe('simulation');
  });
});

describe('validateAndroidManifestConfig – app.json', () => {
  it('pakolliset luvat sisältävät sijainti-, foreground service- ja Bluetooth-luvat', () => {
    expect(REQUIRED_ANDROID_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.BLUETOOTH_SCAN',
      ]),
    );
    expect(REQUIRED_ANDROID_FEATURES).toEqual([
      { name: 'android.hardware.usb.host', required: false },
    ]);
  });

  it('havaitsee puuttuvat luvat ja USB host -ominaisuuden', () => {
    const result = validateAndroidManifestConfig({ expo: { android: { permissions: [] } } });
    expect(result.ok).toBe(false);
    expect(result.missingPermissions).toContain('android.permission.BLUETOOTH_SCAN');
    expect(result.missingFeatures).toContain('android.hardware.usb.host');
  });

  it('hyväksyy lyhyet lupanimet (ACCESS_FINE_LOCATION)', () => {
    const result = validateAndroidManifestConfig({
      expo: {
        android: {
          permissions: REQUIRED_ANDROID_PERMISSIONS.map((p: string) => p.replace('android.permission.', '')),
        },
        plugins: ['./plugins/withUsbHostFeature'],
      },
    });
    expect(result.missingPermissions).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('projektin app.json täyttää Development Buildin vaatimukset', () => {
    const result = validateAndroidManifestConfig(readJson('app.json'));
    expect(result).toEqual({ ok: true, missingPermissions: [], missingFeatures: [], missingPlugins: [] });
  });

  it('app.json sisältää expo-dev-client-pluginin', () => {
    const plugins = readJson('app.json').expo.plugins as unknown[];
    const names = plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('expo-dev-client');
  });

  it('expo-dev-client on projektin riippuvuus', () => {
    expect(readJson('package.json').dependencies['expo-dev-client']).toBeDefined();
  });
});

describe('withUsbHostFeature – config plugin', () => {
  it('lisää <uses-feature android.hardware.usb.host required=false>', () => {
    const manifest = { manifest: { $: {} } } as any;
    const out = usbPlugin.applyUsbHostFeature(manifest);
    expect(out.manifest['uses-feature']).toEqual([
      { $: { 'android:name': 'android.hardware.usb.host', 'android:required': 'false' } },
    ]);
  });

  it('ei lisää duplikaattia ja korjaa required-arvon', () => {
    const manifest = {
      manifest: {
        'uses-feature': [
          { $: { 'android:name': 'android.hardware.usb.host', 'android:required': 'true' } },
          { $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } },
        ],
      },
    } as any;
    const out = usbPlugin.applyUsbHostFeature(manifest);
    const usb = out.manifest['uses-feature'].filter(
      (f: any) => f.$['android:name'] === 'android.hardware.usb.host',
    );
    expect(usb).toHaveLength(1);
    expect(usb[0].$['android:required']).toBe('false');
    expect(out.manifest['uses-feature']).toHaveLength(2);
  });
});

describe('validateEasConfig – eas.json', () => {
  it('havaitsee puuttuvat profiilit', () => {
    const r = validateEasConfig({ build: {} });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/development/);
    expect(r.errors.join(' ')).toMatch(/preview/);
  });

  it('vaatii APK-jakelun ja dev clientin development-profiiliin', () => {
    const r = validateEasConfig({
      build: {
        development: { distribution: 'internal', android: { buildType: 'app-bundle' } },
        preview: { distribution: 'internal', android: { buildType: 'apk' } },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/developmentClient/);
    expect(r.errors.join(' ')).toMatch(/apk/);
  });

  it('projektin eas.json on kunnossa', () => {
    expect(validateEasConfig(readJson('eas.json'))).toEqual({ ok: true, errors: [] });
  });
});

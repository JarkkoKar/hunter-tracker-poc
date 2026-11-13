import { describe, it, expect, afterEach } from '@jest/globals';
import {
  GOOGLE_MAPS_ENV_VAR,
  MAPS_PLUGIN,
  readGoogleMapsApiKey,
  applyGoogleMapsApiKey,
} from '../plugins/googleMapsApiKey';
import appConfig from '../app.config';
import appJson from '../app.json';

// Tiketti #54: Development Build kaatuu karttaan, koska Google Maps -avain puuttuu.
// Avain luetaan ympäristömuuttujasta, eikä sitä koskaan kirjoiteta repoon.

const FAKE_KEY = 'test-key-not-real';

describe('readGoogleMapsApiKey – avaimen luku ympäristöstä', () => {
  it('käyttää muuttujaa GOOGLE_MAPS_ANDROID_API_KEY', () => {
    expect(GOOGLE_MAPS_ENV_VAR).toBe('GOOGLE_MAPS_ANDROID_API_KEY');
  });

  it('palauttaa avaimen ilman ympäröiviä välilyöntejä', () => {
    expect(readGoogleMapsApiKey({ GOOGLE_MAPS_ANDROID_API_KEY: `  ${FAKE_KEY}\n` })).toBe(FAKE_KEY);
  });

  it('palauttaa undefined, kun muuttuja puuttuu, on tyhjä tai pelkkiä välilyöntejä', () => {
    expect(readGoogleMapsApiKey({})).toBeUndefined();
    expect(readGoogleMapsApiKey({ GOOGLE_MAPS_ANDROID_API_KEY: '' })).toBeUndefined();
    expect(readGoogleMapsApiKey({ GOOGLE_MAPS_ANDROID_API_KEY: '   ' })).toBeUndefined();
    expect(readGoogleMapsApiKey(undefined)).toBeUndefined();
  });
});

describe('applyGoogleMapsApiKey – react-native-maps-pluginin konfigurointi', () => {
  const base = { name: 'x', plugins: ['expo-dev-client', './plugins/withUsbHostFeature'] };

  it('ei muuta konfiguraatiota ilman avainta (Expo Go toimii ennallaan)', () => {
    expect(applyGoogleMapsApiKey(base, {})).toEqual(base);
  });

  it('lisää react-native-maps-pluginin avaimella ja säilyttää muut pluginit järjestyksessä', () => {
    const result = applyGoogleMapsApiKey(base, { GOOGLE_MAPS_ANDROID_API_KEY: FAKE_KEY });
    expect(result.plugins).toEqual([
      'expo-dev-client',
      './plugins/withUsbHostFeature',
      [MAPS_PLUGIN, { androidGoogleMapsApiKey: FAKE_KEY }],
    ]);
    expect(result.name).toBe('x');
  });

  it('korvaa merkkijonona listatun pluginin eikä tee kaksoiskappaletta', () => {
    const cfg = { plugins: [MAPS_PLUGIN, 'expo-dev-client'] };
    const result = applyGoogleMapsApiKey(cfg, { GOOGLE_MAPS_ANDROID_API_KEY: FAKE_KEY });
    expect(result.plugins).toEqual([
      [MAPS_PLUGIN, { androidGoogleMapsApiKey: FAKE_KEY }],
      'expo-dev-client',
    ]);
  });

  it('säilyttää pluginin muut asetukset ja lisää avaimen niiden rinnalle', () => {
    const cfg = { plugins: [[MAPS_PLUGIN, { iosGoogleMapsApiKey: 'ios' }]] };
    const result = applyGoogleMapsApiKey(cfg, { GOOGLE_MAPS_ANDROID_API_KEY: FAKE_KEY });
    expect(result.plugins).toEqual([
      [MAPS_PLUGIN, { iosGoogleMapsApiKey: 'ios', androidGoogleMapsApiKey: FAKE_KEY }],
    ]);
  });

  it('toimii, kun pluginlista puuttuu kokonaan', () => {
    const result = applyGoogleMapsApiKey({ name: 'y' }, { GOOGLE_MAPS_ANDROID_API_KEY: FAKE_KEY });
    expect(result.plugins).toEqual([[MAPS_PLUGIN, { androidGoogleMapsApiKey: FAKE_KEY }]]);
  });

  it('ei muokkaa alkuperäistä konfiguraatiota', () => {
    const cfg = { plugins: ['expo-dev-client'] };
    applyGoogleMapsApiKey(cfg, { GOOGLE_MAPS_ANDROID_API_KEY: FAKE_KEY });
    expect(cfg).toEqual({ plugins: ['expo-dev-client'] });
  });
});

describe('app.config.js – avain ympäristöstä app.jsonin päälle', () => {
  const original = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;
    else process.env.GOOGLE_MAPS_ANDROID_API_KEY = original;
  });

  it('lisää avaimen, kun ympäristömuuttuja on asetettu', () => {
    process.env.GOOGLE_MAPS_ANDROID_API_KEY = FAKE_KEY;
    const result = appConfig({ config: appJson.expo });
    expect(result.plugins).toContainEqual([MAPS_PLUGIN, { androidGoogleMapsApiKey: FAKE_KEY }]);
    expect(result.android.package).toBe('com.huntertracker.app');
  });

  it('palauttaa app.jsonin sellaisenaan ilman ympäristömuuttujaa', () => {
    delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;
    expect(appConfig({ config: appJson.expo })).toEqual(appJson.expo);
  });
});

describe('Avain ei päädy versionhallintaan', () => {
  it('app.json ei sisällä Google Maps -avainta', () => {
    const text = JSON.stringify(appJson);
    expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(text).not.toContain('androidGoogleMapsApiKey');
    expect(text).not.toContain('com.google.android.geo.API_KEY');
  });
});

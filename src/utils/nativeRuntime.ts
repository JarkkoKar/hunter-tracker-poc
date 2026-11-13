/**
 * Ajonaikainen ympäristön tunnistus ja natiivimoduulien suojattu reititys.
 *
 * Expo Go ei sisällä projektin omia natiivimoduuleja (USB-OTG Serial,
 * taustapaikannuksen foreground service). Development Buildissa
 * (expo-dev-client) ja standalone-APK:ssa ne ovat käytettävissä.
 *
 * Tiedosto on puhdas: se ei importtaa expo-constantsia, vaan sovellus
 * syöttää `Constants.executionEnvironment` / `Constants.appOwnership`
 * -arvot funktioille. Näin logiikka on testattavissa Jestissä.
 */

export type RuntimeEnvironment = 'expo-go' | 'development-build' | 'standalone' | 'unknown';

export interface RuntimeInfo {
  /** expo-constants: 'storeClient' (Expo Go) | 'standalone' | 'bare' */
  executionEnvironment?: string | null;
  /** expo-constants (vanhentunut): 'expo' = Expo Go */
  appOwnership?: string | null;
  /** true, jos expo-dev-clientin natiivimoduuli on ladattu */
  hasDevClient?: boolean;
}

export function detectRuntime(info: RuntimeInfo | undefined | null): RuntimeEnvironment {
  if (!info) return 'unknown';
  const env = info.executionEnvironment;
  if (env === 'storeClient' || info.appOwnership === 'expo') return 'expo-go';
  if (env === 'bare') return info.hasDevClient ? 'development-build' : 'standalone';
  if (env === 'standalone') return info.hasDevClient ? 'development-build' : 'standalone';
  return 'unknown';
}

export function isExpoGo(info: RuntimeInfo | undefined | null): boolean {
  return detectRuntime(info) === 'expo-go';
}

export function isDevelopmentBuild(info: RuntimeInfo | undefined | null): boolean {
  return detectRuntime(info) === 'development-build';
}

/** Natiivit laiterajapinnat ovat käytössä vain omassa natiivikäännöksessä. */
export function supportsNativeModules(runtime: RuntimeEnvironment): boolean {
  return runtime === 'development-build' || runtime === 'standalone';
}

export type NativeCapability = 'usbSerial' | 'backgroundLocation';
export const NATIVE_CAPABILITIES: NativeCapability[] = ['usbSerial', 'backgroundLocation'];

export interface CapabilityResolution {
  capability: NativeCapability;
  mode: 'native' | 'simulation';
  reason: string;
}

export type ModuleAvailability = Partial<Record<NativeCapability, boolean>>;

export function resolveNativeCapability(
  capability: NativeCapability,
  runtime: RuntimeEnvironment,
  availability: ModuleAvailability = {},
): CapabilityResolution {
  if (runtime === 'expo-go') {
    return {
      capability,
      mode: 'simulation',
      reason: 'Expo Go ei sisällä natiivimoduulia – käytetään simulaatiota.',
    };
  }
  if (!supportsNativeModules(runtime)) {
    return {
      capability,
      mode: 'simulation',
      reason: 'Ajoympäristö tuntematon – käytetään turvallista simulaatiota.',
    };
  }
  if (availability[capability] === false) {
    return {
      capability,
      mode: 'simulation',
      reason: 'Natiivi moduuli puuttuu käännöksestä – käytetään simulaatiota.',
    };
  }
  return { capability, mode: 'native', reason: 'Natiivi rajapinta käytössä.' };
}

export function resolveAllCapabilities(
  runtime: RuntimeEnvironment,
  availability: ModuleAvailability = {},
): Record<NativeCapability, CapabilityResolution> {
  const out = {} as Record<NativeCapability, CapabilityResolution>;
  for (const c of NATIVE_CAPABILITIES) out[c] = resolveNativeCapability(c, runtime, availability);
  return out;
}

// --- Manifestin (app.json) validointi -------------------------------------

export const REQUIRED_ANDROID_PERMISSIONS: string[] = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_SCAN',
];

export interface AndroidFeatureRequirement {
  name: string;
  required: boolean;
}

export const REQUIRED_ANDROID_FEATURES: AndroidFeatureRequirement[] = [
  { name: 'android.hardware.usb.host', required: false },
];

/** Config plugin, joka lisää usb.host-ominaisuuden AndroidManifestiin. */
export const USB_HOST_PLUGIN = './plugins/withUsbHostFeature';

export const REQUIRED_PLUGINS: string[] = ['expo-dev-client'];

/** Mikä plugin tuottaa minkäkin uses-feature-tagin. */
const FEATURE_PLUGINS: Record<string, string> = {
  'android.hardware.usb.host': USB_HOST_PLUGIN,
};

export interface ManifestValidation {
  ok: boolean;
  missingPermissions: string[];
  missingFeatures: string[];
  missingPlugins: string[];
}

function normalizePermission(p: string): string {
  return p.includes('.') ? p : `android.permission.${p}`;
}

function pluginNames(plugins: unknown): string[] {
  if (!Array.isArray(plugins)) return [];
  return plugins
    .map((p) => (Array.isArray(p) ? p[0] : p))
    .filter((p): p is string => typeof p === 'string');
}

export function validateAndroidManifestConfig(
  appJson: any,
  requiredPlugins: string[] = [],
): ManifestValidation {
  const expo = appJson?.expo ?? appJson ?? {};
  const perms: string[] = Array.isArray(expo.android?.permissions)
    ? expo.android.permissions.map(normalizePermission)
    : [];
  const plugins = pluginNames(expo.plugins);

  const missingPermissions = REQUIRED_ANDROID_PERMISSIONS.filter((p) => !perms.includes(p));
  const missingFeatures = REQUIRED_ANDROID_FEATURES.filter(
    (f) => !plugins.includes(FEATURE_PLUGINS[f.name]),
  ).map((f) => f.name);
  const missingPlugins = requiredPlugins.filter((p) => !plugins.includes(p));

  return {
    ok: missingPermissions.length === 0 && missingFeatures.length === 0 && missingPlugins.length === 0,
    missingPermissions,
    missingFeatures,
    missingPlugins,
  };
}

// --- eas.json-validointi --------------------------------------------------

export interface EasValidation {
  ok: boolean;
  errors: string[];
}

export function validateEasConfig(easJson: any): EasValidation {
  const errors: string[] = [];
  const build = easJson?.build ?? {};
  const dev = build.development;
  const preview = build.preview;

  if (!dev) {
    errors.push('Profiili "development" puuttuu.');
  } else {
    if (dev.developmentClient !== true) errors.push('development: developmentClient ei ole true.');
    if (dev.distribution !== 'internal') errors.push('development: distribution ei ole "internal".');
    if (dev.android?.buildType !== 'apk') errors.push('development: android.buildType ei ole "apk".');
  }

  if (!preview) {
    errors.push('Profiili "preview" puuttuu.');
  } else {
    if (preview.distribution !== 'internal') errors.push('preview: distribution ei ole "internal".');
    if (preview.android?.buildType !== 'apk') errors.push('preview: android.buildType ei ole "apk".');
  }

  return { ok: errors.length === 0, errors };
}

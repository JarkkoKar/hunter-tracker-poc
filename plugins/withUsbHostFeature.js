/**
 * Expo config plugin: lisää AndroidManifestiin
 *   <uses-feature android:name="android.hardware.usb.host" android:required="false" />
 * USB-C OTG LoRa -radioita varten (tiketti #26 / #25).
 * required="false": sovellus asentuu myös laitteisiin ilman USB host -tukea.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const USB_HOST_FEATURE = 'android.hardware.usb.host';

function applyUsbHostFeature(androidManifest) {
  const manifest = androidManifest.manifest;
  const features = Array.isArray(manifest['uses-feature']) ? manifest['uses-feature'] : [];
  const existing = features.find((f) => f && f.$ && f.$['android:name'] === USB_HOST_FEATURE);
  if (existing) {
    existing.$['android:required'] = 'false';
  } else {
    features.push({ $: { 'android:name': USB_HOST_FEATURE, 'android:required': 'false' } });
  }
  manifest['uses-feature'] = features;
  return androidManifest;
}

function withUsbHostFeature(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyUsbHostFeature(cfg.modResults);
    return cfg;
  });
}

module.exports = withUsbHostFeature;
module.exports.applyUsbHostFeature = applyUsbHostFeature;

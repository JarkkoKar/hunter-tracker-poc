/**
 * Google Maps -avain react-native-mapsille Development Buildissa (tiketti #54).
 *
 * react-native-maps käyttää Androidissa aina Google Maps SDK:ta (myös mapType="none" + UrlTile),
 * ja SDK vaatii avaimen AndroidManifestiin. Expo Go sisältää Expon oman avaimen, Dev Build ei.
 *
 * Avain luetaan ympäristömuuttujasta GOOGLE_MAPS_ANDROID_API_KEY (EAS-ympäristömuuttuja tai
 * paikallinen .env, joka ei kuulu versionhallintaan). Avainta ei koskaan kirjoiteta repoon.
 * Ilman avainta konfiguraatio palautetaan muuttamattomana, jolloin Expo Go toimii ennallaan.
 */
const GOOGLE_MAPS_ENV_VAR = 'GOOGLE_MAPS_ANDROID_API_KEY';
const MAPS_PLUGIN = 'react-native-maps';

function readGoogleMapsApiKey(env) {
  const value = env ? env[GOOGLE_MAPS_ENV_VAR] : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function pluginName(entry) {
  return Array.isArray(entry) ? entry[0] : entry;
}

function applyGoogleMapsApiKey(config, env) {
  const apiKey = readGoogleMapsApiKey(env);
  if (!apiKey) return config;

  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  let found = false;
  const nextPlugins = plugins.map((entry) => {
    if (pluginName(entry) !== MAPS_PLUGIN) return entry;
    found = true;
    const options =
      Array.isArray(entry) && entry[1] && typeof entry[1] === 'object' ? entry[1] : {};
    return [MAPS_PLUGIN, { ...options, androidGoogleMapsApiKey: apiKey }];
  });
  if (!found) nextPlugins.push([MAPS_PLUGIN, { androidGoogleMapsApiKey: apiKey }]);

  return { ...config, plugins: nextPlugins };
}

module.exports = {
  GOOGLE_MAPS_ENV_VAR,
  MAPS_PLUGIN,
  readGoogleMapsApiKey,
  applyGoogleMapsApiKey,
};

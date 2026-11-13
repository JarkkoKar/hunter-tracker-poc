/**
 * Dynaaminen Expo-konfiguraatio. Perusasetukset ovat app.json:ssa (Expo antaa ne tänne
 * `config`-parametrina); tämä tiedosto lisää vain ympäristömuuttujista tulevat arvot.
 *
 * GOOGLE_MAPS_ANDROID_API_KEY: Google Maps -avain Development Buildia varten (tiketti #54).
 * Aseta se EAS-ympäristömuuttujaksi ja paikallisesti .env-tiedostoon – ei koskaan repoon.
 */
const { applyGoogleMapsApiKey } = require('./plugins/googleMapsApiKey');

module.exports = ({ config }) => applyGoogleMapsApiKey(config, process.env);

import { buildLocalTileUrlTemplate, DEFAULT_OFFLINE_ZOOM_LEVELS } from './offlineTileCache';

export type TileLayerId = 'mml-maastokartta' | 'opentopomap';

export interface TileLayerConfig {
  /** Kerroksen tunniste; käytetään myös offline-välimuistin hakemistonimenä. */
  id: TileLayerId;
  urlTemplate: string;
  isMml: boolean;
  /** true = urlTemplate osoittaa laitteen paikalliseen file://-tiilihakemistoon. */
  isOffline: boolean;
  label: string;
  maximumZ: number;
  /** Suurin zoom, jolle tiiliä on olemassa; tätä suuremmilla skaalataan ylös. */
  maximumNativeZ?: number;
}

export interface TopoTileOptions {
  /**
   * Kun annettu (esim. expo-file-systemin `Paths.document.uri`), kartta lukee
   * tiilet paikallisesta välimuistista `.../tiles/{layer}/{z}/{x}/{y}.png`
   * eikä tarvitse verkkoyhteyttä.
   */
  offlineCacheRootUri?: string;
  /** Suurin offline-välimuistiin ladattu zoom-taso (oletus 15). */
  offlineMaxNativeZ?: number;
}

const OPENTOPOMAP_LAYER: TileLayerConfig = {
  id: 'opentopomap',
  urlTemplate: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
  isMml: false,
  isOffline: false,
  label: 'Maastokartta (OpenTopo)',
  maximumZ: 17,
};

/**
 * Käyttäjän valitseman karttatason kerros (#59). Oletus on OpenTopoMap myös
 * silloin, kun MML-avain on asetettu. `offline` lukee offline-lähteen
 * (MML avaimen kanssa, muuten OpenTopoMap) tiilet laitteen välimuistista.
 */
export function getTileLayerConfig(
  layer: 'opentopomap' | 'mml-maastokartta' | 'offline',
  apiKey?: string,
  options: TopoTileOptions = {}
): TileLayerConfig {
  const hasKey = (apiKey || '').trim().length > 0;
  if (layer === 'offline') {
    const source = getTileLayerConfig(hasKey ? 'mml-maastokartta' : 'opentopomap', apiKey);
    if (!options.offlineCacheRootUri) return source;
    return toOfflineLayer(source, options);
  }
  if (layer === 'mml-maastokartta' && hasKey) {
    return getTopoTileConfig(apiKey);
  }
  return { ...OPENTOPOMAP_LAYER };
}

function toOfflineLayer(online: TileLayerConfig, options: TopoTileOptions): TileLayerConfig {
  // Offline: sama kerros, mutta luetaan laitteen levyltä. API-avain ei päädy polkuun.
  return {
    ...online,
    urlTemplate: buildLocalTileUrlTemplate(options.offlineCacheRootUri as string, online.id),
    isOffline: true,
    label: `${online.label} (offline)`,
    maximumNativeZ:
      options.offlineMaxNativeZ ??
      DEFAULT_OFFLINE_ZOOM_LEVELS[DEFAULT_OFFLINE_ZOOM_LEVELS.length - 1],
  };
}

export function getTopoTileConfig(apiKey?: string, options: TopoTileOptions = {}): TileLayerConfig {
  const cleanKey = (apiKey || '').trim();

  const online: TileLayerConfig =
    cleanKey.length > 0
      ? {
          id: 'mml-maastokartta',
          urlTemplate: `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=${cleanKey}`,
          isMml: true,
          isOffline: false,
          label: 'MML Maastokartta',
          maximumZ: 18,
        }
      : {
          id: 'opentopomap',
          urlTemplate: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
          isMml: false,
          isOffline: false,
          label: 'Maastokartta (OpenTopo)',
          maximumZ: 17,
        };

  if (!options.offlineCacheRootUri) {
    return online;
  }

  // Offline: sama kerros, mutta luetaan laitteen levyltä. API-avain ei päädy polkuun.
  return {
    ...online,
    urlTemplate: buildLocalTileUrlTemplate(options.offlineCacheRootUri, online.id),
    isOffline: true,
    label: `${online.label} (offline)`,
    maximumNativeZ:
      options.offlineMaxNativeZ ??
      DEFAULT_OFFLINE_ZOOM_LEVELS[DEFAULT_OFFLINE_ZOOM_LEVELS.length - 1],
  };
}

export interface TileLayerConfig {
  urlTemplate: string;
  isMml: boolean;
  label: string;
  maximumZ: number;
}

export function getTopoTileConfig(apiKey?: string): TileLayerConfig {
  const cleanKey = (apiKey || '').trim();

  if (cleanKey.length > 0) {
    return {
      urlTemplate: `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=${cleanKey}`,
      isMml: true,
      label: 'MML Maastokartta',
      maximumZ: 18,
    };
  }

  return {
    urlTemplate: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
    isMml: false,
    label: 'Maastokartta (OpenTopo)',
    maximumZ: 17,
  };
}

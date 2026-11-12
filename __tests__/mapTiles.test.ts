import { describe, it, expect } from '@jest/globals';
import { getTopoTileConfig } from '../src/utils/mapTiles';

describe('MML Topographic Tile Configuration', () => {
  it('muodostaa MML maastokartta WMTS URL-pohjan, kun API-avain on annettu', () => {
    const config = getTopoTileConfig('testi-avain-123');

    expect(config.isMml).toBe(true);
    expect(config.label).toBe('MML Maastokartta');
    expect(config.urlTemplate).toContain('avoin-karttakuva.maanmittauslaitos.fi');
    expect(config.urlTemplate).toContain('maastokartta');
    expect(config.urlTemplate).toContain('WGS84_Pseudo-Mercator/{z}/{y}/{x}.png');
    expect(config.urlTemplate).toContain('api-key=testi-avain-123');
  });

  it('käyttää OpenTopoMap-varakerrosta, jos MML API-avain puuttuu', () => {
    const config = getTopoTileConfig('');

    expect(config.isMml).toBe(false);
    expect(config.label).toBe('Maastokartta (OpenTopo)');
    expect(config.urlTemplate).toContain('opentopomap.org/{z}/{x}/{y}.png');
  });
});

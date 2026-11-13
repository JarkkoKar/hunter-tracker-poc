import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_MAP_LAYER,
  MAP_LAYER_FILE_NAME,
  buildMapLayerUri,
  getAvailableMapLayers,
  resolveMapLayerChoice,
  getNextMapLayer,
  getMapLayerAttribution,
  getOfflineSourceLayer,
  serializeMapLayerPreference,
  parseMapLayerPreference,
  saveMapLayerPreference,
  loadMapLayerPreference,
} from '../src/utils/mapLayerPreference';
import { getTileLayerConfig } from '../src/utils/mapTiles';
import type { AreaStorage } from '../src/utils/areaPersistence';

function memoryStorage(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial };
  const storage: AreaStorage = {
    exists: async (uri) => uri in files,
    read: async (uri) => {
      if (!(uri in files)) throw new Error('ENOENT');
      return files[uri];
    },
    write: async (uri, text) => {
      files[uri] = text;
    },
    remove: async (uri) => {
      delete files[uri];
    },
  };
  return { storage, files };
}

const DOC_DIR = 'file:///data/doc/';

describe('Karttatason oletus ja valinta', () => {
  it('oletuskarttataso on OpenTopoMap', () => {
    expect(DEFAULT_MAP_LAYER).toBe('opentopomap');
  });

  it('MML on valittavissa vain, kun API-avain on asetettu', () => {
    expect(getAvailableMapLayers('avain')).toEqual(['opentopomap', 'mml-maastokartta', 'offline']);
    expect(getAvailableMapLayers('')).toEqual(['opentopomap', 'offline']);
    expect(getAvailableMapLayers('   ')).toEqual(['opentopomap', 'offline']);
    expect(getAvailableMapLayers(undefined)).toEqual(['opentopomap', 'offline']);
  });

  it('OpenTopoMap valitaan oletukseksi myös silloin, kun MML-avain on asetettu', () => {
    expect(resolveMapLayerChoice(null, 'avain')).toBe('opentopomap');
    expect(resolveMapLayerChoice(undefined, 'avain')).toBe('opentopomap');
  });

  it('käyttäjän valinta ohjaa', () => {
    expect(resolveMapLayerChoice('mml-maastokartta', 'avain')).toBe('mml-maastokartta');
    expect(resolveMapLayerChoice('offline', '')).toBe('offline');
    expect(resolveMapLayerChoice('opentopomap', 'avain')).toBe('opentopomap');
  });

  it('MML-valinta ilman avainta ja tuntematon arvo palaavat OpenTopoMapiin', () => {
    expect(resolveMapLayerChoice('mml-maastokartta', '')).toBe('opentopomap');
    expect(resolveMapLayerChoice('google-satelliitti', 'avain')).toBe('opentopomap');
    expect(resolveMapLayerChoice(42 as unknown as string, 'avain')).toBe('opentopomap');
  });

  it('karttatasopainike kiertää käytettävissä olevat tasot', () => {
    expect(getNextMapLayer('opentopomap', 'avain')).toBe('mml-maastokartta');
    expect(getNextMapLayer('mml-maastokartta', 'avain')).toBe('offline');
    expect(getNextMapLayer('offline', 'avain')).toBe('opentopomap');
    expect(getNextMapLayer('opentopomap', '')).toBe('offline');
    expect(getNextMapLayer('offline', '')).toBe('opentopomap');
  });
});

describe('Lähdeviite kartalla', () => {
  it('OpenTopoMap: CC-BY-SA ja OpenStreetMap', () => {
    expect(getMapLayerAttribution('opentopomap')).toBe(
      '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap'
    );
  });

  it('MML Maastokartta: Maanmittauslaitos', () => {
    expect(getMapLayerAttribution('mml-maastokartta')).toContain('Maanmittauslaitos');
  });
});

describe('Offline-latauksen lähde', () => {
  it('käyttää MML:ää, kun avain on asetettu (OpenTopoMapia ei joukkoladata)', () => {
    expect(getOfflineSourceLayer('avain')).toBe('mml-maastokartta');
  });

  it('ilman avainta säilyy nykyinen OpenTopoMap-lähde', () => {
    expect(getOfflineSourceLayer('')).toBe('opentopomap');
    expect(getOfflineSourceLayer(undefined)).toBe('opentopomap');
  });
});

describe('getTileLayerConfig', () => {
  it('OpenTopoMap on OpenTopo-tiilet myös avaimen kanssa', () => {
    const c = getTileLayerConfig('opentopomap', 'avain');
    expect(c.id).toBe('opentopomap');
    expect(c.isMml).toBe(false);
    expect(c.isOffline).toBe(false);
    expect(c.urlTemplate).toContain('opentopomap.org/{z}/{x}/{y}.png');
    expect(c.urlTemplate).not.toContain('avain');
  });

  it('MML-kerros sisältää avaimen URL-pohjassa', () => {
    const c = getTileLayerConfig('mml-maastokartta', 'avain');
    expect(c.isMml).toBe(true);
    expect(c.urlTemplate).toContain('maastokartta');
    expect(c.urlTemplate).toContain('api-key=avain');
  });

  it('MML ilman avainta putoaa OpenTopoMapiin', () => {
    const c = getTileLayerConfig('mml-maastokartta', '');
    expect(c.id).toBe('opentopomap');
  });

  it('offline lukee offline-lähteen tiilet laitteelta ilman avainta polussa', () => {
    const c = getTileLayerConfig('offline', 'avain', {
      offlineCacheRootUri: 'file:///data/doc/',
      offlineMaxNativeZ: 14,
    });
    expect(c.isOffline).toBe(true);
    expect(c.id).toBe('mml-maastokartta');
    expect(c.urlTemplate.startsWith('file:///data/doc/')).toBe(true);
    expect(c.urlTemplate).toContain('mml-maastokartta');
    expect(c.urlTemplate).not.toContain('avain');
    expect(c.maximumNativeZ).toBe(14);
  });

  it('offline ilman avainta käyttää OpenTopoMap-välimuistia', () => {
    const c = getTileLayerConfig('offline', '', { offlineCacheRootUri: 'file:///data/doc/' });
    expect(c.isOffline).toBe(true);
    expect(c.id).toBe('opentopomap');
  });
});

describe('Karttatason pysyvä tallennus', () => {
  it('tiedosto on dokumenttihakemistossa', () => {
    expect(buildMapLayerUri(DOC_DIR)).toBe(DOC_DIR + MAP_LAYER_FILE_NAME);
    expect(buildMapLayerUri('file:///data/doc')).toBe('file:///data/doc/' + MAP_LAYER_FILE_NAME);
  });

  it('sarjallistus ja jäsennys ovat käänteiset', () => {
    const text = serializeMapLayerPreference('mml-maastokartta', 123);
    expect(parseMapLayerPreference(text)).toBe('mml-maastokartta');
  });

  it('vioittunut tai tuntematon tiedosto jäsentyy null-arvoksi', () => {
    expect(parseMapLayerPreference('')).toBeNull();
    expect(parseMapLayerPreference('{rikki')).toBeNull();
    expect(parseMapLayerPreference('{"version":1,"layer":"tuntematon"}')).toBeNull();
    expect(parseMapLayerPreference('[]')).toBeNull();
  });

  it('tallennettu valinta luetaan seuraavalla käynnistyksellä', async () => {
    const { storage } = memoryStorage();
    expect(await saveMapLayerPreference(storage, DOC_DIR, 'offline')).toEqual({ ok: true });
    expect(await loadMapLayerPreference(storage, DOC_DIR, 'avain')).toBe('offline');
  });

  it('ilman tallennusta palautuu oletus OpenTopoMap', async () => {
    const { storage } = memoryStorage();
    expect(await loadMapLayerPreference(storage, DOC_DIR, 'avain')).toBe('opentopomap');
  });

  it('tallennettu MML-valinta ilman avainta palautuu OpenTopoMapiin', async () => {
    const { storage } = memoryStorage();
    await saveMapLayerPreference(storage, DOC_DIR, 'mml-maastokartta');
    expect(await loadMapLayerPreference(storage, DOC_DIR, '')).toBe('opentopomap');
  });

  it('lukuvirhe ei heitä vaan palauttaa oletuksen', async () => {
    const storage: AreaStorage = {
      exists: async () => true,
      read: async () => {
        throw new Error('IO');
      },
      write: async () => undefined,
      remove: async () => undefined,
    };
    expect(await loadMapLayerPreference(storage, DOC_DIR, 'avain')).toBe('opentopomap');
  });

  it('kirjoitusvirhe palautetaan virheenä eikä heitetä', async () => {
    const storage: AreaStorage = {
      exists: async () => false,
      read: async () => '',
      write: async () => {
        throw new Error('levy täynnä');
      },
      remove: async () => undefined,
    };
    const r = await saveMapLayerPreference(storage, DOC_DIR, 'opentopomap');
    expect(r.ok).toBe(false);
  });

  it('API-avain ei päädy tallennustiedostoon', async () => {
    const { storage, files } = memoryStorage();
    await saveMapLayerPreference(storage, DOC_DIR, 'mml-maastokartta');
    expect(Object.values(files).join('')).not.toContain('avain');
  });
});

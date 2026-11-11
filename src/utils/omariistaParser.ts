export interface Stand {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface Boundary {
  name: string;
  coordinates: Array<{ latitude: number; longitude: number }>;
}

export interface HuntingArea {
  boundary?: Boundary;
  stands: Stand[];
}

export function parseOmaRiistaGeoJSON(geoJson: any): HuntingArea {
  const area: HuntingArea = {
    stands: []
  };

  if (!geoJson || !Array.isArray(geoJson.features)) {
    return area;
  }

  for (const feature of geoJson.features) {
    const geometry = feature.geometry;
    const properties = feature.properties || {};

    if (!geometry) continue;

    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
      const ring = geometry.coordinates[0] || [];
      area.boundary = {
        name: properties.name || 'Jahtialue',
        coordinates: ring.map((coord: number[]) => ({
          longitude: coord[0],
          latitude: coord[1]
        }))
      };
    } else if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
      area.stands.push({
        id: properties.id || properties.name || Math.random().toString(),
        name: properties.name || 'Passi',
        longitude: geometry.coordinates[0],
        latitude: geometry.coordinates[1]
      });
    }
  }

  return area;
}

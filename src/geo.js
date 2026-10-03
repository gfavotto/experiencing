import * as THREE from "three";

export const ELE_EXAG = 2.6;
export const METERS_PER_DEG_LAT = 111320;
export const WORLD_SCALE = 0.04;

/**
 * @param {{ lat: number, lon: number, ele: number }[]} points
 */
export function createProjector(points) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const eles = points.map((p) => p.ele);

  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const ele0 = Math.min(...eles);
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);

  /** @param {number} lat @param {number} lon @param {number} ele */
  function project(lat, lon, ele) {
    return new THREE.Vector3(
      (lon - lon0) * metersPerDegLon * WORLD_SCALE,
      (ele - ele0) * WORLD_SCALE * ELE_EXAG,
      -(lat - lat0) * METERS_PER_DEG_LAT * WORLD_SCALE,
    );
  }

  const vectors = points.map((p) => project(p.lat, p.lon, p.ele));

  return {
    lat0,
    lon0,
    ele0,
    project,
    vectors,
    bounds: {
      latMin: Math.min(...lats),
      latMax: Math.max(...lats),
      lonMin: Math.min(...lons),
      lonMax: Math.max(...lons),
    },
  };
}

/** @param {{ latMin: number, latMax: number, lonMin: number, lonMax: number }} bounds @param {number} padFraction */
export function padBounds(bounds, padFraction = 0.45) {
  const latPad = (bounds.latMax - bounds.latMin) * padFraction || 0.004;
  const lonPad = (bounds.lonMax - bounds.lonMin) * padFraction || 0.006;
  return {
    latMin: bounds.latMin - latPad,
    latMax: bounds.latMax + latPad,
    lonMin: bounds.lonMin - lonPad,
    lonMax: bounds.lonMax + lonPad,
  };
}

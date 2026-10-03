import * as THREE from "three";

const TILE_SIZE = 256;
const DEM_ZOOM = 13;
const SAT_ZOOM = 14;

// Proxied in vite.config.js to avoid CORS issues in dev/prod preview.
const DEM_URL = (z, x, y) => `/tiles/dem/${z}/${x}/${y}.png`;
const SAT_URL = (z, x, y) => `/tiles/sat/${z}/${y}/${x}`;

/**
 * @param {{ latMin: number, latMax: number, lonMin: number, lonMax: number }} bounds
 * @param {{ project: (lat:number, lon:number, ele:number) => THREE.Vector3 }} projector
 * @returns {Promise<THREE.Mesh>}
 */
export async function createTerrainMesh(bounds, projector) {
  const [heights, texture] = await Promise.all([
    sampleDemGrid(bounds, DEM_ZOOM, 96),
    stitchSatelliteTexture(bounds, SAT_ZOOM),
  ]);

  const { cols, rows, values, latMin, latMax, lonMin, lonMax } = heights;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices = [];

  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    const lat = latMax - v * (latMax - latMin);
    for (let col = 0; col < cols; col++) {
      const u = col / (cols - 1);
      const lon = lonMin + u * (lonMax - lonMin);
      const ele = values[row * cols + col];
      const p = projector.project(lat, lon, ele);
      const i = row * cols + col;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = 1 - v;
    }
  }

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

async function sampleDemGrid(bounds, zoom, resolution) {
  const cols = resolution;
  const rows = resolution;
  const values = new Float32Array(cols * rows);

  const tiles = await loadTileSet(bounds, zoom, DEM_URL, "dem");

  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    const lat = bounds.latMax - v * (bounds.latMax - bounds.latMin);
    for (let col = 0; col < cols; col++) {
      const u = col / (cols - 1);
      const lon = bounds.lonMin + u * (bounds.lonMax - bounds.lonMin);
      values[row * cols + col] = sampleTerrarium(tiles, zoom, lat, lon);
    }
  }

  return {
    cols,
    rows,
    values,
    latMin: bounds.latMin,
    latMax: bounds.latMax,
    lonMin: bounds.lonMin,
    lonMax: bounds.lonMax,
  };
}

async function stitchSatelliteTexture(bounds, zoom) {
  const tiles = await loadTileSet(bounds, zoom, SAT_URL, "sat");
  const { minX, maxX, minY, maxY } = tileRange(bounds, zoom);
  const width = (maxX - minX + 1) * TILE_SIZE;
  const height = (maxY - minY + 1) * TILE_SIZE;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");

  // Fill with rock tone while tiles load gaps
  ctx.fillStyle = "#8a7a66";
  ctx.fillRect(0, 0, width, height);

  const nw = latLonToWorld(bounds.latMax, bounds.lonMin, zoom);
  const se = latLonToWorld(bounds.latMin, bounds.lonMax, zoom);

  for (const tile of tiles) {
    const dx = (tile.x - minX) * TILE_SIZE;
    const dy = (tile.y - minY) * TILE_SIZE;
    ctx.drawImage(tile.image, dx, dy);
  }

  // Crop to exact geographic bounds inside the tile mosaic
  const cropX = (nw.x - minX) * TILE_SIZE;
  const cropY = (nw.y - minY) * TILE_SIZE;
  const cropW = Math.max(1, (se.x - nw.x) * TILE_SIZE);
  const cropH = Math.max(1, (se.y - nw.y) * TILE_SIZE);

  const cropped = document.createElement("canvas");
  cropped.width = Math.round(cropW);
  cropped.height = Math.round(cropH);
  const cctx = cropped.getContext("2d");
  if (!cctx) throw new Error("Canvas 2D unavailable");
  cctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropped.width, cropped.height);

  const texture = new THREE.CanvasTexture(cropped);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * @param {{ latMin:number, latMax:number, lonMin:number, lonMax:number }} bounds
 * @param {number} zoom
 * @param {(z:number,x:number,y:number)=>string} urlFor
 * @param {string} kind
 */
async function loadTileSet(bounds, zoom, urlFor, kind) {
  const { minX, maxX, minY, maxY } = tileRange(bounds, zoom);
  /** @type {{ x:number, y:number, image: CanvasImageSource, pixels?: ImageData }[]} */
  const tiles = [];

  const jobs = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      jobs.push(
        loadImage(urlFor(zoom, x, y)).then(async (image) => {
          const entry = { x, y, image };
          if (kind === "dem") {
            entry.pixels = await imageDataFrom(image);
          }
          tiles.push(entry);
        }),
      );
    }
  }

  await Promise.all(jobs);
  return tiles;
}

function tileRange(bounds, zoom) {
  const nw = latLonToTile(bounds.latMax, bounds.lonMin, zoom);
  const se = latLonToTile(bounds.latMin, bounds.lonMax, zoom);
  return {
    minX: Math.min(nw.x, se.x),
    maxX: Math.max(nw.x, se.x),
    minY: Math.min(nw.y, se.y),
    maxY: Math.max(nw.y, se.y),
  };
}

function latLonToTile(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

function latLonToWorld(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function sampleTerrarium(tiles, zoom, lat, lon) {
  const world = latLonToWorld(lat, lon, zoom);
  const tx = Math.floor(world.x);
  const ty = Math.floor(world.y);
  const tile = tiles.find((t) => t.x === tx && t.y === ty);
  if (!tile?.pixels) return 2200;

  const fx = (world.x - tx) * TILE_SIZE;
  const fy = (world.y - ty) * TILE_SIZE;
  const x0 = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(fy)));
  const x1 = Math.min(TILE_SIZE - 1, x0 + 1);
  const y1 = Math.min(TILE_SIZE - 1, y0 + 1);
  const wx = fx - x0;
  const wy = fy - y0;

  const h00 = heightAt(tile.pixels, x0, y0);
  const h10 = heightAt(tile.pixels, x1, y0);
  const h01 = heightAt(tile.pixels, x0, y1);
  const h11 = heightAt(tile.pixels, x1, y1);

  const h0 = h00 * (1 - wx) + h10 * wx;
  const h1 = h01 * (1 - wx) + h11 * wx;
  return h0 * (1 - wy) + h1 * wy;
}

function heightAt(imageData, x, y) {
  const i = (y * imageData.width + x) * 4;
  const r = imageData.data[i];
  const g = imageData.data[i + 1];
  const b = imageData.data[i + 2];
  return r * 256 + g + b / 256 - 32768;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed tile ${url}`));
    img.src = url;
  });
}

async function imageDataFrom(image) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
}

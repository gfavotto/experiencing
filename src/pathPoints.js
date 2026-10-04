import * as THREE from "three";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import gpxText from "../assets/pian-falzarego-forcella-lagazuoi-baracca-ufficiali-austriaci.gpx?raw";

const METERS_PER_DEG_LAT = 111320;
/** Drop GPS glitches that jump far from the continuous track. */
const MAX_STEP_M = 100;
/** Vertical exaggeration — near full climb; framing kept via camera. */
const ELE_EXAG = 2.15;
/** Tiny squash only — start/end kept on-canvas mainly by camera FOV. */
const HEIGHT_COMPRESS = 0.95;
/**
 * Idle ring spins ~0.08°/frame → ~0.0014 rad.
 * Cloud stays slower, slightly above prior 0.00045.
 */
const CLOUD_SPIN_RAD = 0.00062;
const POINT_SIZE = 0.4;
/** World radius for start/end spheres (1/4 of previous 0.11). */
const ENDPOINT_RADIUS = 0.0275;
const POINT_COLOR = 0x47c14d;

/**
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 */
function distanceMeters(a, b) {
  const lat0 = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (b.lon - a.lon) * METERS_PER_DEG_LAT * Math.cos(lat0);
  const dy = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/**
 * @param {{ lat: number, lon: number, ele: number }[]} points
 */
function filterTrackOutliers(points) {
  if (points.length < 2) return points;
  /** @type {{ lat: number, lon: number, ele: number }[]} */
  const kept = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = kept[kept.length - 1];
    if (distanceMeters(prev, points[i]) <= MAX_STEP_M) {
      kept.push(points[i]);
    }
  }
  return kept;
}

/**
 * Keep ~1/8 of the filtered points, always preserving start and end.
 * @param {{ lat: number, lon: number, ele: number }[]} points
 */
function downsampleEighth(points) {
  if (points.length <= 2) return points;
  /** @type {{ lat: number, lon: number, ele: number }[]} */
  const out = [];
  for (let i = 0; i < points.length; i += 8) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * @returns {{ lat: number, lon: number, ele: number }[]}
 */
export function loadGpxPoints() {
  const doc = new DOMParser().parseFromString(gpxText, "application/xml");
  const raw = [...doc.querySelectorAll("trkpt")].map((el) => {
    const eleNode = el.querySelector("ele");
    return {
      lat: Number(el.getAttribute("lat")),
      lon: Number(el.getAttribute("lon")),
      ele: eleNode ? Number(eleNode.textContent) : 0,
    };
  });
  return downsampleEighth(filterTrackOutliers(raw));
}

/**
 * Local ENU-ish meters, Y = elevation.
 * @param {{ lat: number, lon: number, ele: number }[]} points
 */
function projectPoints(points) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const eles = points.map((p) => p.ele);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const ele0 = Math.min(...eles);
  const mLon = METERS_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);

  return points.map(
    (p) =>
      new THREE.Vector3(
        (p.lon - lon0) * mLon,
        (p.ele - ele0) * ELE_EXAG,
        -(p.lat - lat0) * METERS_PER_DEG_LAT,
      ),
  );
}

/**
 * @param {number} eleM
 */
function makeEleLabel(eleM) {
  const el = document.createElement("div");
  el.className = "path-points-ele";
  el.textContent = `${Math.round(eleM)} m`;
  const label = new CSS2DObject(el);
  label.center.set(0.5, 0.5);
  return label;
}

/**
 * @param {THREE.Vector3} position
 */
function makeEndpoint(position) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(ENDPOINT_RADIUS, 20, 16),
    new THREE.MeshBasicMaterial({
      color: POINT_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    }),
  );
  mesh.position.copy(position);
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * 3D point cloud from GPS (lat / lon / ele). No other trail chrome.
 * @param {HTMLElement} host
 * @param {{ lat: number, lon: number, ele: number }[]} points
 */
export function mountPathPoints(host, points) {
  if (!points.length) return;

  const canvas = document.createElement("canvas");
  canvas.className = "path-points-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.replaceChildren(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "path-points-labels";
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const root = new THREE.Group();
  scene.add(root);

  const vectors = projectPoints(points);
  for (const v of vectors) v.y *= HEIGHT_COMPRESS;

  const box = new THREE.Box3().setFromPoints(vectors);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  // Leave margin so start/end + labels stay inside the canvas
  const fit = 3.4 / maxDim;

  const fitted = vectors.map((v) => v.clone().sub(center).multiplyScalar(fit));

  const positions = new Float32Array(fitted.length * 3);
  for (let i = 0; i < fitted.length; i += 1) {
    positions[i * 3] = fitted[i].x;
    positions[i * 3 + 1] = fitted[i].y;
    positions[i * 3 + 2] = fitted[i].z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: POINT_COLOR,
    size: POINT_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  root.add(new THREE.Points(geometry, material));

  const startPos = fitted[0];
  const endPos = fitted[fitted.length - 1];
  root.add(makeEndpoint(startPos));
  root.add(makeEndpoint(endPos));

  const startLabel = makeEleLabel(points[0].ele);
  startLabel.position.copy(startPos);
  startLabel.position.y += ENDPOINT_RADIUS * 3.75;
  root.add(startLabel);

  const endLabel = makeEleLabel(points[points.length - 1].ele);
  endLabel.position.copy(endPos);
  endLabel.position.y += ENDPOINT_RADIUS * 3.75;
  root.add(endLabel);

  // Slightly elevated camera looking a bit down — keeps start+end in FOV
  camera.position.set(0.6, 3.6, 8.6);
  camera.lookAt(0, -0.35, 0);

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const tick = () => {
    requestAnimationFrame(tick);
    root.rotation.y += CLOUD_SPIN_RAD;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  tick();
}

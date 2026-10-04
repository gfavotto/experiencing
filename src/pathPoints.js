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
/** Phase 1: trail collapses to the center. */
const FIREWORK_GATHER_MS = 1100;
/** Phase 2: burst + fall. */
const FIREWORK_BURST_MS = 2400;

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
 * Random outward velocity with upward bias (firework spark).
 * @param {THREE.Vector3} out
 */
function randomBurstVelocity(out) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const speed = 0.07 + Math.random() * 0.16;
  out.set(
    Math.sin(phi) * Math.cos(theta) * speed,
    Math.abs(Math.cos(phi)) * speed * 0.9 + 0.055 + Math.random() * 0.07,
    Math.sin(phi) * Math.sin(theta) * speed,
  );
  return out;
}

/**
 * 3D point cloud from GPS (lat / lon / ele). No other trail chrome.
 * @param {HTMLElement} host
 * @param {{ lat: number, lon: number, ele: number }[]} points
 * @returns {{ triggerFirework: () => void, reset: () => void } | undefined}
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
  // Need CPU-side updates during the firework
  geometry.attributes.position.usage = THREE.DynamicDrawUsage;
  const material = new THREE.PointsMaterial({
    color: POINT_COLOR,
    size: POINT_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const cloud = new THREE.Points(geometry, material);
  root.add(cloud);

  const startPos = fitted[0];
  const endPos = fitted[fitted.length - 1];
  const startMesh = makeEndpoint(startPos);
  const endMesh = makeEndpoint(endPos);
  root.add(startMesh);
  root.add(endMesh);

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

  /** @type {Float32Array} */
  const basePositions = new Float32Array(positions);
  /** @type {Float32Array | null} */
  let velocities = null;
  /** @type {"idle" | "gather" | "burst"} */
  let fireworkPhase = "idle";
  let fireworkStart = 0;
  const tmpVel = new THREE.Vector3();
  const gatherCenter = new THREE.Vector3(0, 0, 0);

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  function syncEndpointsFromArray(arr) {
    startMesh.position.set(arr[0], arr[1], arr[2]);
    const last = (fitted.length - 1) * 3;
    endMesh.position.set(arr[last], arr[last + 1], arr[last + 2]);
  }

  function resetFirework() {
    fireworkPhase = "idle";
    velocities = null;
    positions.set(basePositions);
    geometry.attributes.position.needsUpdate = true;
    material.opacity = 0.92;
    material.size = POINT_SIZE;
    startMesh.position.copy(startPos);
    endMesh.position.copy(endPos);
    startMesh.material.opacity = 1;
    endMesh.material.opacity = 1;
    startMesh.visible = true;
    endMesh.visible = true;
    startLabel.visible = true;
    endLabel.visible = true;
  }

  function triggerFirework() {
    positions.set(basePositions);
    geometry.attributes.position.needsUpdate = true;
    velocities = null;
    startLabel.visible = false;
    endLabel.visible = false;
    material.opacity = 0.92;
    material.size = POINT_SIZE;
    fireworkStart = performance.now();
    fireworkPhase = "gather";
  }

  function startBurst() {
    // Snap everyone to the center, then assign burst velocities
    const arr = /** @type {Float32Array} */ (geometry.attributes.position.array);
    velocities = new Float32Array(fitted.length * 3);
    for (let i = 0; i < fitted.length; i += 1) {
      const ix = i * 3;
      arr[ix] = gatherCenter.x;
      arr[ix + 1] = gatherCenter.y;
      arr[ix + 2] = gatherCenter.z;
      randomBurstVelocity(tmpVel);
      const kick = 0.85 + Math.random() * 0.55;
      velocities[ix] = tmpVel.x * kick;
      velocities[ix + 1] = tmpVel.y * kick;
      velocities[ix + 2] = tmpVel.z * kick;
    }
    geometry.attributes.position.needsUpdate = true;
    syncEndpointsFromArray(arr);
    fireworkStart = performance.now();
    fireworkPhase = "burst";
  }

  const tick = () => {
    requestAnimationFrame(tick);

    if (fireworkPhase === "gather") {
      const elapsed = performance.now() - fireworkStart;
      const u = Math.min(1, elapsed / FIREWORK_GATHER_MS);
      // Ease-in-out: pull into a tight knot
      const e = u * u * (3 - 2 * u);
      const posAttr = geometry.attributes.position;
      const arr = /** @type {Float32Array} */ (posAttr.array);

      for (let i = 0; i < fitted.length; i += 1) {
        const ix = i * 3;
        arr[ix] = basePositions[ix] + (gatherCenter.x - basePositions[ix]) * e;
        arr[ix + 1] =
          basePositions[ix + 1] + (gatherCenter.y - basePositions[ix + 1]) * e;
        arr[ix + 2] =
          basePositions[ix + 2] + (gatherCenter.z - basePositions[ix + 2]) * e;
      }
      posAttr.needsUpdate = true;
      syncEndpointsFromArray(arr);
      // Slightly denser glow as they meet
      material.size = POINT_SIZE * (1 + e * 0.6);

      if (u >= 1) startBurst();
    } else if (fireworkPhase === "burst" && velocities) {
      const elapsed = performance.now() - fireworkStart;
      const t = Math.min(1, elapsed / FIREWORK_BURST_MS);
      const posAttr = geometry.attributes.position;
      const arr = /** @type {Float32Array} */ (posAttr.array);

      for (let i = 0; i < fitted.length; i += 1) {
        const ix = i * 3;
        velocities[ix + 1] -= 0.00135;
        velocities[ix] *= 0.985;
        velocities[ix + 1] *= 0.985;
        velocities[ix + 2] *= 0.985;
        arr[ix] += velocities[ix];
        arr[ix + 1] += velocities[ix + 1];
        arr[ix + 2] += velocities[ix + 2];
      }
      posAttr.needsUpdate = true;
      syncEndpointsFromArray(arr);

      const fade = Math.max(0, 1 - t * t);
      material.opacity = 0.92 * fade;
      material.size = POINT_SIZE * (1.6 + t * 1.4);
      startMesh.material.opacity = fade;
      endMesh.material.opacity = fade;

      if (t >= 1) {
        fireworkPhase = "idle";
        startMesh.visible = false;
        endMesh.visible = false;
      }
    } else if (fireworkPhase === "idle") {
      root.rotation.y += CLOUD_SPIN_RAD;
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  tick();

  return {
    triggerFirework,
    reset: resetFirework,
    resize,
  };
}

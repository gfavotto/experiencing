import * as THREE from "three";

/** Max GPU texture edge — keeps ~1400 photos in VRAM. */
const TEX_EDGE = 160;
/** Sphere radius the photo tiles sit on. */
const SPHERE_RADIUS = 42;
/** Concurrent image decodes while filling the sphere. */
const LOAD_CONCURRENCY = 12;
const AUTO_YAW = 0.00055;
const OUTSIDE_DIST_MIN = SPHERE_RADIUS * 1.12;
/** Starting / “comfortable” framing. */
const OUTSIDE_DIST_DEFAULT = SPHERE_RADIUS * 3.6;
/** How far the user can pull back — sphere becomes a small disc. */
const OUTSIDE_DIST_MAX = SPHERE_RADIUS * 32;
const OUTSIDE_FOV = 46;
const INSIDE_FOV = 72;

/**
 * Horizontal latitude rows on a sphere. Photos stay upright (world Y up),
 * facing the vertical axis — no tilt following the sphere curvature.
 * @param {number} n
 * @param {number} radius
 * @returns {{
 *   position: THREE.Vector3,
 *   tileW: number,
 *   tileH: number,
 * }[]}
 */
function layoutHorizontalRows(n, radius) {
  /** @type {{ position: THREE.Vector3, tileW: number, tileH: number }[]} */
  const slots = [];
  if (n <= 0) return slots;

  const rows = Math.max(4, Math.round(Math.sqrt(n * 0.5)));
  const latPad = 0.2;
  const latMin = -Math.PI / 2 + latPad;
  const latMax = Math.PI / 2 - latPad;
  const latSpan = latMax - latMin;

  /** @type {number[]} */
  const lats = [];
  /** @type {number[]} */
  const weights = [];
  for (let r = 0; r < rows; r++) {
    const t = rows === 1 ? 0.5 : r / (rows - 1);
    const lat = latMin + latSpan * t;
    lats.push(lat);
    weights.push(Math.max(0.18, Math.cos(lat)));
  }
  const wSum = weights.reduce((a, b) => a + b, 0);

  /** @type {number[]} */
  const rowCounts = [];
  let assigned = 0;
  for (let r = 0; r < rows; r++) {
    if (r === rows - 1) {
      rowCounts.push(Math.max(1, n - assigned));
    } else {
      const c = Math.max(1, Math.round((n * weights[r]) / wSum));
      rowCounts.push(c);
      assigned += c;
    }
  }
  // Fix overflow/underflow from rounding
  let total = rowCounts.reduce((a, b) => a + b, 0);
  while (total > n) {
    let best = 0;
    for (let r = 1; r < rows; r++) {
      if (rowCounts[r] > rowCounts[best]) best = r;
    }
    if (rowCounts[best] <= 1) break;
    rowCounts[best] -= 1;
    total -= 1;
  }
  while (total < n) {
    let best = 0;
    for (let r = 1; r < rows; r++) {
      if (weights[r] / rowCounts[r] > weights[best] / rowCounts[best]) best = r;
    }
    rowCounts[best] += 1;
    total += 1;
  }

  const rowHeight = (radius * latSpan) / rows;

  for (let r = 0; r < rows; r++) {
    const lat = lats[r];
    const count = rowCounts[r];
    const y = radius * Math.sin(lat);
    const ringR = Math.max(radius * 0.12, radius * Math.cos(lat));
    const tileW = ((2 * Math.PI * ringR) / count) * 0.9;
    const tileH = rowHeight * 0.88;
    const phase = r % 2 === 0 ? 0 : Math.PI / count;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + phase;
      slots.push({
        position: new THREE.Vector3(
          ringR * Math.cos(theta),
          y,
          ringR * Math.sin(theta),
        ),
        tileW,
        tileH,
      });
    }
  }
  return slots;
}

/**
 * Downscale an image into a GPU-friendly canvas texture.
 * @param {CanvasImageSource} source
 * @param {number} srcW
 * @param {number} srcH
 */
function makePhotoTexture(source, srcW, srcH) {
  const scale = TEX_EDGE / Math.max(srcW, srcH, 1);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(source, 0, 0, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, aspect: w / h };
}

/**
 * @param {string} url
 * @returns {Promise<{ texture: THREE.CanvasTexture, aspect: number }>}
 */
function loadPhotoTexture(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      try {
        resolve(makePhotoTexture(img, img.naturalWidth, img.naturalHeight));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

/**
 * Photopoint image sphere: start outside, dolly in to enter, freelook inside.
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} urls
 * @param {{
 *   onProgress?: (loaded: number, total: number) => void,
 *   onMode?: (mode: "outside" | "inside") => void,
 *   onReady?: () => void,
 *   onTap?: () => void,
 * }} [opts]
 */
export function createInfoSphere(canvas, urls, opts = {}) {
  const onProgress = opts.onProgress ?? (() => {});
  const onMode = opts.onMode ?? (() => {});
  const onReady = opts.onReady ?? (() => {});
  const onTap = opts.onTap ?? (() => {});
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x050505, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(OUTSIDE_FOV, 1, 0.1, OUTSIDE_DIST_MAX * 2);
  const shell = new THREE.Group();
  scene.add(shell);

  const slots = layoutHorizontalRows(urls.length, SPHERE_RADIUS);
  const geo = new THREE.PlaneGeometry(1, 1);

  /** @type {THREE.Mesh[]} */
  const meshes = [];
  /** @type {THREE.CanvasTexture[]} */
  const textures = [];

  slots.forEach((slot, i) => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff69b4,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(slot.position);
    // Upright billboard facing the vertical axis (no sphere-tilt)
    mesh.up.set(0, 1, 0);
    mesh.lookAt(0, slot.position.y, 0);
    mesh.scale.set(slot.tileW, slot.tileH, 1);
    mesh.userData.urlIndex = i;
    mesh.userData.tileW = slot.tileW;
    mesh.userData.tileH = slot.tileH;
    shell.add(mesh);
    meshes.push(mesh);
  });

  let disposed = false;
  let raf = 0;
  /** @type {"outside" | "inside"} */
  let mode = "outside";
  let yaw = 0.65;
  let pitch = 0.18;
  let camDist = OUTSIDE_DIST_DEFAULT;
  let dragging = false;
  let dragDistance = 0;
  let lastX = 0;
  let lastY = 0;
  let autoSpin = true;
  /** @type {number | null} */
  let transition = null;

  const setMode = (next) => {
    if (mode === next) return;
    mode = next;
    onMode(mode);
  };

  const applyCamera = () => {
    const maxPitch = Math.PI / 2 - 0.1;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));

    if (mode === "outside") {
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      camera.position.set(camDist * cp * sy, camDist * sp, camDist * cp * cy);
      camera.lookAt(0, 0, 0);
      camera.fov = OUTSIDE_FOV;
      camera.near = 0.2;
      camera.far = OUTSIDE_DIST_MAX * 2;
    } else {
      camera.position.set(0, 0, 0.02);
      const qYaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        yaw,
      );
      const qPitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        pitch,
      );
      camera.quaternion.copy(qYaw).multiply(qPitch);
      camera.fov = INSIDE_FOV;
      camera.near = 0.05;
      camera.far = SPHERE_RADIUS * 3;
    }
    camera.updateProjectionMatrix();
  };

  const enterInside = () => {
    if (mode === "inside" || transition != null) return;
    const startDist = camDist;
    const startYaw = yaw;
    const startPitch = pitch;
    // Face the point on the shell we were approaching
    const endYaw = yaw + Math.PI;
    const endPitch = -pitch;
    const start = performance.now();
    const dur = 900;
    transition = start;
    autoSpin = false;

    const step = (now) => {
      if (disposed) return;
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - (1 - t) ** 3;
      camDist = startDist + (0.02 - startDist) * e;
      yaw = startYaw + (endYaw - startYaw) * e * 0.35;
      pitch = startPitch + (endPitch - startPitch) * e * 0.35;
      // Keep orbital look-at while crossing the shell
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      camera.position.set(camDist * cp * sy, camDist * sp, camDist * cp * cy);
      camera.lookAt(0, 0, 0);
      camera.fov = OUTSIDE_FOV + (INSIDE_FOV - OUTSIDE_FOV) * e;
      camera.near = 0.05;
      camera.far = OUTSIDE_DIST_MAX * 2;
      camera.updateProjectionMatrix();
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        transition = null;
        yaw = endYaw;
        pitch = endPitch;
        camDist = 0.02;
        setMode("inside");
        applyCamera();
      }
    };
    requestAnimationFrame(step);
  };

  const exitOutside = () => {
    if (mode === "outside" || transition != null) return;
    const startYaw = yaw;
    const startPitch = pitch;
    const endYaw = yaw + Math.PI;
    const endPitch = -pitch;
    const endDist = OUTSIDE_DIST_MIN * 1.15;
    const start = performance.now();
    const dur = 850;
    transition = start;
    autoSpin = false;

    const step = (now) => {
      if (disposed) return;
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - (1 - t) ** 3;
      const dist = 0.02 + (endDist - 0.02) * e;
      const y = startYaw + (endYaw - startYaw) * e;
      const p = startPitch + (endPitch - startPitch) * e;
      const cp = Math.cos(p);
      const sp = Math.sin(p);
      const cy = Math.cos(y);
      const sy = Math.sin(y);
      camera.position.set(dist * cp * sy, dist * sp, dist * cp * cy);
      camera.lookAt(0, 0, 0);
      camera.fov = INSIDE_FOV + (OUTSIDE_FOV - INSIDE_FOV) * e;
      camera.near = 0.05;
      camera.far = OUTSIDE_DIST_MAX * 2;
      camera.updateProjectionMatrix();
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        transition = null;
        yaw = endYaw;
        pitch = endPitch;
        camDist = endDist;
        setMode("outside");
        applyCamera();
      }
    };
    requestAnimationFrame(step);
  };

  applyCamera();
  onMode(mode);

  const resize = () => {
    const parent = canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth || window.innerWidth);
    const h = Math.max(1, parent?.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    if (autoSpin && !dragging && transition == null && mode === "outside") {
      yaw += AUTO_YAW;
    }
    if (transition == null) applyCamera();
    renderer.render(scene, camera);
  };

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (transition != null) return;
    dragging = true;
    dragDistance = 0;
    autoSpin = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging || transition != null) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance += Math.hypot(dx, dy);
    if (mode === "outside") {
      yaw -= dx * 0.005;
      pitch += dy * 0.004;
    } else {
      yaw -= dx * 0.0045;
      pitch -= dy * 0.0045;
    }
  };
  const onPointerUp = (e) => {
    const wasTap = dragging && dragDistance < 8;
    dragging = false;
    try {
      canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    if (wasTap && transition == null) onTap();
  };
  const onWheel = (e) => {
    e.preventDefault();
    if (transition != null) return;
    autoSpin = false;
    if (mode === "outside") {
      const next =
        camDist + e.deltaY * 0.045 * Math.max(1, camDist / OUTSIDE_DIST_DEFAULT);
      if (e.deltaY < 0 && next <= OUTSIDE_DIST_MIN) {
        enterInside();
        return;
      }
      camDist = Math.min(OUTSIDE_DIST_MAX, Math.max(OUTSIDE_DIST_MIN, next));
      applyCamera();
      return;
    }
    // Inside: scroll out to leave the sphere
    if (e.deltaY > 0) exitOutside();
  };
  const onDblClick = (e) => {
    e.preventDefault();
    if (transition != null) return;
    autoSpin = false;
    if (mode === "outside") enterInside();
    else exitOutside();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDblClick);
  window.addEventListener("resize", resize);
  resize();
  tick();

  let loaded = 0;
  const total = urls.length;
  onProgress(0, total);

  /** @type {string[]} */
  const queue = [...urls];
  let cursor = 0;

  const pump = async () => {
    while (!disposed && cursor < queue.length) {
      const index = cursor++;
      const url = queue[index];
      const mesh = meshes[index];
      if (!mesh || !url) continue;
      try {
        const { texture, aspect } = await loadPhotoTexture(url);
        if (disposed) {
          texture.dispose();
          return;
        }
        textures.push(texture);
        const mat = /** @type {THREE.MeshBasicMaterial} */ (mesh.material);
        if (mat.map) mat.map.dispose();
        mat.map = texture;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        const tw = Number(mesh.userData.tileW) || 1;
        const th = Number(mesh.userData.tileH) || 1;
        // Fit photo into the upright cell, keep cell bounds
        const cellAspect = tw / th;
        if (aspect > cellAspect) {
          mesh.scale.set(tw, tw / aspect, 1);
        } else {
          mesh.scale.set(th * aspect, th, 1);
        }
      } catch (err) {
        console.warn("photopoint tile failed", url, err);
      }
      loaded += 1;
      onProgress(loaded, total);
    }
  };

  const workers = Array.from(
    { length: Math.min(LOAD_CONCURRENCY, Math.max(1, total)) },
    () => pump(),
  );
  Promise.all(workers)
    .then(() => {
      if (!disposed) onReady();
    })
    .catch(() => {
      if (!disposed) onReady();
    });

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDblClick);
    window.removeEventListener("resize", resize);
    for (const mesh of meshes) {
      const mat = /** @type {THREE.MeshBasicMaterial} */ (mesh.material);
      mat.map = null;
      mat.dispose();
    }
    geo.dispose();
    for (const texture of textures) texture.dispose();
    renderer.dispose();
  };
}

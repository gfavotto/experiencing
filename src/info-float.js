import * as THREE from "three";

/**
 * Group photo floating in black 3D space: starts bottom-right, drifts slowly,
 * tumbles on its own axes, and bounces off the viewport edges.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} imageUrl
 * @returns {() => void} dispose
 */
export function createFloatingPhoto(canvas, imageUrl) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const FOV = 38;
  const CAM_Z = 4.2;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);
  camera.lookAt(0, 0, 0);

  // Outer rig = position in the room; inner spin = tumble on itself
  const rig = new THREE.Group();
  const spin = new THREE.Group();
  rig.add(spin);
  scene.add(rig);

  let disposed = false;
  let raf = 0;
  /** @type {THREE.Mesh | null} */
  let plane = null;
  /** @type {THREE.Texture | null} */
  let texture = null;

  /** Half-extents of the photo in world units (set after load). */
  let halfW = 0.6;
  let halfH = 0.4;
  /** Conservative radius so a tumbling plate stays on screen. */
  let boundR = 0.8;
  let viewHalfW = 1;
  let viewHalfH = 1;

  let x = 0;
  let y = 0;
  let z = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  /** Angular velocity (rad/s) — continuous 3D tumble */
  let wx = 0.05;
  let wy = 0.09;
  let wz = 0.03;
  let ready = false;
  let lastNow = performance.now();

  const quat = new THREE.Quaternion();
  const omegaQ = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisY = new THREE.Vector3(0, 1, 0);
  const axisZ = new THREE.Vector3(0, 0, 1);

  const recomputeViewBounds = () => {
    const dist = Math.max(0.5, CAM_Z - z);
    viewHalfH = Math.tan(THREE.MathUtils.degToRad(FOV * 0.5)) * dist;
    viewHalfW = viewHalfH * camera.aspect;
  };

  const clampBounds = () => {
    // Use diagonal radius so rotation never pushes edges off-screen
    const maxX = Math.max(0.05, viewHalfW - boundR);
    const maxY = Math.max(0.05, viewHalfH - boundR);
    const maxZ = 0.55;
    return { maxX, maxY, maxZ };
  };

  const placeStartBottomRight = () => {
    const { maxX, maxY } = clampBounds();
    x = maxX;
    y = -maxY;
    z = 0;
    // Slow drift up-left into the frame
    const speed = 0.11;
    const angle = Math.PI * 0.72 + (Math.random() - 0.5) * 0.25;
    vx = Math.cos(angle) * speed;
    vy = Math.sin(angle) * speed;
    vz = 0.03;
    wx = 0.045 + Math.random() * 0.03;
    wy = 0.08 + Math.random() * 0.045;
    wz = 0.025 + Math.random() * 0.02;
    quat.identity();
  };

  const resize = () => {
    const parent = canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth || window.innerWidth);
    const h = Math.max(1, parent?.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    recomputeViewBounds();
    if (ready) {
      const { maxX, maxY, maxZ } = clampBounds();
      x = Math.min(maxX, Math.max(-maxX, x));
      y = Math.min(maxY, Math.max(-maxY, y));
      z = Math.min(maxZ, Math.max(-maxZ, z));
    }
  };

  /**
   * @param {number} now
   */
  const tick = (now) => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;

    if (ready && plane) {
      recomputeViewBounds();
      const { maxX, maxY, maxZ } = clampBounds();

      x += vx * dt;
      y += vy * dt;
      z += vz * dt;

      if (x > maxX) {
        x = maxX;
        vx = -Math.abs(vx);
        wy *= -1;
        wx += 0.02;
      } else if (x < -maxX) {
        x = -maxX;
        vx = Math.abs(vx);
        wy *= -1;
        wx -= 0.02;
      }
      if (y > maxY) {
        y = maxY;
        vy = -Math.abs(vy);
        wx *= -1;
        wz += 0.015;
      } else if (y < -maxY) {
        y = -maxY;
        vy = Math.abs(vy);
        wx *= -1;
        wz -= 0.015;
      }
      if (z > maxZ) {
        z = maxZ;
        vz = -Math.abs(vz);
        wy += 0.015;
      } else if (z < -maxZ) {
        z = -maxZ;
        vz = Math.abs(vz);
        wy -= 0.015;
      }

      // Keep tumble calm but always alive
      wx = THREE.MathUtils.clamp(wx, -0.16, 0.16);
      wy = THREE.MathUtils.clamp(wy, -0.2, 0.2);
      wz = THREE.MathUtils.clamp(wz, -0.12, 0.12);
      // Gentle floor so it never stops spinning
      if (Math.abs(wy) < 0.055) wy = Math.sign(wy || 1) * 0.055;
      if (Math.abs(wx) < 0.025) wx = Math.sign(wx || 1) * 0.025;

      // Integrate angular velocity into orientation (true 3D tumble)
      omegaQ.setFromAxisAngle(axisX, wx * dt);
      quat.premultiply(omegaQ);
      omegaQ.setFromAxisAngle(axisY, wy * dt);
      quat.premultiply(omegaQ);
      omegaQ.setFromAxisAngle(axisZ, wz * dt);
      quat.premultiply(omegaQ);
      quat.normalize();

      rig.position.set(x, y, z);
      spin.quaternion.copy(quat);
    }

    renderer.render(scene, camera);
  };

  window.addEventListener("resize", resize);
  resize();
  lastNow = performance.now();
  tick(lastNow);

  const loader = new THREE.TextureLoader();
  loader.load(
    imageUrl,
    (tex) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      texture = tex;

      const img = tex.image;
      const aspect =
        img && img.width && img.height ? img.width / img.height : 1.5;
      const height = 2.35 * 0.5;
      const width = height * aspect;
      halfW = width * 0.5;
      halfH = height * 0.5;
      boundR = Math.hypot(halfW, halfH) * 0.92;

      const geo = new THREE.PlaneGeometry(width, height);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      plane = new THREE.Mesh(geo, mat);
      spin.add(plane);

      recomputeViewBounds();
      placeStartBottomRight();
      ready = true;
    },
    undefined,
    (err) => {
      console.warn("group photo load failed", err);
    },
  );

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    if (plane) {
      plane.geometry.dispose();
      const mat = /** @type {THREE.MeshBasicMaterial} */ (plane.material);
      mat.map = null;
      mat.dispose();
      spin.remove(plane);
      plane = null;
    }
    texture?.dispose();
    texture = null;
    renderer.dispose();
  };
}

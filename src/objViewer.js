import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

/**
 * Absolute http(s) URL so MTLLoader (blob base) does not prefix texture paths.
 * @param {string} url
 */
function toAbsoluteUrl(url) {
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  return new URL(url, window.location.href).href;
}

/**
 * Rewrite MTL texture paths to Vite-resolved absolute URLs.
 * @param {string} mtlText
 * @param {Record<string, string>} textureMap relative path / basename → url
 */
function rewriteMtlTextures(mtlText, textureMap) {
  return mtlText.replace(
    /^((?:map_Kd|map_Ka|map_Ks|map_Bump|map_d|bump|norm|map_ao|disp)\s+)(.+)$/gim,
    (full, prefix, rawPath) => {
      const key = String(rawPath).trim().replace(/\\/g, "/");
      const base = key.split("/").pop() ?? key;
      const url = textureMap[key] ?? textureMap[base];
      if (!url) {
        console.warn("OBJ texture missing from map:", key);
        return full;
      }
      return `${prefix}${toAbsoluteUrl(url)}`;
    },
  );
}

/**
 * @param {string} objUrl
 * @param {string | null} mtlUrl
 * @param {Record<string, string>} textureMap
 */
async function loadObjModel(objUrl, mtlUrl, textureMap) {
  const objLoader = new OBJLoader();

  if (mtlUrl) {
    const mtlText = await fetch(mtlUrl).then((r) => {
      if (!r.ok) throw new Error(`MTL ${r.status}`);
      return r.text();
    });
    const rewritten = rewriteMtlTextures(mtlText, textureMap);
    const blobUrl = URL.createObjectURL(
      new Blob([rewritten], { type: "text/plain" }),
    );
    try {
      const mtlLoader = new MTLLoader();
      const materials = await mtlLoader.loadAsync(blobUrl);
      // blob MTL base would otherwise prefix Vite /assets URLs — textures are absolute https
      materials.baseUrl = "";
      materials.preload();
      objLoader.setMaterials(materials);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  return objLoader.loadAsync(objUrl);
}

/**
 * Mount an interactive OBJ viewer (drag to rotate). Not for the carousel.
 *
 * @param {HTMLElement} host
 * @param {{
 *   objUrl: string,
 *   mtlUrl?: string | null,
 *   textureMap?: Record<string, string>,
 *   label?: string,
 * }} opts
 */
export function mountObjViewer(host, opts) {
  const { objUrl, mtlUrl = null, textureMap = {}, label = "Modello 3D" } = opts;

  const wrap = document.createElement("div");
  wrap.className = "story-obj";
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", label);

  const canvas = document.createElement("canvas");
  canvas.className = "story-obj-canvas";
  wrap.appendChild(canvas);

  const status = document.createElement("span");
  status.className = "story-obj-status";
  status.textContent = "3D…";
  wrap.appendChild(status);

  host.appendChild(wrap);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "default",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(0.45, 0.35, 0.7);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.rotateSpeed = 0.9;

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(2.2, 3.4, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xddeeff, 0.45);
  fill.position.set(-2.4, 0.8, -1.2);
  scene.add(fill);

  let raf = 0;
  let disposed = false;
  /** @type {THREE.Object3D | null} */
  let root = null;

  const fit = (object) => {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const dist = maxDim * 1.85;
    camera.near = Math.max(0.001, dist / 100);
    camera.far = dist * 40;
    camera.position.set(dist * 0.55, dist * 0.4, dist * 0.85);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    camera.updateProjectionMatrix();
  };

  const resize = () => {
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };

  const onPointerDown = (event) => {
    event.stopPropagation();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();
  tick();

  loadObjModel(objUrl, mtlUrl, textureMap)
    .then((object) => {
      if (disposed) return;
      root = object;
      object.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const mat of mats) {
            if (!mat) continue;
            mat.side = THREE.DoubleSide;
            if ("map" in mat && mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
          }
        }
      });
      scene.add(object);
      fit(object);
      status.remove();
    })
    .catch((err) => {
      console.warn("OBJ load failed:", label, err);
      status.textContent = "3D n/d";
    });

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    controls.dispose();
    if (root) {
      root.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose?.();
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const mat of mats) {
            if (!mat) continue;
            for (const key of Object.keys(mat)) {
              const val = mat[key];
              if (val && val.isTexture) val.dispose();
            }
            mat.dispose?.();
          }
        }
      });
      scene.remove(root);
    }
    renderer.dispose();
    wrap.remove();
  };
}

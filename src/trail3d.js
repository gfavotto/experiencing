import * as THREE from "three";
import { createProjector, padBounds } from "./geo.js";
import { createTerrainMesh } from "./terrain.js";

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ points: {lat:number, lon:number, ele:number}[] }} trail
 */
export async function createTrailScene(canvas, trail) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xd8e4ee, 0.004);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  const clock = new THREE.Clock();

  const projector = createProjector(trail.points);
  const vectors = projector.vectors.map((v) => v.clone());
  const center = new THREE.Vector3();
  const box = new THREE.Box3().setFromPoints(vectors);
  box.getCenter(center);
  vectors.forEach((v) => v.sub(center));

  const projectCentered = (lat, lon, ele) =>
    projector.project(lat, lon, ele).sub(center);

  // Terrain under the path (DEM + satellite)
  try {
    const terrainBounds = padBounds(projector.bounds, 0.55);
    const terrain = await createTerrainMesh(terrainBounds, {
      project: projectCentered,
    });
    scene.add(terrain);
  } catch (err) {
    console.warn("Terrain unavailable, showing path only:", err);
  }

  // Lift path slightly above DEM to avoid z-fighting (GPX vs terrain mismatch)
  const PATH_LIFT = 1.1;
  vectors.forEach((v) => {
    v.y += PATH_LIFT;
  });

  box.setFromPoints(vectors);
  box.expandByScalar(3.5);

  const curve = new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.15);
  const tubeGeo = new THREE.TubeGeometry(curve, Math.max(120, vectors.length * 2), 0.45, 10, false);
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0xc9a227,
    roughness: 0.45,
    metalness: 0.15,
    emissive: 0x3a2e08,
    emissiveIntensity: 0.25,
  });
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  scene.add(tube);

  const drawProgress = { t: 0 };
  tube.onBeforeCompile = (shader) => {
    shader.uniforms.uDraw = { value: 0 };
    shader.vertexShader = `
      varying float vPathT;
      ${shader.vertexShader}
    `.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      vPathT = uv.x;
      `,
    );
    shader.fragmentShader = `
      uniform float uDraw;
      varying float vPathT;
      ${shader.fragmentShader}
    `.replace(
      "#include <dithering_fragment>",
      `
      if (vPathT > uDraw) discard;
      #include <dithering_fragment>
      `,
    );
    tube.userData.shader = shader;
  };

  const startMarker = makeMarker(0x2f6f5e);
  startMarker.position.copy(vectors[0]);
  startMarker.position.y += 1.2;
  scene.add(startMarker);

  const endMarker = makeMarker(0xb85c38);
  endMarker.position.copy(vectors[vectors.length - 1]);
  endMarker.position.y += 1.2;
  scene.add(endMarker);

  const ambient = new THREE.AmbientLight(0xf2f6fa, 0.7);
  const key = new THREE.DirectionalLight(0xfff2dd, 1.25);
  key.position.set(40, 80, 20);
  const fill = new THREE.DirectionalLight(0xb8d4ea, 0.45);
  fill.position.set(-50, 30, -40);
  scene.add(ambient, key, fill);

  // Fit camera to path + terrain
  const fitBox = box.clone();
  scene.traverse((obj) => {
    if (obj.isMesh && obj !== tube && obj !== startMarker && obj !== endMarker) {
      fitBox.expandByObject(obj);
    }
  });
  // Prefer path-focused framing if terrain is much larger
  const pathSphere = new THREE.Sphere();
  box.getBoundingSphere(pathSphere);
  const terrainSphere = new THREE.Sphere();
  fitBox.getBoundingSphere(terrainSphere);
  const sphere =
    terrainSphere.radius > pathSphere.radius * 1.8
      ? new THREE.Sphere(pathSphere.center, pathSphere.radius * 1.35)
      : terrainSphere;

  const size = new THREE.Vector3();
  box.getSize(size);
  const lookAt = new THREE.Vector3(0, size.y * 0.02, 0);

  let orbitAngle = -0.7;
  const orbitSpeed = 0.06;
  let fitDistance = 80;
  const EDGE_PAD_PX = 20;

  function updateFitDistance(viewW, viewH) {
    const w = viewW || canvas.clientWidth || window.innerWidth;
    const h = viewH || canvas.clientHeight || window.innerHeight;
    const availW = Math.max(1, w - EDGE_PAD_PX * 2);
    const availH = Math.max(1, h - EDGE_PAD_PX * 2);

    const vFovFull = THREE.MathUtils.degToRad(camera.fov);
    const vFovSafe = 2 * Math.atan(Math.tan(vFovFull / 2) * (availH / h));
    const hFovSafe = 2 * Math.atan(Math.tan(vFovFull / 2) * camera.aspect * (availW / w));
    const limitingFov = Math.min(vFovSafe, hFovSafe);

    fitDistance = sphere.radius / Math.sin(limitingFov / 2);
    camera.near = Math.max(0.1, fitDistance / 100);
    camera.far = fitDistance * 6;
    camera.updateProjectionMatrix();
    if (scene.fog) {
      scene.fog.density = 0.22 / fitDistance;
    }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updateFitDistance(w, h);
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    if (drawProgress.t < 1) {
      drawProgress.t = Math.min(1, drawProgress.t + dt * 0.35);
      if (tube.userData.shader) {
        tube.userData.shader.uniforms.uDraw.value = easeOutCubic(drawProgress.t);
      }
    }

    orbitAngle += orbitSpeed * dt;
    const elev = 0.42;
    const dist = fitDistance;
    const horiz = Math.cos(elev) * dist;
    camera.position.set(
      Math.cos(orbitAngle) * horiz,
      Math.sin(elev) * dist,
      Math.sin(orbitAngle) * horiz,
    );
    camera.lookAt(lookAt);

    startMarker.position.y = vectors[0].y + 1.2 + Math.sin(elapsed * 2) * 0.25;
    endMarker.position.y = vectors[vectors.length - 1].y + 1.2 + Math.sin(elapsed * 2 + 1) * 0.25;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);

  return {
    dispose() {
      window.removeEventListener("resize", resize);
      renderer.dispose();
      tubeGeo.dispose();
      tubeMat.dispose();
    },
  };
}

function makeMarker(color) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 2.2, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4 }),
  );
  stem.position.y = 1.1;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 16),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2,
      roughness: 0.35,
    }),
  );
  head.position.y = 2.4;
  group.add(stem, head);
  return group;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

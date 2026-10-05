import{C as $i,V as F,M as et,T as Xe,Q as Kt,S as wa,a as te,R as eo,P as to,b as Ya,L as Xt,F as ot,c as ne,d as _e,B as Et,e as tt,f as pe,g as nt,h as no,i as Dn,j as Xa,k as at,l as xe,m as ao,n as io,D as Zn,o as rt,I as oo,p as ro,O as Gn,q as Ja,r as so,s as lo,t as $a,N as co,u as po,v as ho,w as Bn,x as ei,y as Vt,z as mo,A as uo,E as Je,G as Tt,H as qt,J as ti,K as ni,U as $e,W as go,X as Ao,Y as Wt,Z as Rn,_ as fo,$ as bo,a0 as _t,a1 as xt,a2 as On,a3 as vo,a4 as ko,a5 as wo,a6 as yo,a7 as To,a8 as ai,a9 as _o,aa as ya,ab as Ta,ac as _a,ad as xa,ae as ii,af as xo,ag as Hn,ah as Eo,ai as oi,aj as Mo,ak as We,al as ri,am as si,an as So,ao as Lo,ap as zo}from"./three.module-HOKLy1Qc.js";const Co=`import * as THREE from "three";

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
`,Io=`import * as THREE from "three";

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
`,Do=`import "./info-styles.css";
import { createFloatingPhoto } from "./info-float.js";
import { createInfoSphere } from "./info-sphere.js";
import groupPhotoUrl from "../assets/media/peak prompt - lagazuoi - 2026 - group.jpeg?url";

/**
 * Eager URL map — hashed paths are inlined in the info bundle.
 * Lazy \`import()\` per photo would fire ~1400 extra JS requests before
 * any image URL is known (looks like a blank page on slow networks).
 */
const photopointUrlModules = import.meta.glob(
  "../assets/media/photopoint/*.{jpg,jpeg,png,webp}",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

/** @type {"it" | "en"} */
let infoLang =
  new URLSearchParams(window.location.search).get("lang")?.toLowerCase() ===
  "en"
    ? "en"
    : "it";

function photopointHref(lang) {
  return lang === "en"
    ? "https://lagazuoi.it/EN/fotopoint.php"
    : "https://lagazuoi.it/IT/fotopoint.php";
}

const INFO_COPY = {
  it: {
    homeAria: "Torna alla home",
    ringsAria: "Torna alle circonferenze",
    langAria: "Lingua",
    hintOutside: "click or scroll",
    hintInside: "click or scroll",
    paragraphs: [
      [
        "Nell’overdose di AI che stiamo vivendo, mi chiedo quanto l’esperienza vissuta sia una ricchezza in via di estinzione. Abbiamo percorso assieme il percorso di salita da Passo Falzarego fino al rifugio Lagazuoi. Abbiamo raccolto contenuti per trovare forme di racconto delle nostre esperienze. Molti contenuti, in molte forme. Una volta raggiunta la vetta abbiamo scattato una foto tramite il ",
        { hrefKey: "photopoint", label: "Photopoint" },
        ", servizio di scatto-upload immagini dei rifugio. Mi sono interessato a queste immagini e alle storie che documentano; momenti reali di persone che hanno condiviso un tempo assieme. Ho scaricato e osservato le fotografie scattate tramite Photopoint negli ultimi 3 mesi, selezionandone 10, tra cui la mia. Ho chiesto ad alcuni modelli AI di analizzare queste immagini ed inventare delle storie possibili che raccontassero le persone ritratte. Da queste storie, ho guidato i modelli AI nel generare immagini e video compatibili con le storie inventate, nonché l’intero sito che stai esplorando. In alcune storie ho usato contenuti che raccontavano in realtà la mia esperienza o miei ricordi. Ogni storia ha trovato una forma di racconto, ma quella storia appartiene alle persone ritratte?",
      ],
      [
        "Questo progetto sviluppato grazie a ",
        { href: "https://pittogramma.xyz", label: "Pittogramma" },
        ", sotto la guida sapiente di ",
        { href: "https://gigadesignstudio.com", label: "Giga Design Studio" },
        " mi ha permesso di fare esperienza di nuovi strumenti di narrazione.",
      ],
      "Un sentito grazie a chi ha reso possibile questa esperienza.",
      [
        { href: "https://www.giuliofavotto.it", label: "Giulio Favotto" },
        ", 2026.",
      ],
    ],
  },
  en: {
    homeAria: "Back to home",
    ringsAria: "Back to the rings",
    langAria: "Language",
    hintOutside: "click or scroll",
    hintInside: "click or scroll",
    paragraphs: [
      [
        "In the AI overdose we are living through, I wonder how much lived experience is a form of wealth on the way to extinction. Together we walked the climb from Passo Falzarego up to Rifugio Lagazuoi. We gathered content to find ways of telling our experiences. Many pieces of content, in many forms. Once we reached the summit we took a photo through the ",
        { hrefKey: "photopoint", label: "Photopoint" },
        ", the hut’s capture-and-upload photo service. I became interested in these images and the stories they document; real moments of people who shared time together. I downloaded and looked through the photographs taken via Photopoint over the last three months, selecting ten of them, including my own. I asked some AI models to analyze these images and invent possible stories that might tell of the people portrayed. From those stories, I guided the AI models in generating images and videos compatible with the invented stories, as well as the entire site you are exploring. In some stories I used content that in fact told my own experience or my memories. Each story found a form of telling — but does that story belong to the people portrayed?",
      ],
      [
        "This project, developed thanks to ",
        { href: "https://pittogramma.xyz", label: "Pittogramma" },
        ", under the wise guidance of ",
        { href: "https://gigadesignstudio.com", label: "Giga Design Studio" },
        ", allowed me to experience new tools for narration.",
      ],
      "Heartfelt thanks to everyone who made this experience possible.",
      [
        { href: "https://www.giuliofavotto.it", label: "Giulio Favotto" },
        ", 2026.",
      ],
    ],
  },
};

/**
 * @param {HTMLElement} host
 * @param {typeof INFO_COPY.it} pack
 * @param {"it" | "en"} lang
 */
function renderInfoCopy(host, pack, lang) {
  host.replaceChildren();
  for (const block of pack.paragraphs) {
    const p = document.createElement("p");
    if (typeof block === "string") {
      p.textContent = block;
    } else {
      for (const part of block) {
        if (typeof part === "string") {
          p.append(document.createTextNode(part));
        } else {
          const a = document.createElement("a");
          a.className = "info-copy-link";
          a.href =
            "hrefKey" in part && part.hrefKey === "photopoint"
              ? photopointHref(lang)
              : part.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = part.label;
          p.append(a);
        }
      }
    }
    host.append(p);
  }
}

/**
 * @param {string} path
 * @param {Record<string, string | null | undefined>} params
 */
function withParams(path, params) {
  const url = new URL(path, window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return \`\${url.pathname}\${url.search}\${url.hash}\`;
}

function resolvePhotopointUrls() {
  return Object.entries(photopointUrlModules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, url]) => String(url))
    .filter(Boolean);
}

async function boot() {
  const canvas = document.querySelector("#info-canvas");
  const floatCanvas = document.querySelector("#info-float-canvas");
  const home = document.querySelector("#info-home");
  const homeRing = document.querySelector("#info-home-ring");
  const hint = document.querySelector("#info-browse-hint");
  const copy = document.querySelector("#info-copy");
  const langSwitch = document.querySelector("#lang-switch");
  const langItBtn = document.querySelector("#lang-it");
  const langEnBtn = document.querySelector("#lang-en");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  if (!(floatCanvas instanceof HTMLCanvasElement)) return;
  if (!(hint instanceof HTMLElement)) return;
  if (!(copy instanceof HTMLElement)) return;
  if (!(langSwitch instanceof HTMLElement)) return;
  if (!(langItBtn instanceof HTMLButtonElement)) return;
  if (!(langEnBtn instanceof HTMLButtonElement)) return;

  /** @type {typeof INFO_COPY.it} */
  let pack = INFO_COPY[infoLang];
  /** @type {"outside" | "inside"} */
  let mode = "outside";

  function hintCopy() {
    return mode === "inside" ? pack.hintInside : pack.hintOutside;
  }

  function syncLangButtons() {
    langItBtn.classList.toggle("is-active", infoLang === "it");
    langEnBtn.classList.toggle("is-active", infoLang === "en");
    langItBtn.setAttribute("aria-pressed", infoLang === "it" ? "true" : "false");
    langEnBtn.setAttribute("aria-pressed", infoLang === "en" ? "true" : "false");
    langSwitch.setAttribute("aria-label", pack.langAria);
    document.documentElement.lang = infoLang === "en" ? "en" : "it";
  }

  function applyLocale() {
    pack = INFO_COPY[infoLang];
    document.documentElement.lang = infoLang === "en" ? "en" : "it";
    renderInfoCopy(copy, pack, infoLang);
    syncLangButtons();

    const langParam = infoLang === "en" ? "en" : null;
    const homeHref = withParams(import.meta.env.BASE_URL, { lang: langParam });
    const ringsHref = withParams(import.meta.env.BASE_URL, {
      rings: "1",
      lang: langParam,
    });
    if (home instanceof HTMLAnchorElement) {
      home.href = homeHref;
      home.setAttribute("aria-label", pack.homeAria);
    }
    if (homeRing instanceof HTMLAnchorElement) {
      homeRing.href = ringsHref;
      homeRing.setAttribute("aria-label", pack.ringsAria);
    }
    if (!hint.hidden) hint.textContent = hintCopy();

    const url = new URL(window.location.href);
    if (infoLang === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    window.history.replaceState({}, "", url);
  }

  /**
   * @param {"it" | "en"} lang
   */
  function setInfoLang(lang) {
    if (lang !== "it" && lang !== "en") return;
    if (lang === infoLang) return;
    infoLang = lang;
    applyLocale();
  }

  applyLocale();

  langItBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setInfoLang("it");
  });
  langEnBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setInfoLang("en");
  });

  const urls = resolvePhotopointUrls();
  if (!urls.length) return;

  let hintPending = true;
  let hintTracking = false;
  /** @type {number | null} */
  let hintHideTimer = null;
  /** @type {number | null} */
  let copyRevealTimer = null;
  /** @type {"sphere" | "group"} */
  let viewMode = "sphere";
  let viewSwitching = false;
  /** @type {(() => void) | null} */
  let disposeSphere = null;
  /** @type {(() => void) | null} */
  let disposeFloat = null;

  function showGroupPhoto() {
    if (viewMode === "group" || viewSwitching) return;
    viewSwitching = true;
    viewMode = "group";
    hideHint();
    hintPending = false;
    document.body.classList.add("is-info-sphere-gone");
    document.body.style.cursor = "pointer";

    if (!disposeFloat) {
      disposeFloat = createFloatingPhoto(floatCanvas, groupPhotoUrl);
    }
    requestAnimationFrame(() => {
      document.body.classList.add("is-info-float-visible");
    });
    window.setTimeout(() => {
      viewSwitching = false;
    }, 500);
  }

  function showSphere() {
    if (viewMode === "sphere" || viewSwitching) return;
    viewSwitching = true;
    viewMode = "sphere";
    hideHint();
    document.body.classList.remove("is-info-float-visible");
    document.body.classList.remove("is-info-sphere-gone");
    document.body.style.cursor = "";
    hintPending = true;
    window.setTimeout(() => {
      viewSwitching = false;
    }, 500);
  }

  function toggleSphereGroup() {
    if (viewMode === "sphere") showGroupPhoto();
    else showSphere();
  }

  /**
   * Tap on the floating group photo → back to the sphere.
   * @param {PointerEvent} e
   */
  function onFloatPointerUp(e) {
    if (viewMode !== "group") return;
    if (e.button != null && e.button !== 0) return;
    // Ignore taps on chrome / copy links
    const t = e.target;
    if (t instanceof Element) {
      if (t.closest("a, button, .info-copy-link, .lang-switch")) return;
    }
    toggleSphereGroup();
  }

  floatCanvas.addEventListener("pointerup", onFloatPointerUp);

  function hideHint() {
    if (hintHideTimer != null) {
      window.clearTimeout(hintHideTimer);
      hintHideTimer = null;
    }
    hintTracking = false;
    hint.classList.remove("is-visible");
    hint.hidden = true;
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = "";
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  function placeHint(clientX, clientY) {
    hint.style.left = \`\${clientX}px\`;
    hint.style.top = \`\${clientY}px\`;
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  function showHintAt(clientX, clientY) {
    hint.textContent = hintCopy();
    hint.hidden = false;
    hint.setAttribute("aria-hidden", "false");
    placeHint(clientX, clientY);
    hintTracking = true;
    requestAnimationFrame(() => {
      hint.classList.add("is-visible");
    });
    if (hintHideTimer != null) window.clearTimeout(hintHideTimer);
    hintHideTimer = window.setTimeout(() => {
      hideHint();
    }, 4200);
  }

  /**
   * @param {PointerEvent} e
   */
  function onHintPointerMove(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    if (hintPending) {
      hintPending = false;
      showHintAt(e.clientX, e.clientY);
      return;
    }
    if (hintTracking) placeHint(e.clientX, e.clientY);
  }

  window.addEventListener("pointermove", onHintPointerMove);
  window.addEventListener(
    "wheel",
    () => {
      hideHint();
      hintPending = false;
    },
    { passive: true },
  );
  window.addEventListener("dblclick", () => {
    hideHint();
    hintPending = false;
  });

  disposeSphere = createInfoSphere(canvas, urls, {
    onMode: (next) => {
      mode = next;
      hideHint();
      hintPending = true;
    },
    onReady: () => {
      if (copyRevealTimer != null) window.clearTimeout(copyRevealTimer);
      copyRevealTimer = window.setTimeout(() => {
        copyRevealTimer = null;
        copy.hidden = false;
        copy.setAttribute("aria-hidden", "false");
        requestAnimationFrame(() => {
          copy.classList.add("is-visible");
        });
      }, 1000);
    },
    onTap: () => {
      toggleSphereGroup();
    },
  });
}

boot();
`,Zo=`import * as THREE from "three";

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
    img.onerror = () => reject(new Error(\`Failed to load \${url}\`));
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
`,Bo=`*,
*::before,
*::after {
  box-sizing: border-box;
}

:root {
  --title-size: calc(clamp(2.5rem, 8vw, 6rem) - 25pt);
  --title-top-pad: calc(1.75rem - 5pt);
  --chrome-bottom: calc(1.75rem - 5pt);
  --chrome-font-size: calc((clamp(2.5rem, 8vw, 6rem) - 25pt) * 0.38);
  --chrome-hit: calc(var(--chrome-font-size) * 1.55);
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: #000000;
  color: #e8ff00;
}

body.is-info {
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}

body.is-info:active {
  cursor: grabbing;
}

.info-stage {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000000;
}

#info-float-canvas,
#info-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

#info-float-canvas {
  z-index: 1;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 1.1s ease, visibility 0s linear 1.1s;
}

#info-canvas {
  z-index: 2;
  opacity: 1;
  transition: opacity 0.85s ease;
}

body.is-info-sphere-gone {
  cursor: default;
}

body.is-info-sphere-gone:active {
  cursor: default;
}

body.is-info-sphere-gone #info-canvas {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity 0.85s ease, visibility 0s linear 0.85s;
}

body.is-info-float-visible #info-float-canvas {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  cursor: pointer;
  transition: opacity 1.1s ease, visibility 0s linear 0s;
}

/* Boot-splash type language, overlaid on the sphere (readable scale) */
.info-copy {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.1em;
  box-sizing: border-box;
  margin: 0;
  padding: calc(var(--title-top-pad) + var(--title-size) + 1.25rem) 4vw
    calc(var(--chrome-bottom) + var(--chrome-hit) + 1.25rem);
  overflow: auto;
  pointer-events: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: calc(var(--title-size) * 0.81);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #e8ff00;
  text-align: center;
  mix-blend-mode: difference;
  opacity: 0;
  visibility: hidden;
  transition: opacity 1.35s ease, visibility 0s linear 1.35s;
}

.info-copy.is-visible {
  opacity: 1;
  visibility: visible;
  transition: opacity 1.35s ease, visibility 0s linear 0s;
}

.info-copy[hidden] {
  display: none;
}

.info-copy p {
  margin: 0;
  width: 100%;
  max-width: 72em;
}

.info-copy-link {
  pointer-events: auto;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 0.12em;
  cursor: pointer;
}

.info-copy-link:hover {
  text-decoration: none;
}

/* Same placement + type as the main experience title */
.info-title.title {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: flex-start;
  gap: 0.35em;
  margin: 0;
  padding: var(--title-top-pad) 0 0;
  pointer-events: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: var(--title-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #ff69b4;
  text-align: center;
  text-transform: lowercase;
}

.info-home.title-home {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.35em;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  pointer-events: auto;
  cursor: pointer;
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  text-transform: inherit;
  text-decoration: none;
  -webkit-appearance: none;
  appearance: none;
  transition: color 0.2s ease;
}

.info-home.title-home:hover {
  color: #e8ff00;
}

.info-home.title-home:focus-visible {
  outline: 2px solid #e8ff00;
  outline-offset: 4px;
}

.title-peak,
.title-prompt {
  text-align: center;
}

/* Same cursor-following hint pattern as story browse hint */
.info-browse-hint {
  position: fixed;
  z-index: 12;
  margin: 0;
  padding: 0;
  max-width: 16rem;
  pointer-events: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: calc(clamp(0.7rem, 1.1vw, 0.85rem));
  line-height: 1.25;
  letter-spacing: 0.02em;
  color: #ff69b4;
  text-transform: lowercase;
  white-space: nowrap;
  opacity: 0;
  transform: translate(12px, 14px);
  transition: opacity 0.35s ease;
}

.info-browse-hint.is-visible {
  opacity: 0.85;
}

.info-browse-hint[hidden] {
  display: none !important;
}

.info-home-ring.home-ring {
  position: absolute;
  left: calc(1.75rem - 5pt);
  bottom: calc(var(--chrome-bottom) + (var(--chrome-hit) - 0.95rem) / 2);
  z-index: 5;
  box-sizing: border-box;
  display: block;
  width: 3.4rem;
  height: 0.95rem;
  padding: 0;
  border: 1.5px solid #ff69b4;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  text-decoration: none;
}

.info-home-ring.home-ring:focus-visible {
  outline: 2px solid #ff69b4;
  outline-offset: 3px;
}

/* Same placement as main experience — pink chrome on black */
.info-lang-switch.lang-switch {
  position: absolute;
  right: 0.35rem;
  top: 50%;
  z-index: 5;
  translate: 0 -50%;
  pointer-events: auto;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: calc(var(--title-size) * 0.38);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #ff69b4;
  text-transform: lowercase;
}

.info-lang-switch .lang-switch-rail {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 0.3em;
  transform: rotate(90deg);
  transform-origin: center center;
}

.info-lang-switch .lang-switch-sep {
  opacity: 1;
  user-select: none;
}

.info-lang-switch .lang-switch-btn {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-transform: inherit;
  opacity: 0.35;
  -webkit-appearance: none;
  appearance: none;
}

.info-lang-switch .lang-switch-btn.is-active {
  opacity: 1;
}

.info-lang-switch .lang-switch-btn:focus-visible {
  outline: 2px solid #ff69b4;
  outline-offset: 4px;
}
`,Ro=`import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

/** Shared Draco decoder for compressed GLBs (phon2_test, etc.). */
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(\`\${import.meta.env.BASE_URL}draco/gltf/\`);
dracoLoader.setDecoderConfig({ type: "wasm" });

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

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
    /^((?:map_Kd|map_Ka|map_Ks|map_Bump|map_d|bump|norm|map_ao|disp)\\s+)(.+)$/gim,
    (full, prefix, rawPath) => {
      const key = String(rawPath).trim().replace(/\\\\/g, "/");
      const base = key.split("/").pop() ?? key;
      const url = textureMap[key] ?? textureMap[base];
      if (!url) {
        console.warn("OBJ texture missing from map:", key);
        return full;
      }
      return \`\${prefix}\${toAbsoluteUrl(url)}\`;
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
      if (!r.ok) throw new Error(\`MTL \${r.status}\`);
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
 * @param {string} url
 */
async function loadGlbModel(url) {
  const gltf = await gltfLoader.loadAsync(url);
  return gltf.scene;
}

/**
 * Mount an interactive 3D viewer (OBJ or GLB). Drag to rotate. Not for the carousel.
 *
 * @param {HTMLElement} host
 * @param {{
 *   url?: string,
 *   objUrl?: string,
 *   format?: "obj" | "glb",
 *   mtlUrl?: string | null,
 *   textureMap?: Record<string, string>,
 *   label?: string,
 * }} opts
 */
export function mountObjViewer(host, opts) {
  const {
    format = "obj",
    mtlUrl = null,
    textureMap = {},
    label = "Modello 3D",
  } = opts;
  const url = opts.url ?? opts.objUrl;
  if (!url) {
    console.warn("3D viewer: missing url", label);
    return () => {};
  }

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

  const loadPromise =
    format === "glb"
      ? loadGlbModel(url)
      : loadObjModel(url, mtlUrl, textureMap);

  loadPromise
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
            // Self-lit so photogrammetry / dark GLBs read on the yellow stage
            if ("emissive" in mat) {
              const base =
                mat.color?.clone?.() ?? new THREE.Color(0xffffff);
              mat.emissive.copy(base);
              mat.emissiveIntensity = format === "glb" ? 0.85 : 0.35;
              if (mat.map && "emissiveMap" in mat && !mat.emissiveMap) {
                mat.emissiveMap = mat.map;
              }
              mat.needsUpdate = true;
            }
          }
        }
      });
      scene.add(object);
      fit(object);
      status.remove();
    })
    .catch((err) => {
      console.warn("3D load failed:", label, err);
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
`,Po=`import * as THREE from "three";
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
  el.textContent = \`\${Math.round(eleM)} m\`;
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
`,Fo=`/**
 * Story titles + brief/full/quotes, keyed by Photopoint asset folder id.
 * Italian is the default UI language; English lives under \`en\`.
 * Prose archive: content/storie-photopoint.md
 */

/**
 * @typedef {{ brief: string, full: string, quotes: string[] }} StoryLocaleCopy
 * @typedef {{
 *   title: string,
 *   datetime: string,
 *   real: boolean,
 *   brief: string,
 *   full: string,
 *   quotes: string[],
 *   en: StoryLocaleCopy,
 * }} StoryCopy
 */

/** @type {Record<string, StoryCopy>} */
export const STORY_COPY = {
  "15513": {
    title: "609",
    datetime: "05.07.2026\\n14:25",
    real: false,
    brief: "Ha rifiutato la funivia. Da Falzarego, Sentiero del Fronte, zaino ancora pieno di rabbia e cose inutili. In forcella ha capito che non era fitness: era una linea di guerra. In vetta ha allargato le braccia — non per lo scatto, perché il corpo diceva di avercela fatta a portare se stessa fin qui.",
    full: "Aveva deciso di non prendere la funivia. Non per snobismo da trekker — per bisogno. A Pian Falzarego lo zaino le pesava ancora di cose inutili: caricabatterie doppi, una maglia “per ogni evenienza”, la rabbia lasciata in città. Il Sentiero del Fronte, all’inizio, era solo un nastro di ghiaia e cartelli CAI. Poi, dopo il primo tornante, il passo le ha imposto un ritmo: respirare, posare il piede, non pensare al telefono.\\n\\nVerso i duemilacinquecento metri, alla Forcella Lagazuoi, il vento le ha tolto le ultime frasi pronte. Ha visto i reticolati ricostruiti, le trincee che un secolo fa chiudevano la via verso Val Badia, e ha capito — senza libri — che quella salita non era un fitness. Era una linea. Ha passato la baracca degli ufficiali austriaci senza entrare: il tavolo e le sedie d’epoca le sono bastati da fuori, come un diorama che non voleva toccare. Ha bevuto l’acqua tiepida e ha ripreso.\\n\\nQuando il Rifugio Lagazuoi le è apparso sopra i ghiaioni, non ha pensato al Photopoint. Ha pensato che le braccia le dolevano in un modo giusto. Solo dopo — terrazza, pedana, scatto automatico — ha allargato le braccia. Non era una posa imparata online. Era il corpo che diceva: *ce l’ho fatta a portare me stessa fin qui*. #609 è il numero che la macchina le ha dato. Il viaggio, invece, se lo tiene senza titolo.",
    quotes: [
      "Nota delle 11:40 — ho spento le notifiche. Se qualcuno cerca, rispondo da sopra.",
      "Zaino troppo pieno di cose che non mi servono. Me ne accorgo a ogni tornante.",
      "Messaggio non inviato: «Oggi non scendo come sono salita.»",
    ],
    en: {
      brief: "She refused the cable car. From Falzarego, along the Front Trail, her pack still heavy with anger and useless things. At the pass she understood it was not fitness: it was a line of war. On the summit she opened her arms — not for the photo, because her body was saying she had carried herself all the way here.",
      full: "She had decided not to take the cable car. Not out of trekker snobbery — out of need. At Pian Falzarego her pack still weighed with useless things: spare chargers, a sweater “just in case,” the anger left behind in the city. The Front Trail, at first, was only a ribbon of gravel and CAI signs. Then, after the first switchback, the pace forced a rhythm on her: breathe, place the foot, stop thinking about the phone.\\n\\nNear twenty-five hundred meters, at Forcella Lagazuoi, the wind took her last ready-made phrases. She saw the reconstructed wire, the trenches that a century ago closed the way toward Val Badia, and she understood — without books — that this climb was not fitness. It was a line. She passed the Austrian officers’ hut without going in: the period table and chairs were enough from outside, like a diorama she did not want to touch. She drank lukewarm water and went on.\\n\\nWhen Rifugio Lagazuoi appeared above the scree, she did not think of the Photopoint. She thought her arms hurt in the right way. Only later — terrace, platform, automatic shutter — did she open her arms. It was not a pose learned online. It was the body saying: *I made it, carrying myself all the way here*. #609 is the number the machine gave her. The journey, she keeps without a title.",
      quotes: [
        "Note, 11:40 — notifications off. If anyone looks for me, I’ll answer from above.",
        "Pack too full of things I don’t need. I notice it at every switchback.",
        "Unsent message: “I won’t come down the way I went up.”",
      ],
    },
  },
  "29235": {
    title: "442",
    datetime: "06.07.2026\\n12:01",
    real: false,
    brief: "Il cane ha fatto più metri di molti day-tripper in cabina. Sul Sentiero del Fronte ha imparato il ritmo: annusare, fermarsi, bere. Niente galleria — troppo buio. Molte cacche interessanti però. In cima si è seduto al centro della pedana, più calmo di tutti. Portarlo dove la montagna è museo: questa è la salita.",
    full: "Il cane ha fatto più metri di molti day-tripper in cabina. L’avevano lasciato a casa altre volte; stavolta no. Da Falzarego hanno scelto il sentiero largo, quello che i blog chiamano “facile” finché le gambe non rispondono. Lui tirava il guinzaglio solo all’inizio, poi ha capito il gioco: restare vicino, annusare il legno delle passerelle, fermarsi quando i padroni bevevano. Cacche di forme inconsuete, dai profumi nuovi. Batteva i denti per ricordare.\\n\\nIn forcella ha incontrato altri cani e ha fatto il suo lavoro sociale. La borsa della spesa blu — assurdità consapevole — conteneva croccantini e una bottiglia d’acqua condivisa. Non sono scesi in Galleria di Mina: troppo buio, troppo stretto, e lui non ama i caschi. Hanno seguito la linea del fronte a cielo aperto, dove un tempo passavano i portatori di notte con decine di chili per uomo, e oggi passano famiglie con bastoncini telescopici.\\n\\nIn vetta, sulla pedana del Photopoint, si è seduto da solo al centro. Non perché glielo avessero ordinato con durezza: perché il legno era fresco e la voce dei suoi umani era lì. Questa, #442, è la storia di una salita banale e rara insieme — portare un animale fin dove la montagna diventa museo — e scoprire che, di tutti, è lui ad arrivare con più calma.",
    quotes: [
      "Chat: «Portiamo anche lui?» / «Sì. Se si ferma, ci fermiamo.»",
      "Ha trovato un odore dietro una pietra e ci ha obbligati a una pausa filosofica.",
      "Diario: oggi il più serio del gruppo pesava 18 chili e aveva quattro zampe.",
    ],
    en: {
      brief: "The dog covered more meters than many day-trippers in the cabin. On the Front Trail he learned the rhythm: sniff, stop, drink. No tunnel — too dark. Plenty of interesting poop, though. On top he sat in the middle of the platform, calmer than anyone. Bringing him where the mountain is a museum: that is the climb.",
      full: "The dog covered more meters than many day-trippers in the cabin. They had left him home other times; not this time. From Falzarego they chose the wide path, the one blogs call “easy” until the legs disagree. He pulled the leash only at the start, then got the game: stay close, sniff the boardwalk wood, stop when his people drank. Droppings of unfamiliar shapes, new smells. He chattered his teeth to remember.\\n\\nAt the pass he met other dogs and did his social work. The blue grocery bag — a deliberate absurdity — held kibble and a shared water bottle. They did not enter the Galleria di Mina: too dark, too narrow, and he hates helmets. They followed the front line under open sky, where porters once moved at night with tens of kilos per man, and families now pass with telescopic poles.\\n\\nOn the summit, on the Photopoint platform, he sat alone in the center. Not because they ordered him harshly: because the wood was cool and his humans’ voices were there. This, #442, is the story of a climb that is ordinary and rare at once — bringing an animal to where the mountain becomes a museum — and finding that, of everyone, he arrives with the most calm.",
      quotes: [
        "Chat: “Are we bringing him too?” / “Yes. If he stops, we stop.”",
        "He found a smell behind a rock and forced us into a philosophical pause.",
        "Diary: today the most serious member of the group weighed 18 kilos and had four legs.",
      ],
    },
  },
  "46544": {
    title: "978",
    datetime: "06.07.2026\\n12:30",
    real: false,
    brief: "Il nonno, Alpino, le aveva lasciato solo pezzi: il freddo delle gallerie, il nome Lagazuoi detto a mezza voce. Ha salito da Falzarego a piedi, casco e frontale, dentro la Galleria di Mina. Non cercava fantasmi: rispetto. In vetta è rimasta di spalle. Il volto spettava alle Tofane e a lui.",
    full: "Suo nonno non le ha mai raccontato la guerra per intero. Le ha lasciato pezzi: il freddo nelle gallerie, il peso sulle spalle, il nome *Lagazuoi* pronunciato come si pronunciano le cose che non si vogliono ripetere. Era stato dagli Alpini, o vicino agli Alpini — lei non ha mai avuto il grado giusto, solo una foto sbiadita e l’odore di lana umida nei ricordi d’infanzia.\\n\\nQuest’anno ha deciso di salire da Falzarego senza funivia, proprio per sentire i polpacci. Ha noleggiato casco e frontale all’infopoint, è entrata nella Galleria di Mina e ha capito subito il senso delle sue reticenze: sette gradi, umidità, pendenza che ti entra nelle ginocchia. Dentro la roccia ha ripensato ai portatori notturni, alle mine del 1916–17, alla Cengia Martini aggrappata a mezza parete. Non ha cercato fantasmi. Ha cercato rispetto.\\n\\nUscita alla luce, ha proseguito verso forcella e baracca. Non ha messo monete nel cannocchiale in vetta. È rimasta di spalle al Photopoint perché il volto, quel giorno, spettava alle Tofane e a un uomo morto da anni che non vedrà mai lo scatto. #978 è il numero della macchina. La storia è il nonno che, senza saperlo, le ha indicato la salita.",
    quotes: [
      "Avevo la sua foto nello zaino. Non l’ho tirata fuori: mi bastava saperla lì.",
      "Dentro la roccia ho parlato a voce bassa, come si fa in chiesa — o in cucina da lui.",
      "Appunto: non voglio una storia completa. Voglio un pezzo vero.",
    ],
    en: {
      brief: "Her grandfather, an Alpino, had left her only fragments: the cold of the tunnels, the name Lagazuoi said under his breath. She climbed from Falzarego on foot, helmet and headlamp, into the Galleria di Mina. She was not hunting ghosts: respect. On the summit she stayed with her back turned. The face belonged to the Tofane — and to him.",
      full: "Her grandfather never told her the war in full. He left her pieces: the cold in the tunnels, the weight on the shoulders, the name *Lagazuoi* spoken the way you speak things you do not want to repeat. He had been with the Alpini, or near the Alpini — she never had the right rank, only a faded photo and the smell of damp wool in childhood memory.\\n\\nThis year she decided to climb from Falzarego without the cable car, precisely to feel her calves. She rented a helmet and headlamp at the info point, entered the Galleria di Mina, and understood at once the sense of his reticence: seven degrees, humidity, a grade that works into the knees. Inside the rock she thought of the night porters, the mines of 1916–17, the Cengia Martini clinging halfway up the wall. She was not looking for ghosts. She was looking for respect.\\n\\nBack in the light, she went on toward the pass and the hut. She put no coins in the summit telescope. She stayed with her back to the Photopoint because that day the face belonged to the Tofane and to a man dead for years who will never see the frame. #978 is the machine’s number. The story is the grandfather who, without knowing it, pointed her to the climb.",
      quotes: [
        "I had his photo in the pack. I didn’t take it out: knowing it was there was enough.",
        "Inside the rock I spoke softly, the way you do in church — or in his kitchen.",
        "Note: I don’t want a complete story. I want one true piece.",
      ],
    },
  },
  "55826": {
    title: "557",
    datetime: "07.07.2026\\n13:16",
    real: false,
    brief: "Camminavano sull’Alta Via da giorni, rifugio prenotato mesi prima. Verso forcella, in un tornante senza pubblico, si sono detti una promessa rimandata in città: restare nello stesso passo. Il bacio in vetta è solo la firma. La storia è nata prima, tra canederli, temporali e piedi nel lago.",
    full: "Camminavano da giorni sull’Alta Via 1 — o almeno su un pezzo abbastanza lungo da far loro dimenticare le mail. Avevano prenotato il Rifugio Lagazuoi mesi prima, come fanno gli australiani e gli inglesi nei blog, e avevano temuto la folla. Invece, sulla salita verso forcella, c’era abbastanza silenzio da parlarsi davvero.\\n\\nLui aveva lo zaino più pesante; lei teneva il ritmo. A un tornante sopra i duemilatrecento metri, senza anello e senza pubblico, si sono fermati e si sono detti una cosa che in città rimandavano da mesi. Non un matrimonio da organizzare: una promessa di restare nello stesso passo. Poi hanno riso, perché dire cose gravi con i bastoncini in mano sembra sempre un po’ comico.\\n\\nIl bacio sul Photopoint è solo la firma in cima. Il viaggio era tutto ciò che c’era prima: i canederli della sera prima in un altro rifugio, i piedi nel lago a metà tappa come nei diari AV1, la paura del temporale, il sollievo quando il Lagazuoi è diventato un tetto e non un miraggio. #557 non nasce sulla pedana. Nasce sui tornanti.",
    quotes: [
      "WhatsApp, 06:12: «Se piove ci bagniamo. Se no, parliamo.»",
      "Ieri canederli. Oggi una frase che in città rimandavamo da mesi.",
      "Lei nel diario: «Ha preso lo zaino pesante senza farmelo notare. Tipico.»",
    ],
    en: {
      brief: "They had been walking the Alta Via for days, hut booked months ahead. Toward the pass, on a switchback with no audience, they said a promise postponed in the city: stay in the same stride. The kiss on the summit is only the signature. The story began earlier — among canederli, storms, and feet in a lake.",
      full: "They had been walking Alta Via 1 for days — or at least a stretch long enough to make them forget email. They had booked Rifugio Lagazuoi months ahead, the way Australians and Brits do in the blogs, and they had feared the crowds. Instead, on the climb toward the pass, there was enough silence to really speak.\\n\\nHe carried the heavier pack; she held the pace. On a switchback above twenty-three hundred meters, with no ring and no audience, they stopped and said something they had postponed for months in the city. Not a wedding to organize: a promise to stay in the same stride. Then they laughed, because saying serious things with poles in your hands always feels a little comic.\\n\\nThe kiss on the Photopoint is only the signature at the top. The journey was everything before: canederli the night before in another hut, feet in a lake mid-stage as in the AV1 diaries, fear of the storm, relief when Lagazuoi became a roof and not a mirage. #557 is not born on the platform. It is born on the switchbacks.",
      quotes: [
        "WhatsApp, 06:12: “If it rains we get wet. If not, we talk.”",
        "Yesterday canederli. Today a sentence we kept postponing in the city.",
        "Her diary: “He took the heavy pack without making me notice. Typical.”",
      ],
    },
  },
  "57198": {
    title: "629",
    datetime: "11.07.2026\\n08:53",
    real: false,
    brief: "È salito col pomeriggio affollato, ha preso il dormitorio, ha aspettato che dopo le diciassette la cima diventasse eremo. Ha visto il tramonto sulle Tofane. All’alba è uscito prima degli altri: croce, memoria delle gallerie, poi la pedana di spalle. Arriva in vetta due volte. Conta la seconda.",
    full: "È salito il pomeriggio prima, quando la funivia vomitava ancora day-tripper. Ha preso una branda nel dormitorio Pompanin, ha pagato la doccia a gettone, ha cenato al tavolo sbagliato e si è fatto rimproverare — come nei racconti dei trekker inglesi — e ha aspettato. Dopo le diciassette la cima ha cambiato personalità: da luna park a eremo. Ha visto il tramonto sulle Tofane e ha capito perché si pernotta.\\n\\nAl mattino è uscito prima del caffè degli altri. Non verso il Photopoint subito: verso la croce, poi un tratto indietro verso la memoria — feritoie, aria delle gallerie ancora nelle ossa dal giorno in cui era sceso con casco e frontale. Solo alle otto e cinquantatré si è fermato sulla pedana, di spalle, mentre due ospiti del rifugio già chiacchieravano al tavolino con i bicchieri in mano.\\n\\n#629 è la storia di chi arriva in vetta due volte: la prima con la folla, la seconda con l’alba. Il Photopoint coglie la seconda. Il viaggio vero è la notte in mezzo.",
    quotes: [
      "Nota in camerata: sveglia prima del caffè degli altri. Porta chiusa piano.",
      "Mi hanno rimproverato per il posto a tavola. Meglio così — meno chiacchiere.",
      "Messaggio a nessuno: «Stasera la montagna è diventata quieta. Io resto.»",
    ],
    en: {
      brief: "He came up with the crowded afternoon, took a dorm bed, waited for the summit to become a hermitage after five. He watched the sunset on the Tofane. At dawn he left before the others: the cross, the memory of the tunnels, then the platform with his back turned. He reaches the top twice. The second time counts.",
      full: "He came up the afternoon before, when the cable car was still spilling day-trippers. He took a bunk in the Pompanin dormitory, paid for the coin-operated shower, ate at the wrong table and got scolded — as in the English trekker stories — and waited. After five the summit changed personality: from theme park to hermitage. He watched the sunset on the Tofane and understood why people overnight.\\n\\nIn the morning he left before the others’ coffee. Not straight to the Photopoint: toward the cross, then a stretch back toward memory — embrasures, tunnel air still in the bones from the day he had descended with helmet and headlamp. Only at eight fifty-three did he stop on the platform, back turned, while two hut guests already chatted at the little table with glasses in hand.\\n\\n#629 is the story of someone who arrives on the summit twice: first with the crowd, second with the dawn. The Photopoint catches the second. The real journey is the night in between.",
      quotes: [
        "Dorm note: wake before the others’ coffee. Close the door softly.",
        "They scolded me for the table seat. Better that way — less talk.",
        "Message to no one: “Tonight the mountain went quiet. I’m staying.”",
      ],
    },
  },
  "65761": {
    title: "598",
    datetime: "11.07.2026\\n15:44",
    real: false,
    brief: "L’abito e lo smoking sono saliti in funivia con il fotografo; loro hanno voluto il Sentiero del Fronte a piedi, polvere sui pantaloni da trekking. Si sono cambiati in rifugio, ridendo. Un sì tra gallerie di guerra e oceano di vette. Hiking nuziale: la cima al posto dell’altare.",
    full: "L’abito e lo smoking non sono saliti sulle loro spalle per tutto il dislivello — sarebbe stato cinema, non vita. Li avevano lasciati a Cortina; un amico fotografo li ha portati su in funivia, come nelle storie di elopement che si leggono sui siti dei wedding photographer. Loro, invece, hanno voluto arrivare a piedi: Sentiero del Fronte, polvere fine sull’orlo dei pantaloni da trekking, mani che sapevano già di pietra.\\n\\nSotto i vestiti da sposi c’erano ancora i calzini sudati del cammino. Si sono cambiati dietro una porta del rifugio, ridendo nervosi, mentre fuori i turisti ordinavano birra. Avevano scelto il Lagazuoi perché sotto i piedi ci sono le gallerie della Grande Guerra e sopra c’è un oceano di vette — e perché un sì detto qui non somiglia a nessun sì da salone. Venivano da lontano, lontanissimo, ma una persona li legava a quel luogo, e loro volevano legarsi ulteriormente.\\n\\nQuando sono usciti in smoking e tulle, il vento ha provato a sollevare la gonna e qualcuno in canotta ha tagliato il bordo del mondo senza fermarsi. #598 è hiking nuziale: non la cerimonia intera, ma il tratto di ghiaione in cui due persone hanno deciso che la cima, e non l’altare, era il posto giusto per cominciare.",
    quotes: [
      "Dietro la porta del rifugio: «Riesci a chiudere lo smoking con le mani che tremano?»",
      "Vocale a mia sorella: «Ci siamo detti di sì con la polvere ancora sugli scarponi.»",
      "Sul telefono, bozza: luogo: qui. abito: dopo. testimoni: il vento.",
    ],
    en: {
      brief: "The dress and the tuxedo rode the cable car with the photographer; they wanted the Front Trail on foot, dust on their trekking trousers. They changed at the hut, laughing. A yes between war tunnels and an ocean of peaks. Wedding hiking: the summit instead of the altar.",
      full: "The dress and the tuxedo did not ride their shoulders for the whole elevation — that would have been cinema, not life. They had left them in Cortina; a photographer friend brought them up by cable car, as in the elopement stories on wedding photographers’ sites. They, instead, wanted to arrive on foot: Front Trail, fine dust on the cuffs of trekking trousers, hands that already knew stone.\\n\\nUnder the wedding clothes the sweaty socks from the walk were still there. They changed behind a hut door, laughing nervously, while outside tourists ordered beer. They had chosen Lagazuoi because underfoot lie the tunnels of the Great War and above lies an ocean of peaks — and because a yes said here resembles no salon yes. They came from far away, very far, but one person tied them to that place, and they wanted to bind themselves further.\\n\\nWhen they stepped out in tuxedo and tulle, the wind tried to lift the skirt and someone in a tank top cut across the edge of the world without stopping. #598 is wedding hiking: not the whole ceremony, but the stretch of scree where two people decided the summit, not the altar, was the right place to begin.",
      quotes: [
        "Behind the hut door: “Can you close the tuxedo with hands that shake?”",
        "Voice note to my sister: “We said yes with dust still on our boots.”",
        "Phone draft: place: here. clothes: later. witnesses: the wind.",
      ],
    },
  },
  "67091": {
    title: "890",
    datetime: "16.07.2026\\n14:49",
    real: false,
    brief: "I bambini volevano la funivia; i genitori dissero «un pezzo a piedi». Il pezzo divenne seicentocinquanta metri di dislivello, pause ogni tre tornanti, snack in forcella. Niente galleria: troppo buia. In vetta pollice alzato e pile rosa. Arrivare insieme valeva più delle date delle mine.",
    full: "I bambini avevano chiesto la funivia. I genitori avevano risposto: «Un pezzo a piedi, poi si vede». Da Falzarego il «pezzo» è diventato la salita vera — circa seicentocinquanta metri di dislivello che sui blog sembrano un numero e sulle gambe di un bambino in pile rosa diventano un’epopea. Hanno fatto pause ogni tre tornanti. Hanno contato camosci che forse erano pietre. Hanno mangiato snack sulla Forcella Lagazuoi mentre un giovane con lo zaino giallo spiegava al cannocchiale delle cose troppo grandi.\\n\\nNon hanno fatto la galleria: troppo buia per i più piccoli, dicevano le guide. Hanno seguito il cielo. In vetta il bambino ha alzato il pollice prima ancora dello scatto; la bambina era già una bandiera rosa contro il calcare. Intorno, un uomo seduto a terra con i bastoncini rossi recuperava da una salita più dura della loro — e quella vista, per i genitori, è stata la lezione: la montagna tiene insieme chi arriva in tanti modi.\\n\\n#890 è una gita famigliare che sfiora la storia senza entrarci fino in fondo, e va bene così. Arrivare insieme contava più di sapere le date delle mine.",
    quotes: [
      "Papà nel gruppo famiglia: «Pausa snack. Non è una negoziazione.»",
      "La piccola ha chiesto se le pietre erano camosci. Abbiamo detto di sì.",
      "Nota mamma: oggi non importava sapere le date. Importava chi teneva la mano.",
    ],
    en: {
      brief: "The children wanted the cable car; the parents said “a bit on foot.” The bit became six hundred fifty meters of elevation, rests every three switchbacks, snacks at the pass. No tunnel: too dark. On top a thumbs-up and pink fleece. Arriving together mattered more than the dates of the mines.",
      full: "The children had asked for the cable car. The parents had answered: “A bit on foot, then we’ll see.” From Falzarego the “bit” became the real climb — about six hundred fifty meters of elevation that look like a number on blogs and become an epic on the legs of a child in pink fleece. They rested every three switchbacks. They counted chamois that might have been stones. They ate snacks on Forcella Lagazuoi while a young man with a yellow pack explained things too large into the telescope.\\n\\nThey skipped the tunnel: too dark for the little ones, the guides said. They followed the sky. On the summit the boy raised his thumb before the shutter; the girl was already a pink flag against the limestone. Nearby, a man sat on the ground with red poles recovering from a harder climb than theirs — and that sight, for the parents, was the lesson: the mountain holds together those who arrive in many ways.\\n\\n#890 is a family day that brushes history without entering it all the way, and that is fine. Arriving together mattered more than knowing the dates of the mines.",
      quotes: [
        "Dad in the family chat: “Snack break. Not a negotiation.”",
        "The little one asked if the stones were chamois. We said yes.",
        "Mom’s note: today the dates didn’t matter. Who held whose hand did.",
      ],
    },
  },
  "72700": {
    title: "898",
    datetime: "23.07.2026\\n12:52",
    real: false,
    brief: "Non ha detto a nessuno dove andava. Alba, giacca mimetica, versante meno battuto: inseguiva un cerbiatto visto anni prima in Valparola. Ha evitato i gruppi del fronte, la baracca, le chiacchiere. In vetta nessun animale — solo lui e il fallimento. Una salita segreta, non da confessare al rifugio.",
    full: "Non ha detto a nessuno dove andava. Ha preso l’auto prima dell’alba, ha lasciato Falzarego quando i primi pullman ancora dormivano, ed è salito dal versante meno battuto con la giacca mimetica e i bastoncini. Non era un cacciatore da trofeo da salotto. Era qualcuno che da anni inseguiva — o credeva di inseguire — un cerbiatto visto una sola volta in Valparola, una macchia chiara tra i mughi, e da allora trasformata in ossessione privata.\\n\\nHa camminato in silenzio lungo linee che un secolo fa erano di rifornimento e di fuoco. Ha evitato i gruppi del Sentiero del Fronte. Ha passato la baracca degli ufficiali senza fermarsi: troppo tempo sospeso, troppa umanità. Voleva solo gli occhi dell’animale, o la prova di non averlo sognato. In alta quota la caccia è diventata altro — fiato, pazienza, il sospetto di essere lui il braccato dal vuoto.\\n\\nIn vetta non c’era nessun cerbiatto. C’era il Photopoint, un turista nello zaino rosso chino sul cannocchiale, e lui in piedi con l’espressione di chi ha fallito una missione e, nello stesso istante, ha raggiunto comunque una cima. #898 è la storia di una salita segreta: non per la foto, per qualcosa che non si confessa al rifugio.",
    quotes: [
      "Calendario barrato: oggi. Destinazione lasciata in bianco apposta.",
      "Ho evitato due gruppi e una baracca. Troppa voce per quello che cerco.",
      "Taccuino, ultima riga: se non c’è, almeno so di aver guardato bene.",
    ],
    en: {
      brief: "He told no one where he was going. Dawn, camo jacket, the quieter flank: he was after a fawn seen years earlier in Valparola. He avoided the front groups, the hut, the chatter. On the summit no animal — only him and the failure. A secret climb, not one to confess at the refuge.",
      full: "He told no one where he was going. He took the car before dawn, left Falzarego while the first coaches still slept, and climbed the quieter flank in a camo jacket with poles. He was not a parlor trophy hunter. He was someone who for years had been following — or believed he was following — a fawn seen once in Valparola, a pale patch among the pines, since then turned into a private obsession.\\n\\nHe walked in silence along lines that a century ago were supply and fire. He avoided the groups on the Front Trail. He passed the officers’ hut without stopping: too much suspended time, too much humanity. He wanted only the animal’s eyes, or proof he had not dreamed it. High up the hunt became something else — breath, patience, the suspicion that he was the one being stalked by the emptiness.\\n\\nOn the summit there was no fawn. There was the Photopoint, a tourist in a red pack bent over the telescope, and him standing with the look of someone who failed a mission and, in the same instant, still reached a summit. #898 is the story of a secret climb: not for the photo, for something you do not confess at the hut.",
      quotes: [
        "Calendar crossed out: today. Destination left blank on purpose.",
        "I avoided two groups and a hut. Too much voice for what I’m after.",
        "Notebook, last line: if it isn’t there, at least I know I looked well.",
      ],
    },
  },
  "83531": {
    title: "690",
    datetime: "03.10.2026\\n07:09",
    real: false,
    brief: "Aveva letto che dopo le diciassette il Lagazuoi cambia pelle. Ottobre, funivia il pomeriggio, notte in rifugio mentre la folla scende. All’alba: sole di taglio, valle in foschia, terrazza vuota. Ha comprato con una notte ciò che i day-tripper non vedono. L’alba è la ricevuta.",
    full: "Aveva letto che dopo le diciassette il Lagazuoi cambia pelle. Per questo aveva prenotato ottobre — stagione corta, meno code, ultima luce. Era salita nel pomeriggio con la funivia, perché il giorno dopo voleva le gambe fresche per l’alba, non per dimostrare nulla. Aveva cenato guardando le Tofane spopolarsi; aveva sentito il silenzio arrivare come un ospite in ritardo.\\n\\nDi notte, dalla camerata, il vento raccontava la stessa storia di sempre: pietra forata, gallerie sotto i piedi, nemici di ieri diventati museo. Al mattino è uscita alle sette e nove, quando il sole tagliava ancora di filo e la valle a destra restava in foschia. Nessuna borsa Lidl, nessun bacio da mezzogiorno. Solo lei, la giacca pesante, e la certezza di aver comprato con una notte in rifugio ciò che i day-tripper non vedono.\\n\\n#690 è il viaggio breve e verticale di chi sale per restare — non per consumare la vista in un’ora. Il Photopoint all’alba è solo la ricevuta.",
    quotes: [
      "Prenotazione fatta a settembre: volevo la stagione corta, non lo sconto.",
      "Di notte il vento sembrava qualcuno che conosceva già la stanza.",
      "Alle sette e qualcosa: giacca, scarpe, nessuno a cui dare la buonanotte.",
    ],
    en: {
      brief: "She had read that after five Lagazuoi changes its skin. October, cable car in the afternoon, a night in the hut while the crowd goes down. At dawn: hard-edged sun, valley in haze, empty terrace. With one night she bought what day-trippers never see. Dawn is the receipt.",
      full: "She had read that after five Lagazuoi changes its skin. That is why she booked October — short season, fewer queues, last light. She rode up in the afternoon by cable car, because the next day she wanted fresh legs for dawn, not to prove anything. She ate dinner watching the Tofane empty out; she felt the silence arrive like a late guest.\\n\\nAt night, from the dorm, the wind told the same old story: pierced stone, tunnels underfoot, yesterday’s enemies become museum. In the morning she went out at seven nine, when the sun still cut on edge and the valley to the right stayed in haze. No Lidl bag, no midday kiss. Only her, the heavy jacket, and the certainty of having bought with one hut night what day-trippers never see.\\n\\n#690 is the short vertical journey of someone who climbs to stay — not to consume the view in an hour. The Photopoint at dawn is only the receipt.",
      quotes: [
        "Booked in September: I wanted the short season, not the discount.",
        "At night the wind felt like someone who already knew the room.",
        "Sometime after seven: jacket, shoes, no one to say goodnight to.",
      ],
    },
  },
  "92239": {
    title: "683",
    datetime: "03.10.2026\\n07:42",
    real: true,
    brief: "Voleva la luce, non la folla. Buio a Falzarego, Sentiero dei Kaiserjäger, reflex e maglione arancio contro il calcare. Salendo ha pensato ai portatori e ai bengala. In vetta: caffè, macchina sul tavolo, corpo fermo dove la luce finalmente lavora. Non caccia animali: caccia un’ora.",
    full: "Voleva la luce, non la folla. Aveva lasciato l’auto a Falzarego al buio e aveva preso il Sentiero dei Kaiserjäger — la memoria austriaca, cenge e vuoto — con la reflex nello zaino e il maglione arancio scelto apposta per leggere contro il calcare. Non cacciava animali. Cacciava un’ora: quella in cui le stratificazioni delle Tofane smettono di essere cartolina e diventano volume. Era rimasto colpito dal trovare durante il percorso elementi antropici anonimi, ricoperti, ma con sembianze umane. Quanto la montagna oggi subisce il nostro impatto?\\n\\nSalendo ha pensato ai Kaiserjäger che portavano viveri su quel tracciato, ai bengala, al silenzio obbligato. Ha scattato poco: risparmiava batteria e attenzione. In vetta ha ordinato un caffè, ha posato la macchina sul tavolino del Photopoint, ha aspettato che il vapore della tazzina gli dicesse che era vivo e non solo un occhio dietro l’ottica.\\n\\nMezz’ora prima, sulla stessa terrazza, c’era #690. Forse si sono sfiorati senza parlarsi — due solitudini d’ottobre cucite dallo stesso azzurro. #683 è la storia di una salita fatta di esposizione e pazienza: arrivare in cima non per celebrarsi, ma per mettere infine il corpo fermo dove la luce, finalmente, lavora.",
    quotes: [
      "Batteria al 41%. Meglio così: mi obbliga a scegliere.",
      "Sul sentiero qualcosa di umano sotto la pietra. Non so se fotografarlo.",
      "Ordine al bancone: «Un caffè. La macchina resta sul tavolo un minuto.»",
    ],
    en: {
      brief: "He wanted the light, not the crowd. Dark at Falzarego, Kaiserjäger Trail, SLR and an orange sweater against the limestone. Climbing he thought of the porters and the flares. On top: coffee, camera on the table, body still where the light finally works. He does not hunt animals: he hunts an hour.",
      full: "He wanted the light, not the crowd. He left the car at Falzarego in the dark and took the Kaiserjäger Trail — Austrian memory, ledges and void — with the SLR in the pack and an orange sweater chosen to read against the limestone. He was not hunting animals. He was hunting an hour: the one when the Tofane’s strata stop being a postcard and become volume. Along the way he was struck by anonymous human traces, covered over, yet with human shape. How much does the mountain bear our impact today?\\n\\nClimbing he thought of the Kaiserjäger who carried supplies on that line, of the flares, of obligatory silence. He shot little: saving battery and attention. On the summit he ordered a coffee, set the camera on the Photopoint table, waited for the steam from the cup to tell him he was alive and not only an eye behind the lens.\\n\\nHalf an hour earlier, on the same terrace, there was #690. Maybe they brushed past without speaking — two October solitudes stitched by the same blue. #683 is the story of a climb made of exposure and patience: arriving on top not to celebrate yourself, but to set the body still at last where the light, finally, works.",
      quotes: [
        "Battery at 41%. Better that way: it forces me to choose.",
        "On the path something human under the stone. Not sure I should photograph it.",
        "Order at the counter: “One coffee. The camera stays on the table a minute.”",
      ],
    },
  },
  "62537": {
    title: "537",
    datetime: "03.10.2026\\n22:28",
    real: false,
    brief: "Ultima notte in foresteria, sulla funivia che è stata la sua vita. Domani è in pensione. Di pomeriggio, con la moglie, erano ombre sul Photopoint. Quassù ha trovato rifugio: salire, osservare. I genitori lo chiamarono come Vittorio Sella. Il Cervino della foto in ingresso — ora ci torna.",
    full: "Vittorio ha dedicato la vita alla funivia. Non a un mestiere qualunque: a quel cavo teso tra Falzarego e la cima, alle cabine che scaricano day-tripper e riportano silenzio, alla routine di chi sale perché qualcun altro possa salire. I monti, per lui, non erano scenario. Erano rifugio. L’atto di arrivare in alto e osservare il mondo da quassù era l’unico lavoro che avrebbe potuto fare — e forse era già tutto scritto.\\n\\nI genitori lo avevano chiamato così in memoria di Vittorio Sella, il fotografo che per primo aveva fotografato e raccontato moltissime cime. In ingresso, a casa, conservavano una fotografia del Cervino innevato: per il ragazzo era una meta, non una cornice. Anni dopo, le Tofane e il Lagazuoi gli sono bastati come ufficio; il Cervino è rimasto la direzione interna.\\n\\nIl tre ottobre duemilaventisei, di pomeriggio, lui e sua moglie si sono fermati sulla pedana del Photopoint. Di spalle alla luce, di profilo alla pietra: due ombre. Non una posa da cartolina. Un saluto fatto con il corpo. Poi la sera, nella foresteria della funivia — l’ultima notte. Alle ventidue e ventotto la macchina ha scattato nel buio: un flash, quasi nulla nel fotogramma, e tutto ciò che conta fuori dal fotogramma. Dal giorno seguente è in pensione. #537 non è una conquista. È un congedo. Ora torna verso il Cervino — non per dimostrare, per chiudere il cerchio che i genitori avevano appeso all’ingresso.",
    quotes: [
      "Chiavi della foresteria sul comodino. Domani le lascio sul tavolo dell’ufficio.",
      "A lei, a voce: «Se lo scatto viene male, va bene. Oggi conta stare.»",
      "Promemoria nel telefono: Cervino — non una gita. Un ritorno.",
    ],
    en: {
      brief: "Last night in the staff lodge, on the cableway that was his life. Tomorrow he retires. In the afternoon, with his wife, they were shadows on the Photopoint. Up here he found refuge: to climb, to watch. His parents named him after Vittorio Sella. The Matterhorn in the hallway photo — now he returns to it.",
      full: "Vittorio gave his life to the cableway. Not to just any job: to that cable stretched between Falzarego and the summit, to the cabins that unload day-trippers and bring silence back, to the routine of someone who goes up so someone else can go up. The mountains, for him, were not scenery. They were refuge. The act of arriving high and watching the world from up here was the only work he could have done — and maybe it was already written.\\n\\nHis parents had named him after Vittorio Sella, the photographer who first photographed and told so many peaks. In the hallway at home they kept a photograph of the snowy Matterhorn: for the boy it was a destination, not a frame. Years later the Tofane and Lagazuoi were enough as an office; the Matterhorn stayed the inner direction.\\n\\nOn the third of October twenty twenty-six, in the afternoon, he and his wife stopped on the Photopoint platform. Backs to the light, profile to the stone: two shadows. Not a postcard pose. A farewell made with the body. Then evening, in the cableway staff lodge — the last night. At twenty-two twenty-eight the machine fired in the dark: a flash, almost nothing in the frame, and everything that matters outside the frame. From the next day he is retired. #537 is not a conquest. It is a leave-taking. Now he turns toward the Matterhorn — not to prove, to close the circle his parents hung in the hallway.",
      quotes: [
        "Lodge keys on the nightstand. Tomorrow I leave them on the office table.",
        "To her, aloud: “If the shot comes out wrong, that’s fine. Today being here counts.”",
        "Phone reminder: Matterhorn — not a trip. A return.",
      ],
    },
  },
};
`,No=`*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: #e8ff00;
  color: #111111;
  transition: background-color 1.6s ease;
}

body {
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}

body:active {
  cursor: grabbing;
}

/* Fake story + user picks fake: void collapse */
body.is-void-collapse {
  background: #000000;
  cursor: default;
}

/* Brief negative flash when returning from void → home.
   Never filter \`.view\` — it flattens preserve-3d and causes a size snap. */
body.is-void-invert-home .title,
body.is-void-invert-home .spin,
body.is-void-invert-home .lang-switch,
body.is-void-invert-home .info-btn,
body.is-void-invert-home .path-points,
body.is-void-invert-home .carousel-item,
body.is-void-invert-home .text-item,
body.is-void-invert-home .home-ring {
  filter: invert(1);
}

.title,
.spin,
.lang-switch,
.info-btn,
.path-points,
.home-ring,
.carousel-item {
  transition: filter 0.55s ease, opacity 0.65s ease;
}

.void-404 {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 1.5rem 8vw;
  box-sizing: border-box;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: var(--title-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #47c14d;
  text-align: center;
  text-transform: lowercase;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  opacity: 0;
  transition: opacity 0.45s ease;
}

.void-404.is-visible {
  opacity: 1;
}

.void-404[hidden] {
  display: none;
}

.void-404.is-visible[hidden] {
  display: flex;
}

/* Invert only at first; fall uses \`translate\` so existing \`transform\` stays put (no diagonal).
   Skip \`.view\`: filter would flatten preserve-3d (size snap). Rings invert via children. */
.is-void-fall:not(.view) {
  filter: invert(1);
  transition: filter 0.4s ease;
  will-change: translate, opacity, filter;
}

body.is-void-collapse .carousel-item,
body.is-void-collapse .text-item {
  filter: invert(1);
  transition: filter 0.4s ease;
}

.view.is-void-fall {
  will-change: translate, opacity;
}

.is-void-fall.is-void-falling:not(.path-points) {
  translate: 0 120vh;
  opacity: 0;
  pointer-events: none;
  transition:
    translate 1.5s cubic-bezier(0.55, 0.06, 0.68, 0.19),
    opacity 1.35s ease;
}

/* GPS cloud: rushes toward the camera (grows) and exits last.
   Keep translate(-50%, -50%) in the same transform so scale stays centered. */
.path-points.is-void-fall {
  will-change: transform, opacity, filter;
  z-index: 40;
  -webkit-transform-origin: center center;
  transform-origin: center center;
}

.path-points.is-void-fall.is-void-rushing {
  -webkit-transform: translate(-50%, -50%) translateY(var(--ring-lift)) scale(14);
  transform: translate(-50%, -50%) translateY(var(--ring-lift)) scale(14);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 1.6s cubic-bezier(0.22, 0.61, 0.36, 1),
    -webkit-transform 1.6s cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 1.5s ease;
}

/*
  Safari flattens preserve-3d when an ancestor has overflow != visible.
  Keep overflow on .stage for clipping, but put perspective ON .view via
  transform (not CSS perspective on the overflow parent).
*/
.stage {
  position: relative;
  width: 100vw;
  height: 100vh;
  height: 100svh;
  /* overflow on this node breaks preserve-3d in Safari — clip via body */
  overflow: visible;
}

/* 5-column page guide (track math shared with story panels via :root) */
.col-grid {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  gap: var(--col-gap, 15px);
  padding-left: var(--col-pad-left, 5px);
  box-sizing: border-box;
  pointer-events: none;
}

.col-grid-cell {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  background: transparent;
}

.title {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: flex-start;
  gap: 0.35em;
  margin: 0;
  padding: var(--title-top-pad) 0 0;
  pointer-events: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: var(--title-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #ff69b4;
  text-align: center;
  text-transform: lowercase;
}

.title-home {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.35em;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  pointer-events: auto;
  cursor: pointer;
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  text-transform: inherit;
  -webkit-appearance: none;
  appearance: none;
  transition: color 0.2s ease;
}

.title-home:hover {
  color: #47c14d;
}

.title-home:focus-visible {
  outline: 2px solid #000000;
  outline-offset: 4px;
}

.title-peak,
.title-prompt {
  text-align: center;
}

/* Fortune-wheel pointer: pivots just left of the leading “p” */
.title-prompt {
  display: inline-block;
  transform-origin: -0.12em 50%;
  will-change: transform;
}

.boot-splash {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 1.5rem 8vw;
  box-sizing: border-box;
  border: 0;
  background: none;
  pointer-events: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: var(--title-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #47c14d;
  text-align: center;
  -webkit-appearance: none;
  appearance: none;
}

.boot-splash-label {
  position: relative;
  z-index: 1;
  display: inline-block;
  pointer-events: auto;
  cursor: pointer;
  white-space: pre-line;
  opacity: 1;
  transition: opacity 0.25s ease;
}

.boot-wide-carousel {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 0;
  width: min(46vw, 58vh);
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.28s ease;
}

.boot-wide-stack {
  width: 100%;
  box-shadow: none;
}

.boot-splash.is-wide-preview .boot-wide-carousel {
  opacity: 1;
}

.boot-splash.is-wide-preview .boot-splash-label {
  opacity: 0.95;
}

.boot-splash:focus-visible {
  outline: none;
}

.boot-splash:focus-visible .boot-splash-label {
  outline: 2px solid #000000;
  outline-offset: 6px;
}

.boot-splash[hidden] {
  display: none;
}

.boot-splash.is-leaving,
.boot-splash.is-leaving .boot-splash-label {
  opacity: 0;
  pointer-events: none;
}

body.is-booting .spin,
body.is-booting .info-btn {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.boot-credit {
  position: absolute;
  left: 50%;
  bottom: var(--chrome-bottom);
  z-index: 5;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--chrome-hit);
  margin: 0;
  padding: 0;
  transform: translateX(-50%);
  pointer-events: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: var(--chrome-font-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #000000;
  text-align: center;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
}

body.is-booting .boot-credit {
  opacity: 1;
  visibility: visible;
}

.real-confirm {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 1.5rem 8vw;
  box-sizing: border-box;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: var(--title-size);
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: #47c14d;
  text-align: center;
  white-space: pre-line;
  opacity: 0;
  transition: opacity 0.7s ease;
}

.real-confirm.is-visible {
  opacity: 1;
}

.real-confirm[hidden] {
  display: none;
}

.real-confirm.is-visible[hidden] {
  display: flex;
}

/* Real-confirm: dissolve chrome onto the yellow stage; keep caption + GPS + home */
body.is-real-confirm .title,
body.is-real-confirm .spin,
body.is-real-confirm .lang-switch,
body.is-real-confirm .info-btn,
body.is-real-confirm .story-panel,
body.is-real-confirm .story-auth,
body.is-real-confirm .story-media,
body.is-real-confirm .col-grid,
body.is-real-confirm .carousel-item,
body.is-real-confirm .text-item,
body.is-real-confirm .boot-splash {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.95s ease;
}

/* Avoid opacity on .view (preserve-3d size snap) — hide faces via rules above */
body.is-real-confirm .view {
  visibility: hidden;
  pointer-events: none;
}

/* Full-viewport stage for the GPS firework (no clipped window) */
body.is-real-confirm .path-points {
  z-index: 35;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform: none;
}

body.is-booting .carousel-item,
body.is-booting .text-item,
body.is-booting .path-points {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: none;
}

.spin {
  position: absolute;
  left: 50%;
  bottom: var(--chrome-bottom);
  z-index: 5;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--chrome-hit);
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  transform: translateX(-50%);
  cursor: pointer;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: var(--chrome-font-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #000000;
  text-align: center;
  text-transform: lowercase;
  -webkit-appearance: none;
  appearance: none;
  transition: filter 0.55s ease, opacity 0.65s ease, color 0.2s ease;
}

.spin:hover:not(:disabled) {
  color: #ff69b4;
}

.spin:disabled {
  cursor: default;
  opacity: 0.45;
}

.spin:focus-visible {
  outline: 2px solid #000000;
  outline-offset: 4px;
}

.spin[hidden] {
  display: none !important;
}

.home-ring {
  position: absolute;
  left: calc(1.75rem - 5pt);
  bottom: calc(var(--chrome-bottom) + (var(--chrome-hit) - 0.95rem) / 2);
  z-index: 5;
  box-sizing: border-box;
  width: 3.4rem;
  height: 0.95rem;
  padding: 0;
  border: 1.5px solid #000000;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.home-ring[hidden] {
  display: none;
}

.home-ring:focus-visible {
  outline: 2px solid #000000;
  outline-offset: 3px;
}

.lang-switch {
  position: absolute;
  right: 0.35rem;
  top: 50%;
  z-index: 5;
  translate: 0 -50%;
  pointer-events: auto;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: calc((clamp(2.5rem, 8vw, 6rem) - 25pt) * 0.38);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #000000;
  text-transform: lowercase;
}

.lang-switch-rail {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 0.3em;
  transform: rotate(90deg);
  transform-origin: center center;
}

.lang-switch-sep {
  opacity: 1;
  user-select: none;
}

.lang-switch-btn {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-transform: inherit;
  opacity: 0.35;
  -webkit-appearance: none;
  appearance: none;
}

.lang-switch-btn.is-active {
  opacity: 1;
}

.lang-switch-btn:focus-visible {
  outline: 2px solid #000000;
  outline-offset: 4px;
}

.info-btn {
  position: absolute;
  right: 2.15rem;
  bottom: var(--chrome-bottom);
  z-index: 5;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--chrome-hit);
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: var(--chrome-font-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #000000;
  text-decoration: none;
  text-transform: lowercase;
  -webkit-appearance: none;
  appearance: none;
  transition: filter 0.55s ease, opacity 0.65s ease, color 0.2s ease;
}

.info-btn:hover {
  color: #ff69b4;
}

.info-btn:focus-visible {
  outline: 2px solid #000000;
  outline-offset: 4px;
}

:root {
  /* Outer ring brief (small) */
  --story-type-size: calc(clamp(0.55rem, 0.95vw, 0.78rem) - 1pt);
  /* Full story in page cols 1–2 — sized for ~60% page height block */
  --story-full-size: calc(clamp(1.05rem, 1.55vw, 1.35rem) - 2pt);
  --title-size: calc(clamp(2.5rem, 8vw, 6rem) - 25pt);
  --title-top-pad: calc(1.75rem - 5pt);
  /* Rings + GPS + story media: lifted toward “peak prompt” (negative = up) */
  --ring-lift: -4vh;
  /* Brief ring: extra downward nudge on large screens (0 by default) */
  --brief-y-extra: 0%;
  /* Bottom chrome: shared baseline for home-ring / spin / auth / i */
  --chrome-bottom: calc(1.75rem - 5pt);
  --chrome-font-size: calc((clamp(2.5rem, 8vw, 6rem) - 25pt) * 0.38);
  --chrome-hit: calc(var(--chrome-font-size) * 1.55);
  --col-count: 5;
  --col-gap: 15px;
  --col-pad-left: 5px;
  --col-track: calc(
    (100% - var(--col-pad-left) - (var(--col-count) - 1) * var(--col-gap)) /
      var(--col-count)
  );
}

/* Longer viewport side > 1700px → drop brief texts by 10% of their cell height */
@media (min-width: 1701px), (min-height: 1701px) {
  :root {
    --brief-y-extra: 10%;
  }
}

/* Full story: cols 1–2, 60% page height; fills col 1 then spills to col 2 */
.story-panel {
  position: absolute;
  top: calc(var(--title-top-pad) + var(--title-size) + 42pt);
  left: var(--col-pad-left);
  z-index: 6;
  display: flex;
  align-items: flex-start;
  /* 2 of 5 columns + the gutter between them */
  width: calc(var(--col-track) * 2 + var(--col-gap));
  height: 60%;
  box-sizing: border-box;
  padding: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--settle-fade-ms, 1s) ease;
}

.story-panel.is-visible {
  opacity: 1;
}

.story-panel[hidden] {
  display: none;
}

.story-panel.is-visible[hidden] {
  display: flex;
}

.story-panel-inner {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: auto;
  font-family: "Times New Roman", Times, serif;
  font-size: var(--story-full-size);
  font-weight: 400;
  line-height: 1.35;
  color: #000000;
}

.story-panel-datetime {
  flex: 0 0 auto;
  margin: 0 0 0.85em;
  font: inherit;
  white-space: pre-line;
}

.story-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  font: inherit;
  text-align: justify;
  white-space: pre-wrap;
  overflow: hidden;
  /* Fill first column completely, then continue in the second */
  columns: 2;
  column-gap: 15px;
  column-fill: auto;
}

/* Replaces #spin once a story is open: “real or fake?” */
.story-auth {
  position: absolute;
  left: 50%;
  bottom: var(--chrome-bottom);
  z-index: 5;
  box-sizing: border-box;
  display: none;
  align-items: center;
  justify-content: center;
  height: var(--chrome-hit);
  margin: 0;
  padding: 0;
  transform: translateX(-50%);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--settle-fade-ms, 1s) ease;
}

.story-auth.is-visible {
  display: flex;
  opacity: 1;
  pointer-events: none;
}

.story-auth[hidden] {
  display: none !important;
  opacity: 0 !important;
}

.story-auth.is-visible[hidden] {
  display: none !important;
}

.story-auth-prompt {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.28em;
  margin: 0;
  pointer-events: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: var(--chrome-font-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #000000;
  text-align: center;
  text-transform: lowercase;
}

.story-auth-or,
.story-auth-mark {
  pointer-events: none;
  user-select: none;
}

.story-auth-choice {
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  pointer-events: auto;
  font: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  color: inherit;
  text-transform: inherit;
  -webkit-appearance: none;
  appearance: none;
}

.story-auth-choice:hover,
.story-auth-choice:focus-visible {
  text-decoration: underline;
  outline: none;
}

.story-auth-choice:disabled {
  cursor: default;
  text-decoration: none;
  opacity: 1;
}

/* Story media: centered depth stack (same locus as B&W carousel face) */
.story-media {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--settle-fade-ms, 1s) ease;
}

.story-media.is-visible {
  opacity: 1;
}

.story-media[hidden] {
  display: none;
}

.story-media.is-visible[hidden] {
  display: block;
}

.story-media-viewport {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(52vw, 68vh);
  height: min(52vw, 68vh);
  transform: translate(-50%, -50%) translateY(var(--ring-lift));
  -webkit-perspective: 90vw;
  perspective: 90vw;
  -webkit-perspective-origin: 50% 50%;
  perspective-origin: 50% 50%;
  pointer-events: auto;
}

.story-media-stack {
  position: absolute;
  inset: 0;
  -webkit-transform-style: preserve-3d;
  transform-style: preserve-3d;
  pointer-events: none;
}

.story-media-card {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(46vw, 58vh);
  max-height: min(46vw, 58vh);
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  -webkit-transform-style: flat;
  transform-style: flat;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  pointer-events: auto;
  cursor: zoom-in;
  -webkit-appearance: none;
  appearance: none;
  will-change: transform, opacity;
}

.story-media-card:focus-visible {
  outline: 2px solid #000000;
  outline-offset: 3px;
}

.story-media-card img,
.story-media-card video {
  display: block;
  width: 100%;
  height: auto;
  max-height: min(46vw, 58vh);
  object-fit: contain;
  pointer-events: none;
}

.story-media-obj {
  width: min(46vw, 58vh);
  height: min(46vw, 58vh);
  max-height: min(46vw, 58vh);
  pointer-events: auto;
  cursor: grab;
}

.story-media-quote {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: clamp(1rem, 2.5vw, 2rem);
  cursor: default;
  pointer-events: none;
}

.story-media-quote-text {
  margin: 0;
  max-width: 18em;
  font-family: Helvetica, Arial, sans-serif;
  font-size: calc(var(--story-full-size) * 1.05);
  font-weight: 400;
  font-style: normal;
  line-height: 1.25;
  letter-spacing: 0.02em;
  text-align: left;
  text-transform: uppercase;
  white-space: pre-line;
  color: #000000;
  quotes: none;
}

.story-browse-hint {
  position: fixed;
  z-index: 12;
  margin: 0;
  padding: 0;
  max-width: 14rem;
  pointer-events: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: calc(clamp(0.7rem, 1.1vw, 0.85rem));
  line-height: 1.25;
  letter-spacing: 0.02em;
  color: #000000;
  text-transform: lowercase;
  white-space: nowrap;
  opacity: 0;
  transform: translate(12px, 14px);
  transition:
    opacity 0.35s ease,
    color 0.15s ease;
}

.story-browse-hint.is-over-media {
  color: #e8ff00;
}

.story-browse-hint.is-visible {
  opacity: 0.85;
}

.story-browse-hint[hidden] {
  display: none !important;
}

.story-obj {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
  background: transparent;
}

.story-obj:active {
  cursor: grabbing;
}

.story-obj-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.story-obj-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font: 11px/1.2 ui-monospace, monospace;
  letter-spacing: 0.04em;
  color: rgba(0, 0, 0, 0.55);
  pointer-events: none;
  user-select: none;
}

.lightbox {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(1.75rem - 5pt);
  box-sizing: border-box;
  background: rgba(232, 255, 0, 0.92);
  cursor: zoom-out;
}

.lightbox[hidden] {
  display: none;
}

.lightbox-image,
.lightbox-video {
  max-width: min(92vw, 1100px);
  max-height: min(88vh, 88svh);
  width: auto;
  height: auto;
  object-fit: contain;
  box-shadow: none;
}

.lightbox-image {
  pointer-events: none;
}

.lightbox-video {
  pointer-events: auto;
  background: #000000;
}

.lightbox-close {
  position: absolute;
  top: calc(1.75rem - 5pt);
  right: calc(1.75rem - 5pt);
  z-index: 1;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 400;
  font-size: calc((clamp(2.5rem, 8vw, 6rem) - 25pt) * 0.42);
  line-height: 1;
  color: #000000;
  -webkit-appearance: none;
  appearance: none;
}

.lightbox-close:focus-visible {
  outline: 2px solid #000000;
  outline-offset: 4px;
}

/* Camera: perspective + elevated tilt — static */
.view {
  position: absolute;
  inset: 0;
  -webkit-transform: perspective(90vw) translateY(var(--ring-lift)) rotateX(-7deg);
  transform: perspective(90vw) translateY(var(--ring-lift)) rotateX(-7deg);
  -webkit-transform-style: preserve-3d;
  transform-style: preserve-3d;
  -webkit-transform-origin: center center;
  transform-origin: center center;
}

/* GPS points only — fixed at the center of the two rings */
.path-points {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 0;
  width: min(56vw, 84vh);
  height: min(56vw, 84vh);
  transform: translate(-50%, -50%) translateY(var(--ring-lift));
  pointer-events: none;
}

.path-points-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.path-points-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

.path-points-ele {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 7pt;
  font-weight: 400;
  line-height: 1;
  color: #000000;
  white-space: nowrap;
  user-select: none;
  z-index: 1;
}

/* Only rotateY is updated in JS — direct parent of all ring faces */
.rig {
  position: absolute;
  inset: 0;
  -webkit-transform-style: preserve-3d;
  transform-style: preserve-3d;
  -webkit-transform-origin: center center;
  transform-origin: center center;
}

.carousel-item,
.text-item {
  position: absolute;
  top: 50%;
  left: 50%;
  -webkit-transform-style: flat;
  transform-style: flat;
  -webkit-backface-visibility: visible;
  backface-visibility: visible;
  user-select: none;
  pointer-events: none;
}

.carousel-item {
  opacity: 1;
  transition:
    opacity 0.65s ease,
    filter 0.55s ease;
}

.text-item {
  opacity: 1;
  transition:
    opacity var(--settle-fade-ms, 1s) ease,
    filter 0.55s ease;
}

.text-item.is-fading-out {
  opacity: 0;
}

.carousel-item.is-hidden,
.text-item.is-hidden {
  visibility: hidden;
  opacity: 0;
  transition: none;
}

.frame-stack {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 2;
  overflow: hidden;
}

.frame-stack img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  opacity: 0;
  /* TEST: tutte le immagini in bianco e nero */
  filter: grayscale(1);
}

.frame-stack img.is-active {
  opacity: 1;
}

/* Boot hover preview: color stills (override ring grayscale) */
.boot-wide-stack.frame-stack img {
  filter: none;
}

.text-item {
  box-sizing: border-box;
  overflow: hidden;
  color: #000000;
  font-family: "Times New Roman", Times, serif;
  text-align: left;
}

.text-item-head,
.text-item-brief {
  display: block;
  margin: 0;
  font-family: "Times New Roman", Times, serif;
  font-size: var(--story-type-size);
  font-weight: 400;
  line-height: 1.35;
  text-align: left;
}

.text-item-head {
  margin-bottom: calc(1.35em * 3);
  white-space: pre-line;
}

/* Fake story marked “real”: hide stage chrome, show source wall */
body.is-code-reveal {
  background: #0a0a0a;
  cursor: grab;
}

body.is-code-reveal:active {
  cursor: grabbing;
}

body.is-code-reveal .stage > :not(.code-reveal):not(.home-ring) {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 1.35s ease;
}

body.is-code-reveal .home-ring {
  z-index: 70;
  border-color: #e8ff00;
}

.code-reveal {
  position: absolute;
  inset: 0;
  z-index: 60;
  overflow: hidden;
  perspective: min(140vw, 1600px);
  -webkit-perspective: min(140vw, 1600px);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  opacity: 0;
  transition: opacity 1.45s ease;
  background:
    radial-gradient(ellipse at 40% 30%, #1a1a12 0%, #0a0a0a 55%, #050505 100%);
}

.code-reveal.is-visible {
  opacity: 1;
}

.code-reveal[hidden] {
  display: none;
}

.code-reveal.is-visible[hidden] {
  display: block;
}

.code-reveal-caption {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 1.5rem 8vw;
  box-sizing: border-box;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  font-family: Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: var(--title-size);
  line-height: 1;
  letter-spacing: -0.02em;
  color: #47c14d;
  text-align: center;
  white-space: pre-line;
}

.code-reveal-scene {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-style: preserve-3d;
  -webkit-transform-style: preserve-3d;
}

.code-reveal-rig {
  position: relative;
  width: 1px;
  height: 1px;
  transform-style: preserve-3d;
  -webkit-transform-style: preserve-3d;
  transform-origin: center center;
  -webkit-transform-origin: center center;
  /* Default: upright pages (no rotateX), 3/4 view on Y — JS orbit overrides */
  transform: rotateY(-35deg);
  -webkit-transform: rotateY(-35deg);
}

.code-page {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  width: min(35.7vw, 20.4rem);
  height: min(66.3vh, 40.8rem);
  margin: 0;
  padding: 0.5rem 0.45rem 0.55rem;
  overflow: hidden;
  border: 1px solid rgba(232, 255, 0, 0.22);
  background: linear-gradient(165deg, #141410 0%, #0d0d0d 55%, #101208 100%);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    0 18px 40px rgba(0, 0, 0, 0.55);
  color: #9aa86a;
  font-family: "SF Mono", "Menlo", "Consolas", "Liberation Mono", monospace;
  font-size: 5.3px;
  line-height: 1.18;
  letter-spacing: -0.02em;
  white-space: pre;
  transform-style: preserve-3d;
  -webkit-transform-style: preserve-3d;
  backface-visibility: visible;
  -webkit-backface-visibility: visible;
  user-select: none;
  pointer-events: none;
}

.code-page-name {
  display: block;
  margin: 0 0 0.35rem;
  padding-bottom: 0.2rem;
  border-bottom: 1px solid rgba(232, 255, 0, 0.28);
  color: #e8ff00;
  font-size: 6.8px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.code-page-body {
  display: block;
  margin: 0;
  opacity: 0.85;
}

@media (max-width: 700px) {
  .code-page {
    width: min(49.3vw, 13.6rem);
    height: min(57.8vh, 28.9rem);
    font-size: 4.1px;
  }

  .code-page-name {
    font-size: 5.1px;
  }
}
`,jo=`import * as THREE from "three";

const TILE_SIZE = 256;
const DEM_ZOOM = 13;
const SAT_ZOOM = 14;

// Proxied in vite.config.js to avoid CORS issues in dev/prod preview.
const DEM_URL = (z, x, y) => \`/tiles/dem/\${z}/\${x}/\${y}.png\`;
const SAT_URL = (z, x, y) => \`/tiles/sat/\${z}/\${y}/\${x}\`;

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
    img.onerror = () => reject(new Error(\`Failed tile \${url}\`));
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
`,Go=`import "./trail-styles.css";
import { createTrailScene } from "./trail3d.js";

async function boot() {
  const canvas = document.querySelector("#trail-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const res = await fetch("/trail.json");
  if (!res.ok) {
    console.error("Failed to load trail.json", res.status);
    return;
  }

  const trail = await res.json();
  await createTrailScene(canvas, trail);
}

boot();
`,Oo=`:root {
  --sky-top: #c9dff0;
  --sky-mid: #e8eef2;
  --sky-low: #d6cbb8;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--sky-mid);
}

body {
  overflow: hidden;
}

#app {
  position: relative;
  min-height: 100svh;
}

#trail-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  background:
    radial-gradient(120% 80% at 70% 10%, #f4f7fa 0%, transparent 55%),
    linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 48%, var(--sky-low) 100%);
}

.credit {
  position: fixed;
  right: 12px;
  bottom: 10px;
  z-index: 2;
  margin: 0;
  font: 500 10px/1.2 "Helvetica Neue", sans-serif;
  letter-spacing: 0.02em;
  color: rgba(28, 36, 41, 0.55);
  pointer-events: none;
}
`,Ho=`import * as THREE from "three";
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
    shader.vertexShader = \`
      varying float vPathT;
      \${shader.vertexShader}
    \`.replace(
      "#include <begin_vertex>",
      \`
      #include <begin_vertex>
      vPathT = uv.x;
      \`,
    );
    shader.fragmentShader = \`
      uniform float uDraw;
      varying float vPathT;
      \${shader.fragmentShader}
    \`.replace(
      "#include <dithering_fragment>",
      \`
      if (vPathT > uDraw) discard;
      #include <dithering_fragment>
      \`,
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
`,Uo=`# Lagazuoi — contesto per le storie

> Archivio editoriale Peak Prompt. Fonte di verità per ambientazioni, timeline e tono narrativo legati al percorso GPX  
> **Pian Falzarego → Forcella Lagazuoi → Baracca ufficiali austriaci → Rifugio Lagazuoi**.

Ultimo aggiornamento: 2026-10-03 (sezione turismo aggiunta)  
Percorso GPX: \`assets/pian-falzarego-forcella-lagazuoi-baracca-ufficiali-austriaci.gpx\`  
Stats tipiche: ~6.6 km, +~650 m, quota ~2075 → ~2750 m.

---

## In una frase

Qui il fronte alpino si fermò: non si avanzava a valle, si scavava dentro la montagna. Il GPX ripercorre la linea di rifornimento e di memoria tra Falzarego e la cima dove oggi sorge il rifugio.

---

## Geografia e senso del luogo

- **Piccolo Lagazuoi** (~2778 m in vetta; Rifugio a 2752 m) domina **Passo Falzarego** (~2117 m) e **Valparola**, sopra **Cortina d’Ampezzo**.
- Contesto UNESCO Dolomiti: panorama su Tofane, Sass de Stria, Marmolada, Sella, Civetta, Pelmo, Antelao, ecc.
- Oggi: funivia Falzarego–Lagazuoi, Rifugio Lagazuoi, Photopoint, Museo all’aperto della Grande Guerra (gallerie, trincee, baracche restaurate).
- Clima narrativo: luce dura d’alta quota, ghiaioni, pareti verticali, vento, senso di “castello di roccia” forato dalla storia.

### Tappe del percorso (ordine GPX)

| Tappa | Quota / note | Ruolo storico / narrativo |
| --- | --- | --- |
| Pian / Passo Falzarego | ~2117 m | Base, stazione di valle, terra di nessuno tra linee IT e AU |
| Forcella Lagazuoi | ~2500–2570 m | Nodo del Sentiero del Fronte; reticolati e trincee austriache; verso Travenanzes e cima |
| Baracca ufficiali austriaci | lungo la salita verso forcella/cima | Ricovero k.u.k.; tavolo, sedie, oggetti d’epoca — “tempo sospeso” |
| Rifugio Lagazuoi | 2752 m | Cima accessibile; panorama; accesso gallerie / museo; Photopoint |

Waypoint GPX (da metadata trail): Forcella ~1.9 km, Baracca ufficiali ~2.9 km.

---

## Timeline storica (sintesi)

| Quando | Cosa succede |
| --- | --- |
| 23 mag 1915 | L’Italia dichiara guerra all’Austria-Ungheria; Cortina viene occupata dagli italiani dopo secoli asburgici. |
| Estate 1915 | Gli austro-ungarici si attestano su Lagazuoi, Valparola e Falzarego per chiudere la via verso Val Badia e Pusteria. |
| 18–19 ott 1915 | Gli Alpini occupano di notte la **Cengia Martini** sul versante sud del Piccolo Lagazuoi: cuneo sotto le postazioni austriache. |
| 1916–1917 | **Guerra di mine**: quattro mine austriache contro la Cengia Martini; gli italiani scavano ~1100 m di galleria verso l’Anticima. |
| 22 mag 1917 | Mina austriaca più potente: stacca una porzione di parete (~199 × 136 m) senza espugnare i ricoveri italiani. |
| **20 giu 1917** | **Mina italiana (~33.000 kg / ~33 t)**: esplode l’Anticima. Gli italiani occupano il cratere ma restano sotto il fuoco austriaco; lo stallo continua. |
| 1 nov 1917 | Dopo **Caporetto** il fronte dolomitico viene abbandonato; restano gallerie, trincee e baracche nella roccia. |
| 1963–65 | Funivia Falzarego–Lagazuoi e **Rifugio Lagazuoi** (famiglia Pompanin): la cima diventa destinazione turistica. |

### Numeri utili in narrazione

- Fronte attivo locale: **1915–1917**
- Galleria di mina italiana: **~1100 m** (ripida, oggi percorribile con attrezzatura)
- Esplosivo Anticima: **~33 t** (fonti citano anche ~32.664 kg)
- Cinque mine in totale sul massiccio: **4 austriache** (vs Cengia Martini) + **1 italiana** (Anticima)
- Quota rifugio: **2752 m**

---

## Due schieramenti (per personaggi / punti di vista)

### Austro-ungarici (k.u.k. / Kaiserjäger)

- Occupano per primi cresta e vetta.
- Costruiscono il **Sentiero dei Kaiserjäger** come via di rifornimento dal passo alle postazioni (ponte sospeso ~10 m lungo / ~25 m alto, cenge esposte).
- Difesa di Forcella Lagazuoi con reticolati; postazioni sulla Muraglia Rocciosa, feritoie, baracche in nicchie.
- Tentativi ripetuti di eliminare la Cengia Martini con mine (1916–1917).
- Comandante citato in fonti sulla mina italiana: **Cap. Raschin** (evacuazione anticipata grazie a intercettazioni / disertore).

### Italiani (Alpini)

- Si aggrappano alla **Cengia Martini** (ott. 1915), dal Maggiore **Ettore Martini**.
- Seconda linea / artiglieria e riflettori da **5 Torri** e Averau per illuminare la parete.
- Rispondono allo stallo con la grande galleria fino all’Anticima (ingegneri **Malvezzi** e **Cadorin**, già noti per il Castelletto).
- 20 giugno 1917: brillamento; conquista parziale del cratere, non della cima.
- Caporetto chiude il capitolo dolomitico (ritirata nov. 1917).

### Vita quotidiana sul fronte (dettagli “di atmosfera”)

- Ogni soldato in prima linea: fabbisogno giornaliero dell’ordine di **decine di kg** (viveri, munizioni, acqua, materiali) — fonti citano fino a ~70 kg di materiale per uomo.
- Corvée di portatori spesso **di notte**, in silenzio; rischio bengala e fuoco nemico sul Sentiero del Fronte.
- Miglior riparo dall’artiglieria = **dentro la montagna** → ricoveri, cucine, vasche d’acqua, gallerie-abitazione.
- Freddo, umidità, buio delle gallerie: esperienza ancora centrale per i visitatori moderni.

---

## Luoghi-simbolo collegati (anche fuori GPX ma utili)

- **Cengia Martini** — postazione italiana “inespugnabile” a mezza parete sud.
- **Galleria di Mina / Anticima** — esperienza immersiva più citata; discesa dalla cima o salita da Falzarego.
- **Sentiero del Fronte** (CAI 401–402) — allineato in spirito al GPX; linea tra i due eserciti.
- **Sentiero dei Kaiserjäger** — alternativa più esposta, memoria austriaca.
- **Sass de Stria, Valparola (Vonbank), Castelletto, 5 Torri** — sistema difensivo / seconda linea intorno.
- **Photopoint Lagazuoi** — rituale contemporaneo in vetta (foto con branding Lagazuoi Dolomiti); collegato alle immagini in \`assets/media/stories/\`.

---

## Temi e “mito” del luogo (cosa si racconta in rete)

Usare come leve narrative / mood, non come fatti biografici di individui specifici.

1. **Montagna forata** — “la più perforata delle Dolomiti”; castello di roccia con viscere militari.
2. **Vivere nella pietra** — dormire, cucinare, combattere dentro la parete (Guerra Bianca).
3. **Portatori nella notte** — rifornimenti, silenzio, bengala, peso quotidiano della sopravvivenza.
4. **Baracca degli ufficiali** — oggetti ancora lì; senso di tempo sospeso / diorama vivente.
5. **Galleria come immersione** — freddo, pendenza, buio, corpo che ripercorre lo scavo del 1917.
6. **Da fronte a nido magico** — famiglia Pompanin, anni ’60: da cima di guerra a rifugio ospitale a 2752 m.
7. **Nemici di ieri, museo di oggi** — restauro congiunto / memoria condivisa; app e targhe lungo i percorsi.
8. **Panorama come riconciliazione** — la stessa vista che era campo di tiro diventa cartolina e Photopoint.

Tono consigliato per Peak Prompt: meraviglia + rispetto della tragedia; evitare celebrazione della violenza; privilegiare senso del luogo, corpo in quota, oggetti, luce, silenzio.

---

## Turismo contemporaneo (perché si viene, chi viene, cosa si racconta)

### Perché interessa (motivi di visita)

1. **Panorama “oceano di vette”** — Piccolo Lagazuoi (~2778 m) è relativamente basso rispetto alle cime intorno: vista ampia senza “minimizzare” Tofane, Marmolada, Fanes, Civetta, Pelmo, Antelao, Sella, Odle, ecc. Molti guide/blog lo chiamano tra i **migliori viewpoint delle Dolomiti**; per chi fa **Alta Via 1** è spesso citato come highlight n.1 della tappa.
2. **Accessibilità** — Funivia da Falzarego in ~3 minuti (~700 m di dislivello in cabina): giorno-trip facile anche per non escursionisti, famiglie, persone con mobilità ridotta (sentiero croce di vetta dichiarato accessibile anche con carrozzina).
3. **Storia “toccabile”** — Museo all’aperto + gallerie/trincee: non solo targa, ma corpo dentro la roccia. App multimediale e visite guidate con rievocatore / guida storica.
4. **Alba e tramonto** — Motivo n.1 per **pernottare**: dopo l’ultima discesa funivia (~17:00) la cima si svuota; fotografi e trekker restano per la luce.
5. **Inverno sportivo** — Pista **Armentarola** (~7,5–8,5 km, “Hidden Valley”): tra le piste più famose delle Alpi; ghiaccioli, canyon, traino a cavallo (Noriker) verso Alta Badia; collegata a Dolomiti Superski / Great War Ski Tour / Super8.
6. **Cultura in quota** — **Lagazuoi EXPO Dolomiti**: galleria espositiva ad altissima quota (arte/cultura/montagna).
7. **Wellness improbabile** — Sauna finlandese outdoor tra le più alte delle Dolomiti (accanto al rifugio): contrasto calore / oceano di pietra.
8. **Rituale Photopoint** — Foto automatica sulla terrazza (branding Lagazuoi Dolomiti, data/ora/quota): souvenir digitale, materiale base delle \`assets/media/stories/\`.

### Chi viene (pubblici ricorrenti)

| Pubblico | Comportamento tipico |
| --- | --- |
| Day-trippers funivia | 1–3 ore: terrazza, drink/pasto, croce di vetta, qualche foto; maggioranza dei visitatori estivi |
| Trekker Alta Via 1 / lunghi itinerari | Pernottamento; prenotazione anticipata; tramonto+alba; confronto con Scotoni / Dibona / 5 Torri |
| Escursionisti storici | Funivia su + discesa Galleria di Mina / Sentiero del Fronte / Kaiserjäger; casco+frontale |
| Famiglie | Funivia + sentieri facili; galleria sconsigliata sotto ~12 anni (fonti museo) |
| Fotografi / content creators | Tramonto, Photopoint, 360°, “rifugio illuminato” al golden hour |
| Sciatori (inverno) | Armentarola da Alta Badia/Cortina; giro mezza giornata tipico da Corvara–San Cassiano |
| Arrampicatori / ferratisti | Vie e ferrate intorno; passaggio in rifugio |
| Internazionali | Fortissima presenza inglese/tedesca/olandese nei blog e TripAdvisor; mix Cortina–Alta Badia |

Stagionalità estate tipica funivia (es. 2026): circa **giugno–metà ottobre**; corse ogni ~15 min, ultima salita ~16:40, ultima discesa ~17:00. Affollamento picco **giugno–settembre**, soprattutto metà giornata.

### Cosa offrono le strutture (fatti utili in storia)

- **Rifugio Lagazuoi** (Pompanin, 3ª generazione): ~74 posti letto; bar/ristorante ~100 interni / ~200 esterni; 50 m dalla stazione a monte; “più alto e capiente di Cortina”.
- **Terrace Bar** alla stazione a monte + terrazza rifugio.
- **Infopoint Falzarego**: noleggio casco, lampada, imbrago, cordino (prezzi indicativi estate 2026: casco ~8 €, kit completo ~21 €).
- Visite guidate museo: turni giornalieri, IT/EN (e finestre DE), tour breve/lungo a pagamento, max ~20 persone.

### Cosa raccontano i visitatori (voci tipiche)

**Lodano**
- Vista 360° “da fermarsi per ore”; terrazza e croce di vetta.
- Momento magico **dopo le 17**: silenzio, luce, pochi ospiti del rifugio.
- Combo storia + panorama unica; galleria “da fare almeno una volta”; gradini, umidità, torcia, casco = immersione fisica.
- Funivia spettacolare (cabine veloci, ~40 km/h, senza piloni intermedi nelle descrizioni guide).
- AV1: “vale la salita infinita” per quello che si trova in cima.
- Armentarola: “fiaba”, canyon, cavalli alla fine.

**Criticano / avvertono**
- **Folla** a metà giornata in estate; code funivia e cima; arrivare presto.
- Rifugio: prezzi da hotel per standard “hut” (camere semplici, bagni spesso condivisi); recensioni miste su cena/servizio nei picchi di afflusso.
- Acqua non potabile in alcuni racconti → bottiglie a prezzo alto.
- Galleria: scivolosa, umida (~7 °C citato in un diario), buia, pendenza forte; salire è più duro di scendere; no casco = sbattere la testa.
- Tensione etica ricorrente: “strano che un luogo di morte sia un’attrazione” — poi accettano il museo come memoria.
- Dopo qualsiasi passeggiata: si risale sempre verso il rifugio (cima = trampolino).

### Pattern di giornata (utili per plot)

- **A) Espresso turistico**: Falzarego 9–11 → funivia → terrazza/Photopoint → croce → pranzo → giù entro 15–16.
- **B) Storia immersiva**: su in funivia → Galleria di Mina in discesa (casco/frontale) → Cengia Martini / baraccamenti → Falzarego a piedi.
- **C) Trekker GPX-like**: Falzarego → Sentiero del Fronte / 402–401 → Forcella → baracca ufficiali → rifugio (allineato al vostro GPX).
- **D) Pernottamento fotografico**: arrivo pomeriggio → folla se ne va → tramonto → notte in camerata → alba → discesa o funivia.
- **E) Inverno Armentarola**: bus/taxi da Alta Badia → Falzarego → funivia → discesa valle “nascosta” → cavalli → San Cassiano.

### Seed narrativi aggiuntivi (turismo)

- La cima che cambia personalità alle 17: da Luna Park a eremo.
- Due sconosciuti al Photopoint, stessa ora, storie opposte (day-trip vs ultima tappa AV1).
- Chi scende in galleria senza casco e chi noleggia tutto all’infopoint: due modi di “entrare” nella storia.
- Sciatore sull’Armentarola che non sa di passare sopra vecchie linee di fronte.
- Recensione TripAdvisor vs silenzio reale dell’alba: gap tra aspettativa e luogo.

### Storie di chi viene da lontano (casi documentati in rete)

Pattern dominante: **trekker internazionali sull’Alta Via 1** che prenotano Lagazuoi mesi prima; meno spesso day-trip da Cortina di turisti intercontinentali. Provenienze tipiche nei blog/recensioni: **Australia, USA, UK, Paesi Bassi, Belgio, Germania, Singapore, Giappone**.

| Chi / dove | Cosa racconta (sintesi) | Fonte |
| --- | --- | --- |
| Coppia australiana (Jenny Chapman, Escape and Explore, ago 2025) | AV1 giorno Fanes→Lagazuoi: 12 km, ~7,5 h, due salite enormi, temporali; piedi nel lago a metà; switchback “miraggio”; arriva sotto pioggia, dormitorio difficile emotivamente, doccia a 5 €; amici Tanji & Kent (altri trekker) a cena. Mattina dopo: white-out, sceglie funivia invece di galleria/ferrata. | escapeandexplore.com.au |
| Blog UK (Dr John / oyston.com, AV1 2025 con amico britannico) | Giornata misty poi “euforia” al lago; salita interminabile; contento della camera privata; zona comune affollata; rimproverato per essersi seduto al tavolo sbagliato prima di cena. Confronta Lagazuoi con altri trek mondiali (Patagonia, Islanda, Tatra). | oyston.com |
| USA – Inga’s Adventures (pianificazione AV1) | Coppie USA via tour operator; Lagazuoi “insanely busy”, staff “frazzled”; preferiscono altri rifugi per accoglienza. | ingasadventures.com |
| USA – The DIY Vacationer (2019) | AV1 nord; giorno più duro sotto pioggia battente; in rifugio incontra “farmacologi australiani”, amici italiani, geologi USA e tedeschi — tavola come crocevia. | thediyvacationer.com |
| Australia – Jan Somers (2023) | Day walk: sale **dentro** la Galleria di Mina al buio (~1 h), poi Kaiserjäger e croce; caffè/torta in vetta mescolandosi ai turisti funivia. | jansomers.com.au |
| Giappone – batfish su 4travel (ago 2025) | Viaggio Haneda→Vienna→Dolomiti; da Lagazuoi scende verso Scotoni; **incontra un altro giapponese** che sta facendo AV1 in 9 giorni fino a Belluno (“prenotazioni rifugi durissime”). | 4travel.jp |
| TripAdvisor (vari) | Recensori da NYC/Brooklyn, UK (Newport, St Albans, Harrogate), NL (Boxtel, Eindhoven), Singapore, Brisbane, Colorado, Texas, DC, Omaha, Berlino… Motivo ricorrente AV1 o vista; lode alla location, note su folla/prezzi/doccia a gettone. | tripadvisor |

**Motivo del viaggio da lontano (ricorrente):** non “solo Cortina”, ma **badge dell’Alta Via 1** / bucket-list Dolomiti / foto tramonto-alba. Lagazuoi è tappa-icona alta (~2750 m), spesso la più affollata e discussa del trek.

**Dettaglio narrativo forte:** tavolate serali dove si mescolano continenti; la funivia come “uscita di emergenza” meteo per chi ha volato dall’altra parte del mondo; lo shock culturale dormitorio vs aspettativa hotel.

### Coppie sposate / honeymoon / elopement al Lagazuoi

Il Lagazuoi è location ricorrente per **elopement**, **giornate di nozze destination** e **foto di coppia/engagement** (spesso cerimonia simbolica in quota + matrimonio legale altrove).

| Coppia | Storia | Fonte |
| --- | --- | --- |
| **Shelly & Kyle** | Matrimonio originale cancellato dal Covid → trasformano la luna di miele AV1 in elopement. Pernottano al Rifugio Lagazuoi; valigie con abiti nuziali lasciate a Cortina e portate su in funivia dal fotografo. **Voti all’alba in vetta al Lagazuoi** mentre il sole rompe la nebbia — “favorite moment”. Il giorno dopo arrivano anche i genitori per una breve cerimonia, poi riprendono il trek. Kyle aveva chiesto la mano sotto il Kilimanjaro. | wildconnectionsphotography.com |
| **Elisabeth & Julius** | Destination wedding day intero: alba Tre Cime → **pomeriggio Rifugio Lagazuoi** (funivia da Falzarego, vista, gallerie sotto i piedi) → tramonto Passo Giau. In una versione del racconto scambiano voti nella luce dorata; zuppe/canederli e birra in rifugio come pausa. | nordicaphotography.com · voyageandvine.com |
| **Yuliia (UA) & Gunnar (IS)** | Vivono in Islanda; elopement Dolomiti: Passo Giau → **Rifugio Lagazuoi** per la vista → pesca al tramonto. | nordicaphotography.com |
| **Barbara & Michel** | Engagement shoot in vetta Lagazuoi + lago Valparola. | natanstudio.com |
| **Mariaelena & Ivano** | Ritratto di coppia invernale a ~2700 m al rifugio, con i cani Sole e Miele. | alessandroghedina.com |

**Motivi ricorrenti:** terrazza “da favola”, tramonto/alba senza folla se si pernotta, contrasto romantico con la storia di guerra sotto i piedi, accessibilità funivia in abito (vs hike pesante).  
Guide fotografi EN/IT propongono esplicitamente Lagazuoi in itinerari honeymoon/elopement Dolomiti.

**Seed:** abito da sposa in dormitorio rifugio; voti nella nebbia che si squarcia; genitori che salgono in funivia mentre gli sposi arrivano a piedi dall’AV1; Photopoint come “foto di nozze ufficiale” della montagna.

---



## Hook narrativi pronti (seed)

- Un oggetto lasciato nella baracca ufficiali che “non dovrebbe essere lì”.
- Due punti di vista sullo stesso cratere (20 giu 1917): chi ha scavato / chi ha evacuato.
- Una corvée notturna sul Sentiero del Fronte interrotta da un bengala.
- Un visitatore di oggi nella galleria che sente il dislivello come memoria fisica.
- Alba al Photopoint: la stessa anticima che era obiettivo di mina.
- Il primo inverno del rifugio (1964–65) e la scelta di restare a 2752 m.

---

## Fonti primarie da citare / rileggere

### Storia
- https://lagazuoi.it/IT/Conoscere-La-Storia-page3-La-Grande-Guerra-in-Ampezzo  
- https://lagazuoi.it/IT/percorso6-La-Galleria-di-Mina  
- https://lagazuoi.it/IT/pTer4-Note-storiche-sul-Sentiero-del-Fronte  
- https://lagazuoi.it/IT/pTer6-Il-sentiero-dei-Kaiserjger-191517  
- https://www.cortinamuseoguerra.it/percorsi-storici/lagazuoi/  
- https://rifugiolagazuoi.com/EN/p6-Our-history (storia rifugio / Pompanin)  
- https://cortina.dolomiti.org/it/inverno/scopri/cultura/storia-e-guerra-mondiale/lagazuoi/

### Turismo / esperienza
- https://lagazuoi.it/ (offerta estate, Expo, funivia)  
- https://lagazuoi.it/IT/Conoscere-I-servizi-page23-Il-rifugio-Lagazuoi  
- https://lagazuoi.it/EN/Discover-Elements-of-the-landscape-page38-The-panorama  
- https://lagazuoi.it/EN/Experience-Winter-page32-The-Armentarola-Piste  
- https://lagazuoi.it/IT/Conoscere-I-servizi-page22-Infopoint-Lagazuoi-noleggio-attrezzatura-al-passo-Falzarego  
- https://routinelynomadic.com/rifugio-lagazuoi-italy/ (guida trekker EN, AV1)  
- https://kimberlykepharttravels.com/rifugio-lagazuoi-overnight-stay-guide/ (pernotto, tramonto)  
- TripAdvisor / AllTrails recensioni Rifugio e Galleria Anticima (voci utente, non fonte ufficiale)

Canvas correlato (IDE): \`canvases/lagazuoi-contesto.canvas.tsx\`

---

## Note per l’agente

- Consultare **questo file** prima di scrivere storie ambientate sul percorso o sulle foto Photopoint in \`assets/media/stories/\`.
- Le quote e le date delle mine possono variare leggermente tra fonti: preferire range e “circa” in prosa; per copy istituzionale riallinearsi a lagazuoi.it.
- Non inventare nomi di soldati reali oltre a quelli già documentati (Martini, Malvezzi, Cadorin, Raschin) senza verifica.
- Codici cartelle media (\`assets/media/<codice>/\`) e foto stories sono materiali contemporanei: legarli al contesto storico solo con intenzione narrativa esplicita.
`,Qo=`# Photopoint Lagazuoi — storie

> Archivio editoriale Peak Prompt.  
> **Titolo = codice a tre cifre.** Ogni storia ha **breve**, **esteso**, **citazioni** (IT) e traduzione **EN**.  
> **Autenticità:** solo **#683 / 92239** è *reale* (\`real: true\`); tutte le altre sono *finte* (\`real: false\`).  
> Contesto: \`content/lagazuoi-contesto.md\`.  
> UI: italiano di default; inglese con \`?lang=en\`.  
> Ultimo aggiornamento: 2026-10-04.

| Titolo | Photopoint (asset) | Reale | Nucleo del viaggio |
| --- | --- | --- | --- |
| **609** | 15513 | no | Prima salita a piedi da Falzarego; liberarsi di un peso |
| **442** | 29235 | no | Gita con il cane sul Sentiero del Fronte |
| **978** | 46544 | no | Memoria del nonno Alpino; baracca e silenzio |
| **557** | 55826 | no | Coppia sull’Alta Via; promessa prima della cima |
| **629** | 57198 | no | Pernotto + alba verso la croce; galleria il giorno prima |
| **598** | 65761 | no | Elopement: hiking (e funivia) in abiti nuziali |
| **890** | 67091 | no | Famiglia day-trip; i bambini e i 650 m |
| **898** | 72700 | no | Salita segreta per cacciare un cerbiatto |
| **690** | 83531 | no | Notte in rifugio; alba dopo la folla delle 17 |
| **683** | 92239 | **sì** | Kaiserjäger all’alba; luce e memoria di pietra |
| **537** | 62537 | no | Vittorio: ultima notte in foresteria; pensione; Cervino |

---

## 609

**Asset:** \`assets/media/stories/15513-f1-2026-07-05T14-25-38-big.jpg\` · 05.07.2026

### Breve
Ha rifiutato la funivia. Da Falzarego, Sentiero del Fronte, zaino ancora pieno di rabbia e cose inutili. In forcella ha capito che non era fitness: era una linea di guerra. In vetta ha allargato le braccia — non per lo scatto, perché il corpo diceva di avercela fatta a portare se stessa fin qui.

### Esteso
Aveva deciso di non prendere la funivia. Non per snobismo da trekker — per bisogno. A Pian Falzarego lo zaino le pesava ancora di cose inutili: caricabatterie doppi, una maglia “per ogni evenienza”, la rabbia lasciata in città. Il Sentiero del Fronte, all’inizio, era solo un nastro di ghiaia e cartelli CAI. Poi, dopo il primo tornante, il passo le ha imposto un ritmo: respirare, posare il piede, non pensare al telefono.

Verso i duemilacinquecento metri, alla Forcella Lagazuoi, il vento le ha tolto le ultime frasi pronte. Ha visto i reticolati ricostruiti, le trincee che un secolo fa chiudevano la via verso Val Badia, e ha capito — senza libri — che quella salita non era un fitness. Era una linea. Ha passato la baracca degli ufficiali austriaci senza entrare: il tavolo e le sedie d’epoca le sono bastati da fuori, come un diorama che non voleva toccare. Ha bevuto l’acqua tiepida e ha ripreso.

Quando il Rifugio Lagazuoi le è apparso sopra i ghiaioni, non ha pensato al Photopoint. Ha pensato che le braccia le dolevano in un modo giusto. Solo dopo — terrazza, pedana, scatto automatico — ha allargato le braccia. Non era una posa imparata online. Era il corpo che diceva: *ce l’ho fatta a portare me stessa fin qui*. #609 è il numero che la macchina le ha dato. Il viaggio, invece, se lo tiene senza titolo.

### Citazioni
- Nota delle 11:40 — ho spento le notifiche. Se qualcuno cerca, rispondo da sopra.
- Zaino troppo pieno di cose che non mi servono. Me ne accorgo a ogni tornante.
- Messaggio non inviato: «Oggi non scendo come sono salita.»

### Brief (EN)
She refused the cable car. From Falzarego, along the Front Trail, her pack still heavy with anger and useless things. At the pass she understood it was not fitness: it was a line of war. On the summit she opened her arms — not for the photo, because her body was saying she had carried herself all the way here.

### Full (EN)
She had decided not to take the cable car. Not out of trekker snobbery — out of need. At Pian Falzarego her pack still weighed with useless things: spare chargers, a sweater “just in case,” the anger left behind in the city. The Front Trail, at first, was only a ribbon of gravel and CAI signs. Then, after the first switchback, the pace forced a rhythm on her: breathe, place the foot, stop thinking about the phone.

Near twenty-five hundred meters, at Forcella Lagazuoi, the wind took her last ready-made phrases. She saw the reconstructed wire, the trenches that a century ago closed the way toward Val Badia, and she understood — without books — that this climb was not fitness. It was a line. She passed the Austrian officers’ hut without going in: the period table and chairs were enough from outside, like a diorama she did not want to touch. She drank lukewarm water and went on.

When Rifugio Lagazuoi appeared above the scree, she did not think of the Photopoint. She thought her arms hurt in the right way. Only later — terrace, platform, automatic shutter — did she open her arms. It was not a pose learned online. It was the body saying: *I made it, carrying myself all the way here*. #609 is the number the machine gave her. The journey, she keeps without a title.

### Quotes (EN)
- Note, 11:40 — notifications off. If anyone looks for me, I’ll answer from above.
- Pack too full of things I don’t need. I notice it at every switchback.
- Unsent message: “I won’t come down the way I went up.”

---

## 442

**Asset:** \`assets/media/stories/29235-f1-2026-07-06T12-01-52-big.jpg\` · 06.07.2026

### Breve
Il cane ha fatto più metri di molti day-tripper in cabina. Sul Sentiero del Fronte ha imparato il ritmo: annusare, fermarsi, bere. Niente galleria — troppo buio. Molte cacche interessanti però. In cima si è seduto al centro della pedana, più calmo di tutti. Portarlo dove la montagna è museo: questa è la salita.

### Esteso
Il cane ha fatto più metri di molti day-tripper in cabina. L’avevano lasciato a casa altre volte; stavolta no. Da Falzarego hanno scelto il sentiero largo, quello che i blog chiamano “facile” finché le gambe non rispondono. Lui tirava il guinzaglio solo all’inizio, poi ha capito il gioco: restare vicino, annusare il legno delle passerelle, fermarsi quando i padroni bevevano. Cacche di forme inconsuete, dai profumi nuovi. Batteva i denti per ricordare.

In forcella ha incontrato altri cani e ha fatto il suo lavoro sociale. La borsa della spesa blu — assurdità consapevole — conteneva croccantini e una bottiglia d’acqua condivisa. Non sono scesi in Galleria di Mina: troppo buio, troppo stretto, e lui non ama i caschi. Hanno seguito la linea del fronte a cielo aperto, dove un tempo passavano i portatori di notte con decine di chili per uomo, e oggi passano famiglie con bastoncini telescopici.

In vetta, sulla pedana del Photopoint, si è seduto da solo al centro. Non perché glielo avessero ordinato con durezza: perché il legno era fresco e la voce dei suoi umani era lì. Questa, #442, è la storia di una salita banale e rara insieme — portare un animale fin dove la montagna diventa museo — e scoprire che, di tutti, è lui ad arrivare con più calma.

### Citazioni
- Chat: «Portiamo anche lui?» / «Sì. Se si ferma, ci fermiamo.»
- Ha trovato un odore dietro una pietra e ci ha obbligati a una pausa filosofica.
- Diario: oggi il più serio del gruppo pesava 18 chili e aveva quattro zampe.

### Brief (EN)
The dog covered more meters than many day-trippers in the cabin. On the Front Trail he learned the rhythm: sniff, stop, drink. No tunnel — too dark. Plenty of interesting poop, though. On top he sat in the middle of the platform, calmer than anyone. Bringing him where the mountain is a museum: that is the climb.

### Full (EN)
The dog covered more meters than many day-trippers in the cabin. They had left him home other times; not this time. From Falzarego they chose the wide path, the one blogs call “easy” until the legs disagree. He pulled the leash only at the start, then got the game: stay close, sniff the boardwalk wood, stop when his people drank. Droppings of unfamiliar shapes, new smells. He chattered his teeth to remember.

At the pass he met other dogs and did his social work. The blue grocery bag — a deliberate absurdity — held kibble and a shared water bottle. They did not enter the Galleria di Mina: too dark, too narrow, and he hates helmets. They followed the front line under open sky, where porters once moved at night with tens of kilos per man, and families now pass with telescopic poles.

On the summit, on the Photopoint platform, he sat alone in the center. Not because they ordered him harshly: because the wood was cool and his humans’ voices were there. This, #442, is the story of a climb that is ordinary and rare at once — bringing an animal to where the mountain becomes a museum — and finding that, of everyone, he arrives with the most calm.

### Quotes (EN)
- Chat: “Are we bringing him too?” / “Yes. If he stops, we stop.”
- He found a smell behind a rock and forced us into a philosophical pause.
- Diary: today the most serious member of the group weighed 18 kilos and had four legs.

---

## 978

**Asset:** \`assets/media/stories/46544-f1-2026-07-06T12a-30-24-big.jpg\` · 06.07.2026

### Breve
Il nonno, Alpino, le aveva lasciato solo pezzi: il freddo delle gallerie, il nome Lagazuoi detto a mezza voce. Ha salito da Falzarego a piedi, casco e frontale, dentro la Galleria di Mina. Non cercava fantasmi: rispetto. In vetta è rimasta di spalle. Il volto spettava alle Tofane e a lui.

### Esteso
Suo nonno non le ha mai raccontato la guerra per intero. Le ha lasciato pezzi: il freddo nelle gallerie, il peso sulle spalle, il nome *Lagazuoi* pronunciato come si pronunciano le cose che non si vogliono ripetere. Era stato dagli Alpini, o vicino agli Alpini — lei non ha mai avuto il grado giusto, solo una foto sbiadita e l’odore di lana umida nei ricordi d’infanzia.

Quest’anno ha deciso di salire da Falzarego senza funivia, proprio per sentire i polpacci. Ha noleggiato casco e frontale all’infopoint, è entrata nella Galleria di Mina e ha capito subito il senso delle sue reticenze: sette gradi, umidità, pendenza che ti entra nelle ginocchia. Dentro la roccia ha ripensato ai portatori notturni, alle mine del 1916–17, alla Cengia Martini aggrappata a mezza parete. Non ha cercato fantasmi. Ha cercato rispetto.

Uscita alla luce, ha proseguito verso forcella e baracca. Non ha messo monete nel cannocchiale in vetta. È rimasta di spalle al Photopoint perché il volto, quel giorno, spettava alle Tofane e a un uomo morto da anni che non vedrà mai lo scatto. #978 è il numero della macchina. La storia è il nonno che, senza saperlo, le ha indicato la salita.

### Citazioni
- Avevo la sua foto nello zaino. Non l’ho tirata fuori: mi bastava saperla lì.
- Dentro la roccia ho parlato a voce bassa, come si fa in chiesa — o in cucina da lui.
- Appunto: non voglio una storia completa. Voglio un pezzo vero.

### Brief (EN)
Her grandfather, an Alpino, had left her only fragments: the cold of the tunnels, the name Lagazuoi said under his breath. She climbed from Falzarego on foot, helmet and headlamp, into the Galleria di Mina. She was not hunting ghosts: respect. On the summit she stayed with her back turned. The face belonged to the Tofane — and to him.

### Full (EN)
Her grandfather never told her the war in full. He left her pieces: the cold in the tunnels, the weight on the shoulders, the name *Lagazuoi* spoken the way you speak things you do not want to repeat. He had been with the Alpini, or near the Alpini — she never had the right rank, only a faded photo and the smell of damp wool in childhood memory.

This year she decided to climb from Falzarego without the cable car, precisely to feel her calves. She rented a helmet and headlamp at the info point, entered the Galleria di Mina, and understood at once the sense of his reticence: seven degrees, humidity, a grade that works into the knees. Inside the rock she thought of the night porters, the mines of 1916–17, the Cengia Martini clinging halfway up the wall. She was not looking for ghosts. She was looking for respect.

Back in the light, she went on toward the pass and the hut. She put no coins in the summit telescope. She stayed with her back to the Photopoint because that day the face belonged to the Tofane and to a man dead for years who will never see the frame. #978 is the machine’s number. The story is the grandfather who, without knowing it, pointed her to the climb.

### Quotes (EN)
- I had his photo in the pack. I didn’t take it out: knowing it was there was enough.
- Inside the rock I spoke softly, the way you do in church — or in his kitchen.
- Note: I don’t want a complete story. I want one true piece.

---

## 557

**Asset:** \`assets/media/stories/55826-f1-2026-07-07T13-16-18-big.jpg\` · 07.07.2026

### Breve
Camminavano sull’Alta Via da giorni, rifugio prenotato mesi prima. Verso forcella, in un tornante senza pubblico, si sono detti una promessa rimandata in città: restare nello stesso passo. Il bacio in vetta è solo la firma. La storia è nata prima, tra canederli, temporali e piedi nel lago.

### Esteso
Camminavano da giorni sull’Alta Via 1 — o almeno su un pezzo abbastanza lungo da far loro dimenticare le mail. Avevano prenotato il Rifugio Lagazuoi mesi prima, come fanno gli australiani e gli inglesi nei blog, e avevano temuto la folla. Invece, sulla salita verso forcella, c’era abbastanza silenzio da parlarsi davvero.

Lui aveva lo zaino più pesante; lei teneva il ritmo. A un tornante sopra i duemilatrecento metri, senza anello e senza pubblico, si sono fermati e si sono detti una cosa che in città rimandavano da mesi. Non un matrimonio da organizzare: una promessa di restare nello stesso passo. Poi hanno riso, perché dire cose gravi con i bastoncini in mano sembra sempre un po’ comico.

Il bacio sul Photopoint è solo la firma in cima. Il viaggio era tutto ciò che c’era prima: i canederli della sera prima in un altro rifugio, i piedi nel lago a metà tappa come nei diari AV1, la paura del temporale, il sollievo quando il Lagazuoi è diventato un tetto e non un miraggio. #557 non nasce sulla pedana. Nasce sui tornanti.

### Citazioni
- WhatsApp, 06:12: «Se piove ci bagniamo. Se no, parliamo.»
- Ieri canederli. Oggi una frase che in città rimandavamo da mesi.
- Lei nel diario: «Ha preso lo zaino pesante senza farmelo notare. Tipico.»

### Brief (EN)
They had been walking the Alta Via for days, hut booked months ahead. Toward the pass, on a switchback with no audience, they said a promise postponed in the city: stay in the same stride. The kiss on the summit is only the signature. The story began earlier — among canederli, storms, and feet in a lake.

### Full (EN)
They had been walking Alta Via 1 for days — or at least a stretch long enough to make them forget email. They had booked Rifugio Lagazuoi months ahead, the way Australians and Brits do in the blogs, and they had feared the crowds. Instead, on the climb toward the pass, there was enough silence to really speak.

He carried the heavier pack; she held the pace. On a switchback above twenty-three hundred meters, with no ring and no audience, they stopped and said something they had postponed for months in the city. Not a wedding to organize: a promise to stay in the same stride. Then they laughed, because saying serious things with poles in your hands always feels a little comic.

The kiss on the Photopoint is only the signature at the top. The journey was everything before: canederli the night before in another hut, feet in a lake mid-stage as in the AV1 diaries, fear of the storm, relief when Lagazuoi became a roof and not a mirage. #557 is not born on the platform. It is born on the switchbacks.

### Quotes (EN)
- WhatsApp, 06:12: “If it rains we get wet. If not, we talk.”
- Yesterday canederli. Today a sentence we kept postponing in the city.
- Her diary: “He took the heavy pack without making me notice. Typical.”

---

## 629

**Asset:** \`assets/media/stories/57198-f1-2026-07-11T08-53-10-big.jpg\` · 11.07.2026

### Breve
È salito col pomeriggio affollato, ha preso il dormitorio, ha aspettato che dopo le diciassette la cima diventasse eremo. Ha visto il tramonto sulle Tofane. All’alba è uscito prima degli altri: croce, memoria delle gallerie, poi la pedana di spalle. Arriva in vetta due volte. Conta la seconda.

### Esteso
È salito il pomeriggio prima, quando la funivia vomitava ancora day-tripper. Ha preso una branda nel dormitorio Pompanin, ha pagato la doccia a gettone, ha cenato al tavolo sbagliato e si è fatto rimproverare — come nei racconti dei trekker inglesi — e ha aspettato. Dopo le diciassette la cima ha cambiato personalità: da luna park a eremo. Ha visto il tramonto sulle Tofane e ha capito perché si pernotta.

Al mattino è uscito prima del caffè degli altri. Non verso il Photopoint subito: verso la croce, poi un tratto indietro verso la memoria — feritoie, aria delle gallerie ancora nelle ossa dal giorno in cui era sceso con casco e frontale. Solo alle otto e cinquantatré si è fermato sulla pedana, di spalle, mentre due ospiti del rifugio già chiacchieravano al tavolino con i bicchieri in mano.

#629 è la storia di chi arriva in vetta due volte: la prima con la folla, la seconda con l’alba. Il Photopoint coglie la seconda. Il viaggio vero è la notte in mezzo.

### Citazioni
- Nota in camerata: sveglia prima del caffè degli altri. Porta chiusa piano.
- Mi hanno rimproverato per il posto a tavola. Meglio così — meno chiacchiere.
- Messaggio a nessuno: «Stasera la montagna è diventata quieta. Io resto.»

### Brief (EN)
He came up with the crowded afternoon, took a dorm bed, waited for the summit to become a hermitage after five. He watched the sunset on the Tofane. At dawn he left before the others: the cross, the memory of the tunnels, then the platform with his back turned. He reaches the top twice. The second time counts.

### Full (EN)
He came up the afternoon before, when the cable car was still spilling day-trippers. He took a bunk in the Pompanin dormitory, paid for the coin-operated shower, ate at the wrong table and got scolded — as in the English trekker stories — and waited. After five the summit changed personality: from theme park to hermitage. He watched the sunset on the Tofane and understood why people overnight.

In the morning he left before the others’ coffee. Not straight to the Photopoint: toward the cross, then a stretch back toward memory — embrasures, tunnel air still in the bones from the day he had descended with helmet and headlamp. Only at eight fifty-three did he stop on the platform, back turned, while two hut guests already chatted at the little table with glasses in hand.

#629 is the story of someone who arrives on the summit twice: first with the crowd, second with the dawn. The Photopoint catches the second. The real journey is the night in between.

### Quotes (EN)
- Dorm note: wake before the others’ coffee. Close the door softly.
- They scolded me for the table seat. Better that way — less talk.
- Message to no one: “Tonight the mountain went quiet. I’m staying.”

---

## 598

**Asset:** \`assets/media/stories/65761-f1-2026-07-11T15-44-58-big.jpg\` · 11.07.2026

### Breve
L’abito e lo smoking sono saliti in funivia con il fotografo; loro hanno voluto il Sentiero del Fronte a piedi, polvere sui pantaloni da trekking. Si sono cambiati in rifugio, ridendo. Un sì tra gallerie di guerra e oceano di vette. Hiking nuziale: la cima al posto dell’altare.

### Esteso
L’abito e lo smoking non sono saliti sulle loro spalle per tutto il dislivello — sarebbe stato cinema, non vita. Li avevano lasciati a Cortina; un amico fotografo li ha portati su in funivia, come nelle storie di elopement che si leggono sui siti dei wedding photographer. Loro, invece, hanno voluto arrivare a piedi: Sentiero del Fronte, polvere fine sull’orlo dei pantaloni da trekking, mani che sapevano già di pietra.

Sotto i vestiti da sposi c’erano ancora i calzini sudati del cammino. Si sono cambiati dietro una porta del rifugio, ridendo nervosi, mentre fuori i turisti ordinavano birra. Avevano scelto il Lagazuoi perché sotto i piedi ci sono le gallerie della Grande Guerra e sopra c’è un oceano di vette — e perché un sì detto qui non somiglia a nessun sì da salone. Venivano da lontano, lontanissimo, ma una persona li legava a quel luogo, e loro volevano legarsi ulteriormente.

Quando sono usciti in smoking e tulle, il vento ha provato a sollevare la gonna e qualcuno in canotta ha tagliato il bordo del mondo senza fermarsi. #598 è hiking nuziale: non la cerimonia intera, ma il tratto di ghiaione in cui due persone hanno deciso che la cima, e non l’altare, era il posto giusto per cominciare.

### Citazioni
- Dietro la porta del rifugio: «Riesci a chiudere lo smoking con le mani che tremano?»
- Vocale a mia sorella: «Ci siamo detti di sì con la polvere ancora sugli scarponi.»
- Sul telefono, bozza: luogo: qui. abito: dopo. testimoni: il vento.

### Brief (EN)
The dress and the tuxedo rode the cable car with the photographer; they wanted the Front Trail on foot, dust on their trekking trousers. They changed at the hut, laughing. A yes between war tunnels and an ocean of peaks. Wedding hiking: the summit instead of the altar.

### Full (EN)
The dress and the tuxedo did not ride their shoulders for the whole elevation — that would have been cinema, not life. They had left them in Cortina; a photographer friend brought them up by cable car, as in the elopement stories on wedding photographers’ sites. They, instead, wanted to arrive on foot: Front Trail, fine dust on the cuffs of trekking trousers, hands that already knew stone.

Under the wedding clothes the sweaty socks from the walk were still there. They changed behind a hut door, laughing nervously, while outside tourists ordered beer. They had chosen Lagazuoi because underfoot lie the tunnels of the Great War and above lies an ocean of peaks — and because a yes said here resembles no salon yes. They came from far away, very far, but one person tied them to that place, and they wanted to bind themselves further.

When they stepped out in tuxedo and tulle, the wind tried to lift the skirt and someone in a tank top cut across the edge of the world without stopping. #598 is wedding hiking: not the whole ceremony, but the stretch of scree where two people decided the summit, not the altar, was the right place to begin.

### Quotes (EN)
- Behind the hut door: “Can you close the tuxedo with hands that shake?”
- Voice note to my sister: “We said yes with dust still on our boots.”
- Phone draft: place: here. clothes: later. witnesses: the wind.

---

## 890

**Asset:** \`assets/media/stories/67091-f1-2026-07-16T14-49-28-big.jpg\` · 16.07.2026

### Breve
I bambini volevano la funivia; i genitori dissero «un pezzo a piedi». Il pezzo divenne seicentocinquanta metri di dislivello, pause ogni tre tornanti, snack in forcella. Niente galleria: troppo buia. In vetta pollice alzato e pile rosa. Arrivare insieme valeva più delle date delle mine.

### Esteso
I bambini avevano chiesto la funivia. I genitori avevano risposto: «Un pezzo a piedi, poi si vede». Da Falzarego il «pezzo» è diventato la salita vera — circa seicentocinquanta metri di dislivello che sui blog sembrano un numero e sulle gambe di un bambino in pile rosa diventano un’epopea. Hanno fatto pause ogni tre tornanti. Hanno contato camosci che forse erano pietre. Hanno mangiato snack sulla Forcella Lagazuoi mentre un giovane con lo zaino giallo spiegava al cannocchiale delle cose troppo grandi.

Non hanno fatto la galleria: troppo buia per i più piccoli, dicevano le guide. Hanno seguito il cielo. In vetta il bambino ha alzato il pollice prima ancora dello scatto; la bambina era già una bandiera rosa contro il calcare. Intorno, un uomo seduto a terra con i bastoncini rossi recuperava da una salita più dura della loro — e quella vista, per i genitori, è stata la lezione: la montagna tiene insieme chi arriva in tanti modi.

#890 è una gita famigliare che sfiora la storia senza entrarci fino in fondo, e va bene così. Arrivare insieme contava più di sapere le date delle mine.

### Citazioni
- Papà nel gruppo famiglia: «Pausa snack. Non è una negoziazione.»
- La piccola ha chiesto se le pietre erano camosci. Abbiamo detto di sì.
- Nota mamma: oggi non importava sapere le date. Importava chi teneva la mano.

### Brief (EN)
The children wanted the cable car; the parents said “a bit on foot.” The bit became six hundred fifty meters of elevation, rests every three switchbacks, snacks at the pass. No tunnel: too dark. On top a thumbs-up and pink fleece. Arriving together mattered more than the dates of the mines.

### Full (EN)
The children had asked for the cable car. The parents had answered: “A bit on foot, then we’ll see.” From Falzarego the “bit” became the real climb — about six hundred fifty meters of elevation that look like a number on blogs and become an epic on the legs of a child in pink fleece. They rested every three switchbacks. They counted chamois that might have been stones. They ate snacks on Forcella Lagazuoi while a young man with a yellow pack explained things too large into the telescope.

They skipped the tunnel: too dark for the little ones, the guides said. They followed the sky. On the summit the boy raised his thumb before the shutter; the girl was already a pink flag against the limestone. Nearby, a man sat on the ground with red poles recovering from a harder climb than theirs — and that sight, for the parents, was the lesson: the mountain holds together those who arrive in many ways.

#890 is a family day that brushes history without entering it all the way, and that is fine. Arriving together mattered more than knowing the dates of the mines.

### Quotes (EN)
- Dad in the family chat: “Snack break. Not a negotiation.”
- The little one asked if the stones were chamois. We said yes.
- Mom’s note: today the dates didn’t matter. Who held whose hand did.

---

## 898

**Asset:** \`assets/media/stories/72700-f1-2026-07-23T12-52-52-big.jpg\` · 23.07.2026

### Breve
Non ha detto a nessuno dove andava. Alba, giacca mimetica, versante meno battuto: inseguiva un cerbiatto visto anni prima in Valparola. Ha evitato i gruppi del fronte, la baracca, le chiacchiere. In vetta nessun animale — solo lui e il fallimento. Una salita segreta, non da confessare al rifugio.

### Esteso
Non ha detto a nessuno dove andava. Ha preso l’auto prima dell’alba, ha lasciato Falzarego quando i primi pullman ancora dormivano, ed è salito dal versante meno battuto con la giacca mimetica e i bastoncini. Non era un cacciatore da trofeo da salotto. Era qualcuno che da anni inseguiva — o credeva di inseguire — un cerbiatto visto una sola volta in Valparola, una macchia chiara tra i mughi, e da allora trasformata in ossessione privata.

Ha camminato in silenzio lungo linee che un secolo fa erano di rifornimento e di fuoco. Ha evitato i gruppi del Sentiero del Fronte. Ha passato la baracca degli ufficiali senza fermarsi: troppo tempo sospeso, troppa umanità. Voleva solo gli occhi dell’animale, o la prova di non averlo sognato. In alta quota la caccia è diventata altro — fiato, pazienza, il sospetto di essere lui il braccato dal vuoto.

In vetta non c’era nessun cerbiatto. C’era il Photopoint, un turista nello zaino rosso chino sul cannocchiale, e lui in piedi con l’espressione di chi ha fallito una missione e, nello stesso istante, ha raggiunto comunque una cima. #898 è la storia di una salita segreta: non per la foto, per qualcosa che non si confessa al rifugio.

### Citazioni
- Calendario barrato: oggi. Destinazione lasciata in bianco apposta.
- Ho evitato due gruppi e una baracca. Troppa voce per quello che cerco.
- Taccuino, ultima riga: se non c’è, almeno so di aver guardato bene.

### Brief (EN)
He told no one where he was going. Dawn, camo jacket, the quieter flank: he was after a fawn seen years earlier in Valparola. He avoided the front groups, the hut, the chatter. On the summit no animal — only him and the failure. A secret climb, not one to confess at the refuge.

### Full (EN)
He told no one where he was going. He took the car before dawn, left Falzarego while the first coaches still slept, and climbed the quieter flank in a camo jacket with poles. He was not a parlor trophy hunter. He was someone who for years had been following — or believed he was following — a fawn seen once in Valparola, a pale patch among the pines, since then turned into a private obsession.

He walked in silence along lines that a century ago were supply and fire. He avoided the groups on the Front Trail. He passed the officers’ hut without stopping: too much suspended time, too much humanity. He wanted only the animal’s eyes, or proof he had not dreamed it. High up the hunt became something else — breath, patience, the suspicion that he was the one being stalked by the emptiness.

On the summit there was no fawn. There was the Photopoint, a tourist in a red pack bent over the telescope, and him standing with the look of someone who failed a mission and, in the same instant, still reached a summit. #898 is the story of a secret climb: not for the photo, for something you do not confess at the hut.

### Quotes (EN)
- Calendar crossed out: today. Destination left blank on purpose.
- I avoided two groups and a hut. Too much voice for what I’m after.
- Notebook, last line: if it isn’t there, at least I know I looked well.

---

## 690

**Asset:** \`assets/media/stories/83531-f1-2026-10-03T07-09-36-big_colette.jpg\` · Colette · 03.10.2026

### Breve
Aveva letto che dopo le diciassette il Lagazuoi cambia pelle. Ottobre, funivia il pomeriggio, notte in rifugio mentre la folla scende. All’alba: sole di taglio, valle in foschia, terrazza vuota. Ha comprato con una notte ciò che i day-tripper non vedono. L’alba è la ricevuta.

### Esteso
Aveva letto che dopo le diciassette il Lagazuoi cambia pelle. Per questo aveva prenotato ottobre — stagione corta, meno code, ultima luce. Era salita nel pomeriggio con la funivia, perché il giorno dopo voleva le gambe fresche per l’alba, non per dimostrare nulla. Aveva cenato guardando le Tofane spopolarsi; aveva sentito il silenzio arrivare come un ospite in ritardo.

Di notte, dalla camerata, il vento raccontava la stessa storia di sempre: pietra forata, gallerie sotto i piedi, nemici di ieri diventati museo. Al mattino è uscita alle sette e nove, quando il sole tagliava ancora di filo e la valle a destra restava in foschia. Nessuna borsa Lidl, nessun bacio da mezzogiorno. Solo lei, la giacca pesante, e la certezza di aver comprato con una notte in rifugio ciò che i day-tripper non vedono.

#690 è il viaggio breve e verticale di chi sale per restare — non per consumare la vista in un’ora. Il Photopoint all’alba è solo la ricevuta.

### Citazioni
- Prenotazione fatta a settembre: volevo la stagione corta, non lo sconto.
- Di notte il vento sembrava qualcuno che conosceva già la stanza.
- Alle sette e qualcosa: giacca, scarpe, nessuno a cui dare la buonanotte.

### Brief (EN)
She had read that after five Lagazuoi changes its skin. October, cable car in the afternoon, a night in the hut while the crowd goes down. At dawn: hard-edged sun, valley in haze, empty terrace. With one night she bought what day-trippers never see. Dawn is the receipt.

### Full (EN)
She had read that after five Lagazuoi changes its skin. That is why she booked October — short season, fewer queues, last light. She rode up in the afternoon by cable car, because the next day she wanted fresh legs for dawn, not to prove anything. She ate dinner watching the Tofane empty out; she felt the silence arrive like a late guest.

At night, from the dorm, the wind told the same old story: pierced stone, tunnels underfoot, yesterday’s enemies become museum. In the morning she went out at seven nine, when the sun still cut on edge and the valley to the right stayed in haze. No Lidl bag, no midday kiss. Only her, the heavy jacket, and the certainty of having bought with one hut night what day-trippers never see.

#690 is the short vertical journey of someone who climbs to stay — not to consume the view in an hour. The Photopoint at dawn is only the receipt.

### Quotes (EN)
- Booked in September: I wanted the short season, not the discount.
- At night the wind felt like someone who already knew the room.
- Sometime after seven: jacket, shoes, no one to say goodnight to.

---

## 683

**Autenticità:** reale (\`real: true\`) — unica storia vera del corpus.

**Asset:** \`assets/media/stories/92239-f1-2026-10-03T07-42-16-big_giulio.jpg\` · Giulio · 03.10.2026

### Breve
Voleva la luce, non la folla. Buio a Falzarego, Sentiero dei Kaiserjäger, reflex e maglione arancio contro il calcare. Salendo ha pensato ai portatori e ai bengala. In vetta: caffè, macchina sul tavolo, corpo fermo dove la luce finalmente lavora. Non caccia animali: caccia un’ora.

### Esteso
Voleva la luce, non la folla. Aveva lasciato l’auto a Falzarego al buio e aveva preso il Sentiero dei Kaiserjäger — la memoria austriaca, cenge e vuoto — con la reflex nello zaino e il maglione arancio scelto apposta per leggere contro il calcare. Non cacciava animali. Cacciava un’ora: quella in cui le stratificazioni delle Tofane smettono di essere cartolina e diventano volume. Era rimasto colpito dal trovare durante il percorso elementi antropici anonimi, ricoperti, ma con sembianze umane. Quanto la montagna oggi subisce il nostro impatto?

Salendo ha pensato ai Kaiserjäger che portavano viveri su quel tracciato, ai bengala, al silenzio obbligato. Ha scattato poco: risparmiava batteria e attenzione. In vetta ha ordinato un caffè, ha posato la macchina sul tavolino del Photopoint, ha aspettato che il vapore della tazzina gli dicesse che era vivo e non solo un occhio dietro l’ottica.

Mezz’ora prima, sulla stessa terrazza, c’era #690. Forse si sono sfiorati senza parlarsi — due solitudini d’ottobre cucite dallo stesso azzurro. #683 è la storia di una salita fatta di esposizione e pazienza: arrivare in cima non per celebrarsi, ma per mettere infine il corpo fermo dove la luce, finalmente, lavora.

### Citazioni
- Batteria al 41%. Meglio così: mi obbliga a scegliere.
- Sul sentiero qualcosa di umano sotto la pietra. Non so se fotografarlo.
- Ordine al bancone: «Un caffè. La macchina resta sul tavolo un minuto.»

### Brief (EN)
He wanted the light, not the crowd. Dark at Falzarego, Kaiserjäger Trail, SLR and an orange sweater against the limestone. Climbing he thought of the porters and the flares. On top: coffee, camera on the table, body still where the light finally works. He does not hunt animals: he hunts an hour.

### Full (EN)
He wanted the light, not the crowd. He left the car at Falzarego in the dark and took the Kaiserjäger Trail — Austrian memory, ledges and void — with the SLR in the pack and an orange sweater chosen to read against the limestone. He was not hunting animals. He was hunting an hour: the one when the Tofane’s strata stop being a postcard and become volume. Along the way he was struck by anonymous human traces, covered over, yet with human shape. How much does the mountain bear our impact today?

Climbing he thought of the Kaiserjäger who carried supplies on that line, of the flares, of obligatory silence. He shot little: saving battery and attention. On the summit he ordered a coffee, set the camera on the Photopoint table, waited for the steam from the cup to tell him he was alive and not only an eye behind the lens.

Half an hour earlier, on the same terrace, there was #690. Maybe they brushed past without speaking — two October solitudes stitched by the same blue. #683 is the story of a climb made of exposure and patience: arriving on top not to celebrate yourself, but to set the body still at last where the light, finally, works.

### Quotes (EN)
- Battery at 41%. Better that way: it forces me to choose.
- On the path something human under the stone. Not sure I should photograph it.
- Order at the counter: “One coffee. The camera stays on the table a minute.”

---

## 537

**Asset:** \`assets/media/stories/62537-f1-2026-10-03T22-28-44-big.jpg\` · Vittorio · 03.10.2026 · ore 22:28

### Breve
Ultima notte in foresteria, sulla funivia che è stata la sua vita. Domani è in pensione. Di pomeriggio, con la moglie, erano ombre sul Photopoint. Quassù ha trovato rifugio: salire, osservare. I genitori lo chiamarono come Vittorio Sella. Il Cervino della foto in ingresso — ora ci torna.

### Esteso
Vittorio ha dedicato la vita alla funivia. Non a un mestiere qualunque: a quel cavo teso tra Falzarego e la cima, alle cabine che scaricano day-tripper e riportano silenzio, alla routine di chi sale perché qualcun altro possa salire. I monti, per lui, non erano scenario. Erano rifugio. L’atto di arrivare in alto e osservare il mondo da quassù era l’unico lavoro che avrebbe potuto fare — e forse era già tutto scritto.

I genitori lo avevano chiamato così in memoria di Vittorio Sella, il fotografo che per primo aveva fotografato e raccontato moltissime cime. In ingresso, a casa, conservavano una fotografia del Cervino innevato: per il ragazzo era una meta, non una cornice. Anni dopo, le Tofane e il Lagazuoi gli sono bastati come ufficio; il Cervino è rimasto la direzione interna.

Il tre ottobre duemilaventisei, di pomeriggio, lui e sua moglie si sono fermati sulla pedana del Photopoint. Di spalle alla luce, di profilo alla pietra: due ombre. Non una posa da cartolina. Un saluto fatto con il corpo. Poi la sera, nella foresteria della funivia — l’ultima notte. Alle ventidue e ventotto la macchina ha scattato nel buio: un flash, quasi nulla nel fotogramma, e tutto ciò che conta fuori dal fotogramma. Dal giorno seguente è in pensione. #537 non è una conquista. È un congedo. Ora torna verso il Cervino — non per dimostrare, per chiudere il cerchio che i genitori avevano appeso all’ingresso.

### Citazioni
- Chiavi della foresteria sul comodino. Domani le lascio sul tavolo dell’ufficio.
- A lei, a voce: «Se lo scatto viene male, va bene. Oggi conta stare.»
- Promemoria nel telefono: Cervino — non una gita. Un ritorno.

### Brief (EN)
Last night in the staff lodge, on the cableway that was his life. Tomorrow he retires. In the afternoon, with his wife, they were shadows on the Photopoint. Up here he found refuge: to climb, to watch. His parents named him after Vittorio Sella. The Matterhorn in the hallway photo — now he returns to it.

### Full (EN)
Vittorio gave his life to the cableway. Not to just any job: to that cable stretched between Falzarego and the summit, to the cabins that unload day-trippers and bring silence back, to the routine of someone who goes up so someone else can go up. The mountains, for him, were not scenery. They were refuge. The act of arriving high and watching the world from up here was the only work he could have done — and maybe it was already written.

His parents had named him after Vittorio Sella, the photographer who first photographed and told so many peaks. In the hallway at home they kept a photograph of the snowy Matterhorn: for the boy it was a destination, not a frame. Years later the Tofane and Lagazuoi were enough as an office; the Matterhorn stayed the inner direction.

On the third of October twenty twenty-six, in the afternoon, he and his wife stopped on the Photopoint platform. Backs to the light, profile to the stone: two shadows. Not a postcard pose. A farewell made with the body. Then evening, in the cableway staff lodge — the last night. At twenty-two twenty-eight the machine fired in the dark: a flash, almost nothing in the frame, and everything that matters outside the frame. From the next day he is retired. #537 is not a conquest. It is a leave-taking. Now he turns toward the Matterhorn — not to prove, to close the circle his parents hung in the hallway.

### Quotes (EN)
- Lodge keys on the nightstand. Tomorrow I leave them on the office table.
- To her, aloud: “If the shot comes out wrong, that’s fine. Today being here counts.”
- Phone reminder: Matterhorn — not a trip. A return.

---

## Nota d’uso

- **Titolo UI:** solo il codice a tre cifre.  
- **Breve / Brief:** card, overlay, anteprima.  
- **Esteso / Full:** viaggio completo verso la vetta.  
- **Citazioni / Quotes:** slide tipografiche nello stack media (non ingrandibili).  
- **Autenticità:** campo \`real\` in \`src/stories-data.js\` — solo **92239 / #683** è \`true\`; le altre \`false\`. In UI restano sempre visibili *reale* e *finto* (EN: *real*/*fake*): l’utente sceglie; se indovina *finto* su una storia falsa, il mondo va in negativo e cade.  
- Lingua UI: selettore **ita / eng** (in basso a destra); anche \`?lang=en\`.  
- Contesto storico/turistico: \`lagazuoi-contesto.md\`.
`,qo=`#!/usr/bin/env python3
"""Export per-story zoom crops with varied aspect ratios."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
STORIES_DIR = ROOT / "assets" / "media" / "stories"
OUT_ROOT = ROOT / "assets" / "media"

# Frame: name, focal_x, focal_y, zoom, aspect (width/height)
# Wide keeps source ~1.50; zooms use portrait / square / ultrawide as fits the subject.
STORIES: dict[str, list[tuple[str, float, float, float, float]]] = {
    "15513": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-ragazza", 0.48, 0.62, 2.4, 0.80),
        ("02-cannocchiale", 0.28, 0.55, 2.8, 0.70),
        ("03-cima", 0.55, 0.28, 2.2, 1.90),
    ],
    "29235": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-cane", 0.48, 0.72, 2.6, 1.00),
        ("02-cannocchiale", 0.30, 0.55, 2.8, 0.68),
        ("03-visitatrice", 0.78, 0.58, 2.5, 0.85),
    ],
    "46544": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-donna", 0.42, 0.62, 2.5, 0.75),
        ("02-cannocchiale", 0.26, 0.55, 2.8, 0.70),
        ("03-parete", 0.58, 0.30, 2.2, 1.85),
    ],
    "55826": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-bacio", 0.38, 0.62, 2.6, 0.90),
        ("02-tavolo", 0.88, 0.68, 2.4, 1.15),
        ("03-cannocchiale", 0.30, 0.52, 2.8, 0.68),
    ],
    "57198": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-osservatore", 0.50, 0.58, 2.5, 0.78),
        ("02-coppia", 0.22, 0.62, 2.6, 1.10),
        ("03-cima", 0.62, 0.28, 2.2, 1.95),
    ],
    "65761": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-sposi", 0.48, 0.55, 2.4, 0.88),
        ("02-abito", 0.58, 0.68, 2.8, 0.72),
        ("03-cannocchiale", 0.22, 0.52, 2.8, 0.68),
    ],
    "67091": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-famiglia", 0.62, 0.60, 2.4, 1.20),
        ("02-zaino-giallo", 0.38, 0.55, 2.6, 0.82),
        ("03-bambina", 0.68, 0.58, 3.0, 0.75),
    ],
    "72700": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-escursionista", 0.52, 0.58, 2.5, 0.78),
        ("02-cannocchiale", 0.32, 0.52, 2.8, 0.68),
        ("03-parete", 0.55, 0.28, 2.2, 1.90),
    ],
    "83531": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-colette", 0.58, 0.62, 2.5, 0.80),
        ("02-cannocchiale", 0.28, 0.55, 2.8, 0.70),
        ("03-valle", 0.82, 0.45, 2.3, 1.80),
    ],
    "92239": [
        ("00-wide", 0.50, 0.50, 1.0, 1.50),
        ("01-giulio", 0.48, 0.58, 2.5, 0.78),
        ("02-fotocamera", 0.82, 0.78, 3.0, 1.25),
        ("03-cima", 0.55, 0.28, 2.2, 1.90),
    ],
}

# Output longest side — keep quality without forcing source aspect.
OUT_LONG = 1400


def find_source(code: str) -> Path:
    matches = sorted(STORIES_DIR.glob(f"{code}-*.jpg"))
    if not matches:
        raise FileNotFoundError(f"No source for story {code}")
    return matches[0]


def crop_zoom(
    img: Image.Image, fx: float, fy: float, zoom: float, aspect: float
) -> Image.Image:
    w, h = img.size
    # Cover area shrinks with zoom; box uses requested aspect.
    cover = min(w, h) / max(zoom, 1.0)
    if aspect >= 1.0:
        cw = cover * aspect
        ch = cover
    else:
        cw = cover
        ch = cover / aspect

    # Fit inside source
    scale = min(w / cw, h / ch, 1.0)
    cw = max(1, int(round(cw * scale)))
    ch = max(1, int(round(ch * scale)))

    cx = fx * w
    cy = fy * h
    left = int(round(cx - cw / 2))
    top = int(round(cy - ch / 2))
    left = max(0, min(left, w - cw))
    top = max(0, min(top, h - ch))
    cropped = img.crop((left, top, left + cw, top + ch))

    # Resize keeping crop aspect
    if cropped.width >= cropped.height:
        out_w = OUT_LONG
        out_h = max(1, int(round(OUT_LONG / (cropped.width / cropped.height))))
    else:
        out_h = OUT_LONG
        out_w = max(1, int(round(OUT_LONG * (cropped.width / cropped.height))))
    return cropped.resize((out_w, out_h), Image.Resampling.LANCZOS)


def main() -> None:
    for code, frames in STORIES.items():
        src = find_source(code)
        out_dir = OUT_ROOT / code
        out_dir.mkdir(parents=True, exist_ok=True)
        # Remove previous exports so stale same-aspect files don't linger
        for old in out_dir.glob("*.jpg"):
            old.unlink()
        img = Image.open(src).convert("RGB")
        print(f"{code}: {src.name} → {len(frames)} frames")
        for name, fx, fy, zoom, aspect in frames:
            frame = crop_zoom(img, fx, fy, zoom, aspect)
            out = out_dir / f"{name}.jpg"
            frame.save(out, "JPEG", quality=88, optimize=True)
            print(
                f"  wrote {out.relative_to(ROOT)} "
                f"({frame.width}×{frame.height}, ar={frame.width/frame.height:.2f})"
            )


if __name__ == "__main__":
    main()
`,Ko=`#!/usr/bin/env python3
"""Export simplified trail JSON from the Wikiloc GPX."""

from __future__ import annotations

import json
import math
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
GPX = ROOT / "assets" / "pian-falzarego-forcella-lagazuoi-baracca-ufficiali-austriaci.gpx"
OUT = ROOT / "public" / "trail.json"
NS = {"g": "http://www.topografix.com/GPX/1/1"}


def haversine(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    r = 6371000.0
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def main() -> None:
    root = ET.parse(GPX).getroot()
    pts: list[tuple[float, float, float]] = []
    for trkpt in root.findall(".//g:trkpt", NS):
        lat = float(trkpt.get("lat"))
        lon = float(trkpt.get("lon"))
        ele = float(trkpt.find("g:ele", NS).text)
        pts.append((lat, lon, ele))

    dist = 0.0
    gain = 0.0
    for i in range(1, len(pts)):
        dist += haversine(pts[i - 1], pts[i])
        de = pts[i][2] - pts[i - 1][2]
        if de > 0:
            gain += de

    eles = [p[2] for p in pts]
    step = max(1, len(pts) // 400)
    simp = pts[::step]
    if simp[-1] != pts[-1]:
        simp.append(pts[-1])

    payload = {
        "name": "Pian Falzarego → Rifugio Lagazuoi",
        "stats": {
            "distanceKm": round(dist / 1000, 2),
            "gainM": round(gain),
            "eleMin": round(min(eles)),
            "eleMax": round(max(eles)),
            "points": len(pts),
        },
        "waypoints": [
            {
                "name": "Pian Falzarego",
                "lat": pts[0][0],
                "lon": pts[0][1],
                "ele": round(pts[0][2], 1),
            },
            {"name": "Forcella Lagazuoi", "km": 1.9},
            {"name": "Baracca ufficiali austriaci", "km": 2.9},
            {
                "name": "Rifugio Lagazuoi",
                "lat": pts[-1][0],
                "lon": pts[-1][1],
                "ele": round(pts[-1][2], 1),
            },
        ],
        "points": [
            {"lat": a, "lon": b, "ele": round(c, 1)} for a, b, c in simp
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} ({len(simp)} points)")


if __name__ == "__main__":
    main()
`,Vo=`<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Peak Prompt</title>
    <!-- Hide GPS/rings before stylesheet loads (avoids flash on refresh) -->
    <style>
      body.is-booting .path-points,
      body.is-booting .carousel-item,
      body.is-booting .text-item {
        opacity: 0 !important;
        visibility: hidden !important;
      }
    </style>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body class="is-booting">
    <div id="app" class="stage">
      <div class="col-grid" aria-hidden="true">
        <div class="col-grid-cell"></div>
        <div class="col-grid-cell"></div>
        <div class="col-grid-cell"></div>
        <div class="col-grid-cell"></div>
        <div class="col-grid-cell"></div>
      </div>
      <h1 class="title">
        <button
          type="button"
          class="title-home"
          id="title-home"
          aria-label="Torna alla home"
        >
          <span class="title-peak">peak</span>
          <span class="title-prompt">prompt</span>
        </button>
      </h1>
      <button type="button" class="boot-splash" id="boot-splash" aria-live="polite">
        <div class="boot-wide-carousel" id="boot-wide-carousel" aria-hidden="true">
          <div class="boot-wide-stack frame-stack" id="boot-wide-stack"></div>
        </div>
        <span class="boot-splash-label">
          10 esperienze<br />pezzi di vita vissuta o di vita generata?
        </span>
      </button>
      <p
        class="real-confirm"
        id="real-confirm"
        hidden
        aria-live="polite"
        aria-hidden="true"
      ></p>
      <p class="void-404" id="void-404" hidden aria-hidden="true">
        sì, questa esperienza è stata generata
      </p>
      <p class="boot-credit" id="boot-credit" aria-hidden="true">
        Lagazuoi EXPO Dolomiti / 2026
      </p>
      <button type="button" class="spin" id="spin" aria-label="Gira la ruota delle storie">
        spin
      </button>
      <aside
        class="story-auth"
        id="story-auth"
        hidden
        aria-hidden="true"
        aria-label="real or fake?"
      >
        <p class="story-auth-prompt">
          <button
            type="button"
            class="story-auth-choice"
            id="story-auth-real"
            data-guess="real"
          ></button>
          <span class="story-auth-or" id="story-auth-or" aria-hidden="true"></span>
          <button
            type="button"
            class="story-auth-choice"
            id="story-auth-fake"
            data-guess="fake"
          ></button>
          <span class="story-auth-mark" aria-hidden="true"></span>
        </p>
      </aside>
      <button
        type="button"
        class="home-ring"
        id="home-ring"
        aria-label="Torna alla home"
        hidden
      ></button>
      <a
        class="info-btn"
        id="info-btn"
        href="./info.html"
        aria-label="Informazioni sul progetto"
      >
        info
      </a>
      <div class="lang-switch" id="lang-switch" role="group" aria-label="Lingua">
        <div class="lang-switch-rail">
          <button type="button" class="lang-switch-btn" id="lang-it" data-lang="it">
            ita
          </button>
          <span class="lang-switch-sep" aria-hidden="true">/</span>
          <button type="button" class="lang-switch-btn" id="lang-en" data-lang="en">
            eng
          </button>
        </div>
      </div>
      <aside class="story-panel" id="story-panel" hidden aria-live="polite">
        <div class="story-panel-inner">
          <p class="story-panel-datetime" id="story-panel-datetime"></p>
          <div class="story-panel-body" id="story-panel-body"></div>
        </div>
      </aside>
      <aside class="story-media" id="story-media" hidden aria-hidden="true">
        <div class="story-media-viewport">
          <div class="story-media-stack" id="story-media-grid"></div>
        </div>
      </aside>
      <p
        class="story-browse-hint"
        id="story-browse-hint"
        hidden
        aria-hidden="true"
      ></p>
      <!-- GPS track as 3D points — stage center, outside CSS-3D view (clean WebGL) -->
      <div class="path-points" id="path-points" aria-hidden="true"></div>
      <!-- Fixed viewpoint (never animated) -->
      <div class="view" id="view">
        <!-- Single rotating 3D root: images + texts as direct children (Safari-safe) -->
        <div class="rig" id="rig" aria-label="Storie Photopoint Lagazuoi"></div>
      </div>
      <div class="lightbox" id="lightbox" hidden>
        <button
          type="button"
          class="lightbox-close"
          id="lightbox-close"
          aria-label="Chiudi"
        >
          ×
        </button>
        <img class="lightbox-image" id="lightbox-image" alt="" hidden />
        <video
          class="lightbox-video"
          id="lightbox-video"
          hidden
          controls
          playsinline
          loop
        ></video>
      </div>
      <!-- Fake story marked “real”: dense 3D wall of project source pages -->
      <div
        class="code-reveal"
        id="code-reveal"
        hidden
        aria-hidden="true"
        role="dialog"
        aria-label="Source"
      >
        <p class="code-reveal-caption" id="code-reveal-caption">
          no, questa esperienza è in larga parte generata
        </p>
        <div class="code-reveal-scene">
          <div class="code-reveal-rig" id="code-reveal-rig"></div>
        </div>
      </div>
    </div>
    <script type="module" src="/src/main.js"><\/script>
  </body>
</html>
`,Wo=`{
  "name": "peak-prompt-v2",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "trail": "python3 scripts/export-trail.py"
  },
  "dependencies": {
    "three": "^0.180.0"
  },
  "devDependencies": {
    "vite": "^7.1.7"
  }
}
`,Yo=`<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Peak Prompt — Trail 3D (temp)</title>
    <link rel="stylesheet" href="/src/trail-styles.css" />
  </head>
  <body>
    <div id="app">
      <canvas id="trail-canvas" aria-hidden="true"></canvas>
      <p class="credit">Imagery © Esri · Terrain AWS/Mapzen</p>
    </div>
    <script type="module" src="/src/trail-main.js"><\/script>
  </body>
</html>
`,Xo=`import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // GitHub Pages project site: https://gfavotto.github.io/experiencing/
  base: "/experiencing/",
  assetsInclude: ["**/*.obj", "**/*.mtl", "**/*.glb", "**/*.gltf"],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        trail: resolve(__dirname, "trail.html"),
        info: resolve(__dirname, "info.html"),
      },
    },
  },
  server: {
    open: true,
    proxy: {
      "/tiles/dem": {
        target: "https://s3.amazonaws.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\\/tiles\\/dem/, "/elevation-tiles-prod/terrarium"),
      },
      "/tiles/sat": {
        target: "https://server.arcgisonline.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\\/tiles\\/sat/,
            "/ArcGIS/rest/services/World_Imagery/MapServer/tile",
          ),
      },
    },
  },
  preview: {
    proxy: {
      "/tiles/dem": {
        target: "https://s3.amazonaws.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\\/tiles\\/dem/, "/elevation-tiles-prod/terrarium"),
      },
      "/tiles/sat": {
        target: "https://server.arcgisonline.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\\/tiles\\/sat/,
            "/ArcGIS/rest/services/World_Imagery/MapServer/tile",
          ),
      },
    },
  },
});
`,Jo="/experiencing/assets/00-wide-Bcua48Bm.jpg",$o="/experiencing/assets/01-DfR8pYNo.jpg",er="/experiencing/assets/02-B3NzYBDr.jpg",tr="/experiencing/assets/Screenshot%202026-10-04%20alle%2009.34.41-CfipTs5F.jpg",nr="/experiencing/assets/15513-phone-01-falzarego-BxugFgZA.jpg",ar="/experiencing/assets/15513-phone-02-tornante-DHqP5bk5.jpg",ir="/experiencing/assets/15513-phone-03-forcella-DXz9_F4V.jpg",or="/experiencing/assets/15513-phone-04-baracca-BP67F55c.jpg",rr="/experiencing/assets/15513-phone-05-acqua-DmhC_hLl.jpg",sr="/experiencing/assets/15513-phone-06-rifugio-DEPKKBS-.jpg",lr="/experiencing/assets/15513-phone-07-vetta-oB4Hc9W7.jpg",cr="/experiencing/assets/00-wide-Ch2jzpn0.jpg",pr="/experiencing/assets/01-cane-BYUJzy9D.jpg",hr="/experiencing/assets/03-visitatrice-CYQBg2AD.jpg",dr="/experiencing/assets/04-CY5NAImO.jpg",mr="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDADknKzIrJDkyLjJAPTlEVo9dVk9PVq99hGiPz7ba1su2yMTk////5PP/9sTI////////////3f//////////////2wBDAT1AQFZLVqhdXaj/7Mjs////////////////////////////////////////////////////////////////////wAARCAHgAlgDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAECA//EAB4QAQEBAQEBAQADAQAAAAAAAAABESExAkEDElFx/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwDoAAAAAAAAAAAAqAKgAAAAAAAKigAAAACAKgAAAAAKgCgAAAAAAAAAAAAAAAAAAACAKIAoAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAACiKAAAAAAAigCKAgqACgIKAigAAAAAAAAAAAAAAAAAAAAAigAAAAAAAAAAAAAAAAIAAAAAAAAAAAAoAAAIoCKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICiAKIAoigAAAAAAgAAAAAAAAACooAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAhaBaayAaaANaaxTAb0YNB0HPW5dBUVABQAAAAAAAAAQBiXW2JZG4AAAAAAAAAqKACAogCgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAmgqWlrFoLahoABoKJpaCpampvQW1A0BqVnSUHWVXHW5QbAAAAAAAABAAAYkm+tyuO1qXgOmjE9bAAAAAAAABUFBFAAAAAAAAAAAAS3DQUTSUFAAAABLQVLWbU0G9NY1QbElUAHO0G9NY00F1NTQFQAAAAQF1KAAEAAASLhgBL0sIDrLxWPmtAohoKJFAQpbkAtmm6427W/nwGwAcsifqmA181tiRsAAAAAAAAAAFEAUQBRAFEAFABLcVz+qBbtWMxQUTSXQblXWE2g6DntXQLUMAAoBBNS0GrcP7MgLbaRI0AigIAAioAACpoYBoAAEAVDQXTU0AABr59bc5XSXQAADQAc/q/jVvHP6vQZ/XX+Nyb+aDqM6A52/4S1hZQdZW5dcpWpf8Bsxia2AAAAAAAAAAAAAACgACW4zaBazqaoCyJF6BhmJ06C6EIBTSwkABcBKzafV6AAAAARpmKCpoAWpoAAACALqaLgILIAAAAAAAAAStSsgOsujPzeNAAAx9a42uv8lxytAb+XN0+QdBi0BghKQGlkISg1FSU2Ao1MoDJrWHAZC2JoNjGloNjGkoNgAGs2s20HTTXMBbdRcMBlqQkUAwaBkarIAJ0FaxhdwCzEtxL9IBb1NAAhgCgAGoAuiRQE0oBqoACmAkigAalAURQEKQFQ1bATVRQSkVAb+W3KXrUvQbGbcjF+qCfV6wX0Aiy4FA0QAWVAF00AaXWGoDUrUrDUoLqWlqAAAAAHis0GtNZAXSpvVAippoKXppoCs2mgqypDQbozrX4DNa1i3GdBus2paloFAADWQa0ADQAP0oUCKkXQMMNUEwAAIoJQoAlVKDLTLVArMLUBZ62xGrQZaZagDNoA1KS5WQG79bGAAASAYKAMAQADVRUhG4w1FCkpnAA00gEVIAoAH4lAAtEtBnetyud9WUG9CGAAALEWAuGLI1gMYbkbxz+rgJeiaaABgAaaDIANaVkBqFAAxU0BUNBTU00F0AE1dYAa0IAqDINM2lqAigCw0AAAANSAmqAAAABqaGKF0QBFRQAIkWNRnTVDZUlUDEWFgEABRDQKAAxW0oMLOIA3KusRsBUAXFiamg3prGqC2s27SxP0ADAFQAGWoAy1WQAAAAGjFBMMUBMFMBFhizAZsZrdvGKBGmSA0zQBDFAAEiKhqhRDQFTUBpNRQU1lQURNBVZUDRACAAoLAJAAai1IoEBiXoN4HsACiUFgkZ3KDVrOl6yC0RQJVl1I3JgKE6YALIuAzI1ODNoFuoyA1prIAAAAAFABoBkAGoMgNmsNAumsAN6mstAzTGsMBkMakBkkaxcAkLIW4xboCVUoIKAgqAAACgBigJiY0gAAIAACgGAAsiRYDchhsWUEvGN619MA6SjErfAJFw1dBnxzvrp9OV9BTNQAWJQF1dQgOk4uuet6C6susWsy5QdWb6tvGaBWWgDBkAAAAAGmQAAAABpkBplqAAzoNMgBK1rIBu1rWYA1prNqAtrJQADAFTADQwwAUkAVAFQAAKAEAQAC0AAAFVFxIRrxmQqgtSiArcc2pcBsIUE+mFtIDItAEDAUACKSAGBoBpQAAgA0AyNMgA0DI1hgM0jVlJ80GRrKYBoYzQDQSAFUAagLokUAESFoVFCiwwExZDAAwEhhjQDODQoZwaZxIGABhgAYABgAMhV/FCKgDUBAXpSFBEAFIEBda1hQKQwAASIuGCgwACFAAMMSAAANSAy0YuKEMWRqQGZFxQDDAAAArNaqAz1nG7EoMgWgQtQoAmLoCs6oKEEiUzVpFDUi8jGmg1WQiRpk0ADQAAABQAAaAkAAKACYucBQhFSAqRSJABQlRrDASLgABQDSBAaGRIA0DI0AQVAAADBZFCYsg1ARcAAAAAAAAAAAGaNIDnYljpYYDnIuNVnAKy1hgMkazDATTUoDXphOFoJUhQFVDQVBNBRNNBSIA0MtAAJATVAAAAAAUGDQDODTKQAUACQDACmABAaBkADQwAjTIBrQYAqKoCRZDwAPQFAAAAAAAAAAAAAAxFAZo1iYDOC4YDGGN4Axh41WaCIoCAAAQAKAAAAALEUFQAAAFQ0FDRIAAAA0MgNMgA0yAAYAAAAAAANMgBhigGvxkGxIv4AqANCKAAAYAAAAGgAAAAAACVQAARGkBCrhgJ+MY34gM4Y0zQQqwsBkWwAwwtQAwAAwAAA0AA0ANAA0AGg0SAAAAAAAAAAAEACmgNMkUDQoIsCwAklJGsBnBpARRQAAAAAAAAAAABQAJAAAMAAAAFGpaGCUFTARnG8MBFt4gDJjWQwGMMdMkT/gMC0kBLUWwwEAAAAAAAAABTTBIoAIKgKIqgAxIDWM4oAaBkxoAkWQgBkMKbwApGrgMxQBcMTVAAAAADQAAAADQAABQAJAAAAAAAAABSCglASwCwwwwEplWkBLGdxtMBntG8TAZMBIVMWooQVcBkaqAgAAAKuJFAwBIGBAMawFBgCQAAMCVQpkobgLmCaQFRUsBeETAFWsqBixFAAAAAAANS3Gd0GtNQ0F02IApElaAAADQDQwAAAEUAAUIqCQAAEBUxYUELQzQTS9XCwEZaAZwsah6DOG43kYsgFqABUAAAGgAA0SACgASAAAABAihvCwlAJwMWQEUsTAUh+AJiyLUAXAAA0AABLxWbegntXCRcBkXAEUkXAZsWVcTyg0E8AAAAADAoGGGgM6uriYCgAIoCCgIGAGGCAU6FBAZBoZaBmmWtemAzmItMBAAAAXQEgAAAoMG94gMjVrOAQMaBkjWLgGEhFBKFgAupaAuiLKAqaugYeGgAAAYAJnV00DA0BKi1AWKkUAs0UGYpYABgAJpoKeooIsAADAAADA0DEqgM6pUBQAQoUEXCLgM2C3iUCLrErVBeVMZ8JQLDG/xigYGCQ01AFJNG5cUH9UzGv7RLdBBZNLMBjBoAioAuhJpZgEvVlZk1fAaSpp6ApIAYYGgKigAQDFAAAEsSqUGdXSxLAXUNNBYrOm0GrU1nKsgLuqSAGFUBkXCwEUAAAAAAAAQAAFMABMUBMFQEsJVMBL0xcQEsZyt1NBnDGt1QRltAZGqAyBIBg1jIA1IYC7xLdXCYCCyQAJFyLgIlUBF9TAFwwABGgBABQACAAAAAAAIlVKCVnrdYoEbiRYCxUAUNAFQBRAACwAQBQANBAXDCAAACKgBoAaJigLqAAAFiYuoCWLABKKUEvQAZaZ00GhlqAaupYsgAtieAYU3T9Ai6uTEsgGmABhgaClZ61gJioAqGgCwIAAAAAAAgAJVQBKqALEUFEAUABUUAAFQAEWoAAAUAAUEFQBUw7AXCxJV0BABcTFlKCVDVBCLYngFWJengNJiaaBYG0BzXBuQGCN2IBJrUmJKoLrNLQCU3osgJtJCxYCLogAFoLKus4TQaqCALILAJAAAAAAAAEVAQVKBUWoAqLAFQBQUAAAAAAAsAEFqAAAiwABdAQUBmkqmAasQBRFBLEaSgmgAGgCWGKSggtAYa1bxAXWK0AzK3qYuAnqyIsANAF0IoIFJASki4AmKmqAQUAAAAAAAAAAUIAkQAKi1KAsSKAACqkUAAAAAAAAClAECoC6ACCgCpq6AlAAxcQAE3KDUKAMjWJYCAoIFAAALUZagAUA00AFkRqQDDFZtBRJTQUlS0gLpUAUAFAAAAAAAAAARUAQAAAEUACFBF0QFVIQGhFAAAAAAAAARSggAAaQCxZ4VJQFiasAKVN0DUsVKBKus4sBdNQAoYAAAYAD//2Q==",ur="/experiencing/assets/29235-gopro-02-humans-CUytd18X.jpg",gr="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDADknKzIrJDkyLjJAPTlEVo9dVk9PVq99hGiPz7ba1su2yMTk////5PP/9sTI////////////3f//////////////2wBDAT1AQFZLVqhdXaj/7Mjs////////////////////////////////////////////////////////////////////wAARCAHgAlgDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAECA//EABsQAQEBAQEBAQEAAAAAAAAAAAABESExQQIS/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCgAAAKgCggAKAAAAANAMjQDI0AyNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAACgIKAAAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMgNDOpoLpqALrTBoNjMrQAAAAAAAAAAAAAAAAMAAKgCgADQDLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAaAAAAAAAAAAADNoNMWlqaCjOroKJqgFNNBPFlS1NBvWnLWpQbCAAAAAAAMgANMgNAAwCgigA0y0ADINDIDTIAAAAA0MgAAAAANAAzbgNM6m6A2MNygAAAWgM2pamgtprIDUqypAG9GJV0Gg00AtYtTQa1NZ0BdNQAAAAAAANNAAqApKjIOkrpLri1+aDoAAAAMgNMgAAAIA2MgAAAAAgCgAAAA0BjLQDINAMtAMtAABaBXO1bWQWGpFwF0RQNw0MBdS3UWAmLhU9ARZFsBNVk0GmbTUBdNqLAAUEAAAAAAAAoICiKAAAmKAxWotQHSXjTEqgAgAGgBoBpoAAAqAABaABKAAAqAKIAogCiKAADQyaDQzqWgtrNqWgASNYCGrhgMjWGAQAExYSLgIYpoJiW4us26CaAAAAqKABoAaaACAqBQFYjQKgzgNBi4AIAqACoANSqzGpQDVwwEFwwEDDAAAAANNS3EtBbU1AF0lQBuUZlXQXTWdAa01kBqVWZWtAEtNBTU1NBbWdDANBYCYY0AQAFEiggoCCgENSpoKlpazQLWWsZwAABploAGQa01kBrQANZ0AaAAZaAZjQAoms6DQy0AAAM61oCy9YpPQdpWmJ4oNMgCGgAABAAY1nQA0GgAAFQBQhoAALF1k0C00AA0AA0BdTUBrS1AF0iRqQAlDAUqSroJTUtTQW1NRnoN6MZWgURkG7GLGtAZI0AM40AVmNVkGxNNBTAgCKgKEAEWoDI0zQAAaAAwwAKzI0A3+VZlaBAUEFQAAAAHIw8NAaZAKBgGmtYyDQRQCABUhSAKACKYCaFgAKAAYBG5GY1oAal/QF4zalus6DWs6aaBpoaDWmsgNazoAa0yAUAA0ANaZAaGQGl1jTQbSjNAla1kBploAABloAAAUAEotQFjTEUGhkBoZ1dBdNADQAcgAAADQA0AGoqKBAASxlowCKigAAIoCKQANRQNXUS0FtYtLU0F1KigAAKkAUQBdNQAABYIaChoAQAaDFBjBsBjG8DQTBbWNApoA0MwBplpmg1BloFBAVFKCKkUANTQUQBTU1dBdE0BgAAg1IC5xit6lBkDQG2NNBsrH9H9A1PVY00Gxz/pdoNjG1NoOmjnt1uAeGljOA1pKzgDVrNqVAVAAUTQUQAUAAAQVMAUABFAWIAoAGmhgGmmGAaaYYBpphgAYYBrWs4nQdNRztpLaDoMbYl/QOmrrltNB0Nc9NB01XPabQbGNNBsZlNBoZ02A0M6AmrakhYBKtqSAG01KQC0gAuJY1NMBnFxbEwDBcSwEqxFkBdhphgJqxMWAWmtWM3gGogC1A0FRfVwEwxcaBnDGgGcMaXQYwxvUBnDGwGMMbAYwsaUHPBuxmwEABRFA00xoGdTVsJANNMMA00wwDTTDAZpKWEAtRaSAYY1iWAgGAsW4nToJfVkRQJFxNAMSxdTQMFlAPp7VIBfDOFATDxcMBCLhgGmkjWcBm0hJ10k4Dn0y10yKDlfzSSx0sTIDHTG8gDGEbrHgFrNW1AAAFkSTWpAJDGjQBnQGtZ000A1AF0QBRFA00Aa1WGgUxFBixnHWsWAhqANRrNYjcoLiYumgmM43oCYzY2UHLrTWFgM5rNjWGAzg1jUgOfS11sYsBJOumMSN4BiWG00GLOqFgIqZVwCxMUBMABvFzhgCYsgAAJARVAAkDQUGrqAFpoAAJCsWtVzqg0AAFkBZGmQDQ1NA0Q0FQAA00BU00BU00F1WdWUFaZ00GhnWtBUoAxZiNWMgNRlQblViNgGiJFEUAAAAAMFBoamgsNTTQXEwNSGCgCYCgwxQGMGgFMTV0CotqJFhUAFQBRAF0YagKYGqABIFEqhm1koACUFjUZi6C6mppaBpqagNamoAumoAogCiAKIAurrIDWmsgNaus6aDems6Sg1qUlKCAAsblYiwG0FSJiiAogChpoGlQUAYtSMULDANaZwBo0JAUxZFyKGRrEsBAASB8ZSNfAABagAqAAQDBUwGdNaxkGhk0GtZtNSqEAASlAWFp8SggAAAAAAAAAAAAAAAAAAAAALK1GGoAAAsTVBWtZgDQzCpGjWY1QBm0lBpWGtBRNUDBLTQKDING4zKVQ3KWsaA3qyuZuA6CboCQZEjUGdawFiAADIDTLUA01mgNazQtAAAZarKgCgIKAMtMgAAAAAAAAAAAAAAAAAAAAAANRlqAAALEWApoAB6SVIQaxkADATV0sMUEK1i4DA3hgMRqxcLAYGsXOAxhjdiUBmteQ9BmB9EgAAaH0DegUA8IAaSlhgNMmgBTQEURQtZVKAAAigCWCgyLYgAAAAAAAAAAAAAAAAAAALIBIoABAAgsBYSaEuA3ItmMz9LuwCphYAzga0kFkBQski7GdAa01kBdNRM0FtiaYZAN0ZokbzUsw1d1QwH0SGiLAKkWpFChqakWiChZTNIJDA2FALDUtUCpqaCpVSgAAAAgtQAEBrImEq6DOGLpoJgAAAAAAAAKCYY1wBnGpEtNBeCAKJFAFAAAVKLgJIsuGGA1umsiQpKgoXWtYi6DWsm6JBqMtApqaz6oa0tZgkCBAMaAGaACKkNUFRagLCwNBYaiWg1okACVNAWxGpfiUEMAACAAAAAIqAgqAAAAAAAAAAAAAAAAAAAKiwFgALFQBQQBUIC6aACVZT0ExSQsA0MQFNCJAlAGmdNAI0yAAAAAUKKEDFBmhSAsAALEIClXEwEFwwEjSKCGKgGYi1KAAAAABQRFAQAAAAAAAAAAAAAAAAFAVFAVIoKBoCYspgGEgAGNFlBnA6bgHYTputyAxTNbw4DHhhSUCwNNAASB4FAE1dAEX4BRKKFEqwDEXxARdTF8AE1ZNBZBq3IxaBoTq4CAAuwqAJp61hYDNNM6WAaIugBoCYKgAAIYoCAAAAAAAAAAYKAEUAABRNPQXRFgLGtYWdBrWSzAGp61Mc41oNWRzsbnTAYxqXFwyAxbTbWrGAATAXVTCAG0tw3QXU3QwEUhQWCeGgUKAeLUvq4AmKUExUlUExdyF4m6BbqAAoAKi4AioC7haiALmpGpQZsLGtQGcFwsBlTDABAFEAVAAAAoAAAKIoBoAEMWQAwgBiyLKUE+rxMJKC41OM0lAphK0BF+EhgMS5W9YsQHTYOfV0G6xU2gJ1Q0DRKABpoKrM61eQEtNT1cBFOGwEot8AUBIVF9MUIphgJYYpsBMJFNoGHhbU0DTUUBfUUExMakakBiSmV0wwHLKOmcZswERQEMXEAxMWQwEwxcATDGgGcMaqYCYY0gJhi4YBhgAYSapLgLnGbGtLAZgAAALKusqC6YQ0Cwbl4xZ0GtJbSSrAMMGtBjGLMdb1LNBzFvEARQEFQAkFgEmRKfQDcNphgGkvUsWQCi0BS0tT0FhKCQtNSxFDXpiLoHh6lWUDIn1cARFAFk0xuTAJMAADABitpQYWCAWoACkigguGAmCgILhQJNLMJWrQYRUA00oAACrKgCiGguM41KAzixQCFNNA1ueOdWUHSK5T9ddJdBbExaaBEpaloJYxi2kAkMalZtBKlXUAVAFRr4zYBoYuAkiz1LVnoH6D9AIsRfgKM6sBSmnqRKjWGKEFwkAlL0qAGACxueMRuUANYtBvS1jp0GtPWFlAwxti+gYYY1IDOGNyGQGI0uGAxSN2MA0yGABhgGGDQMWI1YzgGLDACooAioAuoAurrICgoIKz9Bcblxn4n0HTS1g0GtZtNMBmrKtTANPVlASTSzF8SggoCzxlqelBNQsAI1GWoBehb0BlUAMXCXTQRqIApqLKDWs2gDNJWsZwFRcqyAQs61jNgDUjN5W5eAZGLGtJQZwzGjNBkMwAtbjGNzwAAAAAsAEwUoMa1oAyNAMmNAM4NM4kMMaZqhKigIGAKmKoJpogKrMWAoAAFAEXQPpTQDCGa3JAYu1LHQs0HJqeFmIC50JSJGvYxZ1tn6oTFhSAl9FoDIaQCcLVxAPFlTSgqEq+gkrWmJYCytMT1uAuEADChfAYoX1AWBpoDcrGtSAtYrVjIEdY5RuXAW+oboABoApgILiUBKoCQVEgLiAqKKEZbMBjDGmbQEABUoC4lCgSLiRQQ1akBYUgAi6aAah9BuRSLYCAAVixupaDGdU0tAS8VKCa1GcWAW9EvoBDQBdEUEsFPQRqM4sBbExbU0DFlQB00YhtBsqSmgxfV9LCAYY0aBh2LADWK1fT2AzK1rNmEoNaazrUA1UwgLpKGgupagAM60AqKAGoCyUJQAMAYqVuxmwGYqYAosjWcBmTSyxuYtmwHH6ulmUgKlXEBNXRAVUAVE1QdPytqQBUNNAqWLqWgymLoBDDw1IWJFFCUKAgYgLAgCrGVBazq6WAmhhAAAakKSloIaQBZWtY00HSWVKzK1oM9jemoBSFjNAphNrecBjMbSsg1azoQDWoyaDSprNBoZ1r0AAGbpONmAxpreJgG1YZACoAMmNSLICSLfFZvQJetxynK3KB+ow1bqyAhimAxjVkxbGLQShagBqoCy4us4SA1pKzgDWlqSnoEW1LcTQNNCAsVnQFAB/9k=",Ar="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDADknKzIrJDkyLjJAPTlEVo9dVk9PVq99hGiPz7ba1su2yMTk////5PP/9sTI////////////3f//////////////2wBDAT1AQFZLVqhdXaj/7Mjs////////////////////////////////////////////////////////////////////wAARCAHgAlgDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAECA//EACAQAQEBAAMBAAMBAQEAAAAAAAABERIhMQIDQWFRE4H/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A6AAM2NGAxhjeAM40AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAAAAAAAACgAAAAgqAAAAAAAAAgAAAKigIAAAAAAAAAAAAAAAAAACggoCCgIKAgoCCgIKAgoAAAAAAAAAAAAAAAAAAAAAqAKIoAAAAIAAAAAAACAAAAogAACooCCgIACgAIoCCgIoAAAAAAAAAAAAACgIoACAKAACAAAAAAAAAAAAAAAAAAAAAAAqAAAAAAAAACAAAAAAAAoigAACKAAAACKICiAKAAAAAAAAoAAAAAAAAAAAgoCAAAAAAAAgqAogCiAKIAogCoAAAAAKIAoAAAAAICggoCCgIKAigAAAAAAAAAAAYoCKACKgAAAAKIAogCgAAAAAAgKgAAAAAAYCAAAABaxoN6aygN6ayl6BsZlanYAoCCgIYoCKAAAAAAAIqAKIoAAAACKgKIAogCgAAgKIoAAAAAAAAAgCiAKIAoAAAKgAAAAAAAAACgICWgVm1LQAACKACLoCeLKlqaDppK56Sg6q5yty6CgAgqACgIAAIAAAAAogAAAAAAAAAAAAAAAAAKmgomkoKACLgAgoBgqABaloLoxU0HQSVZQAAFAEUTQVE0tBUtYtNBbU0qAupogNaagC6aiwDUlKkBbUhTQDTS0FlWVnQHaXRzldIAAAAAIAAAAAAABgAAAABhgoJgoCAAAAAoIoluQC3GJdLdSA6YzYa1oEqysU0HQZ1ZQUTS3ALcYtS3QDTQAtJ2fsgGLOgBqVXNdBsTlGL9A3bjG2pu1QNNSoC6AAioCoaAoAIaAGgugliYpoGJfVwsAiauJ+wWXt1l6co383oGxAAAAAAZ0BoAADQAAAAAAAAAADBQQUAA8AYtS1nQVYysBaHZgEreMYuglNqgJtCgGCpQKBIBmJq2RLAXTWdLaDVrNoAaTsWAsAAxFQAAEAADQFShgGhgAAACgCaaC1DQBr5ZalwGwABnU0F1NMXAQXADQ6aBkaZ2ANM7GtAAAAwAMAAAUTTQUTWbQatjFuogALJoI1phgJptXDAS0i4YBAAKRZ2YCeGauNYDOdEjRb0DFuM26W7UBU1QAABYgCqgACAaaAAAAigGoAaGLgIpgAaIALgAAAQpKDcvTWOUvbrLsAwwAMVADQAc9NQBdEAGpUsJ6DpDGJWwANgAzqWg3rNqal7Av0amEBdDFkBBcKCSLJhIQFaxklBrDABkMMATVsSQG4Mmg1SGsW4BbjNtLdQA0ACUAURQAQFtNRmA3oYAamkZoNaqKCFWIARSUCBpoBUtAUSLoFTVQCKmgKnipQNb/HenJ1/HQbAAAAABygEABZgCxKAsXWdXQLWdL2ApqACniaCrGdUFwiaaC2khpaARNNBdABuDErfVAD9Mg1pus2RNwG2Ley/TNugupU0AAABnQaGWgF1j9tglIVYCUhSApSRaCRFAMSxSgEIAFgUEwqoDI2xQaGWsAUATFwAEqgJI189VCA6jMvTWgDOmg0M6A5qigF6SF9BZRIsAtNKkBSIsALTCgemJ4aCmpoCgAQ0AJFxNWAshYsjWAxIY2WAQxktwEtxjat7qAAAyGgNBjIAGA1IuJpoEipFBF1KYDNrUpgC6aSGAKhoKlNAJe1c97a0GkNQFEICsNVkGgAFCAAAFCgERQagkvRoKJpaCiaA56azlXKDcsLWMqdg6auuW1dBu0jGrKDYxrWg0JsJYBYmL0AixLDAXoRZYAYaugkaieLKDcGZTQbSs6loKx9Xtrtm+gmjLQMmGtAYugCazrVAZCgDedMa1oHhKMg2axKaDWs6NYBpphgGms520AqLOwYo1YYAFAAUAAASmgomw2AomxnQbwsY5HKg1i457TaDoa57U7B12GxyymUHTlBjKA3FjGtSgvRkE0GbJjLpfHMBZNR0+Z0DOJldMNBzynboQHPau1vIZAY01qyM4BrWxmfJfmg1sXXK7DaDrprntXaDpKrlK3PoGsMSfcX/pALcjk3brANYy0YDLRWdBpkAGsZa0GaFpoEajOpoNlY00FE00G+jXPQHTTXNQW01DKC6T6xMplBb9fw5JlMBdNZAa01JNXICabW8iyQHPanbpkMBjsytrAc8q8a2AxxOLdJQYvy1IumwEyLkNhsAwTYbAUTlAHM0ANptADaAA183GQHTYbHMB12EsctNB16HPabf9B0sRnamg3Kv6c9XkDN9IW6QHWToyEskXYCcYcYuxZYDPGMWf46WzHMDtNsUoJtNqLAOztQE7O1ATDFNgJi4XDQZsCgLJsXElXQMhiaugYYmmgommgozpoNaRnTQdKzWdoAADUsa2OYDpsOUcwGr9Q1kBrU1AGuScqgC7TagBtNoAaaAAAAANT5OLegMcey/NbWg42WDp9eOYCyajp+MGMTHWwwHLFx0Ogc0dshxgOI68TjAciut+YnGYDmFmUABZNBNNa4dF+cBnaauGUE02mUwA0MA2mmGAaaYZQAwwAXDAQpZgAEmmAC4YCC4YCDU+da4wHMdOMMgOY1ZDAZGsAZKAA1I1gOeGOmLgOWGOuGA5YY64mA54Y6YuA55V41uRcBz/AOdP+ddCg58Dg6SqDHBm/LoUHLBuwBnTkyA1yObIC361AAa+bIyA68oWxyAdNhrmA6yxqWOGmg77DZ/rhq6DtbP9Z3+uW0toF9ABqTpuSa57TaDt1jNrnyqaDWms7TaDRfGdpoCxDQaGdNBoZ00GhnTQa0Z00FqACxWdNoNGsgNbC1kBqVrXMB0lXr/XLTQavrUxz00HS5/rORkAoANfNn7b2OQDrsNjkA67DlHIB15Q5RyAdeUOUcgHXnE5uYDpzZ5sgNczmyA1z/hzZAa5DIBlMrQCZTjW1l7ByssHX68cgCTRqAmGVtYDHGnGxuVQcspldDAc8q5W4A58aca6L+gcbMF+vUnoLPm1eNdJOiwHPjUssdC5QcsplasAZwssaLQZMFgJhjpkMgOeUyumQBzymV1M7BzymV06OgcrMGvyMgSWmVr5bzQcsq5XXDIDllMrri9A45TK69IDnlTK69FByymV1Ogcspldei5gOQX0Ak0ytfjjeQHLKZXXIdA5ZTK69IDnlMdMZwGcMawwGcGsMBnDK0AzlMaJAZymV0xegcso6YAzprIDWk+mQGr9bGQAWXEAa01kBrTkyA1prIDWnJkBrkcqyAW6ADU+rIcqklMoLtTaZV40Etqa1xpxoM6avGllBDTCTQNptXjTKCbTauUygm1dplTKC7TamUygW2hYAS2NcqyYDXKnKs4A1ypyrIDXI5MgNacmQGuRyZAa5GsgF7ABZcXkyA1yOTIDWw2MgNabGQGthsZAa2GxkBrYbGQGthrIDWw2MgOmwcwFymV0Ac8pldDKDlZYOuacYDljUmt4YDHE4umGA58Ti6YYDPExrDATDFwwEz+Jn8bwwHK/LU+W8MBmT+H/AI0AgoDOGNAM4Y0AzxhjQDOGNAM4Y1QGcMaSgmGNAMWazwdQGJ84ufxowGc/hn8awBnP4mNmAxhjeGA5YcXXEwHPicXTDAc+JxdMMBxswx2yJkByk1cdMMBzypldcMByymV1wwHLKZXXDAcspldcMByymV1wwHLKZXTDAc8pjphgOeGOmM5AZGsgDoAAAAqKAAAAAAAAAAAAAAAGgGgAAAAAAAFE9oLAAEqlAgQAPAAE8UAADAAAAA0AAAAAAAAAAAAAABBQEFAQAAwAMTFATBQAAAFBBQAAANNAAAAAA0A1FwAwAAAANAAAAAAoFpIzO60AAAXwL4CfKsz1oAABPFABPFnYAAAAGJigJq6YmAom1dAAAAAAAAAAAAAAAENAFAQAAABUUAEBTUUDQAAAA1NBU0xcBFwAAAAAAAAAAAAAGbd6W3Ikm9g1JgAAAAAM+fTTP161PAAAAAKz5WizQJdGfK1LoAAAAAACYoCeLomAoncNBQAAAAAAAAAAATBQENAAMAAAAAAAA1PQXTTADFAAEBQAATQUT1QAAAAAAAZtAvdakxmRoAAAAAAGfyeLPE+vD8d6BoAAAAACzWfK0WaBLoz3K1LoAAAAAAAACWKAncNVLAUZzF0FRdARQAAAEAUQAAAAAA0ATT0F1O6uAGKICiAKgAoAAIC6goAAAAAAAmroJbiTulu1ZMgKAAAAAAACXxn59rd8cp1QdQAAAAAAALNZ7laSzQJdVnuVZdBQAAAAAAAAAEsUBmzPCVpMA1WbP8Ns9BoSXQFEAAAAAAATTDFAwAAAAAAUAAAE0A9UAAAAAAAAAGbcW3GfaCyftpJMigAAAAAAAAOV6+nVy+vQdZ4MzxoAAAAAAAAEs1nuVtLNAl1WPK1LoKAAAAAAAAAAAAligM2G2NJZoJKqWf4m2A0JKoAAAAAigAAAAAAAAGp6sgCoAogAAAACggKDNuQD6p8xid11AAAAAAAAAAAY/JG2fyeAfjvTTH462AAAAACAoAAAJZrPcraWaCS60xeqsug0IAoAIogKIAqKAhoAogAWACWJtjSYBKJYz3AbElAVUAUAAAAEtBbU9JFAAAAAAAAAAAVFBK527W7U+ZoLJkaRQAAAQFEAUAAABn68aS+A5/NyurjOq6zwFAAAAABAAUAAQAs1mzK0WaCS6rnZlbl0GkAAAAAA0QFEUAwARRAUTVASxQGbBQAABUAVC3D0D0kAFEUAAAAAAAAAAFS3Ia526B7W5MifMaAABQAEoACoAqKCCoAADleq6Txj8nrfzegaBAUAAEAVAAAAAAAEs1iyyuiWaBLqudmVuXQaQNAAAAARQAQBQAQUBAoAGgP/2Q==",fr="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDADknKzIrJDkyLjJAPTlEVo9dVk9PVq99hGiPz7ba1su2yMTk////5PP/9sTI////////////3f//////////////2wBDAT1AQFZLVqhdXaj/7Mjs////////////////////////////////////////////////////////////////////wAARCAHgAlgDASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAECAwT/xAAeEAEBAQADAQEBAQEAAAAAAAAAAREDITECQRIyIv/EABUBAQEAAAAAAAAAAAAAAAAAAAAC/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A6AAAAAAAAAAOXK6scnzoMT/Lm6XqYz/PWgyioCCoAAAAAAAAAAAoApogLrXzdrK8fVBvlnUcXp5Jvy81mUBYhAd+F1cuF1AAAAAAAAAABy5L25t8ntYBKi1AJNW+RrjkzWbewSRc0hPQSwWxAWGogLpqALpqALq6yA1qCgSdJVt6TQFnofPoO/H4LOoA0AAAAAAAAAAULegcvrv6xqz/AJcpd5Ha/wCQee+heqmgIAAAAAAAAAAAC6gCqyugq/M7SV0452Dt+PLyTLXqvjy8k7BkAHfhdXm4/qyvTLsAAAAAAAAAKAOPJ7XOunJ650EJOxfmbQdb18OPrry3rHOQCH6YlBbUEAAAAAAAAAWIoFQUBvjm1iO/HMmg6AAAAAAAAAAAAM3xoB55LPp2v+TI1nQPL9epjt9fG9xyswERQEAAAABQQUBBQEUAAUEdeK9ubXFOwehy5fnrXUs2A8Y19TKyDXHNr1SZHn47leiXoAAAAAAAAACg48nrnWuT1mglb4ptYdeKdaDHJdqTw+u6sAqVUoIioAAAAAAAGNSASF8VL4DKhAa45td5MjPHMjoAAAYAAAAAAAAAAAAADjyzK7OfLOtBwFqAgAAAKAAAAAAACgASa6ccyscc2u0mA2ADjyfP65Y9P1NjheqC/PTr81xldOPug6gAAAAAAAFAHn5PWa6ck7c6CO3zZPlxXegPa1IzPWgQDQSwLU0DExQEwxTQTFw1QJFSKAl8UvgMt8fztZk2u/zMgNyZAAAAAAAAAAAAAAAAAAGfqbGgHlsyo3yTKwCAAAA0H4AgoCCgIKAigDpxTt2cuKOoAAFuR5vr13uVi/MoOcduOdMz4jrJgAAAAAAAAAAOPLdrm68s/XGgLUKCxbUhgHZgAAAIoCAAGKAi6GAsul8TxZd6BJO3f58J8yRQaAAAAAAAwAAAAAAAAAAAAHPkmxxr0XuPP9TKCIqAAA1AgAAAAAAAQJ6DvxzptiXIW6C2oAAL0CLKgDYxqyg0AAAAAADHJcgM8l2OVa1mgRKpgEFSgAgKgAAACKAqAKAAvHLpJtdvmSQFnjQAAAAAAAAAAAAAAAAAAAAAY5cs/XVjkmwHnFvqAgANTwJ4AAAAAAAL8+o18g6aagDWmsgNJpvSAuoeGgLKmpoOkrTlrcug0AAAA5cl7db1Hn+r2BKliGgFpoC/iKgAACYoCYlaSgiooAACosBrjm16JGOOZGwMMAAAANAY01cMBNNXDATV0wwGgAAAAAAAANAL3AB5uSZWXbln640EIE9Br8AAAAEUAAB0+Y5x1nUAAADU0FIEAqKYAilBNX59TFnoOoS9AAaaDHJenC+uvJXIAKkBQAWeIQoAAAABQoMqigAAq8c2pHXjnQOsmQDQZtkSfUrHJe3OWyg9TNuRmfXScn2C/wBDjoD1AAAzsBoZ2Gg0M7CUGgAAAAAAABm3GbbQOS7HG+ut7crOwZWCwAAAEwFNTDAXTTDAWeujHy2AIAqABqpIuAGiAuiKAQIDcvTTnK6ABhgOPJe3N25Z1riCUgUDV3pkBqFItBAAAAChQZVFAUAPmbXokyOfHP1r6+sgJyfXfR/X/LlbtLegLdqaEmgsvRaSGAQakAddhayaBtNpgBKAAaANStsQtBvTWLU0GtS/TIC7pqAKhpQNc/p0Y+p0DBBZADFATBUwAAACQGp40zGgAAUQBd6Q3pnQaVAAGQbQgBK6fN6cY6/NBsAGOTxwr0WbHG/PoMwTU0FwxAGorMvbQIAAAAlUoMqAKT0X5B08+XK3Wvqs5oILiyAkiyYuGAaBoAANgAaaAALICC1AXUtLQDQhoAaaAaWgAIAzfGmb4DNWQkUAAEFQBLFASVqTWf10+Z0C4FADCUtBA0A/GWmaA0zGgAUBFSgNfNxCA6jEvRoLfGLOq1b0n5QcL6jX1MrIAAEb/GWp4CYFoAGALEpCghABViSNSAWEhh4BjTOgBTagKBoIKA2IoAABoAGiAGgADINDIDQAAGgMtMgAAIACoAAUEzt0l6ZkaA0oWAzrTLQMjQBAAMABQAEqwoIqKCyqzF0C+ELekBz5J2w6cnjmCgAT1q9RPmdrfQSRcMXARGsSwEKJQAWAStJIoAaaABIANXGdA1FJAJAtAJWoznbYAJoKJpoKhoAMgNMgA0yA0zrWAAzQAABAAAAAAWestQG86TF1NBZBNLQLWQwBploAWFBAAURQAQBUAU1FAtNEBnk8c2+RgFCANfK52fJQAAAASzGW7OmaCKALFSAJpplWQAmrgBhhagLGtkjCdgtokgDTWsgGgAAAAADRIDLS5AEZ1qxnANAA0AE0AAAAACoALIpDABrFwGGg0GWgAA0FE1nQaDQAAAZyt4CC4YCGLi4CYYqg48kxh05HMGvxABvjnTVi8fh9AwAAAAzZ20lBCBAak1rJGZTewNNLWQaA0CmGpoC9JpoAgDQiwACAAADchgEhQAwNLQCprNoFAtBFQBUKkoAoAgALEWA3F1MMBdBNAMABnTQDQJAMGlwGGsXDAJDFATFAFAABATe2tZ/WgY5J05O3J44/oCz0PmbQdZ4XxYloMBfU0FE1QC+BfAZIALoi6BgagLqaALExYAhiqBIGgBSgEAAajIDW4ayA1rOgBoYAAUDRmgLsELAVEUDTQAAAq/NZWeg6DIDWsgBaa1jOATsxuQwEkXCRQTFRQAAAAAAAAAASeqgB9eOWdutYzAZxrjhrcAqerQGKz619JAMDQBU1QZvoWAAAFCoChFBIoaAGoCiaA0AADQMgAAAGgBAAALQOksAEFsQCwJSwAABAAWeosvYNGNTxdBMMWYYAYYABFAAAAAAAAAAAAAQxcBBQES+NJgOXbXzreRcBAAYrLrZ05gCWkBVMAZFs7JAQXEoJSKQA0TQXQlAAUEABq000A00ADSgGmmGAAADUgDOFjQDGYKlAENAwlNAKG9n4CBgAsnaNSwG54YsssAMNAFEigCaoAAAAAAAAAAC4h2AAAAACUFEUBFATHO9Orn9QGViRqAA0DNGsAZsTFASxK1azQEUAkAAAAE0BoXpAWAgLqLhgIsDQakVjWpQVFKCMgAUASotSgCSqBmlmNfMPqAwAAqLAdPnxpz+WwDABUNAIoAAAAAAAAAigACAuiHYKJ2QFEUAAAEALNC0GLOwvpAJG2NNBsxjTQKYd6UEpi4W4DOAAAAIAAANCmAYYZSQDDG8LAYtTSoC6usgNStsaSgUKAFEASqlBK18zUdZmAMfUbL4Dki0AAgLHSViNSgoRQBFAENAVAFEUE7FQBUAVA0ACwADQAAAAANAAAL4FBj9LcGbQNAAJRZNBuXpmtSAMpVxroHMauGAyjViYBhgQAMAawhpKDaasw6Bjaa1cZwEqVqxmgAANRk0GikAAARGsJOwZk7a8L6A3L0XwhfAcqFAFhABdRYDcElXQAAAAAAAoAAAAAUATtZQAAAAAAAAANNQFSjNBKhQAACTWpMJGgXEXQEZ1owGQMA0zU8WUDOksb1m0GQoDTWGGgeHqpoLgTswEZsbPQchqxmwAAFlVk0GggAABmtQAVKM2gmGGmgYv4aAz21I1gAoaAAAAAAAABgAAAAAAAAAAAAAAAGAAjFrbnfQAACehPQdJ4LPEABnAaABUuADMwuNVmTQEq2AJooDQyaDVZhTAa00xQA00BLFAc7MR0rmAACxWY0ABAawxQGMLGlwHLKSV1wBiStSKSgBQAAAAA0AAAAAAADQAAAAAMAAAAAAAE0VAGbNaZwGbDGrEwDFkwjUBdRQEwWGAhimAgXoA00rINWs3symYCYKANGKCYpagKGFAQAFQBmsuljnegAAWLKzpAaCFBqKxK2AAAEAAAAAIBoAAAAAAAAAAAABhF0DxLQwAMMAFQAAAAAAAAExnGzAYJW8TAVKshgEDw0AS0lBUXUAAA0t1nGsBkawAFqAYBoKi6AgKAbggG6zY0A5i2IAaALKrLUoHjUrLUBQADQAAAAAAAAAAAIG4C4hKUAVAMMAAUBMAAoAAAAAAqAAAAAAAAAGgAmLCwDDDcNAxFAQVAZ0lazWbAaGQGlRQTDDSAC1NBcKm0AA0GWhQRmyNVkEsR0ZsgMkasiYCztpmRoFEUEUAAAAAAAABQAJA0AAA0ABUAUAEAAVAAADQAVAAAAAAAAAAoAAABgAAAgqABpKBgAAoCAAAAWhgDLQyAaAAAGgAEJGgFJAAAAACKmptBQAAAAAAAAAAAAABQEUAEVAVBQQUBAUEABUFBMXBQTEaMBkWxAAIABQNNMMA2CWAKACWM42AgoCLhDQTBbUA0DQAABkBploBnGhcBgxvAEFxAUAAAAADA0AAAAAAAAAAABZgEFxASmgBpoABgAAAACoAAAAAGtSsngNDMq6BUqgIABDAAgYAEEBrEsNKAEATwUBAABUAMAAXEBcAAAAAAAAMADBUAAAwNAAAAUEhQAAAVAFQUEJ0pgEqCghIKAgAAYAoAIqAqGgAAAAAAAACoAAAGhgKJqgJYoCYKgAAJRQECKCGKgLiAAuIAoAAAAAAYAAAAAAAAAAABAAFBAAAAUQA1UUEUQFBKCoYYBFQBbUADTBQEqoAqAKioAAAABSKgFAAAApoUDTUwBdTVMA0RYAAD//Z",br="/experiencing/assets/29235-roll-04-canon-borsa-DRysSeQh.jpg",vr="/experiencing/assets/29235-roll-05-phone-zampe-CWOcBuqU.jpg",kr="/experiencing/assets/29235-roll-06-phone-bagagliaio-C8jfs7yl.jpg",wr="/experiencing/assets/00-wide-DvctIhpu.jpg",yr="/experiencing/assets/01-BgpmT5E9.jpg",Tr="/experiencing/assets/04-hnR52l2U.jpg",_r="/experiencing/assets/46544-roll-01-nonno-print-JwkXm2J4.jpg",xr="/experiencing/assets/46544-roll-02-phone-galleria-Dq6z8J7B.jpg",Er="/experiencing/assets/46544-roll-05-canon-baracca-kHo7_xgL.jpg",Mr="/experiencing/assets/46544-roll-06-map-ravenstein-1914-BDz0FfQj.jpg",Sr="/experiencing/assets/00-wide-C4Cyo3wC.jpg",Lr="/experiencing/assets/01-bacio-B9DSQBfX.jpg",zr="/experiencing/assets/02-bacio-DAl4BJ-i.jpg",Cr="/experiencing/assets/03-bacio-C7RLMTjL.jpg",Ir="/experiencing/assets/04-cgEwSEs0.jpg",Dr="/experiencing/assets/55826-roll-03-canon-lago-Csq5f2SM.jpg",Zr="/experiencing/assets/55826-roll-04-film-bacio-CCtYtEro.jpg",Br="/experiencing/assets/55826-roll-05-canon-canederli-B-Y5G5pb.jpg",Rr="/experiencing/assets/55826-roll-06-scan-scontrini-Ca-lLFYC.jpg",Pr="/experiencing/assets/00-wide-Bfhxech1.jpg",Fr="/experiencing/assets/01-CQOFKE5p.jpg",Nr="/experiencing/assets/02-DPBMAsnS.jpg",jr="/experiencing/assets/04-BTnccTHV.jpg",Gr="/experiencing/assets/57198-phone-01-ref-sheep-pellets-BFQAqWbx.jpg",Or="/experiencing/assets/57198-phone-02-ref-elk-pellets--ha1vz_c.jpg",Hr="/experiencing/assets/57198-phone-03-camoscio-ghiaia-ClMq3_Yw.jpg",Ur="/experiencing/assets/57198-phone-04-pellets-calcare-DjaBBHb7.jpg",Qr="/experiencing/assets/57198-phone-06-cervo-umido-CwMfJoJJ.jpg",qr="/experiencing/assets/57198-phone-07-pellets-muschio-DOG80dWn.jpg",Kr="/experiencing/assets/57198-phone-08-volpe-pino-DpGke6PS.jpg",Vr="/experiencing/assets/00-wide-CKseZUpv.jpg",Wr="/experiencing/assets/01-pomeriggio-C63B5YOy.jpg",Yr="/experiencing/assets/02-ingresso-sella-DTT3AVhT.jpg",Xr="/experiencing/assets/IMG_3348-D32k83J8.jpg",Jr="/experiencing/assets/IMG_3434-Br0SC07p.jpg",$r="/experiencing/assets/IMG_3435-BXemDYQt.jpg",es="/experiencing/assets/IMG_3436-CUYQBcCU.jpg",ts="/experiencing/assets/IMG_3437-B_bCqEzu.jpg",ns="/experiencing/assets/IMG_3440-D2y-ua3H.jpg",as="/experiencing/assets/IMG_3441-DzRN320U.jpg",is="/experiencing/assets/IMG_3442-BYxCteeR.mp4",os="/experiencing/assets/IMG_3453-CF_jGdkd.mp4",rs="/experiencing/assets/IMG_3457-CZ-bOAJX.jpg",ss="/experiencing/assets/IMG_3464-l64Knkoq.jpg",ls="/experiencing/assets/IMG_3466-DzrbueMk.jpg",cs="/experiencing/assets/IMG_3471-d5AdECEt.jpg",ps="/experiencing/assets/IMG_3473-BS20bAlQ.mp4",hs="/experiencing/assets/IMG_3474-ZB439Ct-.mp4",ds="/experiencing/assets/IMG_3475-BdFMlfzl.jpg",ms="/experiencing/assets/IMG_3489-BcnkDhVs.mp4",us="/experiencing/assets/_DSF4706%201-Cdbj1R3_.jpg",gs="/experiencing/assets/_DSF4706-DlOgn8hl.jpg",As="/experiencing/assets/_DSF4906-BBOIcLdj.jpg",fs="/experiencing/assets/00-wide-DSWuNlGx.jpg",bs="/experiencing/assets/01-CNj0bqzh.jpg",vs="/experiencing/assets/WhatsApp%20Image%202026-10-03%20at%2014.39.37-OzN1OYdw.jpeg",ks="/experiencing/assets/65761-roll-01-canon-cortina-C93G25dg.jpg",ws="/experiencing/assets/65761-roll-02-phone-venezia-D_CReGQ5.jpg",ys="/experiencing/assets/65761-roll-03-phone-cambio-TjIPE0yz.jpg",Ts="/experiencing/assets/65761-roll-05-film-venezia-ZxsSeRt1.jpg",_s="/experiencing/assets/65761-roll-06-film-funivia-DXES_I7J.jpg",xs="/experiencing/assets/Screenshot%202026-10-04%20alle%2009.33.59-DQEnQwKO.jpg",Es="/experiencing/assets/Screenshot%202026-10-04%20alle%2009.34.18-BzSAvOfJ.jpg",Ms="/experiencing/assets/Screenshot%202026-10-04%20alle%2009.34.29-CMeQV-xc.jpg",Ss="/experiencing/assets/00-wide-CgK-VbLP.jpg",Ls="/experiencing/assets/01-famiglia-DdrScUii.jpg",zs="/experiencing/assets/02-CEui_LoW.jpg",Cs="/experiencing/assets/67091-phone-01-aereo-cabina-Dl-Waa6E.jpg",Is="/experiencing/assets/67091-phone-02-aereo-corridoio-B_nIQMqx.jpg",Ds="/experiencing/assets/67091-phone-03-auto-bagagliaio-clWEnK7d.jpg",Zs="/experiencing/assets/67091-phone-04-cockpit-bambino-ChwUfEMN.jpg",Bs="/experiencing/assets/67091-phone-06-auto-seggiolino-DePae944.jpg",Rs="/experiencing/assets/67091-phone-08-bagagli-aeroporto-C5DDJi86.jpg",Ps="/experiencing/assets/67091-roll-01-phone-pausa-CPigeMqs.jpg",Fs="/experiencing/assets/00-wide-CF68gOF_.jpg",Ns="/experiencing/assets/02-DO8A_4IF.jpg",js="/experiencing/assets/Screenshot%202026-10-04%20alle%2009.33.39-BKR1POnm.jpg",Gs="/experiencing/assets/72700-phone-01-fucile-mannlicher-7SydopGc.jpg",Os="/experiencing/assets/72700-phone-02-fucile-banco-YpeBBg5U.jpg",Hs="/experiencing/assets/72700-phone-03-fucile-caccia-DmemP-gk.jpg",Us="/experiencing/assets/72700-phone-04-imbalsamato-lupo-RfMxbRRB.jpg",Qs="/experiencing/assets/72700-phone-05-imbalsamato-daino-D7mp9psf.jpg",qs="/experiencing/assets/72700-phone-06-forum-avvicinare-C3N61m35.jpg",Ks="/experiencing/assets/72700-phone-07-imbalsamato-testa-0mkH6DpN.jpg",Vs="/experiencing/assets/72700-phone-08-imbalsamato-parete-hhuZY8tM.jpg",Ws="/experiencing/assets/72700-roll-01-phone-alba-BsTdFz4A.jpg",Ys="/experiencing/assets/00-wide-75PIM1KW.jpg",Xs="/experiencing/assets/01-colette-Bt_VOa3_.jpg",Js="/experiencing/assets/02-cannocchiale-DSpBkCnL.jpg",$s="/experiencing/assets/03-valle-C_XJY7M-.jpg",el="/experiencing/assets/IMG_3326-CTs9jMq2.jpg",tl="/experiencing/assets/IMG_3339-C3Zo73tP.jpg",nl="/experiencing/assets/IMG_3340-CXLyvJBm.jpg",al="/experiencing/assets/IMG_3370-CEeBtDJS.jpg",il="/experiencing/assets/00-wide-JdvM4ng-.jpg",ol="/experiencing/assets/01-rwIEnCJC.png",rl="data:model/mtl;base64,bmV3bXRsIE1hdGVyaWFsCm1hcF9LZCB0ZXh0dXJlcy8wMDRkMTVkMTAxNGIxMzg5M2E3ZmU5MmVjMGNiNmUzYi5qcGcKUHIgMS4wMAo=",sl="/experiencing/assets/02_10_2026-Z8HfClM1.obj",ll="/experiencing/assets/004d15d1014b13893a7fe92ec0cb6e3b-D2zLBoRM.jpg",cl="/experiencing/assets/Gelato%203x-DMJBskVU.obj",pl="data:model/mtl;base64,bmV3bXRsIE1hdGVyaWFsCm1hcF9LZCB0ZXh0dXJlcy9iNzM2NTBlMWU2NmQ2NGQwZGVlYTI0MTdlOTNkNjRlZC5qcGcKbm9ybSB0ZXh0dXJlcy9mMDNjZTFlZGY4MTFjMWI5MDgyMzRkMjM0NTFjMWM4OS5qcGcKbWFwX2FvIHRleHR1cmVzLzUwNDVhZTIzZjZhYmEwMmNkNDUyOTU0ODgzM2I2MWRlLmpwZwpQciAxLjAwCg==",hl="/experiencing/assets/5045ae23f6aba02cd4529548833b61de-Aj6BprFb.jpg",dl="/experiencing/assets/b73650e1e66d64d0deea2417e93d64ed-BUJey9hz.jpg",ml="/experiencing/assets/f03ce1edf811c1b908234d23451c1c89-BQlMYY26.jpg",ul="/experiencing/assets/IMG_3377-BhThwzBU.mp4",gl="/experiencing/assets/_DSF4659-iQcjxWil.jpg",Al="/experiencing/assets/_DSF4686-loHo_eaZ.jpg",fl="/experiencing/assets/_DSF4748-B2NGUU6g.jpg",bl="/experiencing/assets/_DSF4776-ye-ZVQ-m.jpg",vl="/experiencing/assets/_DSF4822-CB-7Qw0m.jpg",kl="/experiencing/assets/_DSF4856-B0MHlbV8.jpg",wl="/experiencing/assets/_DSF4872-Bo4Rq5yh.jpg",yl="/experiencing/assets/camminata-lunga-CV544Cw8.mp4",Tl="/experiencing/assets/giulio%20rotation-KIhOZAew.mp4",_l="/experiencing/assets/phon2_test-DMPtS47n.glb",xl={15513:{title:"609",datetime:`05.07.2026
14:25`,real:!1,brief:"Ha rifiutato la funivia. Da Falzarego, Sentiero del Fronte, zaino ancora pieno di rabbia e cose inutili. In forcella ha capito che non era fitness: era una linea di guerra. In vetta ha allargato le braccia — non per lo scatto, perché il corpo diceva di avercela fatta a portare se stessa fin qui.",full:`Aveva deciso di non prendere la funivia. Non per snobismo da trekker — per bisogno. A Pian Falzarego lo zaino le pesava ancora di cose inutili: caricabatterie doppi, una maglia “per ogni evenienza”, la rabbia lasciata in città. Il Sentiero del Fronte, all’inizio, era solo un nastro di ghiaia e cartelli CAI. Poi, dopo il primo tornante, il passo le ha imposto un ritmo: respirare, posare il piede, non pensare al telefono.

Verso i duemilacinquecento metri, alla Forcella Lagazuoi, il vento le ha tolto le ultime frasi pronte. Ha visto i reticolati ricostruiti, le trincee che un secolo fa chiudevano la via verso Val Badia, e ha capito — senza libri — che quella salita non era un fitness. Era una linea. Ha passato la baracca degli ufficiali austriaci senza entrare: il tavolo e le sedie d’epoca le sono bastati da fuori, come un diorama che non voleva toccare. Ha bevuto l’acqua tiepida e ha ripreso.

Quando il Rifugio Lagazuoi le è apparso sopra i ghiaioni, non ha pensato al Photopoint. Ha pensato che le braccia le dolevano in un modo giusto. Solo dopo — terrazza, pedana, scatto automatico — ha allargato le braccia. Non era una posa imparata online. Era il corpo che diceva: *ce l’ho fatta a portare me stessa fin qui*. #609 è il numero che la macchina le ha dato. Il viaggio, invece, se lo tiene senza titolo.`,quotes:["Nota delle 11:40 — ho spento le notifiche. Se qualcuno cerca, rispondo da sopra.","Zaino troppo pieno di cose che non mi servono. Me ne accorgo a ogni tornante.","Messaggio non inviato: «Oggi non scendo come sono salita.»"],en:{brief:"She refused the cable car. From Falzarego, along the Front Trail, her pack still heavy with anger and useless things. At the pass she understood it was not fitness: it was a line of war. On the summit she opened her arms — not for the photo, because her body was saying she had carried herself all the way here.",full:`She had decided not to take the cable car. Not out of trekker snobbery — out of need. At Pian Falzarego her pack still weighed with useless things: spare chargers, a sweater “just in case,” the anger left behind in the city. The Front Trail, at first, was only a ribbon of gravel and CAI signs. Then, after the first switchback, the pace forced a rhythm on her: breathe, place the foot, stop thinking about the phone.

Near twenty-five hundred meters, at Forcella Lagazuoi, the wind took her last ready-made phrases. She saw the reconstructed wire, the trenches that a century ago closed the way toward Val Badia, and she understood — without books — that this climb was not fitness. It was a line. She passed the Austrian officers’ hut without going in: the period table and chairs were enough from outside, like a diorama she did not want to touch. She drank lukewarm water and went on.

When Rifugio Lagazuoi appeared above the scree, she did not think of the Photopoint. She thought her arms hurt in the right way. Only later — terrace, platform, automatic shutter — did she open her arms. It was not a pose learned online. It was the body saying: *I made it, carrying myself all the way here*. #609 is the number the machine gave her. The journey, she keeps without a title.`,quotes:["Note, 11:40 — notifications off. If anyone looks for me, I’ll answer from above.","Pack too full of things I don’t need. I notice it at every switchback.","Unsent message: “I won’t come down the way I went up.”"]}},29235:{title:"442",datetime:`06.07.2026
12:01`,real:!1,brief:"Il cane ha fatto più metri di molti day-tripper in cabina. Sul Sentiero del Fronte ha imparato il ritmo: annusare, fermarsi, bere. Niente galleria — troppo buio. Molte cacche interessanti però. In cima si è seduto al centro della pedana, più calmo di tutti. Portarlo dove la montagna è museo: questa è la salita.",full:`Il cane ha fatto più metri di molti day-tripper in cabina. L’avevano lasciato a casa altre volte; stavolta no. Da Falzarego hanno scelto il sentiero largo, quello che i blog chiamano “facile” finché le gambe non rispondono. Lui tirava il guinzaglio solo all’inizio, poi ha capito il gioco: restare vicino, annusare il legno delle passerelle, fermarsi quando i padroni bevevano. Cacche di forme inconsuete, dai profumi nuovi. Batteva i denti per ricordare.

In forcella ha incontrato altri cani e ha fatto il suo lavoro sociale. La borsa della spesa blu — assurdità consapevole — conteneva croccantini e una bottiglia d’acqua condivisa. Non sono scesi in Galleria di Mina: troppo buio, troppo stretto, e lui non ama i caschi. Hanno seguito la linea del fronte a cielo aperto, dove un tempo passavano i portatori di notte con decine di chili per uomo, e oggi passano famiglie con bastoncini telescopici.

In vetta, sulla pedana del Photopoint, si è seduto da solo al centro. Non perché glielo avessero ordinato con durezza: perché il legno era fresco e la voce dei suoi umani era lì. Questa, #442, è la storia di una salita banale e rara insieme — portare un animale fin dove la montagna diventa museo — e scoprire che, di tutti, è lui ad arrivare con più calma.`,quotes:["Chat: «Portiamo anche lui?» / «Sì. Se si ferma, ci fermiamo.»","Ha trovato un odore dietro una pietra e ci ha obbligati a una pausa filosofica.","Diario: oggi il più serio del gruppo pesava 18 chili e aveva quattro zampe."],en:{brief:"The dog covered more meters than many day-trippers in the cabin. On the Front Trail he learned the rhythm: sniff, stop, drink. No tunnel — too dark. Plenty of interesting poop, though. On top he sat in the middle of the platform, calmer than anyone. Bringing him where the mountain is a museum: that is the climb.",full:`The dog covered more meters than many day-trippers in the cabin. They had left him home other times; not this time. From Falzarego they chose the wide path, the one blogs call “easy” until the legs disagree. He pulled the leash only at the start, then got the game: stay close, sniff the boardwalk wood, stop when his people drank. Droppings of unfamiliar shapes, new smells. He chattered his teeth to remember.

At the pass he met other dogs and did his social work. The blue grocery bag — a deliberate absurdity — held kibble and a shared water bottle. They did not enter the Galleria di Mina: too dark, too narrow, and he hates helmets. They followed the front line under open sky, where porters once moved at night with tens of kilos per man, and families now pass with telescopic poles.

On the summit, on the Photopoint platform, he sat alone in the center. Not because they ordered him harshly: because the wood was cool and his humans’ voices were there. This, #442, is the story of a climb that is ordinary and rare at once — bringing an animal to where the mountain becomes a museum — and finding that, of everyone, he arrives with the most calm.`,quotes:["Chat: “Are we bringing him too?” / “Yes. If he stops, we stop.”","He found a smell behind a rock and forced us into a philosophical pause.","Diary: today the most serious member of the group weighed 18 kilos and had four legs."]}},46544:{title:"978",datetime:`06.07.2026
12:30`,real:!1,brief:"Il nonno, Alpino, le aveva lasciato solo pezzi: il freddo delle gallerie, il nome Lagazuoi detto a mezza voce. Ha salito da Falzarego a piedi, casco e frontale, dentro la Galleria di Mina. Non cercava fantasmi: rispetto. In vetta è rimasta di spalle. Il volto spettava alle Tofane e a lui.",full:`Suo nonno non le ha mai raccontato la guerra per intero. Le ha lasciato pezzi: il freddo nelle gallerie, il peso sulle spalle, il nome *Lagazuoi* pronunciato come si pronunciano le cose che non si vogliono ripetere. Era stato dagli Alpini, o vicino agli Alpini — lei non ha mai avuto il grado giusto, solo una foto sbiadita e l’odore di lana umida nei ricordi d’infanzia.

Quest’anno ha deciso di salire da Falzarego senza funivia, proprio per sentire i polpacci. Ha noleggiato casco e frontale all’infopoint, è entrata nella Galleria di Mina e ha capito subito il senso delle sue reticenze: sette gradi, umidità, pendenza che ti entra nelle ginocchia. Dentro la roccia ha ripensato ai portatori notturni, alle mine del 1916–17, alla Cengia Martini aggrappata a mezza parete. Non ha cercato fantasmi. Ha cercato rispetto.

Uscita alla luce, ha proseguito verso forcella e baracca. Non ha messo monete nel cannocchiale in vetta. È rimasta di spalle al Photopoint perché il volto, quel giorno, spettava alle Tofane e a un uomo morto da anni che non vedrà mai lo scatto. #978 è il numero della macchina. La storia è il nonno che, senza saperlo, le ha indicato la salita.`,quotes:["Avevo la sua foto nello zaino. Non l’ho tirata fuori: mi bastava saperla lì.","Dentro la roccia ho parlato a voce bassa, come si fa in chiesa — o in cucina da lui.","Appunto: non voglio una storia completa. Voglio un pezzo vero."],en:{brief:"Her grandfather, an Alpino, had left her only fragments: the cold of the tunnels, the name Lagazuoi said under his breath. She climbed from Falzarego on foot, helmet and headlamp, into the Galleria di Mina. She was not hunting ghosts: respect. On the summit she stayed with her back turned. The face belonged to the Tofane — and to him.",full:`Her grandfather never told her the war in full. He left her pieces: the cold in the tunnels, the weight on the shoulders, the name *Lagazuoi* spoken the way you speak things you do not want to repeat. He had been with the Alpini, or near the Alpini — she never had the right rank, only a faded photo and the smell of damp wool in childhood memory.

This year she decided to climb from Falzarego without the cable car, precisely to feel her calves. She rented a helmet and headlamp at the info point, entered the Galleria di Mina, and understood at once the sense of his reticence: seven degrees, humidity, a grade that works into the knees. Inside the rock she thought of the night porters, the mines of 1916–17, the Cengia Martini clinging halfway up the wall. She was not looking for ghosts. She was looking for respect.

Back in the light, she went on toward the pass and the hut. She put no coins in the summit telescope. She stayed with her back to the Photopoint because that day the face belonged to the Tofane and to a man dead for years who will never see the frame. #978 is the machine’s number. The story is the grandfather who, without knowing it, pointed her to the climb.`,quotes:["I had his photo in the pack. I didn’t take it out: knowing it was there was enough.","Inside the rock I spoke softly, the way you do in church — or in his kitchen.","Note: I don’t want a complete story. I want one true piece."]}},55826:{title:"557",datetime:`07.07.2026
13:16`,real:!1,brief:"Camminavano sull’Alta Via da giorni, rifugio prenotato mesi prima. Verso forcella, in un tornante senza pubblico, si sono detti una promessa rimandata in città: restare nello stesso passo. Il bacio in vetta è solo la firma. La storia è nata prima, tra canederli, temporali e piedi nel lago.",full:`Camminavano da giorni sull’Alta Via 1 — o almeno su un pezzo abbastanza lungo da far loro dimenticare le mail. Avevano prenotato il Rifugio Lagazuoi mesi prima, come fanno gli australiani e gli inglesi nei blog, e avevano temuto la folla. Invece, sulla salita verso forcella, c’era abbastanza silenzio da parlarsi davvero.

Lui aveva lo zaino più pesante; lei teneva il ritmo. A un tornante sopra i duemilatrecento metri, senza anello e senza pubblico, si sono fermati e si sono detti una cosa che in città rimandavano da mesi. Non un matrimonio da organizzare: una promessa di restare nello stesso passo. Poi hanno riso, perché dire cose gravi con i bastoncini in mano sembra sempre un po’ comico.

Il bacio sul Photopoint è solo la firma in cima. Il viaggio era tutto ciò che c’era prima: i canederli della sera prima in un altro rifugio, i piedi nel lago a metà tappa come nei diari AV1, la paura del temporale, il sollievo quando il Lagazuoi è diventato un tetto e non un miraggio. #557 non nasce sulla pedana. Nasce sui tornanti.`,quotes:["WhatsApp, 06:12: «Se piove ci bagniamo. Se no, parliamo.»","Ieri canederli. Oggi una frase che in città rimandavamo da mesi.","Lei nel diario: «Ha preso lo zaino pesante senza farmelo notare. Tipico.»"],en:{brief:"They had been walking the Alta Via for days, hut booked months ahead. Toward the pass, on a switchback with no audience, they said a promise postponed in the city: stay in the same stride. The kiss on the summit is only the signature. The story began earlier — among canederli, storms, and feet in a lake.",full:`They had been walking Alta Via 1 for days — or at least a stretch long enough to make them forget email. They had booked Rifugio Lagazuoi months ahead, the way Australians and Brits do in the blogs, and they had feared the crowds. Instead, on the climb toward the pass, there was enough silence to really speak.

He carried the heavier pack; she held the pace. On a switchback above twenty-three hundred meters, with no ring and no audience, they stopped and said something they had postponed for months in the city. Not a wedding to organize: a promise to stay in the same stride. Then they laughed, because saying serious things with poles in your hands always feels a little comic.

The kiss on the Photopoint is only the signature at the top. The journey was everything before: canederli the night before in another hut, feet in a lake mid-stage as in the AV1 diaries, fear of the storm, relief when Lagazuoi became a roof and not a mirage. #557 is not born on the platform. It is born on the switchbacks.`,quotes:["WhatsApp, 06:12: “If it rains we get wet. If not, we talk.”","Yesterday canederli. Today a sentence we kept postponing in the city.","Her diary: “He took the heavy pack without making me notice. Typical.”"]}},57198:{title:"629",datetime:`11.07.2026
08:53`,real:!1,brief:"È salito col pomeriggio affollato, ha preso il dormitorio, ha aspettato che dopo le diciassette la cima diventasse eremo. Ha visto il tramonto sulle Tofane. All’alba è uscito prima degli altri: croce, memoria delle gallerie, poi la pedana di spalle. Arriva in vetta due volte. Conta la seconda.",full:`È salito il pomeriggio prima, quando la funivia vomitava ancora day-tripper. Ha preso una branda nel dormitorio Pompanin, ha pagato la doccia a gettone, ha cenato al tavolo sbagliato e si è fatto rimproverare — come nei racconti dei trekker inglesi — e ha aspettato. Dopo le diciassette la cima ha cambiato personalità: da luna park a eremo. Ha visto il tramonto sulle Tofane e ha capito perché si pernotta.

Al mattino è uscito prima del caffè degli altri. Non verso il Photopoint subito: verso la croce, poi un tratto indietro verso la memoria — feritoie, aria delle gallerie ancora nelle ossa dal giorno in cui era sceso con casco e frontale. Solo alle otto e cinquantatré si è fermato sulla pedana, di spalle, mentre due ospiti del rifugio già chiacchieravano al tavolino con i bicchieri in mano.

#629 è la storia di chi arriva in vetta due volte: la prima con la folla, la seconda con l’alba. Il Photopoint coglie la seconda. Il viaggio vero è la notte in mezzo.`,quotes:["Nota in camerata: sveglia prima del caffè degli altri. Porta chiusa piano.","Mi hanno rimproverato per il posto a tavola. Meglio così — meno chiacchiere.","Messaggio a nessuno: «Stasera la montagna è diventata quieta. Io resto.»"],en:{brief:"He came up with the crowded afternoon, took a dorm bed, waited for the summit to become a hermitage after five. He watched the sunset on the Tofane. At dawn he left before the others: the cross, the memory of the tunnels, then the platform with his back turned. He reaches the top twice. The second time counts.",full:`He came up the afternoon before, when the cable car was still spilling day-trippers. He took a bunk in the Pompanin dormitory, paid for the coin-operated shower, ate at the wrong table and got scolded — as in the English trekker stories — and waited. After five the summit changed personality: from theme park to hermitage. He watched the sunset on the Tofane and understood why people overnight.

In the morning he left before the others’ coffee. Not straight to the Photopoint: toward the cross, then a stretch back toward memory — embrasures, tunnel air still in the bones from the day he had descended with helmet and headlamp. Only at eight fifty-three did he stop on the platform, back turned, while two hut guests already chatted at the little table with glasses in hand.

#629 is the story of someone who arrives on the summit twice: first with the crowd, second with the dawn. The Photopoint catches the second. The real journey is the night in between.`,quotes:["Dorm note: wake before the others’ coffee. Close the door softly.","They scolded me for the table seat. Better that way — less talk.","Message to no one: “Tonight the mountain went quiet. I’m staying.”"]}},65761:{title:"598",datetime:`11.07.2026
15:44`,real:!1,brief:"L’abito e lo smoking sono saliti in funivia con il fotografo; loro hanno voluto il Sentiero del Fronte a piedi, polvere sui pantaloni da trekking. Si sono cambiati in rifugio, ridendo. Un sì tra gallerie di guerra e oceano di vette. Hiking nuziale: la cima al posto dell’altare.",full:`L’abito e lo smoking non sono saliti sulle loro spalle per tutto il dislivello — sarebbe stato cinema, non vita. Li avevano lasciati a Cortina; un amico fotografo li ha portati su in funivia, come nelle storie di elopement che si leggono sui siti dei wedding photographer. Loro, invece, hanno voluto arrivare a piedi: Sentiero del Fronte, polvere fine sull’orlo dei pantaloni da trekking, mani che sapevano già di pietra.

Sotto i vestiti da sposi c’erano ancora i calzini sudati del cammino. Si sono cambiati dietro una porta del rifugio, ridendo nervosi, mentre fuori i turisti ordinavano birra. Avevano scelto il Lagazuoi perché sotto i piedi ci sono le gallerie della Grande Guerra e sopra c’è un oceano di vette — e perché un sì detto qui non somiglia a nessun sì da salone. Venivano da lontano, lontanissimo, ma una persona li legava a quel luogo, e loro volevano legarsi ulteriormente.

Quando sono usciti in smoking e tulle, il vento ha provato a sollevare la gonna e qualcuno in canotta ha tagliato il bordo del mondo senza fermarsi. #598 è hiking nuziale: non la cerimonia intera, ma il tratto di ghiaione in cui due persone hanno deciso che la cima, e non l’altare, era il posto giusto per cominciare.`,quotes:["Dietro la porta del rifugio: «Riesci a chiudere lo smoking con le mani che tremano?»","Vocale a mia sorella: «Ci siamo detti di sì con la polvere ancora sugli scarponi.»","Sul telefono, bozza: luogo: qui. abito: dopo. testimoni: il vento."],en:{brief:"The dress and the tuxedo rode the cable car with the photographer; they wanted the Front Trail on foot, dust on their trekking trousers. They changed at the hut, laughing. A yes between war tunnels and an ocean of peaks. Wedding hiking: the summit instead of the altar.",full:`The dress and the tuxedo did not ride their shoulders for the whole elevation — that would have been cinema, not life. They had left them in Cortina; a photographer friend brought them up by cable car, as in the elopement stories on wedding photographers’ sites. They, instead, wanted to arrive on foot: Front Trail, fine dust on the cuffs of trekking trousers, hands that already knew stone.

Under the wedding clothes the sweaty socks from the walk were still there. They changed behind a hut door, laughing nervously, while outside tourists ordered beer. They had chosen Lagazuoi because underfoot lie the tunnels of the Great War and above lies an ocean of peaks — and because a yes said here resembles no salon yes. They came from far away, very far, but one person tied them to that place, and they wanted to bind themselves further.

When they stepped out in tuxedo and tulle, the wind tried to lift the skirt and someone in a tank top cut across the edge of the world without stopping. #598 is wedding hiking: not the whole ceremony, but the stretch of scree where two people decided the summit, not the altar, was the right place to begin.`,quotes:["Behind the hut door: “Can you close the tuxedo with hands that shake?”","Voice note to my sister: “We said yes with dust still on our boots.”","Phone draft: place: here. clothes: later. witnesses: the wind."]}},67091:{title:"890",datetime:`16.07.2026
14:49`,real:!1,brief:"I bambini volevano la funivia; i genitori dissero «un pezzo a piedi». Il pezzo divenne seicentocinquanta metri di dislivello, pause ogni tre tornanti, snack in forcella. Niente galleria: troppo buia. In vetta pollice alzato e pile rosa. Arrivare insieme valeva più delle date delle mine.",full:`I bambini avevano chiesto la funivia. I genitori avevano risposto: «Un pezzo a piedi, poi si vede». Da Falzarego il «pezzo» è diventato la salita vera — circa seicentocinquanta metri di dislivello che sui blog sembrano un numero e sulle gambe di un bambino in pile rosa diventano un’epopea. Hanno fatto pause ogni tre tornanti. Hanno contato camosci che forse erano pietre. Hanno mangiato snack sulla Forcella Lagazuoi mentre un giovane con lo zaino giallo spiegava al cannocchiale delle cose troppo grandi.

Non hanno fatto la galleria: troppo buia per i più piccoli, dicevano le guide. Hanno seguito il cielo. In vetta il bambino ha alzato il pollice prima ancora dello scatto; la bambina era già una bandiera rosa contro il calcare. Intorno, un uomo seduto a terra con i bastoncini rossi recuperava da una salita più dura della loro — e quella vista, per i genitori, è stata la lezione: la montagna tiene insieme chi arriva in tanti modi.

#890 è una gita famigliare che sfiora la storia senza entrarci fino in fondo, e va bene così. Arrivare insieme contava più di sapere le date delle mine.`,quotes:["Papà nel gruppo famiglia: «Pausa snack. Non è una negoziazione.»","La piccola ha chiesto se le pietre erano camosci. Abbiamo detto di sì.","Nota mamma: oggi non importava sapere le date. Importava chi teneva la mano."],en:{brief:"The children wanted the cable car; the parents said “a bit on foot.” The bit became six hundred fifty meters of elevation, rests every three switchbacks, snacks at the pass. No tunnel: too dark. On top a thumbs-up and pink fleece. Arriving together mattered more than the dates of the mines.",full:`The children had asked for the cable car. The parents had answered: “A bit on foot, then we’ll see.” From Falzarego the “bit” became the real climb — about six hundred fifty meters of elevation that look like a number on blogs and become an epic on the legs of a child in pink fleece. They rested every three switchbacks. They counted chamois that might have been stones. They ate snacks on Forcella Lagazuoi while a young man with a yellow pack explained things too large into the telescope.

They skipped the tunnel: too dark for the little ones, the guides said. They followed the sky. On the summit the boy raised his thumb before the shutter; the girl was already a pink flag against the limestone. Nearby, a man sat on the ground with red poles recovering from a harder climb than theirs — and that sight, for the parents, was the lesson: the mountain holds together those who arrive in many ways.

#890 is a family day that brushes history without entering it all the way, and that is fine. Arriving together mattered more than knowing the dates of the mines.`,quotes:["Dad in the family chat: “Snack break. Not a negotiation.”","The little one asked if the stones were chamois. We said yes.","Mom’s note: today the dates didn’t matter. Who held whose hand did."]}},72700:{title:"898",datetime:`23.07.2026
12:52`,real:!1,brief:"Non ha detto a nessuno dove andava. Alba, giacca mimetica, versante meno battuto: inseguiva un cerbiatto visto anni prima in Valparola. Ha evitato i gruppi del fronte, la baracca, le chiacchiere. In vetta nessun animale — solo lui e il fallimento. Una salita segreta, non da confessare al rifugio.",full:`Non ha detto a nessuno dove andava. Ha preso l’auto prima dell’alba, ha lasciato Falzarego quando i primi pullman ancora dormivano, ed è salito dal versante meno battuto con la giacca mimetica e i bastoncini. Non era un cacciatore da trofeo da salotto. Era qualcuno che da anni inseguiva — o credeva di inseguire — un cerbiatto visto una sola volta in Valparola, una macchia chiara tra i mughi, e da allora trasformata in ossessione privata.

Ha camminato in silenzio lungo linee che un secolo fa erano di rifornimento e di fuoco. Ha evitato i gruppi del Sentiero del Fronte. Ha passato la baracca degli ufficiali senza fermarsi: troppo tempo sospeso, troppa umanità. Voleva solo gli occhi dell’animale, o la prova di non averlo sognato. In alta quota la caccia è diventata altro — fiato, pazienza, il sospetto di essere lui il braccato dal vuoto.

In vetta non c’era nessun cerbiatto. C’era il Photopoint, un turista nello zaino rosso chino sul cannocchiale, e lui in piedi con l’espressione di chi ha fallito una missione e, nello stesso istante, ha raggiunto comunque una cima. #898 è la storia di una salita segreta: non per la foto, per qualcosa che non si confessa al rifugio.`,quotes:["Calendario barrato: oggi. Destinazione lasciata in bianco apposta.","Ho evitato due gruppi e una baracca. Troppa voce per quello che cerco.","Taccuino, ultima riga: se non c’è, almeno so di aver guardato bene."],en:{brief:"He told no one where he was going. Dawn, camo jacket, the quieter flank: he was after a fawn seen years earlier in Valparola. He avoided the front groups, the hut, the chatter. On the summit no animal — only him and the failure. A secret climb, not one to confess at the refuge.",full:`He told no one where he was going. He took the car before dawn, left Falzarego while the first coaches still slept, and climbed the quieter flank in a camo jacket with poles. He was not a parlor trophy hunter. He was someone who for years had been following — or believed he was following — a fawn seen once in Valparola, a pale patch among the pines, since then turned into a private obsession.

He walked in silence along lines that a century ago were supply and fire. He avoided the groups on the Front Trail. He passed the officers’ hut without stopping: too much suspended time, too much humanity. He wanted only the animal’s eyes, or proof he had not dreamed it. High up the hunt became something else — breath, patience, the suspicion that he was the one being stalked by the emptiness.

On the summit there was no fawn. There was the Photopoint, a tourist in a red pack bent over the telescope, and him standing with the look of someone who failed a mission and, in the same instant, still reached a summit. #898 is the story of a secret climb: not for the photo, for something you do not confess at the hut.`,quotes:["Calendar crossed out: today. Destination left blank on purpose.","I avoided two groups and a hut. Too much voice for what I’m after.","Notebook, last line: if it isn’t there, at least I know I looked well."]}},83531:{title:"690",datetime:`03.10.2026
07:09`,real:!1,brief:"Aveva letto che dopo le diciassette il Lagazuoi cambia pelle. Ottobre, funivia il pomeriggio, notte in rifugio mentre la folla scende. All’alba: sole di taglio, valle in foschia, terrazza vuota. Ha comprato con una notte ciò che i day-tripper non vedono. L’alba è la ricevuta.",full:`Aveva letto che dopo le diciassette il Lagazuoi cambia pelle. Per questo aveva prenotato ottobre — stagione corta, meno code, ultima luce. Era salita nel pomeriggio con la funivia, perché il giorno dopo voleva le gambe fresche per l’alba, non per dimostrare nulla. Aveva cenato guardando le Tofane spopolarsi; aveva sentito il silenzio arrivare come un ospite in ritardo.

Di notte, dalla camerata, il vento raccontava la stessa storia di sempre: pietra forata, gallerie sotto i piedi, nemici di ieri diventati museo. Al mattino è uscita alle sette e nove, quando il sole tagliava ancora di filo e la valle a destra restava in foschia. Nessuna borsa Lidl, nessun bacio da mezzogiorno. Solo lei, la giacca pesante, e la certezza di aver comprato con una notte in rifugio ciò che i day-tripper non vedono.

#690 è il viaggio breve e verticale di chi sale per restare — non per consumare la vista in un’ora. Il Photopoint all’alba è solo la ricevuta.`,quotes:["Prenotazione fatta a settembre: volevo la stagione corta, non lo sconto.","Di notte il vento sembrava qualcuno che conosceva già la stanza.","Alle sette e qualcosa: giacca, scarpe, nessuno a cui dare la buonanotte."],en:{brief:"She had read that after five Lagazuoi changes its skin. October, cable car in the afternoon, a night in the hut while the crowd goes down. At dawn: hard-edged sun, valley in haze, empty terrace. With one night she bought what day-trippers never see. Dawn is the receipt.",full:`She had read that after five Lagazuoi changes its skin. That is why she booked October — short season, fewer queues, last light. She rode up in the afternoon by cable car, because the next day she wanted fresh legs for dawn, not to prove anything. She ate dinner watching the Tofane empty out; she felt the silence arrive like a late guest.

At night, from the dorm, the wind told the same old story: pierced stone, tunnels underfoot, yesterday’s enemies become museum. In the morning she went out at seven nine, when the sun still cut on edge and the valley to the right stayed in haze. No Lidl bag, no midday kiss. Only her, the heavy jacket, and the certainty of having bought with one hut night what day-trippers never see.

#690 is the short vertical journey of someone who climbs to stay — not to consume the view in an hour. The Photopoint at dawn is only the receipt.`,quotes:["Booked in September: I wanted the short season, not the discount.","At night the wind felt like someone who already knew the room.","Sometime after seven: jacket, shoes, no one to say goodnight to."]}},92239:{title:"683",datetime:`03.10.2026
07:42`,real:!0,brief:"Voleva la luce, non la folla. Buio a Falzarego, Sentiero dei Kaiserjäger, reflex e maglione arancio contro il calcare. Salendo ha pensato ai portatori e ai bengala. In vetta: caffè, macchina sul tavolo, corpo fermo dove la luce finalmente lavora. Non caccia animali: caccia un’ora.",full:`Voleva la luce, non la folla. Aveva lasciato l’auto a Falzarego al buio e aveva preso il Sentiero dei Kaiserjäger — la memoria austriaca, cenge e vuoto — con la reflex nello zaino e il maglione arancio scelto apposta per leggere contro il calcare. Non cacciava animali. Cacciava un’ora: quella in cui le stratificazioni delle Tofane smettono di essere cartolina e diventano volume. Era rimasto colpito dal trovare durante il percorso elementi antropici anonimi, ricoperti, ma con sembianze umane. Quanto la montagna oggi subisce il nostro impatto?

Salendo ha pensato ai Kaiserjäger che portavano viveri su quel tracciato, ai bengala, al silenzio obbligato. Ha scattato poco: risparmiava batteria e attenzione. In vetta ha ordinato un caffè, ha posato la macchina sul tavolino del Photopoint, ha aspettato che il vapore della tazzina gli dicesse che era vivo e non solo un occhio dietro l’ottica.

Mezz’ora prima, sulla stessa terrazza, c’era #690. Forse si sono sfiorati senza parlarsi — due solitudini d’ottobre cucite dallo stesso azzurro. #683 è la storia di una salita fatta di esposizione e pazienza: arrivare in cima non per celebrarsi, ma per mettere infine il corpo fermo dove la luce, finalmente, lavora.`,quotes:["Batteria al 41%. Meglio così: mi obbliga a scegliere.","Sul sentiero qualcosa di umano sotto la pietra. Non so se fotografarlo.","Ordine al bancone: «Un caffè. La macchina resta sul tavolo un minuto.»"],en:{brief:"He wanted the light, not the crowd. Dark at Falzarego, Kaiserjäger Trail, SLR and an orange sweater against the limestone. Climbing he thought of the porters and the flares. On top: coffee, camera on the table, body still where the light finally works. He does not hunt animals: he hunts an hour.",full:`He wanted the light, not the crowd. He left the car at Falzarego in the dark and took the Kaiserjäger Trail — Austrian memory, ledges and void — with the SLR in the pack and an orange sweater chosen to read against the limestone. He was not hunting animals. He was hunting an hour: the one when the Tofane’s strata stop being a postcard and become volume. Along the way he was struck by anonymous human traces, covered over, yet with human shape. How much does the mountain bear our impact today?

Climbing he thought of the Kaiserjäger who carried supplies on that line, of the flares, of obligatory silence. He shot little: saving battery and attention. On the summit he ordered a coffee, set the camera on the Photopoint table, waited for the steam from the cup to tell him he was alive and not only an eye behind the lens.

Half an hour earlier, on the same terrace, there was #690. Maybe they brushed past without speaking — two October solitudes stitched by the same blue. #683 is the story of a climb made of exposure and patience: arriving on top not to celebrate yourself, but to set the body still at last where the light, finally, works.`,quotes:["Battery at 41%. Better that way: it forces me to choose.","On the path something human under the stone. Not sure I should photograph it.","Order at the counter: “One coffee. The camera stays on the table a minute.”"]}},62537:{title:"537",datetime:`03.10.2026
22:28`,real:!1,brief:"Ultima notte in foresteria, sulla funivia che è stata la sua vita. Domani è in pensione. Di pomeriggio, con la moglie, erano ombre sul Photopoint. Quassù ha trovato rifugio: salire, osservare. I genitori lo chiamarono come Vittorio Sella. Il Cervino della foto in ingresso — ora ci torna.",full:`Vittorio ha dedicato la vita alla funivia. Non a un mestiere qualunque: a quel cavo teso tra Falzarego e la cima, alle cabine che scaricano day-tripper e riportano silenzio, alla routine di chi sale perché qualcun altro possa salire. I monti, per lui, non erano scenario. Erano rifugio. L’atto di arrivare in alto e osservare il mondo da quassù era l’unico lavoro che avrebbe potuto fare — e forse era già tutto scritto.

I genitori lo avevano chiamato così in memoria di Vittorio Sella, il fotografo che per primo aveva fotografato e raccontato moltissime cime. In ingresso, a casa, conservavano una fotografia del Cervino innevato: per il ragazzo era una meta, non una cornice. Anni dopo, le Tofane e il Lagazuoi gli sono bastati come ufficio; il Cervino è rimasto la direzione interna.

Il tre ottobre duemilaventisei, di pomeriggio, lui e sua moglie si sono fermati sulla pedana del Photopoint. Di spalle alla luce, di profilo alla pietra: due ombre. Non una posa da cartolina. Un saluto fatto con il corpo. Poi la sera, nella foresteria della funivia — l’ultima notte. Alle ventidue e ventotto la macchina ha scattato nel buio: un flash, quasi nulla nel fotogramma, e tutto ciò che conta fuori dal fotogramma. Dal giorno seguente è in pensione. #537 non è una conquista. È un congedo. Ora torna verso il Cervino — non per dimostrare, per chiudere il cerchio che i genitori avevano appeso all’ingresso.`,quotes:["Chiavi della foresteria sul comodino. Domani le lascio sul tavolo dell’ufficio.","A lei, a voce: «Se lo scatto viene male, va bene. Oggi conta stare.»","Promemoria nel telefono: Cervino — non una gita. Un ritorno."],en:{brief:"Last night in the staff lodge, on the cableway that was his life. Tomorrow he retires. In the afternoon, with his wife, they were shadows on the Photopoint. Up here he found refuge: to climb, to watch. His parents named him after Vittorio Sella. The Matterhorn in the hallway photo — now he returns to it.",full:`Vittorio gave his life to the cableway. Not to just any job: to that cable stretched between Falzarego and the summit, to the cabins that unload day-trippers and bring silence back, to the routine of someone who goes up so someone else can go up. The mountains, for him, were not scenery. They were refuge. The act of arriving high and watching the world from up here was the only work he could have done — and maybe it was already written.

His parents had named him after Vittorio Sella, the photographer who first photographed and told so many peaks. In the hallway at home they kept a photograph of the snowy Matterhorn: for the boy it was a destination, not a frame. Years later the Tofane and Lagazuoi were enough as an office; the Matterhorn stayed the inner direction.

On the third of October twenty twenty-six, in the afternoon, he and his wife stopped on the Photopoint platform. Backs to the light, profile to the stone: two shadows. Not a postcard pose. A farewell made with the body. Then evening, in the cableway staff lodge — the last night. At twenty-two twenty-eight the machine fired in the dark: a flash, almost nothing in the frame, and everything that matters outside the frame. From the next day he is retired. #537 is not a conquest. It is a leave-taking. Now he turns toward the Matterhorn — not to prove, to close the circle his parents hung in the hallway.`,quotes:["Lodge keys on the nightstand. Tomorrow I leave them on the office table.","To her, aloud: “If the shot comes out wrong, that’s fine. Today being here counts.”","Phone reminder: Matterhorn — not a trip. A return."]}}},Ea={type:"change"},Un={type:"start"},li={type:"end"},Ot=new eo,Ma=new to,El=Math.cos(70*Ya.DEG2RAD),Y=new F,oe=2*Math.PI,O={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},Tn=1e-6;class Ml extends $i{constructor(e,t=null){super(e,t),this.state=O.NONE,this.target=new F,this.cursor=new F,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:et.ROTATE,MIDDLE:et.DOLLY,RIGHT:et.PAN},this.touches={ONE:Xe.ROTATE,TWO:Xe.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this._lastPosition=new F,this._lastQuaternion=new Kt,this._lastTargetPosition=new F,this._quat=new Kt().setFromUnitVectors(e.up,new F(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new wa,this._sphericalDelta=new wa,this._scale=1,this._panOffset=new F,this._rotateStart=new te,this._rotateEnd=new te,this._rotateDelta=new te,this._panStart=new te,this._panEnd=new te,this._panDelta=new te,this._dollyStart=new te,this._dollyEnd=new te,this._dollyDelta=new te,this._dollyDirection=new F,this._mouse=new te,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Ll.bind(this),this._onPointerDown=Sl.bind(this),this._onPointerUp=zl.bind(this),this._onContextMenu=Pl.bind(this),this._onMouseWheel=Dl.bind(this),this._onKeyDown=Zl.bind(this),this._onTouchStart=Bl.bind(this),this._onTouchMove=Rl.bind(this),this._onMouseDown=Cl.bind(this),this._onMouseMove=Il.bind(this),this._interceptControlDown=Fl.bind(this),this._interceptControlUp=Nl.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}connect(e){super.connect(e),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction="auto"}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(Ea),this.update(),this.state=O.NONE}update(e=null){const t=this.object.position;Y.copy(t).sub(this.target),Y.applyQuaternion(this._quat),this._spherical.setFromVector3(Y),this.autoRotate&&this.state===O.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let a=this.minAzimuthAngle,n=this.maxAzimuthAngle;isFinite(a)&&isFinite(n)&&(a<-Math.PI?a+=oe:a>Math.PI&&(a-=oe),n<-Math.PI?n+=oe:n>Math.PI&&(n-=oe),a<=n?this._spherical.theta=Math.max(a,Math.min(n,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(a+n)/2?Math.max(a,this._spherical.theta):Math.min(n,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let i=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const o=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),i=o!=this._spherical.radius}if(Y.setFromSpherical(this._spherical),Y.applyQuaternion(this._quatInverse),t.copy(this.target).add(Y),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let o=null;if(this.object.isPerspectiveCamera){const s=Y.length();o=this._clampDistance(s*this._scale);const r=s-o;this.object.position.addScaledVector(this._dollyDirection,r),this.object.updateMatrixWorld(),i=!!r}else if(this.object.isOrthographicCamera){const s=new F(this._mouse.x,this._mouse.y,0);s.unproject(this.object);const r=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),i=r!==this.object.zoom;const p=new F(this._mouse.x,this._mouse.y,0);p.unproject(this.object),this.object.position.sub(p).add(s),this.object.updateMatrixWorld(),o=Y.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;o!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(o).add(this.object.position):(Ot.origin.copy(this.object.position),Ot.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(Ot.direction))<El?this.object.lookAt(this.target):(Ma.setFromNormalAndCoplanarPoint(this.object.up,this.target),Ot.intersectPlane(Ma,this.target))))}else if(this.object.isOrthographicCamera){const o=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),o!==this.object.zoom&&(this.object.updateProjectionMatrix(),i=!0)}return this._scale=1,this._performCursorZoom=!1,i||this._lastPosition.distanceToSquared(this.object.position)>Tn||8*(1-this._lastQuaternion.dot(this.object.quaternion))>Tn||this._lastTargetPosition.distanceToSquared(this.target)>Tn?(this.dispatchEvent(Ea),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e!==null?oe/60*this.autoRotateSpeed*e:oe/60/60*this.autoRotateSpeed}_getZoomScale(e){const t=Math.abs(e*.01);return Math.pow(.95,this.zoomSpeed*t)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,t){Y.setFromMatrixColumn(t,0),Y.multiplyScalar(-e),this._panOffset.add(Y)}_panUp(e,t){this.screenSpacePanning===!0?Y.setFromMatrixColumn(t,1):(Y.setFromMatrixColumn(t,0),Y.crossVectors(this.object.up,Y)),Y.multiplyScalar(e),this._panOffset.add(Y)}_pan(e,t){const a=this.domElement;if(this.object.isPerspectiveCamera){const n=this.object.position;Y.copy(n).sub(this.target);let i=Y.length();i*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*i/a.clientHeight,this.object.matrix),this._panUp(2*t*i/a.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/a.clientWidth,this.object.matrix),this._panUp(t*(this.object.top-this.object.bottom)/this.object.zoom/a.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(e,t){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const a=this.domElement.getBoundingClientRect(),n=e-a.left,i=t-a.top,o=a.width,s=a.height;this._mouse.x=n/o*2-1,this._mouse.y=-(i/s)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const t=this.domElement;this._rotateLeft(oe*this._rotateDelta.x/t.clientHeight),this._rotateUp(oe*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let t=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(oe*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),t=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(-oe*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),t=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(oe*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),t=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(-oe*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),a=.5*(e.pageX+t.x),n=.5*(e.pageY+t.y);this._rotateStart.set(a,n)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),a=.5*(e.pageX+t.x),n=.5*(e.pageY+t.y);this._panStart.set(a,n)}}_handleTouchStartDolly(e){const t=this._getSecondPointerPosition(e),a=e.pageX-t.x,n=e.pageY-t.y,i=Math.sqrt(a*a+n*n);this._dollyStart.set(0,i)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{const a=this._getSecondPointerPosition(e),n=.5*(e.pageX+a.x),i=.5*(e.pageY+a.y);this._rotateEnd.set(n,i)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const t=this.domElement;this._rotateLeft(oe*this._rotateDelta.x/t.clientHeight),this._rotateUp(oe*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),a=.5*(e.pageX+t.x),n=.5*(e.pageY+t.y);this._panEnd.set(a,n)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){const t=this._getSecondPointerPosition(e),a=e.pageX-t.x,n=e.pageY-t.y,i=Math.sqrt(a*a+n*n);this._dollyEnd.set(0,i),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const o=(e.pageX+t.x)*.5,s=(e.pageY+t.y)*.5;this._updateZoomParameters(o,s)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId){this._pointers.splice(t,1);return}}_isTrackingPointer(e){for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId)return!0;return!1}_trackPointer(e){let t=this._pointerPositions[e.pointerId];t===void 0&&(t=new te,this._pointerPositions[e.pointerId]=t),t.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){const t=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[t]}_customWheelEvent(e){const t=e.deltaMode,a={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(t){case 1:a.deltaY*=16;break;case 2:a.deltaY*=100;break}return e.ctrlKey&&!this._controlActive&&(a.deltaY*=10),a}}function Sl(c){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(c.pointerId),this.domElement.addEventListener("pointermove",this._onPointerMove),this.domElement.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(c)&&(this._addPointer(c),c.pointerType==="touch"?this._onTouchStart(c):this._onMouseDown(c)))}function Ll(c){this.enabled!==!1&&(c.pointerType==="touch"?this._onTouchMove(c):this._onMouseMove(c))}function zl(c){switch(this._removePointer(c),this._pointers.length){case 0:this.domElement.releasePointerCapture(c.pointerId),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(li),this.state=O.NONE;break;case 1:const e=this._pointers[0],t=this._pointerPositions[e];this._onTouchStart({pointerId:e,pageX:t.x,pageY:t.y});break}}function Cl(c){let e;switch(c.button){case 0:e=this.mouseButtons.LEFT;break;case 1:e=this.mouseButtons.MIDDLE;break;case 2:e=this.mouseButtons.RIGHT;break;default:e=-1}switch(e){case et.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(c),this.state=O.DOLLY;break;case et.ROTATE:if(c.ctrlKey||c.metaKey||c.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(c),this.state=O.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(c),this.state=O.ROTATE}break;case et.PAN:if(c.ctrlKey||c.metaKey||c.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(c),this.state=O.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(c),this.state=O.PAN}break;default:this.state=O.NONE}this.state!==O.NONE&&this.dispatchEvent(Un)}function Il(c){switch(this.state){case O.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(c);break;case O.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(c);break;case O.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(c);break}}function Dl(c){this.enabled===!1||this.enableZoom===!1||this.state!==O.NONE||(c.preventDefault(),this.dispatchEvent(Un),this._handleMouseWheel(this._customWheelEvent(c)),this.dispatchEvent(li))}function Zl(c){this.enabled!==!1&&this._handleKeyDown(c)}function Bl(c){switch(this._trackPointer(c),this._pointers.length){case 1:switch(this.touches.ONE){case Xe.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(c),this.state=O.TOUCH_ROTATE;break;case Xe.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(c),this.state=O.TOUCH_PAN;break;default:this.state=O.NONE}break;case 2:switch(this.touches.TWO){case Xe.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(c),this.state=O.TOUCH_DOLLY_PAN;break;case Xe.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(c),this.state=O.TOUCH_DOLLY_ROTATE;break;default:this.state=O.NONE}break;default:this.state=O.NONE}this.state!==O.NONE&&this.dispatchEvent(Un)}function Rl(c){switch(this._trackPointer(c),this.state){case O.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(c),this.update();break;case O.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(c),this.update();break;case O.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(c),this.update();break;case O.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(c),this.update();break;default:this.state=O.NONE}}function Pl(c){this.enabled!==!1&&c.preventDefault()}function Fl(c){c.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function Nl(c){c.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}const _n=new WeakMap;class jl extends Xt{constructor(e){super(e),this.decoderPath="",this.decoderConfig={},this.decoderBinary=null,this.decoderPending=null,this.workerLimit=4,this.workerPool=[],this.workerNextTaskID=1,this.workerSourceURL="",this.defaultAttributeIDs={position:"POSITION",normal:"NORMAL",color:"COLOR",uv:"TEX_COORD"},this.defaultAttributeTypes={position:"Float32Array",normal:"Float32Array",color:"Float32Array",uv:"Float32Array"}}setDecoderPath(e){return this.decoderPath=e,this}setDecoderConfig(e){return this.decoderConfig=e,this}setWorkerLimit(e){return this.workerLimit=e,this}load(e,t,a,n){const i=new ot(this.manager);i.setPath(this.path),i.setResponseType("arraybuffer"),i.setRequestHeader(this.requestHeader),i.setWithCredentials(this.withCredentials),i.load(e,o=>{this.parse(o,t,n)},a,n)}parse(e,t,a=()=>{}){this.decodeDracoFile(e,t,null,null,ne,a).catch(a)}decodeDracoFile(e,t,a,n,i=_e,o=()=>{}){const s={attributeIDs:a||this.defaultAttributeIDs,attributeTypes:n||this.defaultAttributeTypes,useUniqueIDs:!!a,vertexColorSpace:i};return this.decodeGeometry(e,s).then(t).catch(o)}decodeGeometry(e,t){const a=JSON.stringify(t);if(_n.has(e)){const r=_n.get(e);if(r.key===a)return r.promise;if(e.byteLength===0)throw new Error("THREE.DRACOLoader: Unable to re-decode a buffer with different settings. Buffer has already been transferred.")}let n;const i=this.workerNextTaskID++,o=e.byteLength,s=this._getWorker(i,o).then(r=>(n=r,new Promise((p,d)=>{n._callbacks[i]={resolve:p,reject:d},n.postMessage({type:"decode",id:i,taskConfig:t,buffer:e},[e])}))).then(r=>this._createGeometry(r.geometry));return s.catch(()=>!0).then(()=>{n&&i&&this._releaseTask(n,i)}),_n.set(e,{key:a,promise:s}),s}_createGeometry(e){const t=new Et;e.index&&t.setIndex(new tt(e.index.array,1));for(let a=0;a<e.attributes.length;a++){const n=e.attributes[a],i=n.name,o=n.array,s=n.itemSize,r=new tt(o,s);i==="color"&&(this._assignVertexColorSpace(r,n.vertexColorSpace),r.normalized=!(o instanceof Float32Array)),t.setAttribute(i,r)}return t}_assignVertexColorSpace(e,t){if(t!==ne)return;const a=new pe;for(let n=0,i=e.count;n<i;n++)a.fromBufferAttribute(e,n),nt.colorSpaceToWorking(a,ne),e.setXYZ(n,a.r,a.g,a.b)}_loadLibrary(e,t){const a=new ot(this.manager);return a.setPath(this.decoderPath),a.setResponseType(t),a.setWithCredentials(this.withCredentials),new Promise((n,i)=>{a.load(e,n,void 0,i)})}preload(){return this._initDecoder(),this}_initDecoder(){if(this.decoderPending)return this.decoderPending;const e=typeof WebAssembly!="object"||this.decoderConfig.type==="js",t=[];return e?t.push(this._loadLibrary("draco_decoder.js","text")):(t.push(this._loadLibrary("draco_wasm_wrapper.js","text")),t.push(this._loadLibrary("draco_decoder.wasm","arraybuffer"))),this.decoderPending=Promise.all(t).then(a=>{const n=a[0];e||(this.decoderConfig.wasmBinary=a[1]);const i=Gl.toString(),o=["/* draco decoder */",n,"","/* worker */",i.substring(i.indexOf("{")+1,i.lastIndexOf("}"))].join(`
`);this.workerSourceURL=URL.createObjectURL(new Blob([o]))}),this.decoderPending}_getWorker(e,t){return this._initDecoder().then(()=>{if(this.workerPool.length<this.workerLimit){const n=new Worker(this.workerSourceURL);n._callbacks={},n._taskCosts={},n._taskLoad=0,n.postMessage({type:"init",decoderConfig:this.decoderConfig}),n.onmessage=function(i){const o=i.data;switch(o.type){case"decode":n._callbacks[o.id].resolve(o);break;case"error":n._callbacks[o.id].reject(o);break;default:console.error('THREE.DRACOLoader: Unexpected message, "'+o.type+'"')}},this.workerPool.push(n)}else this.workerPool.sort(function(n,i){return n._taskLoad>i._taskLoad?-1:1});const a=this.workerPool[this.workerPool.length-1];return a._taskCosts[e]=t,a._taskLoad+=t,a})}_releaseTask(e,t){e._taskLoad-=e._taskCosts[t],delete e._callbacks[t],delete e._taskCosts[t]}debug(){console.log("Task load: ",this.workerPool.map(e=>e._taskLoad))}dispose(){for(let e=0;e<this.workerPool.length;++e)this.workerPool[e].terminate();return this.workerPool.length=0,this.workerSourceURL!==""&&URL.revokeObjectURL(this.workerSourceURL),this}}function Gl(){let c,e;onmessage=function(o){const s=o.data;switch(s.type){case"init":c=s.decoderConfig,e=new Promise(function(d){c.onModuleLoaded=function(h){d({draco:h})},DracoDecoderModule(c)});break;case"decode":const r=s.buffer,p=s.taskConfig;e.then(d=>{const h=d.draco,m=new h.Decoder;try{const g=t(h,m,new Int8Array(r),p),A=g.attributes.map(b=>b.array.buffer);g.index&&A.push(g.index.array.buffer),self.postMessage({type:"decode",id:s.id,geometry:g},A)}catch(g){console.error(g),self.postMessage({type:"error",id:s.id,error:g.message})}finally{h.destroy(m)}});break}};function t(o,s,r,p){const d=p.attributeIDs,h=p.attributeTypes;let m,g;const A=s.GetEncodedGeometryType(r);if(A===o.TRIANGULAR_MESH)m=new o.Mesh,g=s.DecodeArrayToMesh(r,r.byteLength,m);else if(A===o.POINT_CLOUD)m=new o.PointCloud,g=s.DecodeArrayToPointCloud(r,r.byteLength,m);else throw new Error("THREE.DRACOLoader: Unexpected geometry type.");if(!g.ok()||m.ptr===0)throw new Error("THREE.DRACOLoader: Decoding failed: "+g.error_msg());const b={index:null,attributes:[]};for(const f in d){const k=self[h[f]];let w,M;if(p.useUniqueIDs)M=d[f],w=s.GetAttributeByUniqueId(m,M);else{if(M=s.GetAttributeId(m,o[d[f]]),M===-1)continue;w=s.GetAttribute(m,M)}const T=n(o,s,m,f,k,w);f==="color"&&(T.vertexColorSpace=p.vertexColorSpace),b.attributes.push(T)}return A===o.TRIANGULAR_MESH&&(b.index=a(o,s,m)),o.destroy(m),b}function a(o,s,r){const d=r.num_faces()*3,h=d*4,m=o._malloc(h);s.GetTrianglesUInt32Array(r,h,m);const g=new Uint32Array(o.HEAPF32.buffer,m,d).slice();return o._free(m),{array:g,itemSize:1}}function n(o,s,r,p,d,h){const m=h.num_components(),A=r.num_points()*m,b=A*d.BYTES_PER_ELEMENT,f=i(o,d),k=o._malloc(b);s.GetAttributeDataArrayForAllPoints(r,h,f,b,k);const w=new d(o.HEAPF32.buffer,k,A).slice();return o._free(k),{name:p,array:w,itemSize:m}}function i(o,s){switch(s){case Float32Array:return o.DT_FLOAT32;case Int8Array:return o.DT_INT8;case Int16Array:return o.DT_INT16;case Int32Array:return o.DT_INT32;case Uint8Array:return o.DT_UINT8;case Uint16Array:return o.DT_UINT16;case Uint32Array:return o.DT_UINT32}}}function Sa(c,e){if(e===no)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),c;if(e===Dn||e===Xa){let t=c.getIndex();if(t===null){const o=[],s=c.getAttribute("position");if(s!==void 0){for(let r=0;r<s.count;r++)o.push(r);c.setIndex(o),t=c.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),c}const a=t.count-2,n=[];if(e===Dn)for(let o=1;o<=a;o++)n.push(t.getX(0)),n.push(t.getX(o)),n.push(t.getX(o+1));else for(let o=0;o<a;o++)o%2===0?(n.push(t.getX(o)),n.push(t.getX(o+1)),n.push(t.getX(o+2))):(n.push(t.getX(o+2)),n.push(t.getX(o+1)),n.push(t.getX(o)));n.length/3!==a&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const i=c.clone();return i.setIndex(n),i.clearGroups(),i}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),c}class Ol extends Xt{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new Kl(t)}),this.register(function(t){return new Vl(t)}),this.register(function(t){return new ac(t)}),this.register(function(t){return new ic(t)}),this.register(function(t){return new oc(t)}),this.register(function(t){return new Yl(t)}),this.register(function(t){return new Xl(t)}),this.register(function(t){return new Jl(t)}),this.register(function(t){return new $l(t)}),this.register(function(t){return new ql(t)}),this.register(function(t){return new ec(t)}),this.register(function(t){return new Wl(t)}),this.register(function(t){return new nc(t)}),this.register(function(t){return new tc(t)}),this.register(function(t){return new Ul(t)}),this.register(function(t){return new rc(t)}),this.register(function(t){return new sc(t)})}load(e,t,a,n){const i=this;let o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){const p=at.extractUrlBase(e);o=at.resolveURL(p,this.path)}else o=at.extractUrlBase(e);this.manager.itemStart(e);const s=function(p){n?n(p):console.error(p),i.manager.itemError(e),i.manager.itemEnd(e)},r=new ot(this.manager);r.setPath(this.path),r.setResponseType("arraybuffer"),r.setRequestHeader(this.requestHeader),r.setWithCredentials(this.withCredentials),r.load(e,function(p){try{i.parse(p,o,function(d){t(d),i.manager.itemEnd(e)},s)}catch(d){s(d)}},a,s)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,a,n){let i;const o={},s={},r=new TextDecoder;if(typeof e=="string")i=JSON.parse(e);else if(e instanceof ArrayBuffer)if(r.decode(new Uint8Array(e,0,4))===ci){try{o[I.KHR_BINARY_GLTF]=new lc(e)}catch(h){n&&n(h);return}i=JSON.parse(o[I.KHR_BINARY_GLTF].content)}else i=JSON.parse(r.decode(e));else i=e;if(i.asset===void 0||i.asset.version[0]<2){n&&n(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const p=new wc(i,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});p.fileLoader.setRequestHeader(this.requestHeader);for(let d=0;d<this.pluginCallbacks.length;d++){const h=this.pluginCallbacks[d](p);h.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),s[h.name]=h,o[h.name]=!0}if(i.extensionsUsed)for(let d=0;d<i.extensionsUsed.length;++d){const h=i.extensionsUsed[d],m=i.extensionsRequired||[];switch(h){case I.KHR_MATERIALS_UNLIT:o[h]=new Ql;break;case I.KHR_DRACO_MESH_COMPRESSION:o[h]=new cc(i,this.dracoLoader);break;case I.KHR_TEXTURE_TRANSFORM:o[h]=new pc;break;case I.KHR_MESH_QUANTIZATION:o[h]=new hc;break;default:m.indexOf(h)>=0&&s[h]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+h+'".')}}p.setExtensions(o),p.setPlugins(s),p.parse(a,n)}parseAsync(e,t){const a=this;return new Promise(function(n,i){a.parse(e,t,n,i)})}}function Hl(){let c={};return{get:function(e){return c[e]},add:function(e,t){c[e]=t},remove:function(e){delete c[e]},removeAll:function(){c={}}}}const I={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class Ul{constructor(e){this.parser=e,this.name=I.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const e=this.parser,t=this.parser.json.nodes||[];for(let a=0,n=t.length;a<n;a++){const i=t[a];i.extensions&&i.extensions[this.name]&&i.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,i.extensions[this.name].light)}}_loadLight(e){const t=this.parser,a="light:"+e;let n=t.cache.get(a);if(n)return n;const i=t.json,r=((i.extensions&&i.extensions[this.name]||{}).lights||[])[e];let p;const d=new pe(16777215);r.color!==void 0&&d.setRGB(r.color[0],r.color[1],r.color[2],_e);const h=r.range!==void 0?r.range:0;switch(r.type){case"directional":p=new Zn(d),p.target.position.set(0,0,-1),p.add(p.target);break;case"point":p=new io(d),p.distance=h;break;case"spot":p=new ao(d),p.distance=h,r.spot=r.spot||{},r.spot.innerConeAngle=r.spot.innerConeAngle!==void 0?r.spot.innerConeAngle:0,r.spot.outerConeAngle=r.spot.outerConeAngle!==void 0?r.spot.outerConeAngle:Math.PI/4,p.angle=r.spot.outerConeAngle,p.penumbra=1-r.spot.innerConeAngle/r.spot.outerConeAngle,p.target.position.set(0,0,-1),p.add(p.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+r.type)}return p.position.set(0,0,0),Te(p,r),r.intensity!==void 0&&(p.intensity=r.intensity),p.name=t.createUniqueName(r.name||"light_"+e),n=Promise.resolve(p),t.cache.add(a,n),n}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){const t=this,a=this.parser,i=a.json.nodes[e],s=(i.extensions&&i.extensions[this.name]||{}).light;return s===void 0?null:this._loadLight(s).then(function(r){return a._getNodeRef(t.cache,s,r)})}}class Ql{constructor(){this.name=I.KHR_MATERIALS_UNLIT}getMaterialType(){return $e}extendParams(e,t,a){const n=[];e.color=new pe(1,1,1),e.opacity=1;const i=t.pbrMetallicRoughness;if(i){if(Array.isArray(i.baseColorFactor)){const o=i.baseColorFactor;e.color.setRGB(o[0],o[1],o[2],_e),e.opacity=o[3]}i.baseColorTexture!==void 0&&n.push(a.assignTexture(e,"map",i.baseColorTexture,ne))}return Promise.all(n)}}class ql{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name].emissiveStrength;return i!==void 0&&(t.emissiveIntensity=i),Promise.resolve()}}class Kl{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const a=this.parser,n=a.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];if(o.clearcoatFactor!==void 0&&(t.clearcoat=o.clearcoatFactor),o.clearcoatTexture!==void 0&&i.push(a.assignTexture(t,"clearcoatMap",o.clearcoatTexture)),o.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=o.clearcoatRoughnessFactor),o.clearcoatRoughnessTexture!==void 0&&i.push(a.assignTexture(t,"clearcoatRoughnessMap",o.clearcoatRoughnessTexture)),o.clearcoatNormalTexture!==void 0&&(i.push(a.assignTexture(t,"clearcoatNormalMap",o.clearcoatNormalTexture)),o.clearcoatNormalTexture.scale!==void 0)){const s=o.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new te(s,s)}return Promise.all(i)}}class Vl{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_DISPERSION}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name];return t.dispersion=i.dispersion!==void 0?i.dispersion:0,Promise.resolve()}}class Wl{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const a=this.parser,n=a.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.iridescenceFactor!==void 0&&(t.iridescence=o.iridescenceFactor),o.iridescenceTexture!==void 0&&i.push(a.assignTexture(t,"iridescenceMap",o.iridescenceTexture)),o.iridescenceIor!==void 0&&(t.iridescenceIOR=o.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),o.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=o.iridescenceThicknessMinimum),o.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=o.iridescenceThicknessMaximum),o.iridescenceThicknessTexture!==void 0&&i.push(a.assignTexture(t,"iridescenceThicknessMap",o.iridescenceThicknessTexture)),Promise.all(i)}}class Yl{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_SHEEN}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const a=this.parser,n=a.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[];t.sheenColor=new pe(0,0,0),t.sheenRoughness=0,t.sheen=1;const o=n.extensions[this.name];if(o.sheenColorFactor!==void 0){const s=o.sheenColorFactor;t.sheenColor.setRGB(s[0],s[1],s[2],_e)}return o.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=o.sheenRoughnessFactor),o.sheenColorTexture!==void 0&&i.push(a.assignTexture(t,"sheenColorMap",o.sheenColorTexture,ne)),o.sheenRoughnessTexture!==void 0&&i.push(a.assignTexture(t,"sheenRoughnessMap",o.sheenRoughnessTexture)),Promise.all(i)}}class Xl{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const a=this.parser,n=a.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.transmissionFactor!==void 0&&(t.transmission=o.transmissionFactor),o.transmissionTexture!==void 0&&i.push(a.assignTexture(t,"transmissionMap",o.transmissionTexture)),Promise.all(i)}}class Jl{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_VOLUME}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const a=this.parser,n=a.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];t.thickness=o.thicknessFactor!==void 0?o.thicknessFactor:0,o.thicknessTexture!==void 0&&i.push(a.assignTexture(t,"thicknessMap",o.thicknessTexture)),t.attenuationDistance=o.attenuationDistance||1/0;const s=o.attenuationColor||[1,1,1];return t.attenuationColor=new pe().setRGB(s[0],s[1],s[2],_e),Promise.all(i)}}class $l{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_IOR}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name];return t.ior=i.ior!==void 0?i.ior:1.5,Promise.resolve()}}class ec{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_SPECULAR}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const a=this.parser,n=a.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];t.specularIntensity=o.specularFactor!==void 0?o.specularFactor:1,o.specularTexture!==void 0&&i.push(a.assignTexture(t,"specularIntensityMap",o.specularTexture));const s=o.specularColorFactor||[1,1,1];return t.specularColor=new pe().setRGB(s[0],s[1],s[2],_e),o.specularColorTexture!==void 0&&i.push(a.assignTexture(t,"specularColorMap",o.specularColorTexture,ne)),Promise.all(i)}}class tc{constructor(e){this.parser=e,this.name=I.EXT_MATERIALS_BUMP}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const a=this.parser,n=a.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return t.bumpScale=o.bumpFactor!==void 0?o.bumpFactor:1,o.bumpTexture!==void 0&&i.push(a.assignTexture(t,"bumpMap",o.bumpTexture)),Promise.all(i)}}class nc{constructor(e){this.parser=e,this.name=I.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){const a=this.parser.json.materials[e];return!a.extensions||!a.extensions[this.name]?null:xe}extendMaterialParams(e,t){const a=this.parser,n=a.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.anisotropyStrength!==void 0&&(t.anisotropy=o.anisotropyStrength),o.anisotropyRotation!==void 0&&(t.anisotropyRotation=o.anisotropyRotation),o.anisotropyTexture!==void 0&&i.push(a.assignTexture(t,"anisotropyMap",o.anisotropyTexture)),Promise.all(i)}}class ac{constructor(e){this.parser=e,this.name=I.KHR_TEXTURE_BASISU}loadTexture(e){const t=this.parser,a=t.json,n=a.textures[e];if(!n.extensions||!n.extensions[this.name])return null;const i=n.extensions[this.name],o=t.options.ktx2Loader;if(!o){if(a.extensionsRequired&&a.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,i.source,o)}}class ic{constructor(e){this.parser=e,this.name=I.EXT_TEXTURE_WEBP}loadTexture(e){const t=this.name,a=this.parser,n=a.json,i=n.textures[e];if(!i.extensions||!i.extensions[t])return null;const o=i.extensions[t],s=n.images[o.source];let r=a.textureLoader;if(s.uri){const p=a.options.manager.getHandler(s.uri);p!==null&&(r=p)}return a.loadTextureImage(e,o.source,r)}}class oc{constructor(e){this.parser=e,this.name=I.EXT_TEXTURE_AVIF}loadTexture(e){const t=this.name,a=this.parser,n=a.json,i=n.textures[e];if(!i.extensions||!i.extensions[t])return null;const o=i.extensions[t],s=n.images[o.source];let r=a.textureLoader;if(s.uri){const p=a.options.manager.getHandler(s.uri);p!==null&&(r=p)}return a.loadTextureImage(e,o.source,r)}}class rc{constructor(e){this.name=I.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){const t=this.parser.json,a=t.bufferViews[e];if(a.extensions&&a.extensions[this.name]){const n=a.extensions[this.name],i=this.parser.getDependency("buffer",n.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return i.then(function(s){const r=n.byteOffset||0,p=n.byteLength||0,d=n.count,h=n.byteStride,m=new Uint8Array(s,r,p);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(d,h,m,n.mode,n.filter).then(function(g){return g.buffer}):o.ready.then(function(){const g=new ArrayBuffer(d*h);return o.decodeGltfBuffer(new Uint8Array(g),d,h,m,n.mode,n.filter),g})})}else return null}}class sc{constructor(e){this.name=I.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){const t=this.parser.json,a=t.nodes[e];if(!a.extensions||!a.extensions[this.name]||a.mesh===void 0)return null;const n=t.meshes[a.mesh];for(const p of n.primitives)if(p.mode!==me.TRIANGLES&&p.mode!==me.TRIANGLE_STRIP&&p.mode!==me.TRIANGLE_FAN&&p.mode!==void 0)return null;const o=a.extensions[this.name].attributes,s=[],r={};for(const p in o)s.push(this.parser.getDependency("accessor",o[p]).then(d=>(r[p]=d,r[p])));return s.length<1?null:(s.push(this.parser.createNodeMesh(e)),Promise.all(s).then(p=>{const d=p.pop(),h=d.isGroup?d.children:[d],m=p[0].count,g=[];for(const A of h){const b=new rt,f=new F,k=new Kt,w=new F(1,1,1),M=new oo(A.geometry,A.material,m);for(let T=0;T<m;T++)r.TRANSLATION&&f.fromBufferAttribute(r.TRANSLATION,T),r.ROTATION&&k.fromBufferAttribute(r.ROTATION,T),r.SCALE&&w.fromBufferAttribute(r.SCALE,T),M.setMatrixAt(T,b.compose(f,k,w));for(const T in r)if(T==="_COLOR_0"){const R=r[T];M.instanceColor=new ro(R.array,R.itemSize,R.normalized)}else T!=="TRANSLATION"&&T!=="ROTATION"&&T!=="SCALE"&&A.geometry.setAttribute(T,r[T]);Gn.prototype.copy.call(M,A),this.parser.assignFinalMaterial(M),g.push(M)}return d.isGroup?(d.clear(),d.add(...g),d):g[0]}))}}const ci="glTF",vt=12,La={JSON:1313821514,BIN:5130562};class lc{constructor(e){this.name=I.KHR_BINARY_GLTF,this.content=null,this.body=null;const t=new DataView(e,0,vt),a=new TextDecoder;if(this.header={magic:a.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==ci)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const n=this.header.length-vt,i=new DataView(e,vt);let o=0;for(;o<n;){const s=i.getUint32(o,!0);o+=4;const r=i.getUint32(o,!0);if(o+=4,r===La.JSON){const p=new Uint8Array(e,vt+o,s);this.content=a.decode(p)}else if(r===La.BIN){const p=vt+o;this.body=e.slice(p,p+s)}o+=s}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class cc{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=I.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){const a=this.json,n=this.dracoLoader,i=e.extensions[this.name].bufferView,o=e.extensions[this.name].attributes,s={},r={},p={};for(const d in o){const h=Pn[d]||d.toLowerCase();s[h]=o[d]}for(const d in e.attributes){const h=Pn[d]||d.toLowerCase();if(o[d]!==void 0){const m=a.accessors[e.attributes[d]],g=it[m.componentType];p[h]=g.name,r[h]=m.normalized===!0}}return t.getDependency("bufferView",i).then(function(d){return new Promise(function(h,m){n.decodeDracoFile(d,function(g){for(const A in g.attributes){const b=g.attributes[A],f=r[A];f!==void 0&&(b.normalized=f)}h(g)},s,p,_e,m)})})}}class pc{constructor(){this.name=I.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}}class hc{constructor(){this.name=I.KHR_MESH_QUANTIZATION}}class pi extends xo{constructor(e,t,a,n){super(e,t,a,n)}copySampleValue_(e){const t=this.resultBuffer,a=this.sampleValues,n=this.valueSize,i=e*n*3+n;for(let o=0;o!==n;o++)t[o]=a[i+o];return t}interpolate_(e,t,a,n){const i=this.resultBuffer,o=this.sampleValues,s=this.valueSize,r=s*2,p=s*3,d=n-t,h=(a-t)/d,m=h*h,g=m*h,A=e*p,b=A-p,f=-2*g+3*m,k=g-m,w=1-f,M=k-m+h;for(let T=0;T!==s;T++){const R=o[b+T+s],E=o[b+T+r]*d,x=o[A+T+s],X=o[A+T]*d;i[T]=w*R+M*E+f*x+k*X}return i}}const dc=new Kt;class mc extends pi{interpolate_(e,t,a,n){const i=super.interpolate_(e,t,a,n);return dc.fromArray(i).normalize().toArray(i),i}}const me={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},it={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},za={9728:ei,9729:Bn,9984:ho,9985:po,9986:co,9987:$a},Ca={33071:uo,33648:mo,10497:Vt},xn={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Pn={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},Ie={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},uc={CUBICSPLINE:void 0,LINEAR:ai,STEP:To},En={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function gc(c){return c.DefaultMaterial===void 0&&(c.DefaultMaterial=new ti({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:ii})),c.DefaultMaterial}function je(c,e,t){for(const a in t.extensions)c[a]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[a]=t.extensions[a])}function Te(c,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(c.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function Ac(c,e,t){let a=!1,n=!1,i=!1;for(let p=0,d=e.length;p<d;p++){const h=e[p];if(h.POSITION!==void 0&&(a=!0),h.NORMAL!==void 0&&(n=!0),h.COLOR_0!==void 0&&(i=!0),a&&n&&i)break}if(!a&&!n&&!i)return Promise.resolve(c);const o=[],s=[],r=[];for(let p=0,d=e.length;p<d;p++){const h=e[p];if(a){const m=h.POSITION!==void 0?t.getDependency("accessor",h.POSITION):c.attributes.position;o.push(m)}if(n){const m=h.NORMAL!==void 0?t.getDependency("accessor",h.NORMAL):c.attributes.normal;s.push(m)}if(i){const m=h.COLOR_0!==void 0?t.getDependency("accessor",h.COLOR_0):c.attributes.color;r.push(m)}}return Promise.all([Promise.all(o),Promise.all(s),Promise.all(r)]).then(function(p){const d=p[0],h=p[1],m=p[2];return a&&(c.morphAttributes.position=d),n&&(c.morphAttributes.normal=h),i&&(c.morphAttributes.color=m),c.morphTargetsRelative=!0,c})}function fc(c,e){if(c.updateMorphTargets(),e.weights!==void 0)for(let t=0,a=e.weights.length;t<a;t++)c.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){const t=e.extras.targetNames;if(c.morphTargetInfluences.length===t.length){c.morphTargetDictionary={};for(let a=0,n=t.length;a<n;a++)c.morphTargetDictionary[t[a]]=a}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function bc(c){let e;const t=c.extensions&&c.extensions[I.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+Mn(t.attributes):e=c.indices+":"+Mn(c.attributes)+":"+c.mode,c.targets!==void 0)for(let a=0,n=c.targets.length;a<n;a++)e+=":"+Mn(c.targets[a]);return e}function Mn(c){let e="";const t=Object.keys(c).sort();for(let a=0,n=t.length;a<n;a++)e+=t[a]+":"+c[t[a]]+";";return e}function Fn(c){switch(c){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function vc(c){return c.search(/\.jpe?g($|\?)/i)>0||c.search(/^data\:image\/jpeg/)===0?"image/jpeg":c.search(/\.webp($|\?)/i)>0||c.search(/^data\:image\/webp/)===0?"image/webp":c.search(/\.ktx2($|\?)/i)>0||c.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}const kc=new rt;class wc{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new Hl,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let a=!1,n=-1,i=!1,o=-1;if(typeof navigator<"u"){const s=navigator.userAgent;a=/^((?!chrome|android).)*safari/i.test(s)===!0;const r=s.match(/Version\/(\d+)/);n=a&&r?parseInt(r[1],10):-1,i=s.indexOf("Firefox")>-1,o=i?s.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||a&&n<17||i&&o<98?this.textureLoader=new Ja(this.options.manager):this.textureLoader=new so(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new ot(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){const a=this,n=this.json,i=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([a.getDependencies("scene"),a.getDependencies("animation"),a.getDependencies("camera")])}).then(function(o){const s={scene:o[0][n.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:n.asset,parser:a,userData:{}};return je(i,s,n),Te(s,n),Promise.all(a._invokeAll(function(r){return r.afterRoot&&r.afterRoot(s)})).then(function(){for(const r of s.scenes)r.updateMatrixWorld();e(s)})}).catch(t)}_markDefs(){const e=this.json.nodes||[],t=this.json.skins||[],a=this.json.meshes||[];for(let n=0,i=t.length;n<i;n++){const o=t[n].joints;for(let s=0,r=o.length;s<r;s++)e[o[s]].isBone=!0}for(let n=0,i=e.length;n<i;n++){const o=e[n];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(a[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,a){if(e.refs[t]<=1)return a;const n=a.clone(),i=(o,s)=>{const r=this.associations.get(o);r!=null&&this.associations.set(s,r);for(const[p,d]of o.children.entries())i(d,s.children[p])};return i(a,n),n.name+="_instance_"+e.uses[t]++,n}_invokeOne(e){const t=Object.values(this.plugins);t.push(this);for(let a=0;a<t.length;a++){const n=e(t[a]);if(n)return n}return null}_invokeAll(e){const t=Object.values(this.plugins);t.unshift(this);const a=[];for(let n=0;n<t.length;n++){const i=e(t[n]);i&&a.push(i)}return a}getDependency(e,t){const a=e+":"+t;let n=this.cache.get(a);if(!n){switch(e){case"scene":n=this.loadScene(t);break;case"node":n=this._invokeOne(function(i){return i.loadNode&&i.loadNode(t)});break;case"mesh":n=this._invokeOne(function(i){return i.loadMesh&&i.loadMesh(t)});break;case"accessor":n=this.loadAccessor(t);break;case"bufferView":n=this._invokeOne(function(i){return i.loadBufferView&&i.loadBufferView(t)});break;case"buffer":n=this.loadBuffer(t);break;case"material":n=this._invokeOne(function(i){return i.loadMaterial&&i.loadMaterial(t)});break;case"texture":n=this._invokeOne(function(i){return i.loadTexture&&i.loadTexture(t)});break;case"skin":n=this.loadSkin(t);break;case"animation":n=this._invokeOne(function(i){return i.loadAnimation&&i.loadAnimation(t)});break;case"camera":n=this.loadCamera(t);break;default:if(n=this._invokeOne(function(i){return i!=this&&i.getDependency&&i.getDependency(e,t)}),!n)throw new Error("Unknown type: "+e);break}this.cache.add(a,n)}return n}getDependencies(e){let t=this.cache.get(e);if(!t){const a=this,n=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(n.map(function(i,o){return a.getDependency(e,o)})),this.cache.add(e,t)}return t}loadBuffer(e){const t=this.json.buffers[e],a=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[I.KHR_BINARY_GLTF].body);const n=this.options;return new Promise(function(i,o){a.load(at.resolveURL(t.uri,n.path),i,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){const t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(a){const n=t.byteLength||0,i=t.byteOffset||0;return a.slice(i,i+n)})}loadAccessor(e){const t=this,a=this.json,n=this.json.accessors[e];if(n.bufferView===void 0&&n.sparse===void 0){const o=xn[n.type],s=it[n.componentType],r=n.normalized===!0,p=new s(n.count*o);return Promise.resolve(new tt(p,o,r))}const i=[];return n.bufferView!==void 0?i.push(this.getDependency("bufferView",n.bufferView)):i.push(null),n.sparse!==void 0&&(i.push(this.getDependency("bufferView",n.sparse.indices.bufferView)),i.push(this.getDependency("bufferView",n.sparse.values.bufferView))),Promise.all(i).then(function(o){const s=o[0],r=xn[n.type],p=it[n.componentType],d=p.BYTES_PER_ELEMENT,h=d*r,m=n.byteOffset||0,g=n.bufferView!==void 0?a.bufferViews[n.bufferView].byteStride:void 0,A=n.normalized===!0;let b,f;if(g&&g!==h){const k=Math.floor(m/g),w="InterleavedBuffer:"+n.bufferView+":"+n.componentType+":"+k+":"+n.count;let M=t.cache.get(w);M||(b=new p(s,k*g,n.count*g/d),M=new lo(b,g/d),t.cache.add(w,M)),f=new _o(M,r,m%g/d,A)}else s===null?b=new p(n.count*r):b=new p(s,m,n.count*r),f=new tt(b,r,A);if(n.sparse!==void 0){const k=xn.SCALAR,w=it[n.sparse.indices.componentType],M=n.sparse.indices.byteOffset||0,T=n.sparse.values.byteOffset||0,R=new w(o[1],M,n.sparse.count*k),E=new p(o[2],T,n.sparse.count*r);s!==null&&(f=new tt(f.array.slice(),f.itemSize,f.normalized)),f.normalized=!1;for(let x=0,X=R.length;x<X;x++){const S=R[x];if(f.setX(S,E[x*r]),r>=2&&f.setY(S,E[x*r+1]),r>=3&&f.setZ(S,E[x*r+2]),r>=4&&f.setW(S,E[x*r+3]),r>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}f.normalized=A}return f})}loadTexture(e){const t=this.json,a=this.options,i=t.textures[e].source,o=t.images[i];let s=this.textureLoader;if(o.uri){const r=a.manager.getHandler(o.uri);r!==null&&(s=r)}return this.loadTextureImage(e,i,s)}loadTextureImage(e,t,a){const n=this,i=this.json,o=i.textures[e],s=i.images[t],r=(s.uri||s.bufferView)+":"+o.sampler;if(this.textureCache[r])return this.textureCache[r];const p=this.loadImageSource(t,a).then(function(d){d.flipY=!1,d.name=o.name||s.name||"",d.name===""&&typeof s.uri=="string"&&s.uri.startsWith("data:image/")===!1&&(d.name=s.uri);const m=(i.samplers||{})[o.sampler]||{};return d.magFilter=za[m.magFilter]||Bn,d.minFilter=za[m.minFilter]||$a,d.wrapS=Ca[m.wrapS]||Vt,d.wrapT=Ca[m.wrapT]||Vt,d.generateMipmaps=!d.isCompressedTexture&&d.minFilter!==ei&&d.minFilter!==Bn,n.associations.set(d,{textures:e}),d}).catch(function(){return null});return this.textureCache[r]=p,p}loadImageSource(e,t){const a=this,n=this.json,i=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(h=>h.clone());const o=n.images[e],s=self.URL||self.webkitURL;let r=o.uri||"",p=!1;if(o.bufferView!==void 0)r=a.getDependency("bufferView",o.bufferView).then(function(h){p=!0;const m=new Blob([h],{type:o.mimeType});return r=s.createObjectURL(m),r});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");const d=Promise.resolve(r).then(function(h){return new Promise(function(m,g){let A=m;t.isImageBitmapLoader===!0&&(A=function(b){const f=new ya(b);f.needsUpdate=!0,m(f)}),t.load(at.resolveURL(h,i.path),A,void 0,g)})}).then(function(h){return p===!0&&s.revokeObjectURL(r),Te(h,o),h.userData.mimeType=o.mimeType||vc(o.uri),h}).catch(function(h){throw console.error("THREE.GLTFLoader: Couldn't load texture",r),h});return this.sourceCache[e]=d,d}assignTexture(e,t,a,n){const i=this;return this.getDependency("texture",a.index).then(function(o){if(!o)return null;if(a.texCoord!==void 0&&a.texCoord>0&&(o=o.clone(),o.channel=a.texCoord),i.extensions[I.KHR_TEXTURE_TRANSFORM]){const s=a.extensions!==void 0?a.extensions[I.KHR_TEXTURE_TRANSFORM]:void 0;if(s){const r=i.associations.get(o);o=i.extensions[I.KHR_TEXTURE_TRANSFORM].extendTexture(o,s),i.associations.set(o,r)}}return n!==void 0&&(o.colorSpace=n),e[t]=o,o})}assignFinalMaterial(e){const t=e.geometry;let a=e.material;const n=t.attributes.tangent===void 0,i=t.attributes.color!==void 0,o=t.attributes.normal===void 0;if(e.isPoints){const s="PointsMaterial:"+a.uuid;let r=this.cache.get(s);r||(r=new Je,Tt.prototype.copy.call(r,a),r.color.copy(a.color),r.map=a.map,r.sizeAttenuation=!1,this.cache.add(s,r)),a=r}else if(e.isLine){const s="LineBasicMaterial:"+a.uuid;let r=this.cache.get(s);r||(r=new qt,Tt.prototype.copy.call(r,a),r.color.copy(a.color),r.map=a.map,this.cache.add(s,r)),a=r}if(n||i||o){let s="ClonedMaterial:"+a.uuid+":";n&&(s+="derivative-tangents:"),i&&(s+="vertex-colors:"),o&&(s+="flat-shading:");let r=this.cache.get(s);r||(r=a.clone(),i&&(r.vertexColors=!0),o&&(r.flatShading=!0),n&&(r.normalScale&&(r.normalScale.y*=-1),r.clearcoatNormalScale&&(r.clearcoatNormalScale.y*=-1)),this.cache.add(s,r),this.associations.set(r,this.associations.get(a))),a=r}e.material=a}getMaterialType(){return ti}loadMaterial(e){const t=this,a=this.json,n=this.extensions,i=a.materials[e];let o;const s={},r=i.extensions||{},p=[];if(r[I.KHR_MATERIALS_UNLIT]){const h=n[I.KHR_MATERIALS_UNLIT];o=h.getMaterialType(),p.push(h.extendParams(s,i,t))}else{const h=i.pbrMetallicRoughness||{};if(s.color=new pe(1,1,1),s.opacity=1,Array.isArray(h.baseColorFactor)){const m=h.baseColorFactor;s.color.setRGB(m[0],m[1],m[2],_e),s.opacity=m[3]}h.baseColorTexture!==void 0&&p.push(t.assignTexture(s,"map",h.baseColorTexture,ne)),s.metalness=h.metallicFactor!==void 0?h.metallicFactor:1,s.roughness=h.roughnessFactor!==void 0?h.roughnessFactor:1,h.metallicRoughnessTexture!==void 0&&(p.push(t.assignTexture(s,"metalnessMap",h.metallicRoughnessTexture)),p.push(t.assignTexture(s,"roughnessMap",h.metallicRoughnessTexture))),o=this._invokeOne(function(m){return m.getMaterialType&&m.getMaterialType(e)}),p.push(Promise.all(this._invokeAll(function(m){return m.extendMaterialParams&&m.extendMaterialParams(e,s)})))}i.doubleSided===!0&&(s.side=ni);const d=i.alphaMode||En.OPAQUE;if(d===En.BLEND?(s.transparent=!0,s.depthWrite=!1):(s.transparent=!1,d===En.MASK&&(s.alphaTest=i.alphaCutoff!==void 0?i.alphaCutoff:.5)),i.normalTexture!==void 0&&o!==$e&&(p.push(t.assignTexture(s,"normalMap",i.normalTexture)),s.normalScale=new te(1,1),i.normalTexture.scale!==void 0)){const h=i.normalTexture.scale;s.normalScale.set(h,h)}if(i.occlusionTexture!==void 0&&o!==$e&&(p.push(t.assignTexture(s,"aoMap",i.occlusionTexture)),i.occlusionTexture.strength!==void 0&&(s.aoMapIntensity=i.occlusionTexture.strength)),i.emissiveFactor!==void 0&&o!==$e){const h=i.emissiveFactor;s.emissive=new pe().setRGB(h[0],h[1],h[2],_e)}return i.emissiveTexture!==void 0&&o!==$e&&p.push(t.assignTexture(s,"emissiveMap",i.emissiveTexture,ne)),Promise.all(p).then(function(){const h=new o(s);return i.name&&(h.name=i.name),Te(h,i),t.associations.set(h,{materials:e}),i.extensions&&je(n,h,i),h})}createUniqueName(e){const t=go.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){const t=this,a=this.extensions,n=this.primitiveCache;function i(s){return a[I.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(s,t).then(function(r){return Ia(r,s,t)})}const o=[];for(let s=0,r=e.length;s<r;s++){const p=e[s],d=bc(p),h=n[d];if(h)o.push(h.promise);else{let m;p.extensions&&p.extensions[I.KHR_DRACO_MESH_COMPRESSION]?m=i(p):m=Ia(new Et,p,t),n[d]={primitive:p,promise:m},o.push(m)}}return Promise.all(o)}loadMesh(e){const t=this,a=this.json,n=this.extensions,i=a.meshes[e],o=i.primitives,s=[];for(let r=0,p=o.length;r<p;r++){const d=o[r].material===void 0?gc(this.cache):this.getDependency("material",o[r].material);s.push(d)}return s.push(t.loadGeometries(o)),Promise.all(s).then(function(r){const p=r.slice(0,r.length-1),d=r[r.length-1],h=[];for(let g=0,A=d.length;g<A;g++){const b=d[g],f=o[g];let k;const w=p[g];if(f.mode===me.TRIANGLES||f.mode===me.TRIANGLE_STRIP||f.mode===me.TRIANGLE_FAN||f.mode===void 0)k=i.isSkinnedMesh===!0?new Ao(b,w):new Wt(b,w),k.isSkinnedMesh===!0&&k.normalizeSkinWeights(),f.mode===me.TRIANGLE_STRIP?k.geometry=Sa(k.geometry,Xa):f.mode===me.TRIANGLE_FAN&&(k.geometry=Sa(k.geometry,Dn));else if(f.mode===me.LINES)k=new Rn(b,w);else if(f.mode===me.LINE_STRIP)k=new fo(b,w);else if(f.mode===me.LINE_LOOP)k=new bo(b,w);else if(f.mode===me.POINTS)k=new _t(b,w);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+f.mode);Object.keys(k.geometry.morphAttributes).length>0&&fc(k,i),k.name=t.createUniqueName(i.name||"mesh_"+e),Te(k,i),f.extensions&&je(n,k,f),t.assignFinalMaterial(k),h.push(k)}for(let g=0,A=h.length;g<A;g++)t.associations.set(h[g],{meshes:e,primitives:g});if(h.length===1)return i.extensions&&je(n,h[0],i),h[0];const m=new xt;i.extensions&&je(n,m,i),t.associations.set(m,{meshes:e});for(let g=0,A=h.length;g<A;g++)m.add(h[g]);return m})}loadCamera(e){let t;const a=this.json.cameras[e],n=a[a.type];if(!n){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return a.type==="perspective"?t=new On(Ya.radToDeg(n.yfov),n.aspectRatio||1,n.znear||1,n.zfar||2e6):a.type==="orthographic"&&(t=new vo(-n.xmag,n.xmag,n.ymag,-n.ymag,n.znear,n.zfar)),a.name&&(t.name=this.createUniqueName(a.name)),Te(t,a),Promise.resolve(t)}loadSkin(e){const t=this.json.skins[e],a=[];for(let n=0,i=t.joints.length;n<i;n++)a.push(this._loadNodeShallow(t.joints[n]));return t.inverseBindMatrices!==void 0?a.push(this.getDependency("accessor",t.inverseBindMatrices)):a.push(null),Promise.all(a).then(function(n){const i=n.pop(),o=n,s=[],r=[];for(let p=0,d=o.length;p<d;p++){const h=o[p];if(h){s.push(h);const m=new rt;i!==null&&m.fromArray(i.array,p*16),r.push(m)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[p])}return new ko(s,r)})}loadAnimation(e){const t=this.json,a=this,n=t.animations[e],i=n.name?n.name:"animation_"+e,o=[],s=[],r=[],p=[],d=[];for(let h=0,m=n.channels.length;h<m;h++){const g=n.channels[h],A=n.samplers[g.sampler],b=g.target,f=b.node,k=n.parameters!==void 0?n.parameters[A.input]:A.input,w=n.parameters!==void 0?n.parameters[A.output]:A.output;b.node!==void 0&&(o.push(this.getDependency("node",f)),s.push(this.getDependency("accessor",k)),r.push(this.getDependency("accessor",w)),p.push(A),d.push(b))}return Promise.all([Promise.all(o),Promise.all(s),Promise.all(r),Promise.all(p),Promise.all(d)]).then(function(h){const m=h[0],g=h[1],A=h[2],b=h[3],f=h[4],k=[];for(let M=0,T=m.length;M<T;M++){const R=m[M],E=g[M],x=A[M],X=b[M],S=f[M];if(R===void 0)continue;R.updateMatrix&&R.updateMatrix();const L=a._createAnimationTracks(R,E,x,X,S);if(L)for(let P=0;P<L.length;P++)k.push(L[P])}const w=new wo(i,void 0,k);return Te(w,n),w})}createNodeMesh(e){const t=this.json,a=this,n=t.nodes[e];return n.mesh===void 0?null:a.getDependency("mesh",n.mesh).then(function(i){const o=a._getNodeRef(a.meshCache,n.mesh,i);return n.weights!==void 0&&o.traverse(function(s){if(s.isMesh)for(let r=0,p=n.weights.length;r<p;r++)s.morphTargetInfluences[r]=n.weights[r]}),o})}loadNode(e){const t=this.json,a=this,n=t.nodes[e],i=a._loadNodeShallow(e),o=[],s=n.children||[];for(let p=0,d=s.length;p<d;p++)o.push(a.getDependency("node",s[p]));const r=n.skin===void 0?Promise.resolve(null):a.getDependency("skin",n.skin);return Promise.all([i,Promise.all(o),r]).then(function(p){const d=p[0],h=p[1],m=p[2];m!==null&&d.traverse(function(g){g.isSkinnedMesh&&g.bind(m,kc)});for(let g=0,A=h.length;g<A;g++)d.add(h[g]);return d})}_loadNodeShallow(e){const t=this.json,a=this.extensions,n=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];const i=t.nodes[e],o=i.name?n.createUniqueName(i.name):"",s=[],r=n._invokeOne(function(p){return p.createNodeMesh&&p.createNodeMesh(e)});return r&&s.push(r),i.camera!==void 0&&s.push(n.getDependency("camera",i.camera).then(function(p){return n._getNodeRef(n.cameraCache,i.camera,p)})),n._invokeAll(function(p){return p.createNodeAttachment&&p.createNodeAttachment(e)}).forEach(function(p){s.push(p)}),this.nodeCache[e]=Promise.all(s).then(function(p){let d;if(i.isBone===!0?d=new yo:p.length>1?d=new xt:p.length===1?d=p[0]:d=new Gn,d!==p[0])for(let h=0,m=p.length;h<m;h++)d.add(p[h]);if(i.name&&(d.userData.name=i.name,d.name=o),Te(d,i),i.extensions&&je(a,d,i),i.matrix!==void 0){const h=new rt;h.fromArray(i.matrix),d.applyMatrix4(h)}else i.translation!==void 0&&d.position.fromArray(i.translation),i.rotation!==void 0&&d.quaternion.fromArray(i.rotation),i.scale!==void 0&&d.scale.fromArray(i.scale);if(!n.associations.has(d))n.associations.set(d,{});else if(i.mesh!==void 0&&n.meshCache.refs[i.mesh]>1){const h=n.associations.get(d);n.associations.set(d,{...h})}return n.associations.get(d).nodes=e,d}),this.nodeCache[e]}loadScene(e){const t=this.extensions,a=this.json.scenes[e],n=this,i=new xt;a.name&&(i.name=n.createUniqueName(a.name)),Te(i,a),a.extensions&&je(t,i,a);const o=a.nodes||[],s=[];for(let r=0,p=o.length;r<p;r++)s.push(n.getDependency("node",o[r]));return Promise.all(s).then(function(r){for(let d=0,h=r.length;d<h;d++)i.add(r[d]);const p=d=>{const h=new Map;for(const[m,g]of n.associations)(m instanceof Tt||m instanceof ya)&&h.set(m,g);return d.traverse(m=>{const g=n.associations.get(m);g!=null&&h.set(m,g)}),h};return n.associations=p(i),i})}_createAnimationTracks(e,t,a,n,i){const o=[],s=e.name?e.name:e.uuid,r=[];Ie[i.path]===Ie.weights?e.traverse(function(m){m.morphTargetInfluences&&r.push(m.name?m.name:m.uuid)}):r.push(s);let p;switch(Ie[i.path]){case Ie.weights:p=_a;break;case Ie.rotation:p=xa;break;case Ie.translation:case Ie.scale:p=Ta;break;default:a.itemSize===1?p=_a:p=Ta;break}const d=n.interpolation!==void 0?uc[n.interpolation]:ai,h=this._getArrayFromAccessor(a);for(let m=0,g=r.length;m<g;m++){const A=new p(r[m]+"."+Ie[i.path],t.array,h,d);n.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(A),o.push(A)}return o}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){const a=Fn(t.constructor),n=new Float32Array(t.length);for(let i=0,o=t.length;i<o;i++)n[i]=t[i]*a;t=n}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(a){const n=this instanceof xa?mc:pi;return new n(this.times,this.values,this.getValueSize()/3,a)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function yc(c,e,t){const a=e.attributes,n=new Hn;if(a.POSITION!==void 0){const s=t.json.accessors[a.POSITION],r=s.min,p=s.max;if(r!==void 0&&p!==void 0){if(n.set(new F(r[0],r[1],r[2]),new F(p[0],p[1],p[2])),s.normalized){const d=Fn(it[s.componentType]);n.min.multiplyScalar(d),n.max.multiplyScalar(d)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const i=e.targets;if(i!==void 0){const s=new F,r=new F;for(let p=0,d=i.length;p<d;p++){const h=i[p];if(h.POSITION!==void 0){const m=t.json.accessors[h.POSITION],g=m.min,A=m.max;if(g!==void 0&&A!==void 0){if(r.setX(Math.max(Math.abs(g[0]),Math.abs(A[0]))),r.setY(Math.max(Math.abs(g[1]),Math.abs(A[1]))),r.setZ(Math.max(Math.abs(g[2]),Math.abs(A[2]))),m.normalized){const b=Fn(it[m.componentType]);r.multiplyScalar(b)}s.max(r)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}n.expandByVector(s)}c.boundingBox=n;const o=new Eo;n.getCenter(o.center),o.radius=n.min.distanceTo(n.max)/2,c.boundingSphere=o}function Ia(c,e,t){const a=e.attributes,n=[];function i(o,s){return t.getDependency("accessor",o).then(function(r){c.setAttribute(s,r)})}for(const o in a){const s=Pn[o]||o.toLowerCase();s in c.attributes||n.push(i(a[o],s))}if(e.indices!==void 0&&!c.index){const o=t.getDependency("accessor",e.indices).then(function(s){c.setIndex(s)});n.push(o)}return nt.workingColorSpace!==_e&&"COLOR_0"in a&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${nt.workingColorSpace}" not supported.`),Te(c,e),yc(c,e,t),Promise.all(n).then(function(){return e.targets!==void 0?Ac(c,e.targets,t):c})}class Tc extends Xt{constructor(e){super(e)}load(e,t,a,n){const i=this,o=this.path===""?at.extractUrlBase(e):this.path,s=new ot(this.manager);s.setPath(this.path),s.setRequestHeader(this.requestHeader),s.setWithCredentials(this.withCredentials),s.load(e,function(r){try{t(i.parse(r,o))}catch(p){n?n(p):console.error(p),i.manager.itemError(e)}},a,n)}setMaterialOptions(e){return this.materialOptions=e,this}parse(e,t){const a=e.split(`
`);let n={};const i=/\s+/,o={};for(let r=0;r<a.length;r++){let p=a[r];if(p=p.trim(),p.length===0||p.charAt(0)==="#")continue;const d=p.indexOf(" ");let h=d>=0?p.substring(0,d):p;h=h.toLowerCase();let m=d>=0?p.substring(d+1):"";if(m=m.trim(),h==="newmtl")n={name:m},o[m]=n;else if(h==="ka"||h==="kd"||h==="ks"||h==="ke"){const g=m.split(i,3);n[h]=[parseFloat(g[0]),parseFloat(g[1]),parseFloat(g[2])]}else n[h]=m}const s=new _c(this.resourcePath||t,this.materialOptions);return s.setCrossOrigin(this.crossOrigin),s.setManager(this.manager),s.setMaterials(o),s}}class _c{constructor(e="",t={}){this.baseUrl=e,this.options=t,this.materialsInfo={},this.materials={},this.materialsArray=[],this.nameLookup={},this.crossOrigin="anonymous",this.side=this.options.side!==void 0?this.options.side:ii,this.wrap=this.options.wrap!==void 0?this.options.wrap:Vt}setCrossOrigin(e){return this.crossOrigin=e,this}setManager(e){this.manager=e}setMaterials(e){this.materialsInfo=this.convert(e),this.materials={},this.materialsArray=[],this.nameLookup={}}convert(e){if(!this.options)return e;const t={};for(const a in e){const n=e[a],i={};t[a]=i;for(const o in n){let s=!0,r=n[o];const p=o.toLowerCase();switch(p){case"kd":case"ka":case"ks":this.options&&this.options.normalizeRGB&&(r=[r[0]/255,r[1]/255,r[2]/255]),this.options&&this.options.ignoreZeroRGBs&&r[0]===0&&r[1]===0&&r[2]===0&&(s=!1);break}s&&(i[p]=r)}}return t}preload(){for(const e in this.materialsInfo)this.create(e)}getIndex(e){return this.nameLookup[e]}getAsArray(){let e=0;for(const t in this.materialsInfo)this.materialsArray[e]=this.create(t),this.nameLookup[t]=e,e++;return this.materialsArray}create(e){return this.materials[e]===void 0&&this.createMaterial_(e),this.materials[e]}createMaterial_(e){const t=this,a=this.materialsInfo[e],n={name:e,side:this.side};function i(s,r){return typeof r!="string"||r===""?"":/^https?:\/\//i.test(r)?r:s+r}function o(s,r){if(n[s])return;const p=t.getTextureParams(r,n),d=t.loadTexture(i(t.baseUrl,p.url));d.repeat.copy(p.scale),d.offset.copy(p.offset),d.wrapS=t.wrap,d.wrapT=t.wrap,(s==="map"||s==="emissiveMap")&&(d.colorSpace=ne),n[s]=d}for(const s in a){const r=a[s];let p;if(r!=="")switch(s.toLowerCase()){case"kd":n.color=nt.colorSpaceToWorking(new pe().fromArray(r),ne);break;case"ks":n.specular=nt.colorSpaceToWorking(new pe().fromArray(r),ne);break;case"ke":n.emissive=nt.colorSpaceToWorking(new pe().fromArray(r),ne);break;case"map_kd":o("map",r);break;case"map_ks":o("specularMap",r);break;case"map_ke":o("emissiveMap",r);break;case"norm":o("normalMap",r);break;case"map_bump":case"bump":o("bumpMap",r);break;case"disp":o("displacementMap",r);break;case"map_d":o("alphaMap",r),n.transparent=!0;break;case"ns":n.shininess=parseFloat(r);break;case"d":p=parseFloat(r),p<1&&(n.opacity=p,n.transparent=!0);break;case"tr":p=parseFloat(r),this.options&&this.options.invertTrProperty&&(p=1-p),p>0&&(n.opacity=1-p,n.transparent=!0);break}}return this.materials[e]=new oi(n),this.materials[e]}getTextureParams(e,t){const a={scale:new te(1,1),offset:new te(0,0)},n=e.split(/\s+/);let i;return i=n.indexOf("-bm"),i>=0&&(t.bumpScale=parseFloat(n[i+1]),n.splice(i,2)),i=n.indexOf("-mm"),i>=0&&(t.displacementBias=parseFloat(n[i+1]),t.displacementScale=parseFloat(n[i+2]),n.splice(i,3)),i=n.indexOf("-s"),i>=0&&(a.scale.set(parseFloat(n[i+1]),parseFloat(n[i+2])),n.splice(i,4)),i=n.indexOf("-o"),i>=0&&(a.offset.set(parseFloat(n[i+1]),parseFloat(n[i+2])),n.splice(i,4)),a.url=n.join(" ").trim(),a}loadTexture(e,t,a,n,i){const o=this.manager!==void 0?this.manager:Mo;let s=o.getHandler(e);s===null&&(s=new Ja(o)),s.setCrossOrigin&&s.setCrossOrigin(this.crossOrigin);const r=s.load(e,a,n,i);return t!==void 0&&(r.mapping=t),r}}const xc=/^[og]\s*(.+)?/,Ec=/^mtllib /,Mc=/^usemtl /,Sc=/^usemap /,Da=/\s+/,Za=new F,Sn=new F,Ba=new F,Ra=new F,de=new F,Ht=new pe;function Lc(){const c={objects:[],object:{},vertices:[],normals:[],colors:[],uvs:[],materials:{},materialLibraries:[],startObject:function(e,t){if(this.object&&this.object.fromDeclaration===!1){this.object.name=e,this.object.fromDeclaration=t!==!1;return}const a=this.object&&typeof this.object.currentMaterial=="function"?this.object.currentMaterial():void 0;if(this.object&&typeof this.object._finalize=="function"&&this.object._finalize(!0),this.object={name:e||"",fromDeclaration:t!==!1,geometry:{vertices:[],normals:[],colors:[],uvs:[],hasUVIndices:!1},materials:[],smooth:!0,startMaterial:function(n,i){const o=this._finalize(!1);o&&(o.inherited||o.groupCount<=0)&&this.materials.splice(o.index,1);const s={index:this.materials.length,name:n||"",mtllib:Array.isArray(i)&&i.length>0?i[i.length-1]:"",smooth:o!==void 0?o.smooth:this.smooth,groupStart:o!==void 0?o.groupEnd:0,groupEnd:-1,groupCount:-1,inherited:!1,clone:function(r){const p={index:typeof r=="number"?r:this.index,name:this.name,mtllib:this.mtllib,smooth:this.smooth,groupStart:0,groupEnd:-1,groupCount:-1,inherited:!1};return p.clone=this.clone.bind(p),p}};return this.materials.push(s),s},currentMaterial:function(){if(this.materials.length>0)return this.materials[this.materials.length-1]},_finalize:function(n){const i=this.currentMaterial();if(i&&i.groupEnd===-1&&(i.groupEnd=this.geometry.vertices.length/3,i.groupCount=i.groupEnd-i.groupStart,i.inherited=!1),n&&this.materials.length>1)for(let o=this.materials.length-1;o>=0;o--)this.materials[o].groupCount<=0&&this.materials.splice(o,1);return n&&this.materials.length===0&&this.materials.push({name:"",smooth:this.smooth}),i}},a&&a.name&&typeof a.clone=="function"){const n=a.clone(0);n.inherited=!0,this.object.materials.push(n)}this.objects.push(this.object)},finalize:function(){this.object&&typeof this.object._finalize=="function"&&this.object._finalize(!0)},parseVertexIndex:function(e,t){const a=parseInt(e,10);return(a>=0?a-1:a+t/3)*3},parseNormalIndex:function(e,t){const a=parseInt(e,10);return(a>=0?a-1:a+t/3)*3},parseUVIndex:function(e,t){const a=parseInt(e,10);return(a>=0?a-1:a+t/2)*2},addVertex:function(e,t,a){const n=this.vertices,i=this.object.geometry.vertices;i.push(n[e+0],n[e+1],n[e+2]),i.push(n[t+0],n[t+1],n[t+2]),i.push(n[a+0],n[a+1],n[a+2])},addVertexPoint:function(e){const t=this.vertices;this.object.geometry.vertices.push(t[e+0],t[e+1],t[e+2])},addVertexLine:function(e){const t=this.vertices;this.object.geometry.vertices.push(t[e+0],t[e+1],t[e+2])},addNormal:function(e,t,a){const n=this.normals,i=this.object.geometry.normals;i.push(n[e+0],n[e+1],n[e+2]),i.push(n[t+0],n[t+1],n[t+2]),i.push(n[a+0],n[a+1],n[a+2])},addFaceNormal:function(e,t,a){const n=this.vertices,i=this.object.geometry.normals;Za.fromArray(n,e),Sn.fromArray(n,t),Ba.fromArray(n,a),de.subVectors(Ba,Sn),Ra.subVectors(Za,Sn),de.cross(Ra),de.normalize(),i.push(de.x,de.y,de.z),i.push(de.x,de.y,de.z),i.push(de.x,de.y,de.z)},addColor:function(e,t,a){const n=this.colors,i=this.object.geometry.colors;n[e]!==void 0&&i.push(n[e+0],n[e+1],n[e+2]),n[t]!==void 0&&i.push(n[t+0],n[t+1],n[t+2]),n[a]!==void 0&&i.push(n[a+0],n[a+1],n[a+2])},addUV:function(e,t,a){const n=this.uvs,i=this.object.geometry.uvs;i.push(n[e+0],n[e+1]),i.push(n[t+0],n[t+1]),i.push(n[a+0],n[a+1])},addDefaultUV:function(){const e=this.object.geometry.uvs;e.push(0,0),e.push(0,0),e.push(0,0)},addUVLine:function(e){const t=this.uvs;this.object.geometry.uvs.push(t[e+0],t[e+1])},addFace:function(e,t,a,n,i,o,s,r,p){const d=this.vertices.length;let h=this.parseVertexIndex(e,d),m=this.parseVertexIndex(t,d),g=this.parseVertexIndex(a,d);if(this.addVertex(h,m,g),this.addColor(h,m,g),s!==void 0&&s!==""){const A=this.normals.length;h=this.parseNormalIndex(s,A),m=this.parseNormalIndex(r,A),g=this.parseNormalIndex(p,A),this.addNormal(h,m,g)}else this.addFaceNormal(h,m,g);if(n!==void 0&&n!==""){const A=this.uvs.length;h=this.parseUVIndex(n,A),m=this.parseUVIndex(i,A),g=this.parseUVIndex(o,A),this.addUV(h,m,g),this.object.geometry.hasUVIndices=!0}else this.addDefaultUV()},addPointGeometry:function(e){this.object.geometry.type="Points";const t=this.vertices.length;for(let a=0,n=e.length;a<n;a++){const i=this.parseVertexIndex(e[a],t);this.addVertexPoint(i),this.addColor(i)}},addLineGeometry:function(e,t){this.object.geometry.type="Line";const a=this.vertices.length,n=this.uvs.length;for(let i=0,o=e.length;i<o;i++)this.addVertexLine(this.parseVertexIndex(e[i],a));for(let i=0,o=t.length;i<o;i++)this.addUVLine(this.parseUVIndex(t[i],n))}};return c.startObject("",!1),c}class zc extends Xt{constructor(e){super(e),this.materials=null}load(e,t,a,n){const i=this,o=new ot(this.manager);o.setPath(this.path),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(e,function(s){try{t(i.parse(s))}catch(r){n?n(r):console.error(r),i.manager.itemError(e)}},a,n)}setMaterials(e){return this.materials=e,this}parse(e){const t=new Lc;e.indexOf(`\r
`)!==-1&&(e=e.replace(/\r\n/g,`
`)),e.indexOf(`\\
`)!==-1&&(e=e.replace(/\\\n/g,""));const a=e.split(`
`);let n=[];for(let s=0,r=a.length;s<r;s++){const p=a[s].trimStart();if(p.length===0)continue;const d=p.charAt(0);if(d!=="#")if(d==="v"){const h=p.split(Da);switch(h[0]){case"v":t.vertices.push(parseFloat(h[1]),parseFloat(h[2]),parseFloat(h[3])),h.length>=7?(Ht.setRGB(parseFloat(h[4]),parseFloat(h[5]),parseFloat(h[6]),ne),t.colors.push(Ht.r,Ht.g,Ht.b)):t.colors.push(void 0,void 0,void 0);break;case"vn":t.normals.push(parseFloat(h[1]),parseFloat(h[2]),parseFloat(h[3]));break;case"vt":t.uvs.push(parseFloat(h[1]),parseFloat(h[2]));break}}else if(d==="f"){const m=p.slice(1).trim().split(Da),g=[];for(let b=0,f=m.length;b<f;b++){const k=m[b];if(k.length>0){const w=k.split("/");g.push(w)}}const A=g[0];for(let b=1,f=g.length-1;b<f;b++){const k=g[b],w=g[b+1];t.addFace(A[0],k[0],w[0],A[1],k[1],w[1],A[2],k[2],w[2])}}else if(d==="l"){const h=p.substring(1).trim().split(" ");let m=[];const g=[];if(p.indexOf("/")===-1)m=h;else for(let A=0,b=h.length;A<b;A++){const f=h[A].split("/");f[0]!==""&&m.push(f[0]),f[1]!==""&&g.push(f[1])}t.addLineGeometry(m,g)}else if(d==="p"){const m=p.slice(1).trim().split(" ");t.addPointGeometry(m)}else if((n=xc.exec(p))!==null){const h=(" "+n[0].slice(1).trim()).slice(1);t.startObject(h)}else if(Mc.test(p))t.object.startMaterial(p.substring(7).trim(),t.materialLibraries);else if(Ec.test(p))t.materialLibraries.push(p.substring(7).trim());else if(Sc.test(p))console.warn('THREE.OBJLoader: Rendering identifier "usemap" not supported. Textures must be defined in MTL files.');else if(d==="s"){if(n=p.split(" "),n.length>1){const m=n[1].trim().toLowerCase();t.object.smooth=m!=="0"&&m!=="off"}else t.object.smooth=!0;const h=t.object.currentMaterial();h&&(h.smooth=t.object.smooth)}else{if(p==="\0")continue;console.warn('THREE.OBJLoader: Unexpected line: "'+p+'"')}}t.finalize();const i=new xt;if(i.materialLibraries=[].concat(t.materialLibraries),!(t.objects.length===1&&t.objects[0].geometry.vertices.length===0)===!0)for(let s=0,r=t.objects.length;s<r;s++){const p=t.objects[s],d=p.geometry,h=p.materials,m=d.type==="Line",g=d.type==="Points";let A=!1;if(d.vertices.length===0)continue;const b=new Et;b.setAttribute("position",new We(d.vertices,3)),d.normals.length>0&&b.setAttribute("normal",new We(d.normals,3)),d.colors.length>0&&(A=!0,b.setAttribute("color",new We(d.colors,3))),d.hasUVIndices===!0&&b.setAttribute("uv",new We(d.uvs,2));const f=[];for(let w=0,M=h.length;w<M;w++){const T=h[w],R=T.name+"_"+T.smooth+"_"+A;let E=t.materials[R];if(this.materials!==null){if(E=this.materials.create(T.name),m&&E&&!(E instanceof qt)){const x=new qt;Tt.prototype.copy.call(x,E),x.color.copy(E.color),E=x}else if(g&&E&&!(E instanceof Je)){const x=new Je({size:10,sizeAttenuation:!1});Tt.prototype.copy.call(x,E),x.color.copy(E.color),x.map=E.map,E=x}}E===void 0&&(m?E=new qt:g?E=new Je({size:1,sizeAttenuation:!1}):E=new oi,E.name=T.name,E.flatShading=!T.smooth,E.vertexColors=A,t.materials[R]=E),f.push(E)}let k;if(f.length>1){for(let w=0,M=h.length;w<M;w++){const T=h[w];b.addGroup(T.groupStart,T.groupCount,w)}m?k=new Rn(b,f):g?k=new _t(b,f):k=new Wt(b,f)}else m?k=new Rn(b,f[0]):g?k=new _t(b,f[0]):k=new Wt(b,f[0]);k.name=p.name,i.add(k)}else if(t.vertices.length>0){const s=new Je({size:1,sizeAttenuation:!1}),r=new Et;r.setAttribute("position",new We(t.vertices,3)),t.colors.length>0&&t.colors[0]!==void 0&&(r.setAttribute("color",new We(t.colors,3)),s.vertexColors=!0);const p=new _t(r,s);i.add(p)}return i}}const Qn=new jl;Qn.setDecoderPath("/experiencing/draco/gltf/");Qn.setDecoderConfig({type:"wasm"});const hi=new Ol;hi.setDRACOLoader(Qn);function Cc(c){return/^(https?:|blob:|data:)/i.test(c)?c:new URL(c,window.location.href).href}function Ic(c,e){return c.replace(/^((?:map_Kd|map_Ka|map_Ks|map_Bump|map_d|bump|norm|map_ao|disp)\s+)(.+)$/gim,(t,a,n)=>{const i=String(n).trim().replace(/\\/g,"/"),o=i.split("/").pop()??i,s=e[i]??e[o];return s?`${a}${Cc(s)}`:(console.warn("OBJ texture missing from map:",i),t)})}async function Dc(c,e,t){const a=new zc;if(e){const n=await fetch(e).then(s=>{if(!s.ok)throw new Error(`MTL ${s.status}`);return s.text()}),i=Ic(n,t),o=URL.createObjectURL(new Blob([i],{type:"text/plain"}));try{const r=await new Tc().loadAsync(o);r.baseUrl="",r.preload(),a.setMaterials(r)}finally{URL.revokeObjectURL(o)}}return a.loadAsync(c)}async function Zc(c){return(await hi.loadAsync(c)).scene}function Bc(c,e){const{format:t="obj",mtlUrl:a=null,textureMap:n={},label:i="Modello 3D"}=e,o=e.url??e.objUrl;if(!o)return console.warn("3D viewer: missing url",i),()=>{};const s=document.createElement("div");s.className="story-obj",s.setAttribute("role","img"),s.setAttribute("aria-label",i);const r=document.createElement("canvas");r.className="story-obj-canvas",s.appendChild(r);const p=document.createElement("span");p.className="story-obj-status",p.textContent="3D…",s.appendChild(p),c.appendChild(s);const d=new ri({canvas:r,antialias:!0,alpha:!0,powerPreference:"default"});d.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),d.setClearColor(0,0),d.outputColorSpace=ne;const h=new si,m=new On(35,1,.01,100);m.position.set(.45,.35,.7);const g=new Ml(m,r);g.enableDamping=!0,g.dampingFactor=.08,g.enableZoom=!1,g.enablePan=!1,g.rotateSpeed=.9,h.add(new So(16777215,.75));const A=new Zn(16777215,1.05);A.position.set(2.2,3.4,1.6),h.add(A);const b=new Zn(14544639,.45);b.position.set(-2.4,.8,-1.2),h.add(b);let f=0,k=!1,w=null;const M=S=>{const L=new Hn().setFromObject(S),P=L.getSize(new F),B=L.getCenter(new F);S.position.sub(B);const ae=Math.max(P.x,P.y,P.z,.001)*1.85;m.near=Math.max(.001,ae/100),m.far=ae*40,m.position.set(ae*.55,ae*.4,ae*.85),m.lookAt(0,0,0),g.target.set(0,0,0),g.update(),m.updateProjectionMatrix()},T=()=>{const S=Math.max(1,s.clientWidth),L=Math.max(1,s.clientHeight);d.setSize(S,L,!1),m.aspect=S/L,m.updateProjectionMatrix()},R=()=>{k||(f=requestAnimationFrame(R),g.update(),d.render(h,m))},E=S=>{S.stopPropagation()};r.addEventListener("pointerdown",E);const x=new ResizeObserver(T);return x.observe(s),T(),R(),(t==="glb"?Zc(o):Dc(o,a,n)).then(S=>{k||(w=S,S.traverse(L=>{if(L.isMesh){L.castShadow=!1,L.receiveShadow=!1;const P=Array.isArray(L.material)?L.material:[L.material];for(const B of P)if(B&&(B.side=ni,"map"in B&&B.map&&(B.map.colorSpace=ne),"emissive"in B)){const H=B.color?.clone?.()??new pe(16777215);B.emissive.copy(H),B.emissiveIntensity=t==="glb"?.85:.35,B.map&&"emissiveMap"in B&&!B.emissiveMap&&(B.emissiveMap=B.map),B.needsUpdate=!0}}}),h.add(S),M(S),p.remove())}).catch(S=>{console.warn("3D load failed:",i,S),p.textContent="3D n/d"}),()=>{k=!0,cancelAnimationFrame(f),x.disconnect(),r.removeEventListener("pointerdown",E),g.dispose(),w&&(w.traverse(S=>{if(S.isMesh){S.geometry?.dispose?.();const L=Array.isArray(S.material)?S.material:[S.material];for(const P of L)if(P){for(const B of Object.keys(P)){const H=P[B];H&&H.isTexture&&H.dispose()}P.dispose?.()}}}),h.remove(w)),d.dispose(),s.remove()}}class Rc extends Gn{constructor(e=document.createElement("div")){super(),this.isCSS2DObject=!0,this.element=e,this.element.style.position="absolute",this.element.style.userSelect="none",this.element.setAttribute("draggable",!1),this.center=new te(.5,.5),this.addEventListener("removed",function(){this.traverse(function(t){t.element instanceof t.element.ownerDocument.defaultView.Element&&t.element.parentNode!==null&&t.element.remove()})})}copy(e,t){return super.copy(e,t),this.element=e.element.cloneNode(!0),this.center=e.center,this}}const Ye=new F,Pa=new rt,Fa=new rt,Na=new F,ja=new F;class Pc{constructor(e={}){const t=this;let a,n,i,o;const s={objects:new WeakMap},r=e.element!==void 0?e.element:document.createElement("div");r.style.overflow="hidden",this.domElement=r,this.getSize=function(){return{width:a,height:n}},this.render=function(A,b){A.matrixWorldAutoUpdate===!0&&A.updateMatrixWorld(),b.parent===null&&b.matrixWorldAutoUpdate===!0&&b.updateMatrixWorld(),Pa.copy(b.matrixWorldInverse),Fa.multiplyMatrices(b.projectionMatrix,Pa),d(A,A,b),g(A)},this.setSize=function(A,b){a=A,n=b,i=a/2,o=n/2,r.style.width=A+"px",r.style.height=b+"px"};function p(A){A.isCSS2DObject&&(A.element.style.display="none");for(let b=0,f=A.children.length;b<f;b++)p(A.children[b])}function d(A,b,f){if(A.visible===!1){p(A);return}if(A.isCSS2DObject){Ye.setFromMatrixPosition(A.matrixWorld),Ye.applyMatrix4(Fa);const k=Ye.z>=-1&&Ye.z<=1&&A.layers.test(f.layers)===!0,w=A.element;w.style.display=k===!0?"":"none",k===!0&&(A.onBeforeRender(t,b,f),w.style.transform="translate("+-100*A.center.x+"%,"+-100*A.center.y+"%)translate("+(Ye.x*i+i)+"px,"+(-Ye.y*o+o)+"px)",w.parentNode!==r&&r.appendChild(w),A.onAfterRender(t,b,f));const M={distanceToCameraSquared:h(f,A)};s.objects.set(A,M)}for(let k=0,w=A.children.length;k<w;k++)d(A.children[k],b,f)}function h(A,b){return Na.setFromMatrixPosition(A.matrixWorld),ja.setFromMatrixPosition(b.matrixWorld),Na.distanceToSquared(ja)}function m(A){const b=[];return A.traverseVisible(function(f){f.isCSS2DObject&&b.push(f)}),b}function g(A){const b=m(A).sort(function(k,w){if(k.renderOrder!==w.renderOrder)return w.renderOrder-k.renderOrder;const M=s.objects.get(k).distanceToCameraSquared,T=s.objects.get(w).distanceToCameraSquared;return M-T}),f=b.length;for(let k=0,w=b.length;k<w;k++)b[k].element.style.zIndex=f-k}}}const Fc=`<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Wikiloc - https://www.wikiloc.com" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Wikiloc - Pian Falzarego - Forcella Lagazuoi - Baracca ufficiali austriaci - Rifugio Lagazuoi</name>
    <author>
      <name>Giulio Favotto</name>
      <link href="https://www.wikiloc.com/wikiloc/user.do?id=23150823">
        <text>Giulio Favotto on Wikiloc</text>
      </link>
    </author>
    <link href="https://www.wikiloc.com/hiking-trails/pian-falzarego-forcella-lagazuoi-baracca-ufficiali-austriaci-rifugio-lagazuoi-289041552">
      <text>Pian Falzarego - Forcella Lagazuoi - Baracca ufficiali austriaci - Rifugio Lagazuoi on Wikiloc</text>
    </link>
    <time>2026-10-02T15:14:42.040Z</time>
  </metadata>
  <trk>
    <name>Pian Falzarego - Forcella Lagazuoi - Baracca ufficiali austriaci - Rifugio Lagazuoi - Wikiloc</name>
    <cmt>Percorso da Pian Falzarego a Rifugio Lagazuoi passando per:
- Forcella Lagazuoi (1.9 km)
- Baracca ufficiali austriaci (2.9 km)</cmt>
    <desc>Percorso da Pian Falzarego a Rifugio Lagazuoi passando per:
- Forcella Lagazuoi (1.9 km)
- Baracca ufficiali austriaci (2.9 km)</desc>
    <trkseg>
      <trkpt lat="46.519974" lon="12.008762">
        <ele>2074.616</ele>
        <time>2026-10-02T12:02:42.001Z</time>
      </trkpt>
      <trkpt lat="46.519962" lon="12.008848">
        <ele>2074.676</ele>
        <time>2026-10-02T12:03:31.999Z</time>
      </trkpt>
      <trkpt lat="46.520006" lon="12.008876">
        <ele>2074.613</ele>
        <time>2026-10-02T12:05:15Z</time>
      </trkpt>
      <trkpt lat="46.520044" lon="12.008916">
        <ele>2074.609</ele>
        <time>2026-10-02T12:05:20Z</time>
      </trkpt>
      <trkpt lat="46.520093" lon="12.008944">
        <ele>2074.533</ele>
        <time>2026-10-02T12:05:31Z</time>
      </trkpt>
      <trkpt lat="46.520108" lon="12.009008">
        <ele>2074.539</ele>
        <time>2026-10-02T12:05:57Z</time>
      </trkpt>
      <trkpt lat="46.520123" lon="12.009073">
        <ele>2074.530</ele>
        <time>2026-10-02T12:06:06Z</time>
      </trkpt>
      <trkpt lat="46.520175" lon="12.009083">
        <ele>2074.571</ele>
        <time>2026-10-02T12:06:15Z</time>
      </trkpt>
      <trkpt lat="46.520228" lon="12.009091">
        <ele>2074.675</ele>
        <time>2026-10-02T12:06:20.001Z</time>
      </trkpt>
      <trkpt lat="46.520258" lon="12.009139">
        <ele>2074.772</ele>
        <time>2026-10-02T12:06:24.001Z</time>
      </trkpt>
      <trkpt lat="46.520287" lon="12.009199">
        <ele>2074.816</ele>
        <time>2026-10-02T12:06:30.001Z</time>
      </trkpt>
      <trkpt lat="46.520325" lon="12.009238">
        <ele>2074.986</ele>
        <time>2026-10-02T12:06:36.001Z</time>
      </trkpt>
      <trkpt lat="46.520364" lon="12.009277">
        <ele>2075.133</ele>
        <time>2026-10-02T12:06:45.001Z</time>
      </trkpt>
      <trkpt lat="46.520404" lon="12.009330">
        <ele>2075.517</ele>
        <time>2026-10-02T12:07:05.001Z</time>
      </trkpt>
      <trkpt lat="46.520440" lon="12.009371">
        <ele>2076.187</ele>
        <time>2026-10-02T12:07:11.001Z</time>
      </trkpt>
      <trkpt lat="46.520472" lon="12.009440">
        <ele>2076.915</ele>
        <time>2026-10-02T12:07:17.001Z</time>
      </trkpt>
      <trkpt lat="46.520505" lon="12.009488">
        <ele>2077.809</ele>
        <time>2026-10-02T12:07:25.001Z</time>
      </trkpt>
      <trkpt lat="46.520515" lon="12.009555">
        <ele>2078.673</ele>
        <time>2026-10-02T12:08:10Z</time>
      </trkpt>
      <trkpt lat="46.520546" lon="12.009492">
        <ele>2079.529</ele>
        <time>2026-10-02T12:09:36.001Z</time>
      </trkpt>
      <trkpt lat="46.520595" lon="12.009503">
        <ele>2080.150</ele>
        <time>2026-10-02T12:09:42.001Z</time>
      </trkpt>
      <trkpt lat="46.520547" lon="12.009514">
        <ele>2081.071</ele>
        <time>2026-10-02T12:09:54.001Z</time>
      </trkpt>
      <trkpt lat="46.520593" lon="12.009538">
        <ele>2082.045</ele>
        <time>2026-10-02T12:10:17.001Z</time>
      </trkpt>
      <trkpt lat="46.520634" lon="12.009592">
        <ele>2082.342</ele>
        <time>2026-10-02T12:10:22.001Z</time>
      </trkpt>
      <trkpt lat="46.520684" lon="12.009627">
        <ele>2082.716</ele>
        <time>2026-10-02T12:10:28.001Z</time>
      </trkpt>
      <trkpt lat="46.520705" lon="12.009689">
        <ele>2083.026</ele>
        <time>2026-10-02T12:10:36.001Z</time>
      </trkpt>
      <trkpt lat="46.520750" lon="12.009689">
        <ele>2083.913</ele>
        <time>2026-10-02T12:10:43.001Z</time>
      </trkpt>
      <trkpt lat="46.520791" lon="12.009733">
        <ele>2085.535</ele>
        <time>2026-10-02T12:10:48.001Z</time>
      </trkpt>
      <trkpt lat="46.520849" lon="12.009751">
        <ele>2086.986</ele>
        <time>2026-10-02T12:10:55.001Z</time>
      </trkpt>
      <trkpt lat="46.520894" lon="12.009751">
        <ele>2088.114</ele>
        <time>2026-10-02T12:10:59.001Z</time>
      </trkpt>
      <trkpt lat="46.520938" lon="12.009714">
        <ele>2089.609</ele>
        <time>2026-10-02T12:11:07Z</time>
      </trkpt>
      <trkpt lat="46.520981" lon="12.009740">
        <ele>2091.015</ele>
        <time>2026-10-02T12:11:12Z</time>
      </trkpt>
      <trkpt lat="46.521024" lon="12.009773">
        <ele>2092.371</ele>
        <time>2026-10-02T12:11:20Z</time>
      </trkpt>
      <trkpt lat="46.521072" lon="12.009770">
        <ele>2093.752</ele>
        <time>2026-10-02T12:11:28Z</time>
      </trkpt>
      <trkpt lat="46.521103" lon="12.009831">
        <ele>2095.073</ele>
        <time>2026-10-02T12:11:34Z</time>
      </trkpt>
      <trkpt lat="46.521149" lon="12.009838">
        <ele>2096.237</ele>
        <time>2026-10-02T12:11:39Z</time>
      </trkpt>
      <trkpt lat="46.521198" lon="12.009864">
        <ele>2097.064</ele>
        <time>2026-10-02T12:11:44Z</time>
      </trkpt>
      <trkpt lat="46.521251" lon="12.009897">
        <ele>2097.948</ele>
        <time>2026-10-02T12:11:51Z</time>
      </trkpt>
      <trkpt lat="46.521295" lon="12.009949">
        <ele>2099.258</ele>
        <time>2026-10-02T12:11:59Z</time>
      </trkpt>
      <trkpt lat="46.521340" lon="12.009892">
        <ele>2101.585</ele>
        <time>2026-10-02T12:12:03Z</time>
      </trkpt>
      <trkpt lat="46.521378" lon="12.009932">
        <ele>2102.732</ele>
        <time>2026-10-02T12:12:10Z</time>
      </trkpt>
      <trkpt lat="46.521426" lon="12.009946">
        <ele>2103.792</ele>
        <time>2026-10-02T12:12:16Z</time>
      </trkpt>
      <trkpt lat="46.521471" lon="12.009965">
        <ele>2104.411</ele>
        <time>2026-10-02T12:12:22Z</time>
      </trkpt>
      <trkpt lat="46.521516" lon="12.009949">
        <ele>2105.709</ele>
        <time>2026-10-02T12:12:46.001Z</time>
      </trkpt>
      <trkpt lat="46.521510" lon="12.010015">
        <ele>2106.945</ele>
        <time>2026-10-02T12:13:05.001Z</time>
      </trkpt>
      <trkpt lat="46.521471" lon="12.009972">
        <ele>2108.381</ele>
        <time>2026-10-02T12:13:50.001Z</time>
      </trkpt>
      <trkpt lat="46.521504" lon="12.009917">
        <ele>2108.812</ele>
        <time>2026-10-02T12:14:06.001Z</time>
      </trkpt>
      <trkpt lat="46.521517" lon="12.009998">
        <ele>2109.323</ele>
        <time>2026-10-02T12:14:24.001Z</time>
      </trkpt>
      <trkpt lat="46.521497" lon="12.010057">
        <ele>2109.697</ele>
        <time>2026-10-02T12:14:29.001Z</time>
      </trkpt>
      <trkpt lat="46.521481" lon="12.010122">
        <ele>2110.084</ele>
        <time>2026-10-02T12:14:33.001Z</time>
      </trkpt>
      <trkpt lat="46.521489" lon="12.010189">
        <ele>2110.028</ele>
        <time>2026-10-02T12:14:38.001Z</time>
      </trkpt>
      <trkpt lat="46.521524" lon="12.010230">
        <ele>2110.248</ele>
        <time>2026-10-02T12:14:48.001Z</time>
      </trkpt>
      <trkpt lat="46.521545" lon="12.010292">
        <ele>2110.385</ele>
        <time>2026-10-02T12:14:58.001Z</time>
      </trkpt>
      <trkpt lat="46.521565" lon="12.010351">
        <ele>2111.017</ele>
        <time>2026-10-02T12:15:05.001Z</time>
      </trkpt>
      <trkpt lat="46.521590" lon="12.010407">
        <ele>2112.087</ele>
        <time>2026-10-02T12:15:13.001Z</time>
      </trkpt>
      <trkpt lat="46.521610" lon="12.010479">
        <ele>2112.815</ele>
        <time>2026-10-02T12:15:21.001Z</time>
      </trkpt>
      <trkpt lat="46.521638" lon="12.010538">
        <ele>2113.609</ele>
        <time>2026-10-02T12:15:30.001Z</time>
      </trkpt>
      <trkpt lat="46.521663" lon="12.010596">
        <ele>2114.353</ele>
        <time>2026-10-02T12:15:38.001Z</time>
      </trkpt>
      <trkpt lat="46.521689" lon="12.010663">
        <ele>2115.339</ele>
        <time>2026-10-02T12:15:46.001Z</time>
      </trkpt>
      <trkpt lat="46.521714" lon="12.010724">
        <ele>2116.480</ele>
        <time>2026-10-02T12:15:55.001Z</time>
      </trkpt>
      <trkpt lat="46.521739" lon="12.010787">
        <ele>2117.381</ele>
        <time>2026-10-02T12:16:04.001Z</time>
      </trkpt>
      <trkpt lat="46.521771" lon="12.010835">
        <ele>2118.345</ele>
        <time>2026-10-02T12:16:12.001Z</time>
      </trkpt>
      <trkpt lat="46.521823" lon="12.010893">
        <ele>2119.532</ele>
        <time>2026-10-02T12:16:18.001Z</time>
      </trkpt>
      <trkpt lat="46.521868" lon="12.010865">
        <ele>2120.526</ele>
        <time>2026-10-02T12:17:20.002Z</time>
      </trkpt>
      <trkpt lat="46.521914" lon="12.010869">
        <ele>2121.516</ele>
        <time>2026-10-02T12:17:47.002Z</time>
      </trkpt>
      <trkpt lat="46.521872" lon="12.010897">
        <ele>2123.163</ele>
        <time>2026-10-02T12:18:01.002Z</time>
      </trkpt>
      <trkpt lat="46.521873" lon="12.010827">
        <ele>2124.513</ele>
        <time>2026-10-02T12:18:29.002Z</time>
      </trkpt>
      <trkpt lat="46.521911" lon="12.010866">
        <ele>2125.143</ele>
        <time>2026-10-02T12:18:46.002Z</time>
      </trkpt>
      <trkpt lat="46.521868" lon="12.010890">
        <ele>2125.407</ele>
        <time>2026-10-02T12:19:03.002Z</time>
      </trkpt>
      <trkpt lat="46.521856" lon="12.010953">
        <ele>2125.409</ele>
        <time>2026-10-02T12:19:20.002Z</time>
      </trkpt>
      <trkpt lat="46.521853" lon="12.011027">
        <ele>2125.163</ele>
        <time>2026-10-02T12:19:26.002Z</time>
      </trkpt>
      <trkpt lat="46.521861" lon="12.011102">
        <ele>2124.859</ele>
        <time>2026-10-02T12:19:33.002Z</time>
      </trkpt>
      <trkpt lat="46.521893" lon="12.011154">
        <ele>2125.120</ele>
        <time>2026-10-02T12:19:44.002Z</time>
      </trkpt>
      <trkpt lat="46.521912" lon="12.011214">
        <ele>2125.171</ele>
        <time>2026-10-02T12:19:53.002Z</time>
      </trkpt>
      <trkpt lat="46.521942" lon="12.011272">
        <ele>2125.685</ele>
        <time>2026-10-02T12:19:59.002Z</time>
      </trkpt>
      <trkpt lat="46.521969" lon="12.011327">
        <ele>2126.932</ele>
        <time>2026-10-02T12:20:04.002Z</time>
      </trkpt>
      <trkpt lat="46.521983" lon="12.011397">
        <ele>2127.966</ele>
        <time>2026-10-02T12:20:09.002Z</time>
      </trkpt>
      <trkpt lat="46.521999" lon="12.011481">
        <ele>2128.856</ele>
        <time>2026-10-02T12:20:15.002Z</time>
      </trkpt>
      <trkpt lat="46.522027" lon="12.011544">
        <ele>2129.693</ele>
        <time>2026-10-02T12:20:22.002Z</time>
      </trkpt>
      <trkpt lat="46.522065" lon="12.011590">
        <ele>2130.392</ele>
        <time>2026-10-02T12:20:30.002Z</time>
      </trkpt>
      <trkpt lat="46.522083" lon="12.011662">
        <ele>2130.973</ele>
        <time>2026-10-02T12:20:36.002Z</time>
      </trkpt>
      <trkpt lat="46.522105" lon="12.011745">
        <ele>2131.620</ele>
        <time>2026-10-02T12:20:42.002Z</time>
      </trkpt>
      <trkpt lat="46.522133" lon="12.011796">
        <ele>2131.809</ele>
        <time>2026-10-02T12:20:47.002Z</time>
      </trkpt>
      <trkpt lat="46.522158" lon="12.011855">
        <ele>2132.251</ele>
        <time>2026-10-02T12:20:54.002Z</time>
      </trkpt>
      <trkpt lat="46.522170" lon="12.011934">
        <ele>2132.427</ele>
        <time>2026-10-02T12:21:01.002Z</time>
      </trkpt>
      <trkpt lat="46.522188" lon="12.011869">
        <ele>2132.688</ele>
        <time>2026-10-02T12:21:56.003Z</time>
      </trkpt>
      <trkpt lat="46.522218" lon="12.011819">
        <ele>2133.119</ele>
        <time>2026-10-02T12:22:07.003Z</time>
      </trkpt>
      <trkpt lat="46.522263" lon="12.011806">
        <ele>2133.943</ele>
        <time>2026-10-02T12:22:32.003Z</time>
      </trkpt>
      <trkpt lat="46.522273" lon="12.011877">
        <ele>2134.860</ele>
        <time>2026-10-02T12:22:46.003Z</time>
      </trkpt>
      <trkpt lat="46.522279" lon="12.011943">
        <ele>2135.664</ele>
        <time>2026-10-02T12:22:56.003Z</time>
      </trkpt>
      <trkpt lat="46.522262" lon="12.012007">
        <ele>2136.144</ele>
        <time>2026-10-02T12:23:20.004Z</time>
      </trkpt>
      <trkpt lat="46.522207" lon="12.011995">
        <ele>2136.151</ele>
        <time>2026-10-02T12:24:24.004Z</time>
      </trkpt>
      <trkpt lat="46.522158" lon="12.011971">
        <ele>2136.194</ele>
        <time>2026-10-02T12:24:32.004Z</time>
      </trkpt>
      <trkpt lat="46.522171" lon="12.011905">
        <ele>2135.857</ele>
        <time>2026-10-02T12:25:05.004Z</time>
      </trkpt>
      <trkpt lat="46.522203" lon="12.011964">
        <ele>2134.822</ele>
        <time>2026-10-02T12:25:32.005Z</time>
      </trkpt>
      <trkpt lat="46.522224" lon="12.012025">
        <ele>2134.609</ele>
        <time>2026-10-02T12:25:46.005Z</time>
      </trkpt>
      <trkpt lat="46.522259" lon="12.012074">
        <ele>2134.621</ele>
        <time>2026-10-02T12:25:50.005Z</time>
      </trkpt>
      <trkpt lat="46.522300" lon="12.012129">
        <ele>2134.697</ele>
        <time>2026-10-02T12:25:55.005Z</time>
      </trkpt>
      <trkpt lat="46.522337" lon="12.012186">
        <ele>2135.228</ele>
        <time>2026-10-02T12:26:00.005Z</time>
      </trkpt>
      <trkpt lat="46.522388" lon="12.012217">
        <ele>2135.899</ele>
        <time>2026-10-02T12:26:06.005Z</time>
      </trkpt>
      <trkpt lat="46.522431" lon="12.012255">
        <ele>2136.423</ele>
        <time>2026-10-02T12:26:10.005Z</time>
      </trkpt>
      <trkpt lat="46.522468" lon="12.012298">
        <ele>2136.850</ele>
        <time>2026-10-02T12:26:14.005Z</time>
      </trkpt>
      <trkpt lat="46.522511" lon="12.012337">
        <ele>2137.024</ele>
        <time>2026-10-02T12:26:20.005Z</time>
      </trkpt>
      <trkpt lat="46.522556" lon="12.012376">
        <ele>2137.334</ele>
        <time>2026-10-02T12:26:24.005Z</time>
      </trkpt>
      <trkpt lat="46.522597" lon="12.012418">
        <ele>2137.841</ele>
        <time>2026-10-02T12:26:30.005Z</time>
      </trkpt>
      <trkpt lat="46.522633" lon="12.012458">
        <ele>2138.563</ele>
        <time>2026-10-02T12:26:35.005Z</time>
      </trkpt>
      <trkpt lat="46.522671" lon="12.012500">
        <ele>2139.344</ele>
        <time>2026-10-02T12:26:41.005Z</time>
      </trkpt>
      <trkpt lat="46.522709" lon="12.012539">
        <ele>2140.018</ele>
        <time>2026-10-02T12:26:45.005Z</time>
      </trkpt>
      <trkpt lat="46.522754" lon="12.012570">
        <ele>2140.609</ele>
        <time>2026-10-02T12:26:51.005Z</time>
      </trkpt>
      <trkpt lat="46.522790" lon="12.012623">
        <ele>2141.328</ele>
        <time>2026-10-02T12:26:59.005Z</time>
      </trkpt>
      <trkpt lat="46.522829" lon="12.012663">
        <ele>2142.034</ele>
        <time>2026-10-02T12:27:08.005Z</time>
      </trkpt>
      <trkpt lat="46.522859" lon="12.012714">
        <ele>2142.855</ele>
        <time>2026-10-02T12:27:13.005Z</time>
      </trkpt>
      <trkpt lat="46.522881" lon="12.012781">
        <ele>2143.616</ele>
        <time>2026-10-02T12:27:20.007Z</time>
      </trkpt>
      <trkpt lat="46.522925" lon="12.012799">
        <ele>2144.250</ele>
        <time>2026-10-02T12:27:27.007Z</time>
      </trkpt>
      <trkpt lat="46.522949" lon="12.012860">
        <ele>2144.757</ele>
        <time>2026-10-02T12:27:52.006Z</time>
      </trkpt>
      <trkpt lat="46.522991" lon="12.012894">
        <ele>2145.121</ele>
        <time>2026-10-02T12:27:56.006Z</time>
      </trkpt>
      <trkpt lat="46.523030" lon="12.012944">
        <ele>2145.561</ele>
        <time>2026-10-02T12:28:17.006Z</time>
      </trkpt>
      <trkpt lat="46.523074" lon="12.012988">
        <ele>2146.198</ele>
        <time>2026-10-02T12:28:23.006Z</time>
      </trkpt>
      <trkpt lat="46.523119" lon="12.013026">
        <ele>2146.869</ele>
        <time>2026-10-02T12:28:30.006Z</time>
      </trkpt>
      <trkpt lat="46.523155" lon="12.013078">
        <ele>2147.204</ele>
        <time>2026-10-02T12:28:36.005Z</time>
      </trkpt>
      <trkpt lat="46.523146" lon="12.013144">
        <ele>2147.624</ele>
        <time>2026-10-02T12:28:40.005Z</time>
      </trkpt>
      <trkpt lat="46.523147" lon="12.013217">
        <ele>2148.209</ele>
        <time>2026-10-02T12:29:10.005Z</time>
      </trkpt>
      <trkpt lat="46.523184" lon="12.013267">
        <ele>2148.698</ele>
        <time>2026-10-02T12:29:15.005Z</time>
      </trkpt>
      <trkpt lat="46.523199" lon="12.013337">
        <ele>2149.044</ele>
        <time>2026-10-02T12:29:20.005Z</time>
      </trkpt>
      <trkpt lat="46.523219" lon="12.013407">
        <ele>2149.325</ele>
        <time>2026-10-02T12:29:25.007Z</time>
      </trkpt>
      <trkpt lat="46.523259" lon="12.013465">
        <ele>2149.616</ele>
        <time>2026-10-02T12:29:30.007Z</time>
      </trkpt>
      <trkpt lat="46.523262" lon="12.013530">
        <ele>2150.380</ele>
        <time>2026-10-02T12:29:53.006Z</time>
      </trkpt>
      <trkpt lat="46.523279" lon="12.013598">
        <ele>2151.277</ele>
        <time>2026-10-02T12:29:58.006Z</time>
      </trkpt>
      <trkpt lat="46.523302" lon="12.013668">
        <ele>2152.191</ele>
        <time>2026-10-02T12:30:00.006Z</time>
      </trkpt>
      <trkpt lat="46.523312" lon="12.013733">
        <ele>2153.061</ele>
        <time>2026-10-02T12:30:12.006Z</time>
      </trkpt>
      <trkpt lat="46.523326" lon="12.013796">
        <ele>2153.628</ele>
        <time>2026-10-02T12:30:25.006Z</time>
      </trkpt>
      <trkpt lat="46.523328" lon="12.013872">
        <ele>2154.676</ele>
        <time>2026-10-02T12:30:42.006Z</time>
      </trkpt>
      <trkpt lat="46.523329" lon="12.013942">
        <ele>2155.990</ele>
        <time>2026-10-02T12:30:49.006Z</time>
      </trkpt>
      <trkpt lat="46.523343" lon="12.014008">
        <ele>2156.519</ele>
        <time>2026-10-02T12:30:56.006Z</time>
      </trkpt>
      <trkpt lat="46.523378" lon="12.013963">
        <ele>2156.909</ele>
        <time>2026-10-02T12:32:26.006Z</time>
      </trkpt>
      <trkpt lat="46.523399" lon="12.013903">
        <ele>2157.359</ele>
        <time>2026-10-02T12:32:38.006Z</time>
      </trkpt>
      <trkpt lat="46.523444" lon="12.013934">
        <ele>2157.515</ele>
        <time>2026-10-02T12:33:00.006Z</time>
      </trkpt>
      <trkpt lat="46.523426" lon="12.013999">
        <ele>2157.696</ele>
        <time>2026-10-02T12:33:10.006Z</time>
      </trkpt>
      <trkpt lat="46.523383" lon="12.013981">
        <ele>2157.837</ele>
        <time>2026-10-02T12:33:21.006Z</time>
      </trkpt>
      <trkpt lat="46.523353" lon="12.014040">
        <ele>2157.851</ele>
        <time>2026-10-02T12:34:15.006Z</time>
      </trkpt>
      <trkpt lat="46.523377" lon="12.013984">
        <ele>2157.628</ele>
        <time>2026-10-02T12:34:24.006Z</time>
      </trkpt>
      <trkpt lat="46.523391" lon="12.014053">
        <ele>2157.452</ele>
        <time>2026-10-02T12:36:34.006Z</time>
      </trkpt>
      <trkpt lat="46.523399" lon="12.014129">
        <ele>2157.792</ele>
        <time>2026-10-02T12:36:40.006Z</time>
      </trkpt>
      <trkpt lat="46.523412" lon="12.014202">
        <ele>2157.799</ele>
        <time>2026-10-02T12:36:45.006Z</time>
      </trkpt>
      <trkpt lat="46.523423" lon="12.014268">
        <ele>2157.837</ele>
        <time>2026-10-02T12:36:50.006Z</time>
      </trkpt>
      <trkpt lat="46.523437" lon="12.014333">
        <ele>2158.749</ele>
        <time>2026-10-02T12:36:55.006Z</time>
      </trkpt>
      <trkpt lat="46.523452" lon="12.014409">
        <ele>2159.713</ele>
        <time>2026-10-02T12:37:28.006Z</time>
      </trkpt>
      <trkpt lat="46.523490" lon="12.014458">
        <ele>2160.909</ele>
        <time>2026-10-02T12:37:33.006Z</time>
      </trkpt>
      <trkpt lat="46.523504" lon="12.014537">
        <ele>2162.155</ele>
        <time>2026-10-02T12:37:39.006Z</time>
      </trkpt>
      <trkpt lat="46.523528" lon="12.014599">
        <ele>2163.111</ele>
        <time>2026-10-02T12:37:44.006Z</time>
      </trkpt>
      <trkpt lat="46.523553" lon="12.014658">
        <ele>2163.912</ele>
        <time>2026-10-02T12:37:51.007Z</time>
      </trkpt>
      <trkpt lat="46.523572" lon="12.014727">
        <ele>2164.663</ele>
        <time>2026-10-02T12:38:04.007Z</time>
      </trkpt>
      <trkpt lat="46.523610" lon="12.014779">
        <ele>2165.357</ele>
        <time>2026-10-02T12:38:08.007Z</time>
      </trkpt>
      <trkpt lat="46.523632" lon="12.014844">
        <ele>2166.094</ele>
        <time>2026-10-02T12:38:15.007Z</time>
      </trkpt>
      <trkpt lat="46.523654" lon="12.014904">
        <ele>2166.668</ele>
        <time>2026-10-02T12:38:20.007Z</time>
      </trkpt>
      <trkpt lat="46.523674" lon="12.014963">
        <ele>2167.288</ele>
        <time>2026-10-02T12:38:24.007Z</time>
      </trkpt>
      <trkpt lat="46.523699" lon="12.015026">
        <ele>2168.085</ele>
        <time>2026-10-02T12:38:29.007Z</time>
      </trkpt>
      <trkpt lat="46.523723" lon="12.015088">
        <ele>2168.786</ele>
        <time>2026-10-02T12:38:33.007Z</time>
      </trkpt>
      <trkpt lat="46.523738" lon="12.015155">
        <ele>2169.460</ele>
        <time>2026-10-02T12:38:39.007Z</time>
      </trkpt>
      <trkpt lat="46.523760" lon="12.015216">
        <ele>2170.126</ele>
        <time>2026-10-02T12:39:17.007Z</time>
      </trkpt>
      <trkpt lat="46.523790" lon="12.015271">
        <ele>2170.909</ele>
        <time>2026-10-02T12:39:22.007Z</time>
      </trkpt>
      <trkpt lat="46.523814" lon="12.015339">
        <ele>2171.940</ele>
        <time>2026-10-02T12:39:27.007Z</time>
      </trkpt>
      <trkpt lat="46.523844" lon="12.015394">
        <ele>2172.746</ele>
        <time>2026-10-02T12:39:34.007Z</time>
      </trkpt>
      <trkpt lat="46.523859" lon="12.015468">
        <ele>2173.477</ele>
        <time>2026-10-02T12:40:14.008Z</time>
      </trkpt>
      <trkpt lat="46.523896" lon="12.015511">
        <ele>2174.238</ele>
        <time>2026-10-02T12:40:17.008Z</time>
      </trkpt>
      <trkpt lat="46.523928" lon="12.015571">
        <ele>2175.382</ele>
        <time>2026-10-02T12:40:21.008Z</time>
      </trkpt>
      <trkpt lat="46.523947" lon="12.015638">
        <ele>2176.249</ele>
        <time>2026-10-02T12:40:26.008Z</time>
      </trkpt>
      <trkpt lat="46.523975" lon="12.015691">
        <ele>2176.733</ele>
        <time>2026-10-02T12:40:32.008Z</time>
      </trkpt>
      <trkpt lat="46.523996" lon="12.015759">
        <ele>2177.373</ele>
        <time>2026-10-02T12:40:39.008Z</time>
      </trkpt>
      <trkpt lat="46.524015" lon="12.015822">
        <ele>2178.040</ele>
        <time>2026-10-02T12:40:45.008Z</time>
      </trkpt>
      <trkpt lat="46.524063" lon="12.015846">
        <ele>2178.852</ele>
        <time>2026-10-02T12:41:27.008Z</time>
      </trkpt>
      <trkpt lat="46.524108" lon="12.015855">
        <ele>2179.753</ele>
        <time>2026-10-02T12:42:56.008Z</time>
      </trkpt>
      <trkpt lat="46.524132" lon="12.015916">
        <ele>2180.908</ele>
        <time>2026-10-02T12:43:13.008Z</time>
      </trkpt>
      <trkpt lat="46.524181" lon="12.015956">
        <ele>2182.009</ele>
        <time>2026-10-02T12:43:29.008Z</time>
      </trkpt>
      <trkpt lat="46.524217" lon="12.016052">
        <ele>2184.137</ele>
        <time>2026-10-02T12:43:40.008Z</time>
      </trkpt>
      <trkpt lat="46.524255" lon="12.016010">
        <ele>2184.523</ele>
        <time>2026-10-02T12:43:48.008Z</time>
      </trkpt>
      <trkpt lat="46.524309" lon="12.016031">
        <ele>2185.584</ele>
        <time>2026-10-02T12:43:55.008Z</time>
      </trkpt>
      <trkpt lat="46.524326" lon="12.016103">
        <ele>2187.115</ele>
        <time>2026-10-02T12:44:04.008Z</time>
      </trkpt>
      <trkpt lat="46.524368" lon="12.016135">
        <ele>2188.259</ele>
        <time>2026-10-02T12:44:12.008Z</time>
      </trkpt>
      <trkpt lat="46.524418" lon="12.016151">
        <ele>2189.076</ele>
        <time>2026-10-02T12:44:21.008Z</time>
      </trkpt>
      <trkpt lat="46.524464" lon="12.016163">
        <ele>2190.690</ele>
        <time>2026-10-02T12:44:28.008Z</time>
      </trkpt>
      <trkpt lat="46.524498" lon="12.016215">
        <ele>2192.010</ele>
        <time>2026-10-02T12:44:36.008Z</time>
      </trkpt>
      <trkpt lat="46.524544" lon="12.016245">
        <ele>2193.257</ele>
        <time>2026-10-02T12:44:43.008Z</time>
      </trkpt>
      <trkpt lat="46.524589" lon="12.016277">
        <ele>2194.654</ele>
        <time>2026-10-02T12:45:24.008Z</time>
      </trkpt>
      <trkpt lat="46.524635" lon="12.016297">
        <ele>2196.256</ele>
        <time>2026-10-02T12:45:31.008Z</time>
      </trkpt>
      <trkpt lat="46.524688" lon="12.016271">
        <ele>2198.211</ele>
        <time>2026-10-02T12:45:40.008Z</time>
      </trkpt>
      <trkpt lat="46.524733" lon="12.016283">
        <ele>2199.909</ele>
        <time>2026-10-02T12:45:56.008Z</time>
      </trkpt>
      <trkpt lat="46.524772" lon="12.016317">
        <ele>2201.627</ele>
        <time>2026-10-02T12:46:06.008Z</time>
      </trkpt>
      <trkpt lat="46.524820" lon="12.016346">
        <ele>2203.163</ele>
        <time>2026-10-02T12:46:14.009Z</time>
      </trkpt>
      <trkpt lat="46.524837" lon="12.016408">
        <ele>2204.614</ele>
        <time>2026-10-02T12:46:23.009Z</time>
      </trkpt>
      <trkpt lat="46.524867" lon="12.016459">
        <ele>2206.515</ele>
        <time>2026-10-02T12:46:34.008Z</time>
      </trkpt>
      <trkpt lat="46.524918" lon="12.016452">
        <ele>2208.339</ele>
        <time>2026-10-02T12:46:51.008Z</time>
      </trkpt>
      <trkpt lat="46.524957" lon="12.016501">
        <ele>2210.266</ele>
        <time>2026-10-02T12:47:01.008Z</time>
      </trkpt>
      <trkpt lat="46.524991" lon="12.016549">
        <ele>2212.050</ele>
        <time>2026-10-02T12:47:09.008Z</time>
      </trkpt>
      <trkpt lat="46.525013" lon="12.016610">
        <ele>2213.770</ele>
        <time>2026-10-02T12:47:16.008Z</time>
      </trkpt>
      <trkpt lat="46.525040" lon="12.016663">
        <ele>2215.437</ele>
        <time>2026-10-02T12:47:23.008Z</time>
      </trkpt>
      <trkpt lat="46.525032" lon="12.016741">
        <ele>2217.078</ele>
        <time>2026-10-02T12:47:38.008Z</time>
      </trkpt>
      <trkpt lat="46.525044" lon="12.016809">
        <ele>2218.633</ele>
        <time>2026-10-02T12:47:47.008Z</time>
      </trkpt>
      <trkpt lat="46.525038" lon="12.016877">
        <ele>2220.426</ele>
        <time>2026-10-02T12:47:55.008Z</time>
      </trkpt>
      <trkpt lat="46.525033" lon="12.016945">
        <ele>2222.109</ele>
        <time>2026-10-02T12:48:01.008Z</time>
      </trkpt>
      <trkpt lat="46.525061" lon="12.017003">
        <ele>2223.699</ele>
        <time>2026-10-02T12:48:18.006Z</time>
      </trkpt>
      <trkpt lat="46.525045" lon="12.017078">
        <ele>2225.055</ele>
        <time>2026-10-02T12:48:25.006Z</time>
      </trkpt>
      <trkpt lat="46.525055" lon="12.017142">
        <ele>2227.066</ele>
        <time>2026-10-02T12:48:32.006Z</time>
      </trkpt>
      <trkpt lat="46.524998" lon="12.017168">
        <ele>2228.727</ele>
        <time>2026-10-02T12:49:02.007Z</time>
      </trkpt>
      <trkpt lat="46.524988" lon="12.017237">
        <ele>2230.181</ele>
        <time>2026-10-02T12:49:42.007Z</time>
      </trkpt>
      <trkpt lat="46.525019" lon="12.017297">
        <ele>2232.088</ele>
        <time>2026-10-02T12:49:48.007Z</time>
      </trkpt>
      <trkpt lat="46.525044" lon="12.017352">
        <ele>2233.142</ele>
        <time>2026-10-02T12:49:55.007Z</time>
      </trkpt>
      <trkpt lat="46.525071" lon="12.017405">
        <ele>2233.882</ele>
        <time>2026-10-02T12:50:00.007Z</time>
      </trkpt>
      <trkpt lat="46.525047" lon="12.017464">
        <ele>2235.329</ele>
        <time>2026-10-02T12:50:26.008Z</time>
      </trkpt>
      <trkpt lat="46.525096" lon="12.017466">
        <ele>2236.858</ele>
        <time>2026-10-02T12:50:48.008Z</time>
      </trkpt>
      <trkpt lat="46.525140" lon="12.017446">
        <ele>2238.152</ele>
        <time>2026-10-02T12:51:06.008Z</time>
      </trkpt>
      <trkpt lat="46.525168" lon="12.017511">
        <ele>2239.317</ele>
        <time>2026-10-02T12:51:12.008Z</time>
      </trkpt>
      <trkpt lat="46.525212" lon="12.017536">
        <ele>2240.009</ele>
        <time>2026-10-02T12:51:22.008Z</time>
      </trkpt>
      <trkpt lat="46.525257" lon="12.017525">
        <ele>2240.647</ele>
        <time>2026-10-02T12:51:26.008Z</time>
      </trkpt>
      <trkpt lat="46.525309" lon="12.017526">
        <ele>2241.833</ele>
        <time>2026-10-02T12:51:32.008Z</time>
      </trkpt>
      <trkpt lat="46.525356" lon="12.017502">
        <ele>2242.984</ele>
        <time>2026-10-02T12:51:38.008Z</time>
      </trkpt>
      <trkpt lat="46.525400" lon="12.017461">
        <ele>2243.995</ele>
        <time>2026-10-02T12:51:43.008Z</time>
      </trkpt>
      <trkpt lat="46.525445" lon="12.017466">
        <ele>2245.089</ele>
        <time>2026-10-02T12:51:57.008Z</time>
      </trkpt>
      <trkpt lat="46.525464" lon="12.017527">
        <ele>2245.756</ele>
        <time>2026-10-02T12:52:02.008Z</time>
      </trkpt>
      <trkpt lat="46.525499" lon="12.017577">
        <ele>2246.540</ele>
        <time>2026-10-02T12:52:08.008Z</time>
      </trkpt>
      <trkpt lat="46.525527" lon="12.017644">
        <ele>2247.410</ele>
        <time>2026-10-02T12:52:13.008Z</time>
      </trkpt>
      <trkpt lat="46.525563" lon="12.017701">
        <ele>2248.447</ele>
        <time>2026-10-02T12:52:19.008Z</time>
      </trkpt>
      <trkpt lat="46.525598" lon="12.017744">
        <ele>2249.267</ele>
        <time>2026-10-02T12:52:29.009Z</time>
      </trkpt>
      <trkpt lat="46.525639" lon="12.017715">
        <ele>2249.881</ele>
        <time>2026-10-02T12:52:36.009Z</time>
      </trkpt>
      <trkpt lat="46.525686" lon="12.017710">
        <ele>2250.519</ele>
        <time>2026-10-02T12:52:43.009Z</time>
      </trkpt>
      <trkpt lat="46.525733" lon="12.017666">
        <ele>2251.109</ele>
        <time>2026-10-02T12:53:06.009Z</time>
      </trkpt>
      <trkpt lat="46.525786" lon="12.017638">
        <ele>2251.868</ele>
        <time>2026-10-02T12:53:10.009Z</time>
      </trkpt>
      <trkpt lat="46.525828" lon="12.017600">
        <ele>2252.844</ele>
        <time>2026-10-02T12:53:15.009Z</time>
      </trkpt>
      <trkpt lat="46.525873" lon="12.017596">
        <ele>2253.555</ele>
        <time>2026-10-02T12:53:20.009Z</time>
      </trkpt>
      <trkpt lat="46.525911" lon="12.017646">
        <ele>2254.146</ele>
        <time>2026-10-02T12:53:29.009Z</time>
      </trkpt>
      <trkpt lat="46.525940" lon="12.017593">
        <ele>2255.080</ele>
        <time>2026-10-02T12:53:36.009Z</time>
      </trkpt>
      <trkpt lat="46.525986" lon="12.017575">
        <ele>2255.957</ele>
        <time>2026-10-02T12:53:43.009Z</time>
      </trkpt>
      <trkpt lat="46.526031" lon="12.017544">
        <ele>2256.781</ele>
        <time>2026-10-02T12:53:49.009Z</time>
      </trkpt>
      <trkpt lat="46.526084" lon="12.017548">
        <ele>2257.561</ele>
        <time>2026-10-02T12:53:57.009Z</time>
      </trkpt>
      <trkpt lat="46.526127" lon="12.017571">
        <ele>2258.558</ele>
        <time>2026-10-02T12:54:05.009Z</time>
      </trkpt>
      <trkpt lat="46.526172" lon="12.017567">
        <ele>2260.049</ele>
        <time>2026-10-02T12:54:10.009Z</time>
      </trkpt>
      <trkpt lat="46.526220" lon="12.017570">
        <ele>2261.902</ele>
        <time>2026-10-02T12:54:17.009Z</time>
      </trkpt>
      <trkpt lat="46.526269" lon="12.017572">
        <ele>2263.222</ele>
        <time>2026-10-02T12:54:24.009Z</time>
      </trkpt>
      <trkpt lat="46.526329" lon="12.017555">
        <ele>2264.409</ele>
        <time>2026-10-02T12:54:31.009Z</time>
      </trkpt>
      <trkpt lat="46.526375" lon="12.017577">
        <ele>2266.086</ele>
        <time>2026-10-02T12:54:39.011Z</time>
      </trkpt>
      <trkpt lat="46.526415" lon="12.017607">
        <ele>2267.762</ele>
        <time>2026-10-02T12:54:49.011Z</time>
      </trkpt>
      <trkpt lat="46.526440" lon="12.017549">
        <ele>2269.613</ele>
        <time>2026-10-02T12:54:56.011Z</time>
      </trkpt>
      <trkpt lat="46.526488" lon="12.017553">
        <ele>2271.634</ele>
        <time>2026-10-02T12:55:14.011Z</time>
      </trkpt>
      <trkpt lat="46.526534" lon="12.017573">
        <ele>2272.968</ele>
        <time>2026-10-02T12:55:19.011Z</time>
      </trkpt>
      <trkpt lat="46.526583" lon="12.017545">
        <ele>2273.835</ele>
        <time>2026-10-02T12:55:35.011Z</time>
      </trkpt>
      <trkpt lat="46.526631" lon="12.017540">
        <ele>2275.099</ele>
        <time>2026-10-02T12:55:41.011Z</time>
      </trkpt>
      <trkpt lat="46.526681" lon="12.017555">
        <ele>2276.439</ele>
        <time>2026-10-02T12:55:47.011Z</time>
      </trkpt>
      <trkpt lat="46.526737" lon="12.017540">
        <ele>2277.916</ele>
        <time>2026-10-02T12:55:53.011Z</time>
      </trkpt>
      <trkpt lat="46.526772" lon="12.017478">
        <ele>2279.262</ele>
        <time>2026-10-02T12:55:59.011Z</time>
      </trkpt>
      <trkpt lat="46.526809" lon="12.017437">
        <ele>2280.483</ele>
        <time>2026-10-02T12:56:06.011Z</time>
      </trkpt>
      <trkpt lat="46.526845" lon="12.017383">
        <ele>2281.711</ele>
        <time>2026-10-02T12:56:13.011Z</time>
      </trkpt>
      <trkpt lat="46.526881" lon="12.017341">
        <ele>2283.309</ele>
        <time>2026-10-02T12:56:16.011Z</time>
      </trkpt>
      <trkpt lat="46.526928" lon="12.017343">
        <ele>2284.948</ele>
        <time>2026-10-02T12:56:25.011Z</time>
      </trkpt>
      <trkpt lat="46.526979" lon="12.017336">
        <ele>2286.184</ele>
        <time>2026-10-02T12:56:46.012Z</time>
      </trkpt>
      <trkpt lat="46.527035" lon="12.017317">
        <ele>2287.625</ele>
        <time>2026-10-02T12:56:56.012Z</time>
      </trkpt>
      <trkpt lat="46.527063" lon="12.017264">
        <ele>2290.176</ele>
        <time>2026-10-02T12:57:14.012Z</time>
      </trkpt>
      <trkpt lat="46.527058" lon="12.017373">
        <ele>2292.680</ele>
        <time>2026-10-02T12:57:19.012Z</time>
      </trkpt>
      <trkpt lat="46.527064" lon="12.017241">
        <ele>2295.027</ele>
        <time>2026-10-02T12:57:21.012Z</time>
      </trkpt>
      <trkpt lat="46.527124" lon="12.017237">
        <ele>2295.671</ele>
        <time>2026-10-02T12:58:02.012Z</time>
      </trkpt>
      <trkpt lat="46.527170" lon="12.017210">
        <ele>2296.281</ele>
        <time>2026-10-02T12:58:09.012Z</time>
      </trkpt>
      <trkpt lat="46.527214" lon="12.017189">
        <ele>2296.878</ele>
        <time>2026-10-02T12:58:16.012Z</time>
      </trkpt>
      <trkpt lat="46.527261" lon="12.017187">
        <ele>2299.073</ele>
        <time>2026-10-02T12:58:37.012Z</time>
      </trkpt>
      <trkpt lat="46.527303" lon="12.017222">
        <ele>2300.185</ele>
        <time>2026-10-02T12:59:11.013Z</time>
      </trkpt>
      <trkpt lat="46.527294" lon="12.017157">
        <ele>2302.713</ele>
        <time>2026-10-02T12:59:26.013Z</time>
      </trkpt>
      <trkpt lat="46.527321" lon="12.017105">
        <ele>2305.209</ele>
        <time>2026-10-02T12:59:48.013Z</time>
      </trkpt>
      <trkpt lat="46.527365" lon="12.017136">
        <ele>2306.759</ele>
        <time>2026-10-02T12:59:52.013Z</time>
      </trkpt>
      <trkpt lat="46.527414" lon="12.017115">
        <ele>2307.885</ele>
        <time>2026-10-02T13:00:00.013Z</time>
      </trkpt>
      <trkpt lat="46.527458" lon="12.017129">
        <ele>2308.926</ele>
        <time>2026-10-02T13:00:26.013Z</time>
      </trkpt>
      <trkpt lat="46.527505" lon="12.017100">
        <ele>2310.137</ele>
        <time>2026-10-02T13:00:39.013Z</time>
      </trkpt>
      <trkpt lat="46.527546" lon="12.017064">
        <ele>2311.831</ele>
        <time>2026-10-02T13:00:52.014Z</time>
      </trkpt>
      <trkpt lat="46.527565" lon="12.017004">
        <ele>2314.148</ele>
        <time>2026-10-02T13:00:59.014Z</time>
      </trkpt>
      <trkpt lat="46.527608" lon="12.016986">
        <ele>2317.042</ele>
        <time>2026-10-02T13:01:13.014Z</time>
      </trkpt>
      <trkpt lat="46.527648" lon="12.016956">
        <ele>2319.042</ele>
        <time>2026-10-02T13:01:23.014Z</time>
      </trkpt>
      <trkpt lat="46.527698" lon="12.016947">
        <ele>2320.749</ele>
        <time>2026-10-02T13:01:47.014Z</time>
      </trkpt>
      <trkpt lat="46.527709" lon="12.016875">
        <ele>2323.332</ele>
        <time>2026-10-02T13:01:56.014Z</time>
      </trkpt>
      <trkpt lat="46.527768" lon="12.016861">
        <ele>2325.892</ele>
        <time>2026-10-02T13:02:06.014Z</time>
      </trkpt>
      <trkpt lat="46.527817" lon="12.016826">
        <ele>2327.811</ele>
        <time>2026-10-02T13:02:14.014Z</time>
      </trkpt>
      <trkpt lat="46.527862" lon="12.016838">
        <ele>2329.709</ele>
        <time>2026-10-02T13:02:41.014Z</time>
      </trkpt>
      <trkpt lat="46.527904" lon="12.016816">
        <ele>2331.675</ele>
        <time>2026-10-02T13:02:50.014Z</time>
      </trkpt>
      <trkpt lat="46.527950" lon="12.016807">
        <ele>2334.371</ele>
        <time>2026-10-02T13:03:00.015Z</time>
      </trkpt>
      <trkpt lat="46.527998" lon="12.016776">
        <ele>2336.722</ele>
        <time>2026-10-02T13:03:07.015Z</time>
      </trkpt>
      <trkpt lat="46.528048" lon="12.016794">
        <ele>2338.573</ele>
        <time>2026-10-02T13:03:46.014Z</time>
      </trkpt>
      <trkpt lat="46.528105" lon="12.016797">
        <ele>2340.327</ele>
        <time>2026-10-02T13:03:54.014Z</time>
      </trkpt>
      <trkpt lat="46.528156" lon="12.016821">
        <ele>2341.724</ele>
        <time>2026-10-02T13:04:03.014Z</time>
      </trkpt>
      <trkpt lat="46.528198" lon="12.016847">
        <ele>2343.268</ele>
        <time>2026-10-02T13:04:12.014Z</time>
      </trkpt>
      <trkpt lat="46.528245" lon="12.016842">
        <ele>2344.578</ele>
        <time>2026-10-02T13:04:26.014Z</time>
      </trkpt>
      <trkpt lat="46.528286" lon="12.016885">
        <ele>2346.145</ele>
        <time>2026-10-02T13:04:32.014Z</time>
      </trkpt>
      <trkpt lat="46.528320" lon="12.016930">
        <ele>2348.156</ele>
        <time>2026-10-02T13:04:45.014Z</time>
      </trkpt>
      <trkpt lat="46.528359" lon="12.016971">
        <ele>2349.559</ele>
        <time>2026-10-02T13:05:15.014Z</time>
      </trkpt>
      <trkpt lat="46.528354" lon="12.017040">
        <ele>2350.414</ele>
        <time>2026-10-02T13:05:30.014Z</time>
      </trkpt>
      <trkpt lat="46.528396" lon="12.017086">
        <ele>2351.309</ele>
        <time>2026-10-02T13:05:37.014Z</time>
      </trkpt>
      <trkpt lat="46.528424" lon="12.017137">
        <ele>2351.797</ele>
        <time>2026-10-02T13:05:46.014Z</time>
      </trkpt>
      <trkpt lat="46.528444" lon="12.017195">
        <ele>2351.913</ele>
        <time>2026-10-02T13:05:58.014Z</time>
      </trkpt>
      <trkpt lat="46.528467" lon="12.017252">
        <ele>2352.414</ele>
        <time>2026-10-02T13:06:23.014Z</time>
      </trkpt>
      <trkpt lat="46.528461" lon="12.017317">
        <ele>2352.885</ele>
        <time>2026-10-02T13:06:27.014Z</time>
      </trkpt>
      <trkpt lat="46.528467" lon="12.017389">
        <ele>2352.899</ele>
        <time>2026-10-02T13:06:33.014Z</time>
      </trkpt>
      <trkpt lat="46.528472" lon="12.017460">
        <ele>2352.876</ele>
        <time>2026-10-02T13:06:39.014Z</time>
      </trkpt>
      <trkpt lat="46.528488" lon="12.017538">
        <ele>2352.970</ele>
        <time>2026-10-02T13:06:45.014Z</time>
      </trkpt>
      <trkpt lat="46.528487" lon="12.017603">
        <ele>2352.930</ele>
        <time>2026-10-02T13:06:50.014Z</time>
      </trkpt>
      <trkpt lat="46.528496" lon="12.017667">
        <ele>2353.227</ele>
        <time>2026-10-02T13:06:56.014Z</time>
      </trkpt>
      <trkpt lat="46.528505" lon="12.017743">
        <ele>2354.228</ele>
        <time>2026-10-02T13:07:09.014Z</time>
      </trkpt>
      <trkpt lat="46.528520" lon="12.017813">
        <ele>2355.589</ele>
        <time>2026-10-02T13:07:14.014Z</time>
      </trkpt>
      <trkpt lat="46.528535" lon="12.017877">
        <ele>2357.117</ele>
        <time>2026-10-02T13:07:21.014Z</time>
      </trkpt>
      <trkpt lat="46.528556" lon="12.017936">
        <ele>2358.209</ele>
        <time>2026-10-02T13:07:28.014Z</time>
      </trkpt>
      <trkpt lat="46.528577" lon="12.017995">
        <ele>2359.014</ele>
        <time>2026-10-02T13:07:41.014Z</time>
      </trkpt>
      <trkpt lat="46.528610" lon="12.018045">
        <ele>2360.210</ele>
        <time>2026-10-02T13:07:48.014Z</time>
      </trkpt>
      <trkpt lat="46.528621" lon="12.018129">
        <ele>2361.371</ele>
        <time>2026-10-02T13:08:18.014Z</time>
      </trkpt>
      <trkpt lat="46.528665" lon="12.018154">
        <ele>2362.582</ele>
        <time>2026-10-02T13:08:48.014Z</time>
      </trkpt>
      <trkpt lat="46.528698" lon="12.018205">
        <ele>2364.286</ele>
        <time>2026-10-02T13:08:59.014Z</time>
      </trkpt>
      <trkpt lat="46.528728" lon="12.018255">
        <ele>2365.363</ele>
        <time>2026-10-02T13:09:22.015Z</time>
      </trkpt>
      <trkpt lat="46.528776" lon="12.018256">
        <ele>2366.297</ele>
        <time>2026-10-02T13:09:52.015Z</time>
      </trkpt>
      <trkpt lat="46.528817" lon="12.018291">
        <ele>2367.537</ele>
        <time>2026-10-02T13:10:33.015Z</time>
      </trkpt>
      <trkpt lat="46.528855" lon="12.018332">
        <ele>2368.624</ele>
        <time>2026-10-02T13:10:37.015Z</time>
      </trkpt>
      <trkpt lat="46.528896" lon="12.018362">
        <ele>2370.191</ele>
        <time>2026-10-02T13:10:50.015Z</time>
      </trkpt>
      <trkpt lat="46.528930" lon="12.018409">
        <ele>2371.481</ele>
        <time>2026-10-02T13:11:00.015Z</time>
      </trkpt>
      <trkpt lat="46.528972" lon="12.018446">
        <ele>2372.819</ele>
        <time>2026-10-02T13:11:08.015Z</time>
      </trkpt>
      <trkpt lat="46.529013" lon="12.018491">
        <ele>2374.509</ele>
        <time>2026-10-02T13:11:17.015Z</time>
      </trkpt>
      <trkpt lat="46.529046" lon="12.018543">
        <ele>2375.421</ele>
        <time>2026-10-02T13:11:31.016Z</time>
      </trkpt>
      <trkpt lat="46.529093" lon="12.018576">
        <ele>2376.687</ele>
        <time>2026-10-02T13:11:39.016Z</time>
      </trkpt>
      <trkpt lat="46.529127" lon="12.018628">
        <ele>2378.278</ele>
        <time>2026-10-02T13:11:48.016Z</time>
      </trkpt>
      <trkpt lat="46.529164" lon="12.018671">
        <ele>2379.569</ele>
        <time>2026-10-02T13:11:57.016Z</time>
      </trkpt>
      <trkpt lat="46.529210" lon="12.018697">
        <ele>2380.693</ele>
        <time>2026-10-02T13:12:19.016Z</time>
      </trkpt>
      <trkpt lat="46.529235" lon="12.018636">
        <ele>2381.850</ele>
        <time>2026-10-02T13:13:19.015Z</time>
      </trkpt>
      <trkpt lat="46.529274" lon="12.018600">
        <ele>2383.134</ele>
        <time>2026-10-02T13:13:34.016Z</time>
      </trkpt>
      <trkpt lat="46.529304" lon="12.018550">
        <ele>2384.274</ele>
        <time>2026-10-02T13:14:30.016Z</time>
      </trkpt>
      <trkpt lat="46.529344" lon="12.018510">
        <ele>2385.221</ele>
        <time>2026-10-02T13:15:42.016Z</time>
      </trkpt>
      <trkpt lat="46.529376" lon="12.018463">
        <ele>2386.151</ele>
        <time>2026-10-02T13:15:49.016Z</time>
      </trkpt>
      <trkpt lat="46.529414" lon="12.018411">
        <ele>2386.801</ele>
        <time>2026-10-02T13:15:56.016Z</time>
      </trkpt>
      <trkpt lat="46.529450" lon="12.018355">
        <ele>2387.811</ele>
        <time>2026-10-02T13:16:05.016Z</time>
      </trkpt>
      <trkpt lat="46.529476" lon="12.018297">
        <ele>2389.209</ele>
        <time>2026-10-02T13:16:17.016Z</time>
      </trkpt>
      <trkpt lat="46.529464" lon="12.018233">
        <ele>2390.477</ele>
        <time>2026-10-02T13:16:27.016Z</time>
      </trkpt>
      <trkpt lat="46.529491" lon="12.018173">
        <ele>2391.813</ele>
        <time>2026-10-02T13:16:50.016Z</time>
      </trkpt>
      <trkpt lat="46.529522" lon="12.018114">
        <ele>2393.364</ele>
        <time>2026-10-02T13:17:14.016Z</time>
      </trkpt>
      <trkpt lat="46.529550" lon="12.018054">
        <ele>2394.725</ele>
        <time>2026-10-02T13:18:11.017Z</time>
      </trkpt>
      <trkpt lat="46.529548" lon="12.017987">
        <ele>2396.369</ele>
        <time>2026-10-02T13:18:26.017Z</time>
      </trkpt>
      <trkpt lat="46.529506" lon="12.017945">
        <ele>2397.896</ele>
        <time>2026-10-02T13:19:04.017Z</time>
      </trkpt>
      <trkpt lat="46.529505" lon="12.017868">
        <ele>2399.170</ele>
        <time>2026-10-02T13:19:39.017Z</time>
      </trkpt>
      <trkpt lat="46.529519" lon="12.017801">
        <ele>2399.950</ele>
        <time>2026-10-02T13:19:46.019Z</time>
      </trkpt>
      <trkpt lat="46.529526" lon="12.017723">
        <ele>2400.477</ele>
        <time>2026-10-02T13:19:50.019Z</time>
      </trkpt>
      <trkpt lat="46.529567" lon="12.017686">
        <ele>2401.068</ele>
        <time>2026-10-02T13:20:11.019Z</time>
      </trkpt>
      <trkpt lat="46.529606" lon="12.017632">
        <ele>2401.942</ele>
        <time>2026-10-02T13:20:43.019Z</time>
      </trkpt>
      <trkpt lat="46.529635" lon="12.017559">
        <ele>2404.026</ele>
        <time>2026-10-02T13:20:52.019Z</time>
      </trkpt>
      <trkpt lat="46.529620" lon="12.017486">
        <ele>2406.709</ele>
        <time>2026-10-02T13:21:07.019Z</time>
      </trkpt>
      <trkpt lat="46.529622" lon="12.017409">
        <ele>2408.798</ele>
        <time>2026-10-02T13:21:13.019Z</time>
      </trkpt>
      <trkpt lat="46.529619" lon="12.017338">
        <ele>2409.854</ele>
        <time>2026-10-02T13:21:25.019Z</time>
      </trkpt>
      <trkpt lat="46.529634" lon="12.017268">
        <ele>2410.815</ele>
        <time>2026-10-02T13:21:37.019Z</time>
      </trkpt>
      <trkpt lat="46.529588" lon="12.017271">
        <ele>2412.236</ele>
        <time>2026-10-02T13:22:03.020Z</time>
      </trkpt>
      <trkpt lat="46.529558" lon="12.017205">
        <ele>2413.920</ele>
        <time>2026-10-02T13:22:25.020Z</time>
      </trkpt>
      <trkpt lat="46.529605" lon="12.017225">
        <ele>2415.197</ele>
        <time>2026-10-02T13:22:34.020Z</time>
      </trkpt>
      <trkpt lat="46.529671" lon="12.017216">
        <ele>2415.561</ele>
        <time>2026-10-02T13:22:40.019Z</time>
      </trkpt>
      <trkpt lat="46.529694" lon="12.017157">
        <ele>2416.191</ele>
        <time>2026-10-02T13:22:48.019Z</time>
      </trkpt>
      <trkpt lat="46.529682" lon="12.017092">
        <ele>2416.638</ele>
        <time>2026-10-02T13:22:55.019Z</time>
      </trkpt>
      <trkpt lat="46.529667" lon="12.017030">
        <ele>2417.714</ele>
        <time>2026-10-02T13:24:05.019Z</time>
      </trkpt>
      <trkpt lat="46.529638" lon="12.016969">
        <ele>2419.154</ele>
        <time>2026-10-02T13:24:12.019Z</time>
      </trkpt>
      <trkpt lat="46.529634" lon="12.016896">
        <ele>2419.809</ele>
        <time>2026-10-02T13:24:17.019Z</time>
      </trkpt>
      <trkpt lat="46.529613" lon="12.016827">
        <ele>2420.309</ele>
        <time>2026-10-02T13:24:23.019Z</time>
      </trkpt>
      <trkpt lat="46.529595" lon="12.016755">
        <ele>2420.993</ele>
        <time>2026-10-02T13:24:29.019Z</time>
      </trkpt>
      <trkpt lat="46.529578" lon="12.016690">
        <ele>2421.599</ele>
        <time>2026-10-02T13:24:40.019Z</time>
      </trkpt>
      <trkpt lat="46.529554" lon="12.016622">
        <ele>2422.070</ele>
        <time>2026-10-02T13:24:45.019Z</time>
      </trkpt>
      <trkpt lat="46.529525" lon="12.016556">
        <ele>2422.611</ele>
        <time>2026-10-02T13:24:49.019Z</time>
      </trkpt>
      <trkpt lat="46.529517" lon="12.016487">
        <ele>2423.285</ele>
        <time>2026-10-02T13:24:55.019Z</time>
      </trkpt>
      <trkpt lat="46.529503" lon="12.016412">
        <ele>2423.872</ele>
        <time>2026-10-02T13:25:01.019Z</time>
      </trkpt>
      <trkpt lat="46.529473" lon="12.016343">
        <ele>2424.696</ele>
        <time>2026-10-02T13:25:06.019Z</time>
      </trkpt>
      <trkpt lat="46.529448" lon="12.016280">
        <ele>2425.586</ele>
        <time>2026-10-02T13:25:11.019Z</time>
      </trkpt>
      <trkpt lat="46.529430" lon="12.016219">
        <ele>2426.353</ele>
        <time>2026-10-02T13:25:15.019Z</time>
      </trkpt>
      <trkpt lat="46.529412" lon="12.016158">
        <ele>2427.244</ele>
        <time>2026-10-02T13:25:20.019Z</time>
      </trkpt>
      <trkpt lat="46.529378" lon="12.016100">
        <ele>2427.905</ele>
        <time>2026-10-02T13:25:59.019Z</time>
      </trkpt>
      <trkpt lat="46.529361" lon="12.016033">
        <ele>2428.415</ele>
        <time>2026-10-02T13:26:04.019Z</time>
      </trkpt>
      <trkpt lat="46.529332" lon="12.015981">
        <ele>2429.209</ele>
        <time>2026-10-02T13:26:09.019Z</time>
      </trkpt>
      <trkpt lat="46.529298" lon="12.015923">
        <ele>2430.266</ele>
        <time>2026-10-02T13:26:16.019Z</time>
      </trkpt>
      <trkpt lat="46.529268" lon="12.015872">
        <ele>2431.442</ele>
        <time>2026-10-02T13:26:23.019Z</time>
      </trkpt>
      <trkpt lat="46.529228" lon="12.015834">
        <ele>2432.883</ele>
        <time>2026-10-02T13:26:37.019Z</time>
      </trkpt>
      <trkpt lat="46.529187" lon="12.015777">
        <ele>2434.424</ele>
        <time>2026-10-02T13:26:44.019Z</time>
      </trkpt>
      <trkpt lat="46.529138" lon="12.015747">
        <ele>2436.268</ele>
        <time>2026-10-02T13:27:10.019Z</time>
      </trkpt>
      <trkpt lat="46.529107" lon="12.015694">
        <ele>2437.885</ele>
        <time>2026-10-02T13:27:16.019Z</time>
      </trkpt>
      <trkpt lat="46.529070" lon="12.015654">
        <ele>2439.169</ele>
        <time>2026-10-02T13:27:40.019Z</time>
      </trkpt>
      <trkpt lat="46.529025" lon="12.015595">
        <ele>2440.189</ele>
        <time>2026-10-02T13:27:47.019Z</time>
      </trkpt>
      <trkpt lat="46.528975" lon="12.015559">
        <ele>2440.466</ele>
        <time>2026-10-02T13:27:57.019Z</time>
      </trkpt>
      <trkpt lat="46.528959" lon="12.015490">
        <ele>2440.597</ele>
        <time>2026-10-02T13:28:04.019Z</time>
      </trkpt>
      <trkpt lat="46.528982" lon="12.015425">
        <ele>2440.623</ele>
        <time>2026-10-02T13:28:11.020Z</time>
      </trkpt>
      <trkpt lat="46.528996" lon="12.015361">
        <ele>2441.025</ele>
        <time>2026-10-02T13:28:16.020Z</time>
      </trkpt>
      <trkpt lat="46.529000" lon="12.015287">
        <ele>2441.809</ele>
        <time>2026-10-02T13:28:46.020Z</time>
      </trkpt>
      <trkpt lat="46.529025" lon="12.015231">
        <ele>2442.731</ele>
        <time>2026-10-02T13:28:53.020Z</time>
      </trkpt>
      <trkpt lat="46.529057" lon="12.015173">
        <ele>2443.647</ele>
        <time>2026-10-02T13:29:00.020Z</time>
      </trkpt>
      <trkpt lat="46.529091" lon="12.015120">
        <ele>2444.658</ele>
        <time>2026-10-02T13:29:16.020Z</time>
      </trkpt>
      <trkpt lat="46.529133" lon="12.015086">
        <ele>2445.679</ele>
        <time>2026-10-02T13:29:24.020Z</time>
      </trkpt>
      <trkpt lat="46.529158" lon="12.015026">
        <ele>2447.183</ele>
        <time>2026-10-02T13:29:35.020Z</time>
      </trkpt>
      <trkpt lat="46.529198" lon="12.014988">
        <ele>2448.740</ele>
        <time>2026-10-02T13:29:43.020Z</time>
      </trkpt>
      <trkpt lat="46.529244" lon="12.014951">
        <ele>2450.264</ele>
        <time>2026-10-02T13:29:54.020Z</time>
      </trkpt>
      <trkpt lat="46.529300" lon="12.014939">
        <ele>2451.894</ele>
        <time>2026-10-02T13:30:03.020Z</time>
      </trkpt>
      <trkpt lat="46.529341" lon="12.014912">
        <ele>2453.461</ele>
        <time>2026-10-02T13:30:17.018Z</time>
      </trkpt>
      <trkpt lat="46.529394" lon="12.014894">
        <ele>2455.033</ele>
        <time>2026-10-02T13:30:23.018Z</time>
      </trkpt>
      <trkpt lat="46.529354" lon="12.014928">
        <ele>2456.723</ele>
        <time>2026-10-02T13:30:37.019Z</time>
      </trkpt>
      <trkpt lat="46.529402" lon="12.014923">
        <ele>2457.915</ele>
        <time>2026-10-02T13:31:00.019Z</time>
      </trkpt>
      <trkpt lat="46.529454" lon="12.014916">
        <ele>2458.309</ele>
        <time>2026-10-02T13:31:07.019Z</time>
      </trkpt>
      <trkpt lat="46.529502" lon="12.014903">
        <ele>2458.655</ele>
        <time>2026-10-02T13:31:14.019Z</time>
      </trkpt>
      <trkpt lat="46.529549" lon="12.014906">
        <ele>2459.581</ele>
        <time>2026-10-02T13:31:22.019Z</time>
      </trkpt>
      <trkpt lat="46.529592" lon="12.014873">
        <ele>2461.252</ele>
        <time>2026-10-02T13:31:28.019Z</time>
      </trkpt>
      <trkpt lat="46.529646" lon="12.014864">
        <ele>2462.983</ele>
        <time>2026-10-02T13:31:55.019Z</time>
      </trkpt>
      <trkpt lat="46.529682" lon="12.014823">
        <ele>2464.327</ele>
        <time>2026-10-02T13:32:20.018Z</time>
      </trkpt>
      <trkpt lat="46.529670" lon="12.014748">
        <ele>2466.074</ele>
        <time>2026-10-02T13:32:26.018Z</time>
      </trkpt>
      <trkpt lat="46.529640" lon="12.014693">
        <ele>2468.168</ele>
        <time>2026-10-02T13:32:33.018Z</time>
      </trkpt>
      <trkpt lat="46.529655" lon="12.014627">
        <ele>2469.688</ele>
        <time>2026-10-02T13:32:49.019Z</time>
      </trkpt>
      <trkpt lat="46.529693" lon="12.014592">
        <ele>2470.865</ele>
        <time>2026-10-02T13:32:57.019Z</time>
      </trkpt>
      <trkpt lat="46.529729" lon="12.014546">
        <ele>2472.886</ele>
        <time>2026-10-02T13:33:10.019Z</time>
      </trkpt>
      <trkpt lat="46.529778" lon="12.014546">
        <ele>2474.860</ele>
        <time>2026-10-02T13:33:21.019Z</time>
      </trkpt>
      <trkpt lat="46.529817" lon="12.014498">
        <ele>2476.326</ele>
        <time>2026-10-02T13:33:30.019Z</time>
      </trkpt>
      <trkpt lat="46.529827" lon="12.014434">
        <ele>2477.709</ele>
        <time>2026-10-02T13:33:38.019Z</time>
      </trkpt>
      <trkpt lat="46.529813" lon="12.014360">
        <ele>2479.520</ele>
        <time>2026-10-02T13:33:52.019Z</time>
      </trkpt>
      <trkpt lat="46.529794" lon="12.014291">
        <ele>2481.566</ele>
        <time>2026-10-02T13:34:00.019Z</time>
      </trkpt>
      <trkpt lat="46.529783" lon="12.014227">
        <ele>2483.567</ele>
        <time>2026-10-02T13:34:05.019Z</time>
      </trkpt>
      <trkpt lat="46.529763" lon="12.014166">
        <ele>2485.158</ele>
        <time>2026-10-02T13:34:12.019Z</time>
      </trkpt>
      <trkpt lat="46.529743" lon="12.014097">
        <ele>2486.292</ele>
        <time>2026-10-02T13:35:11.020Z</time>
      </trkpt>
      <trkpt lat="46.529763" lon="12.014163">
        <ele>2487.579</ele>
        <time>2026-10-02T13:35:41.020Z</time>
      </trkpt>
      <trkpt lat="46.529772" lon="12.014092">
        <ele>2488.913</ele>
        <time>2026-10-02T13:38:01.020Z</time>
      </trkpt>
      <trkpt lat="46.529769" lon="12.014011">
        <ele>2489.513</ele>
        <time>2026-10-02T13:38:42.019Z</time>
      </trkpt>
      <trkpt lat="46.529733" lon="12.013972">
        <ele>2490.390</ele>
        <time>2026-10-02T13:38:51.019Z</time>
      </trkpt>
      <trkpt lat="46.529736" lon="12.013896">
        <ele>2491.849</ele>
        <time>2026-10-02T13:40:00.018Z</time>
      </trkpt>
      <trkpt lat="46.529781" lon="12.013883">
        <ele>2493.502</ele>
        <time>2026-10-02T13:40:21.018Z</time>
      </trkpt>
      <trkpt lat="46.529801" lon="12.013817">
        <ele>2495.322</ele>
        <time>2026-10-02T13:40:31.018Z</time>
      </trkpt>
      <trkpt lat="46.529781" lon="12.013756">
        <ele>2496.409</ele>
        <time>2026-10-02T13:40:36.018Z</time>
      </trkpt>
      <trkpt lat="46.529793" lon="12.013691">
        <ele>2497.596</ele>
        <time>2026-10-02T13:40:49.018Z</time>
      </trkpt>
      <trkpt lat="46.529824" lon="12.013642">
        <ele>2499.072</ele>
        <time>2026-10-02T13:42:52.019Z</time>
      </trkpt>
      <trkpt lat="46.529825" lon="12.013709">
        <ele>2500.933</ele>
        <time>2026-10-02T13:43:31.018Z</time>
      </trkpt>
      <trkpt lat="46.529776" lon="12.013731">
        <ele>2503.214</ele>
        <time>2026-10-02T13:43:47.018Z</time>
      </trkpt>
      <trkpt lat="46.529804" lon="12.013677">
        <ele>2504.248</ele>
        <time>2026-10-02T13:43:55.018Z</time>
      </trkpt>
      <trkpt lat="46.529834" lon="12.013619">
        <ele>2504.555</ele>
        <time>2026-10-02T13:44:09.018Z</time>
      </trkpt>
      <trkpt lat="46.529883" lon="12.013598">
        <ele>2504.849</ele>
        <time>2026-10-02T13:44:43.018Z</time>
      </trkpt>
      <trkpt lat="46.529932" lon="12.013587">
        <ele>2504.969</ele>
        <time>2026-10-02T13:44:48.018Z</time>
      </trkpt>
      <trkpt lat="46.529981" lon="12.013558">
        <ele>2505.866</ele>
        <time>2026-10-02T13:44:56.018Z</time>
      </trkpt>
      <trkpt lat="46.529996" lon="12.013486">
        <ele>2506.826</ele>
        <time>2026-10-02T13:45:07.018Z</time>
      </trkpt>
      <trkpt lat="46.529968" lon="12.013428">
        <ele>2508.347</ele>
        <time>2026-10-02T13:45:13.018Z</time>
      </trkpt>
      <trkpt lat="46.529927" lon="12.013394">
        <ele>2510.911</ele>
        <time>2026-10-02T13:45:21.018Z</time>
      </trkpt>
      <trkpt lat="46.529919" lon="12.013326">
        <ele>2512.809</ele>
        <time>2026-10-02T13:46:09.018Z</time>
      </trkpt>
      <trkpt lat="46.529935" lon="12.013260">
        <ele>2513.654</ele>
        <time>2026-10-02T13:46:42.018Z</time>
      </trkpt>
      <trkpt lat="46.529961" lon="12.013196">
        <ele>2514.370</ele>
        <time>2026-10-02T13:46:49.018Z</time>
      </trkpt>
      <trkpt lat="46.529988" lon="12.013138">
        <ele>2515.741</ele>
        <time>2026-10-02T13:47:09.019Z</time>
      </trkpt>
      <trkpt lat="46.529982" lon="12.013073">
        <ele>2517.582</ele>
        <time>2026-10-02T13:47:41.019Z</time>
      </trkpt>
      <trkpt lat="46.530027" lon="12.013054">
        <ele>2519.236</ele>
        <time>2026-10-02T13:47:58.019Z</time>
      </trkpt>
      <trkpt lat="46.530072" lon="12.013046">
        <ele>2521.453</ele>
        <time>2026-10-02T13:48:11.019Z</time>
      </trkpt>
      <trkpt lat="46.530032" lon="12.013013">
        <ele>2523.667</ele>
        <time>2026-10-02T13:48:31.019Z</time>
      </trkpt>
      <trkpt lat="46.530009" lon="12.012947">
        <ele>2524.877</ele>
        <time>2026-10-02T13:48:42.019Z</time>
      </trkpt>
      <trkpt lat="46.530056" lon="12.012924">
        <ele>2525.664</ele>
        <time>2026-10-02T13:48:55.019Z</time>
      </trkpt>
      <trkpt lat="46.530069" lon="12.012995">
        <ele>2525.862</ele>
        <time>2026-10-02T13:49:10.020Z</time>
      </trkpt>
      <trkpt lat="46.530117" lon="12.013001">
        <ele>2526.183</ele>
        <time>2026-10-02T13:49:15.020Z</time>
      </trkpt>
      <trkpt lat="46.530168" lon="12.012991">
        <ele>2526.111</ele>
        <time>2026-10-02T13:49:21.020Z</time>
      </trkpt>
      <trkpt lat="46.530219" lon="12.012982">
        <ele>2525.909</ele>
        <time>2026-10-02T13:49:26.020Z</time>
      </trkpt>
      <trkpt lat="46.530263" lon="12.012998">
        <ele>2525.918</ele>
        <time>2026-10-02T13:49:31.020Z</time>
      </trkpt>
      <trkpt lat="46.530312" lon="12.013000">
        <ele>2525.974</ele>
        <time>2026-10-02T13:49:36.020Z</time>
      </trkpt>
      <trkpt lat="46.530272" lon="12.012963">
        <ele>2526.145</ele>
        <time>2026-10-02T13:52:01.020Z</time>
      </trkpt>
      <trkpt lat="46.530223" lon="12.012978">
        <ele>2526.486</ele>
        <time>2026-10-02T13:52:07.020Z</time>
      </trkpt>
      <trkpt lat="46.530179" lon="12.012995">
        <ele>2527.220</ele>
        <time>2026-10-02T13:52:13.020Z</time>
      </trkpt>
      <trkpt lat="46.530130" lon="12.013021">
        <ele>2527.767</ele>
        <time>2026-10-02T13:52:19.020Z</time>
      </trkpt>
      <trkpt lat="46.530088" lon="12.013046">
        <ele>2527.751</ele>
        <time>2026-10-02T13:52:23.020Z</time>
      </trkpt>
      <trkpt lat="46.530042" lon="12.013052">
        <ele>2527.761</ele>
        <time>2026-10-02T13:52:33.020Z</time>
      </trkpt>
      <trkpt lat="46.530080" lon="12.013013">
        <ele>2527.078</ele>
        <time>2026-10-02T13:54:06.020Z</time>
      </trkpt>
      <trkpt lat="46.530125" lon="12.013012">
        <ele>2525.846</ele>
        <time>2026-10-02T13:54:11.020Z</time>
      </trkpt>
      <trkpt lat="46.530172" lon="12.013007">
        <ele>2525.588</ele>
        <time>2026-10-02T13:54:17.020Z</time>
      </trkpt>
      <trkpt lat="46.530214" lon="12.012981">
        <ele>2525.516</ele>
        <time>2026-10-02T13:54:22.020Z</time>
      </trkpt>
      <trkpt lat="46.530261" lon="12.012963">
        <ele>2525.509</ele>
        <time>2026-10-02T13:54:29.020Z</time>
      </trkpt>
      <trkpt lat="46.530304" lon="12.012942">
        <ele>2526.186</ele>
        <time>2026-10-02T13:54:35.020Z</time>
      </trkpt>
      <trkpt lat="46.530354" lon="12.012937">
        <ele>2526.942</ele>
        <time>2026-10-02T13:54:42.020Z</time>
      </trkpt>
      <trkpt lat="46.530396" lon="12.012907">
        <ele>2527.723</ele>
        <time>2026-10-02T13:54:47.020Z</time>
      </trkpt>
      <trkpt lat="46.530360" lon="12.012862">
        <ele>2528.094</ele>
        <time>2026-10-02T13:55:17.020Z</time>
      </trkpt>
      <trkpt lat="46.530340" lon="12.012791">
        <ele>2528.178</ele>
        <time>2026-10-02T13:55:23.022Z</time>
      </trkpt>
      <trkpt lat="46.530286" lon="12.012758">
        <ele>2528.525</ele>
        <time>2026-10-02T13:55:26.022Z</time>
      </trkpt>
      <trkpt lat="46.530286" lon="12.012687">
        <ele>2528.939</ele>
        <time>2026-10-02T13:55:33.022Z</time>
      </trkpt>
      <trkpt lat="46.530256" lon="12.012637">
        <ele>2529.059</ele>
        <time>2026-10-02T13:55:39.022Z</time>
      </trkpt>
      <trkpt lat="46.530223" lon="12.012590">
        <ele>2529.856</ele>
        <time>2026-10-02T13:55:45.022Z</time>
      </trkpt>
      <trkpt lat="46.530197" lon="12.012517">
        <ele>2531.252</ele>
        <time>2026-10-02T13:56:02.022Z</time>
      </trkpt>
      <trkpt lat="46.530155" lon="12.012458">
        <ele>2532.453</ele>
        <time>2026-10-02T13:56:06.022Z</time>
      </trkpt>
      <trkpt lat="46.530118" lon="12.012416">
        <ele>2534.008</ele>
        <time>2026-10-02T13:56:11.022Z</time>
      </trkpt>
      <trkpt lat="46.530105" lon="12.012341">
        <ele>2535.409</ele>
        <time>2026-10-02T13:56:16.022Z</time>
      </trkpt>
      <trkpt lat="46.530089" lon="12.012278">
        <ele>2536.487</ele>
        <time>2026-10-02T13:56:20.022Z</time>
      </trkpt>
      <trkpt lat="46.530043" lon="12.012266">
        <ele>2537.423</ele>
        <time>2026-10-02T13:56:23.022Z</time>
      </trkpt>
      <trkpt lat="46.530039" lon="12.012199">
        <ele>2538.234</ele>
        <time>2026-10-02T13:56:32.022Z</time>
      </trkpt>
      <trkpt lat="46.530051" lon="12.012126">
        <ele>2539.125</ele>
        <time>2026-10-02T13:56:38.022Z</time>
      </trkpt>
      <trkpt lat="46.529999" lon="12.012124">
        <ele>2540.469</ele>
        <time>2026-10-02T13:56:43.022Z</time>
      </trkpt>
      <trkpt lat="46.529956" lon="12.012145">
        <ele>2541.896</ele>
        <time>2026-10-02T13:56:51.022Z</time>
      </trkpt>
      <trkpt lat="46.529909" lon="12.012140">
        <ele>2542.950</ele>
        <time>2026-10-02T13:57:48.023Z</time>
      </trkpt>
      <trkpt lat="46.529960" lon="12.012188">
        <ele>2544.150</ele>
        <time>2026-10-02T13:57:53.023Z</time>
      </trkpt>
      <trkpt lat="46.529934" lon="12.012259">
        <ele>2545.327</ele>
        <time>2026-10-02T13:58:26.023Z</time>
      </trkpt>
      <trkpt lat="46.529908" lon="12.012177">
        <ele>2546.146</ele>
        <time>2026-10-02T13:58:31.023Z</time>
      </trkpt>
      <trkpt lat="46.529986" lon="12.012192">
        <ele>2546.288</ele>
        <time>2026-10-02T13:58:42.023Z</time>
      </trkpt>
      <trkpt lat="46.529945" lon="12.012224">
        <ele>2546.216</ele>
        <time>2026-10-02T13:58:48.022Z</time>
      </trkpt>
      <trkpt lat="46.529952" lon="12.012159">
        <ele>2546.209</ele>
        <time>2026-10-02T13:58:59.022Z</time>
      </trkpt>
      <trkpt lat="46.529917" lon="12.012248">
        <ele>2546.256</ele>
        <time>2026-10-02T13:59:06.022Z</time>
      </trkpt>
      <trkpt lat="46.529917" lon="12.012318">
        <ele>2546.642</ele>
        <time>2026-10-02T13:59:16.022Z</time>
      </trkpt>
      <trkpt lat="46.529927" lon="12.012239">
        <ele>2546.473</ele>
        <time>2026-10-02T13:59:22.022Z</time>
      </trkpt>
      <trkpt lat="46.529939" lon="12.012157">
        <ele>2546.674</ele>
        <time>2026-10-02T13:59:26.022Z</time>
      </trkpt>
      <trkpt lat="46.529937" lon="12.012079">
        <ele>2546.688</ele>
        <time>2026-10-02T13:59:30.023Z</time>
      </trkpt>
      <trkpt lat="46.529921" lon="12.012014">
        <ele>2546.855</ele>
        <time>2026-10-02T13:59:43.023Z</time>
      </trkpt>
      <trkpt lat="46.529956" lon="12.011957">
        <ele>2546.939</ele>
        <time>2026-10-02T14:00:18.023Z</time>
      </trkpt>
      <trkpt lat="46.529912" lon="12.011935">
        <ele>2547.719</ele>
        <time>2026-10-02T14:00:29.023Z</time>
      </trkpt>
      <trkpt lat="46.529868" lon="12.011960">
        <ele>2548.786</ele>
        <time>2026-10-02T14:00:37.023Z</time>
      </trkpt>
      <trkpt lat="46.529823" lon="12.011993">
        <ele>2550.062</ele>
        <time>2026-10-02T14:00:47.023Z</time>
      </trkpt>
      <trkpt lat="46.529810" lon="12.012059">
        <ele>2551.383</ele>
        <time>2026-10-02T14:00:55.023Z</time>
      </trkpt>
      <trkpt lat="46.529835" lon="12.012121">
        <ele>2552.411</ele>
        <time>2026-10-02T14:01:05.023Z</time>
      </trkpt>
      <trkpt lat="46.529851" lon="12.012184">
        <ele>2553.609</ele>
        <time>2026-10-02T14:01:18.023Z</time>
      </trkpt>
      <trkpt lat="46.529804" lon="12.012197">
        <ele>2554.838</ele>
        <time>2026-10-02T14:01:56.023Z</time>
      </trkpt>
      <trkpt lat="46.529773" lon="12.012246">
        <ele>2556.124</ele>
        <time>2026-10-02T14:02:05.023Z</time>
      </trkpt>
      <trkpt lat="46.529739" lon="12.012199">
        <ele>2557.955</ele>
        <time>2026-10-02T14:02:15.023Z</time>
      </trkpt>
      <trkpt lat="46.529738" lon="12.012132">
        <ele>2559.676</ele>
        <time>2026-10-02T14:02:44.023Z</time>
      </trkpt>
      <trkpt lat="46.529748" lon="12.012202">
        <ele>2561.010</ele>
        <time>2026-10-02T14:02:58.023Z</time>
      </trkpt>
      <trkpt lat="46.529712" lon="12.012155">
        <ele>2562.357</ele>
        <time>2026-10-02T14:04:07.022Z</time>
      </trkpt>
      <trkpt lat="46.529685" lon="12.012102">
        <ele>2562.861</ele>
        <time>2026-10-02T14:04:17.022Z</time>
      </trkpt>
      <trkpt lat="46.529635" lon="12.012097">
        <ele>2562.811</ele>
        <time>2026-10-02T14:04:29.022Z</time>
      </trkpt>
      <trkpt lat="46.529607" lon="12.012032">
        <ele>2563.618</ele>
        <time>2026-10-02T14:04:39.022Z</time>
      </trkpt>
      <trkpt lat="46.529561" lon="12.012047">
        <ele>2565.665</ele>
        <time>2026-10-02T14:05:39.022Z</time>
      </trkpt>
      <trkpt lat="46.529519" lon="12.012023">
        <ele>2567.668</ele>
        <time>2026-10-02T14:05:55.020Z</time>
      </trkpt>
      <trkpt lat="46.529556" lon="12.012085">
        <ele>2569.214</ele>
        <time>2026-10-02T14:06:00.099Z</time>
      </trkpt>
      <trkpt lat="46.529547" lon="12.011927">
        <ele>2570.109</ele>
        <time>2026-10-02T14:09:54.037Z</time>
      </trkpt>
      <trkpt lat="46.529512" lon="12.011975">
        <ele>2570.318</ele>
        <time>2026-10-02T14:09:57.022Z</time>
      </trkpt>
      <trkpt lat="46.529485" lon="12.012041">
        <ele>2570.364</ele>
        <time>2026-10-02T14:09:58.022Z</time>
      </trkpt>
      <trkpt lat="46.529541" lon="12.012038">
        <ele>2570.435</ele>
        <time>2026-10-02T14:10:01.022Z</time>
      </trkpt>
      <trkpt lat="46.529664" lon="12.012152">
        <ele>2570.426</ele>
        <time>2026-10-02T14:11:06.051Z</time>
      </trkpt>
      <trkpt lat="46.529657" lon="12.012274">
        <ele>2570.070</ele>
        <time>2026-10-02T14:11:07.052Z</time>
      </trkpt>
      <trkpt lat="46.529617" lon="12.012321">
        <ele>2570.097</ele>
        <time>2026-10-02T14:11:09.053Z</time>
      </trkpt>
      <trkpt lat="46.529583" lon="12.012278">
        <ele>2570.091</ele>
        <time>2026-10-02T14:11:12.024Z</time>
      </trkpt>
      <trkpt lat="46.529634" lon="12.012237">
        <ele>2570.061</ele>
        <time>2026-10-02T14:11:33.024Z</time>
      </trkpt>
      <trkpt lat="46.529595" lon="12.012194">
        <ele>2570.028</ele>
        <time>2026-10-02T14:11:39.024Z</time>
      </trkpt>
      <trkpt lat="46.529637" lon="12.012171">
        <ele>2570.086</ele>
        <time>2026-10-02T14:11:43.024Z</time>
      </trkpt>
      <trkpt lat="46.529683" lon="12.012195">
        <ele>2569.860</ele>
        <time>2026-10-02T14:11:44.024Z</time>
      </trkpt>
      <trkpt lat="46.529662" lon="12.012137">
        <ele>2569.626</ele>
        <time>2026-10-02T14:11:47.024Z</time>
      </trkpt>
      <trkpt lat="46.530858" lon="12.007862">
        <ele>2569.209</ele>
        <time>2026-10-02T14:11:53.024Z</time>
      </trkpt>
      <trkpt lat="46.530915" lon="12.007411">
        <ele>2569.230</ele>
        <time>2026-10-02T14:11:54.024Z</time>
      </trkpt>
      <trkpt lat="46.530989" lon="12.007048">
        <ele>2569.296</ele>
        <time>2026-10-02T14:11:55.024Z</time>
      </trkpt>
      <trkpt lat="46.531081" lon="12.006779">
        <ele>2569.257</ele>
        <time>2026-10-02T14:11:56.024Z</time>
      </trkpt>
      <trkpt lat="46.531148" lon="12.006406">
        <ele>2569.248</ele>
        <time>2026-10-02T14:11:57.024Z</time>
      </trkpt>
      <trkpt lat="46.529608" lon="12.012134">
        <ele>2568.732</ele>
        <time>2026-10-02T14:12:13.053Z</time>
      </trkpt>
      <trkpt lat="46.530521" lon="12.007997">
        <ele>2568.699</ele>
        <time>2026-10-02T14:12:16.052Z</time>
      </trkpt>
      <trkpt lat="46.529592" lon="12.012242">
        <ele>2568.863</ele>
        <time>2026-10-02T14:12:19.025Z</time>
      </trkpt>
      <trkpt lat="46.529593" lon="12.012143">
        <ele>2568.833</ele>
        <time>2026-10-02T14:12:23.023Z</time>
      </trkpt>
      <trkpt lat="46.529643" lon="12.012166">
        <ele>2568.810</ele>
        <time>2026-10-02T14:12:29.023Z</time>
      </trkpt>
      <trkpt lat="46.529607" lon="12.012220">
        <ele>2568.828</ele>
        <time>2026-10-02T14:12:51.024Z</time>
      </trkpt>
      <trkpt lat="46.529579" lon="12.012144">
        <ele>2568.889</ele>
        <time>2026-10-02T14:13:36.025Z</time>
      </trkpt>
      <trkpt lat="46.529602" lon="12.012073">
        <ele>2568.917</ele>
        <time>2026-10-02T14:13:37.025Z</time>
      </trkpt>
      <trkpt lat="46.529632" lon="12.011967">
        <ele>2569.509</ele>
        <time>2026-10-02T14:13:39.101Z</time>
      </trkpt>
      <trkpt lat="46.529646" lon="12.011869">
        <ele>2569.544</ele>
        <time>2026-10-02T14:13:42.069Z</time>
      </trkpt>
      <trkpt lat="46.529553" lon="12.011875">
        <ele>2569.530</ele>
        <time>2026-10-02T14:14:24.051Z</time>
      </trkpt>
      <trkpt lat="46.529575" lon="12.011963">
        <ele>2569.681</ele>
        <time>2026-10-02T14:14:25.060Z</time>
      </trkpt>
      <trkpt lat="46.529538" lon="12.012021">
        <ele>2569.842</ele>
        <time>2026-10-02T14:14:26.053Z</time>
      </trkpt>
      <trkpt lat="46.529534" lon="12.011953">
        <ele>2569.896</ele>
        <time>2026-10-02T14:15:12.027Z</time>
      </trkpt>
      <trkpt lat="46.529499" lon="12.011902">
        <ele>2569.823</ele>
        <time>2026-10-02T14:15:18.027Z</time>
      </trkpt>
      <trkpt lat="46.529495" lon="12.011837">
        <ele>2569.977</ele>
        <time>2026-10-02T14:15:30.027Z</time>
      </trkpt>
      <trkpt lat="46.529465" lon="12.011782">
        <ele>2570.187</ele>
        <time>2026-10-02T14:15:36.026Z</time>
      </trkpt>
      <trkpt lat="46.529465" lon="12.011711">
        <ele>2570.744</ele>
        <time>2026-10-02T14:15:42.026Z</time>
      </trkpt>
      <trkpt lat="46.529458" lon="12.011632">
        <ele>2571.529</ele>
        <time>2026-10-02T14:15:49.026Z</time>
      </trkpt>
      <trkpt lat="46.529457" lon="12.011561">
        <ele>2572.400</ele>
        <time>2026-10-02T14:15:56.026Z</time>
      </trkpt>
      <trkpt lat="46.529423" lon="12.011608">
        <ele>2573.720</ele>
        <time>2026-10-02T14:16:01.026Z</time>
      </trkpt>
      <trkpt lat="46.529405" lon="12.011668">
        <ele>2575.109</ele>
        <time>2026-10-02T14:16:07.026Z</time>
      </trkpt>
      <trkpt lat="46.529375" lon="12.011720">
        <ele>2576.564</ele>
        <time>2026-10-02T14:16:16.026Z</time>
      </trkpt>
      <trkpt lat="46.529338" lon="12.011760">
        <ele>2577.590</ele>
        <time>2026-10-02T14:16:25.026Z</time>
      </trkpt>
      <trkpt lat="46.529316" lon="12.011831">
        <ele>2578.451</ele>
        <time>2026-10-02T14:16:37.026Z</time>
      </trkpt>
      <trkpt lat="46.529315" lon="12.011756">
        <ele>2579.942</ele>
        <time>2026-10-02T14:17:16.024Z</time>
      </trkpt>
      <trkpt lat="46.529323" lon="12.011680">
        <ele>2581.746</ele>
        <time>2026-10-02T14:17:24.024Z</time>
      </trkpt>
      <trkpt lat="46.529351" lon="12.011623">
        <ele>2582.743</ele>
        <time>2026-10-02T14:17:50.024Z</time>
      </trkpt>
      <trkpt lat="46.529321" lon="12.011551">
        <ele>2582.877</ele>
        <time>2026-10-02T14:17:57.024Z</time>
      </trkpt>
      <trkpt lat="46.529323" lon="12.011485">
        <ele>2583.167</ele>
        <time>2026-10-02T14:18:05.024Z</time>
      </trkpt>
      <trkpt lat="46.529284" lon="12.011523">
        <ele>2584.144</ele>
        <time>2026-10-02T14:19:16.023Z</time>
      </trkpt>
      <trkpt lat="46.529247" lon="12.011560">
        <ele>2585.657</ele>
        <time>2026-10-02T14:19:22.023Z</time>
      </trkpt>
      <trkpt lat="46.529215" lon="12.011511">
        <ele>2587.300</ele>
        <time>2026-10-02T14:19:31.023Z</time>
      </trkpt>
      <trkpt lat="46.529242" lon="12.011448">
        <ele>2588.720</ele>
        <time>2026-10-02T14:19:37.023Z</time>
      </trkpt>
      <trkpt lat="46.529249" lon="12.011374">
        <ele>2589.909</ele>
        <time>2026-10-02T14:19:44.023Z</time>
      </trkpt>
      <trkpt lat="46.529202" lon="12.011377">
        <ele>2591.327</ele>
        <time>2026-10-02T14:19:51.023Z</time>
      </trkpt>
      <trkpt lat="46.529173" lon="12.011432">
        <ele>2592.493</ele>
        <time>2026-10-02T14:19:58.023Z</time>
      </trkpt>
      <trkpt lat="46.529138" lon="12.011474">
        <ele>2593.244</ele>
        <time>2026-10-02T14:20:04.023Z</time>
      </trkpt>
      <trkpt lat="46.529116" lon="12.011531">
        <ele>2594.135</ele>
        <time>2026-10-02T14:20:16.023Z</time>
      </trkpt>
      <trkpt lat="46.529094" lon="12.011589">
        <ele>2595.379</ele>
        <time>2026-10-02T14:20:22.023Z</time>
      </trkpt>
      <trkpt lat="46.529056" lon="12.011630">
        <ele>2596.946</ele>
        <time>2026-10-02T14:20:31.023Z</time>
      </trkpt>
      <trkpt lat="46.529025" lon="12.011575">
        <ele>2598.330</ele>
        <time>2026-10-02T14:21:09.021Z</time>
      </trkpt>
      <trkpt lat="46.529003" lon="12.011517">
        <ele>2599.710</ele>
        <time>2026-10-02T14:21:16.021Z</time>
      </trkpt>
      <trkpt lat="46.528982" lon="12.011451">
        <ele>2601.887</ele>
        <time>2026-10-02T14:21:23.021Z</time>
      </trkpt>
      <trkpt lat="46.529019" lon="12.011371">
        <ele>2603.699</ele>
        <time>2026-10-02T14:21:29.021Z</time>
      </trkpt>
      <trkpt lat="46.528982" lon="12.011328">
        <ele>2604.907</ele>
        <time>2026-10-02T14:21:49.021Z</time>
      </trkpt>
      <trkpt lat="46.528930" lon="12.011321">
        <ele>2605.927</ele>
        <time>2026-10-02T14:21:57.021Z</time>
      </trkpt>
      <trkpt lat="46.528902" lon="12.011379">
        <ele>2606.909</ele>
        <time>2026-10-02T14:22:06.021Z</time>
      </trkpt>
      <trkpt lat="46.528894" lon="12.011445">
        <ele>2608.281</ele>
        <time>2026-10-02T14:22:15.021Z</time>
      </trkpt>
      <trkpt lat="46.528883" lon="12.011510">
        <ele>2609.967</ele>
        <time>2026-10-02T14:22:22.021Z</time>
      </trkpt>
      <trkpt lat="46.528881" lon="12.011581">
        <ele>2611.298</ele>
        <time>2026-10-02T14:22:40.021Z</time>
      </trkpt>
      <trkpt lat="46.528850" lon="12.011633">
        <ele>2611.659</ele>
        <time>2026-10-02T14:24:13.022Z</time>
      </trkpt>
      <trkpt lat="46.528796" lon="12.011648">
        <ele>2611.713</ele>
        <time>2026-10-02T14:24:19.022Z</time>
      </trkpt>
      <trkpt lat="46.528845" lon="12.011597">
        <ele>2611.790</ele>
        <time>2026-10-02T14:24:26.022Z</time>
      </trkpt>
      <trkpt lat="46.528843" lon="12.011502">
        <ele>2611.454</ele>
        <time>2026-10-02T14:24:29.022Z</time>
      </trkpt>
      <trkpt lat="46.528876" lon="12.011563">
        <ele>2611.374</ele>
        <time>2026-10-02T14:24:32.022Z</time>
      </trkpt>
      <trkpt lat="46.528948" lon="12.011551">
        <ele>2611.231</ele>
        <time>2026-10-02T14:24:38.022Z</time>
      </trkpt>
      <trkpt lat="46.528999" lon="12.011513">
        <ele>2611.133</ele>
        <time>2026-10-02T14:24:39.022Z</time>
      </trkpt>
      <trkpt lat="46.529023" lon="12.011448">
        <ele>2610.823</ele>
        <time>2026-10-02T14:24:42.022Z</time>
      </trkpt>
      <trkpt lat="46.529010" lon="12.011535">
        <ele>2610.815</ele>
        <time>2026-10-02T14:24:47.022Z</time>
      </trkpt>
      <trkpt lat="46.529051" lon="12.011615">
        <ele>2610.809</ele>
        <time>2026-10-02T14:24:59.022Z</time>
      </trkpt>
      <trkpt lat="46.529435" lon="12.011745">
        <ele>2610.935</ele>
        <time>2026-10-02T14:25:04.022Z</time>
      </trkpt>
      <trkpt lat="46.529485" lon="12.011693">
        <ele>2610.961</ele>
        <time>2026-10-02T14:25:05.022Z</time>
      </trkpt>
      <trkpt lat="46.529517" lon="12.011581">
        <ele>2610.982</ele>
        <time>2026-10-02T14:25:06.022Z</time>
      </trkpt>
      <trkpt lat="46.529507" lon="12.011495">
        <ele>2610.963</ele>
        <time>2026-10-02T14:25:07.022Z</time>
      </trkpt>
      <trkpt lat="46.529126" lon="12.011812">
        <ele>2611.617</ele>
        <time>2026-10-02T14:25:12.022Z</time>
      </trkpt>
      <trkpt lat="46.529183" lon="12.011803">
        <ele>2611.864</ele>
        <time>2026-10-02T14:25:13.022Z</time>
      </trkpt>
      <trkpt lat="46.529123" lon="12.011808">
        <ele>2612.028</ele>
        <time>2026-10-02T14:25:14.022Z</time>
      </trkpt>
      <trkpt lat="46.529047" lon="12.011821">
        <ele>2612.148</ele>
        <time>2026-10-02T14:25:15.022Z</time>
      </trkpt>
      <trkpt lat="46.528997" lon="12.011804">
        <ele>2612.195</ele>
        <time>2026-10-02T14:25:18.022Z</time>
      </trkpt>
      <trkpt lat="46.528956" lon="12.011760">
        <ele>2612.174</ele>
        <time>2026-10-02T14:25:20.022Z</time>
      </trkpt>
      <trkpt lat="46.528911" lon="12.011685">
        <ele>2612.156</ele>
        <time>2026-10-02T14:25:22.022Z</time>
      </trkpt>
      <trkpt lat="46.528881" lon="12.011598">
        <ele>2612.021</ele>
        <time>2026-10-02T14:25:26.022Z</time>
      </trkpt>
      <trkpt lat="46.528905" lon="12.011536">
        <ele>2612.009</ele>
        <time>2026-10-02T14:25:48.022Z</time>
      </trkpt>
      <trkpt lat="46.528848" lon="12.011528">
        <ele>2612.079</ele>
        <time>2026-10-02T14:26:05.022Z</time>
      </trkpt>
      <trkpt lat="46.528805" lon="12.011495">
        <ele>2612.045</ele>
        <time>2026-10-02T14:26:58.023Z</time>
      </trkpt>
      <trkpt lat="46.528814" lon="12.011431">
        <ele>2612.436</ele>
        <time>2026-10-02T14:27:06.023Z</time>
      </trkpt>
      <trkpt lat="46.528778" lon="12.011384">
        <ele>2614.337</ele>
        <time>2026-10-02T14:27:15.023Z</time>
      </trkpt>
      <trkpt lat="46.528855" lon="12.011347">
        <ele>2616.221</ele>
        <time>2026-10-02T14:28:05.022Z</time>
      </trkpt>
      <trkpt lat="46.528802" lon="12.011330">
        <ele>2616.898</ele>
        <time>2026-10-02T14:28:07.022Z</time>
      </trkpt>
      <trkpt lat="46.528804" lon="12.011260">
        <ele>2616.912</ele>
        <time>2026-10-02T14:28:16.022Z</time>
      </trkpt>
      <trkpt lat="46.528802" lon="12.011188">
        <ele>2617.062</ele>
        <time>2026-10-02T14:28:24.022Z</time>
      </trkpt>
      <trkpt lat="46.528816" lon="12.011121">
        <ele>2617.789</ele>
        <time>2026-10-02T14:28:38.022Z</time>
      </trkpt>
      <trkpt lat="46.528805" lon="12.011048">
        <ele>2618.286</ele>
        <time>2026-10-02T14:28:46.022Z</time>
      </trkpt>
      <trkpt lat="46.528813" lon="12.010979">
        <ele>2619.360</ele>
        <time>2026-10-02T14:28:56.022Z</time>
      </trkpt>
      <trkpt lat="46.528796" lon="12.010917">
        <ele>2620.126</ele>
        <time>2026-10-02T14:29:06.022Z</time>
      </trkpt>
      <trkpt lat="46.528774" lon="12.010858">
        <ele>2620.409</ele>
        <time>2026-10-02T14:30:30.022Z</time>
      </trkpt>
      <trkpt lat="46.528735" lon="12.010815">
        <ele>2621.250</ele>
        <time>2026-10-02T14:30:38.022Z</time>
      </trkpt>
      <trkpt lat="46.528712" lon="12.010879">
        <ele>2622.736</ele>
        <time>2026-10-02T14:30:47.022Z</time>
      </trkpt>
      <trkpt lat="46.528671" lon="12.010846">
        <ele>2624.057</ele>
        <time>2026-10-02T14:31:22.023Z</time>
      </trkpt>
      <trkpt lat="46.528651" lon="12.010776">
        <ele>2625.138</ele>
        <time>2026-10-02T14:31:46.022Z</time>
      </trkpt>
      <trkpt lat="46.528617" lon="12.010828">
        <ele>2626.312</ele>
        <time>2026-10-02T14:31:58.022Z</time>
      </trkpt>
      <trkpt lat="46.528573" lon="12.010782">
        <ele>2627.439</ele>
        <time>2026-10-02T14:32:07.022Z</time>
      </trkpt>
      <trkpt lat="46.528557" lon="12.010710">
        <ele>2628.913</ele>
        <time>2026-10-02T14:32:13.022Z</time>
      </trkpt>
      <trkpt lat="46.528555" lon="12.010644">
        <ele>2630.453</ele>
        <time>2026-10-02T14:32:19.022Z</time>
      </trkpt>
      <trkpt lat="46.528545" lon="12.010577">
        <ele>2631.550</ele>
        <time>2026-10-02T14:32:25.022Z</time>
      </trkpt>
      <trkpt lat="46.528567" lon="12.010511">
        <ele>2632.648</ele>
        <time>2026-10-02T14:32:33.022Z</time>
      </trkpt>
      <trkpt lat="46.528555" lon="12.010437">
        <ele>2633.461</ele>
        <time>2026-10-02T14:32:56.021Z</time>
      </trkpt>
      <trkpt lat="46.528517" lon="12.010397">
        <ele>2634.317</ele>
        <time>2026-10-02T14:33:16.021Z</time>
      </trkpt>
      <trkpt lat="46.528467" lon="12.010413">
        <ele>2635.609</ele>
        <time>2026-10-02T14:33:22.021Z</time>
      </trkpt>
      <trkpt lat="46.528453" lon="12.010476">
        <ele>2637.446</ele>
        <time>2026-10-02T14:33:29.022Z</time>
      </trkpt>
      <trkpt lat="46.528416" lon="12.010532">
        <ele>2638.862</ele>
        <time>2026-10-02T14:33:35.022Z</time>
      </trkpt>
      <trkpt lat="46.528367" lon="12.010554">
        <ele>2639.413</ele>
        <time>2026-10-02T14:33:43.022Z</time>
      </trkpt>
      <trkpt lat="46.528380" lon="12.010630">
        <ele>2639.694</ele>
        <time>2026-10-02T14:33:53.022Z</time>
      </trkpt>
      <trkpt lat="46.528334" lon="12.010611">
        <ele>2640.168</ele>
        <time>2026-10-02T14:34:02.022Z</time>
      </trkpt>
      <trkpt lat="46.528288" lon="12.010636">
        <ele>2641.165</ele>
        <time>2026-10-02T14:34:08.022Z</time>
      </trkpt>
      <trkpt lat="46.528252" lon="12.010675">
        <ele>2641.889</ele>
        <time>2026-10-02T14:34:16.022Z</time>
      </trkpt>
      <trkpt lat="46.528215" lon="12.010728">
        <ele>2642.219</ele>
        <time>2026-10-02T14:34:37.022Z</time>
      </trkpt>
      <trkpt lat="46.528250" lon="12.010683">
        <ele>2643.196</ele>
        <time>2026-10-02T14:35:18.022Z</time>
      </trkpt>
      <trkpt lat="46.528259" lon="12.010619">
        <ele>2644.055</ele>
        <time>2026-10-02T14:35:23.022Z</time>
      </trkpt>
      <trkpt lat="46.528215" lon="12.010593">
        <ele>2644.107</ele>
        <time>2026-10-02T14:35:34.022Z</time>
      </trkpt>
      <trkpt lat="46.528239" lon="12.010524">
        <ele>2644.317</ele>
        <time>2026-10-02T14:35:56.022Z</time>
      </trkpt>
      <trkpt lat="46.528223" lon="12.010457">
        <ele>2645.309</ele>
        <time>2026-10-02T14:36:02.022Z</time>
      </trkpt>
      <trkpt lat="46.528192" lon="12.010510">
        <ele>2646.477</ele>
        <time>2026-10-02T14:36:09.022Z</time>
      </trkpt>
      <trkpt lat="46.528149" lon="12.010533">
        <ele>2647.193</ele>
        <time>2026-10-02T14:36:15.022Z</time>
      </trkpt>
      <trkpt lat="46.528104" lon="12.010549">
        <ele>2648.134</ele>
        <time>2026-10-02T14:36:21.022Z</time>
      </trkpt>
      <trkpt lat="46.528069" lon="12.010612">
        <ele>2649.045</ele>
        <time>2026-10-02T14:36:27.022Z</time>
      </trkpt>
      <trkpt lat="46.528038" lon="12.010669">
        <ele>2649.969</ele>
        <time>2026-10-02T14:36:54.022Z</time>
      </trkpt>
      <trkpt lat="46.528000" lon="12.010626">
        <ele>2650.976</ele>
        <time>2026-10-02T14:37:20.022Z</time>
      </trkpt>
      <trkpt lat="46.527956" lon="12.010637">
        <ele>2652.270</ele>
        <time>2026-10-02T14:37:29.022Z</time>
      </trkpt>
      <trkpt lat="46.527918" lon="12.010591">
        <ele>2653.660</ele>
        <time>2026-10-02T14:37:41.022Z</time>
      </trkpt>
      <trkpt lat="46.527882" lon="12.010545">
        <ele>2654.937</ele>
        <time>2026-10-02T14:37:52.022Z</time>
      </trkpt>
      <trkpt lat="46.527837" lon="12.010525">
        <ele>2656.731</ele>
        <time>2026-10-02T14:38:05.022Z</time>
      </trkpt>
      <trkpt lat="46.527801" lon="12.010567">
        <ele>2658.761</ele>
        <time>2026-10-02T14:38:11.022Z</time>
      </trkpt>
      <trkpt lat="46.527762" lon="12.010611">
        <ele>2660.707</ele>
        <time>2026-10-02T14:38:25.022Z</time>
      </trkpt>
      <trkpt lat="46.527747" lon="12.010674">
        <ele>2662.009</ele>
        <time>2026-10-02T14:38:30.022Z</time>
      </trkpt>
      <trkpt lat="46.527685" lon="12.010531">
        <ele>2663.455</ele>
        <time>2026-10-02T14:38:38.022Z</time>
      </trkpt>
      <trkpt lat="46.527732" lon="12.010518">
        <ele>2663.411</ele>
        <time>2026-10-02T14:38:39.022Z</time>
      </trkpt>
      <trkpt lat="46.527782" lon="12.010545">
        <ele>2663.852</ele>
        <time>2026-10-02T14:38:58.022Z</time>
      </trkpt>
      <trkpt lat="46.527788" lon="12.010478">
        <ele>2663.873</ele>
        <time>2026-10-02T14:39:23.022Z</time>
      </trkpt>
      <trkpt lat="46.527805" lon="12.010411">
        <ele>2663.937</ele>
        <time>2026-10-02T14:39:45.023Z</time>
      </trkpt>
      <trkpt lat="46.527811" lon="12.010339">
        <ele>2664.314</ele>
        <time>2026-10-02T14:39:52.023Z</time>
      </trkpt>
      <trkpt lat="46.527829" lon="12.010277">
        <ele>2665.118</ele>
        <time>2026-10-02T14:39:58.023Z</time>
      </trkpt>
      <trkpt lat="46.527842" lon="12.010213">
        <ele>2665.878</ele>
        <time>2026-10-02T14:40:03.023Z</time>
      </trkpt>
      <trkpt lat="46.527858" lon="12.010144">
        <ele>2666.335</ele>
        <time>2026-10-02T14:40:53.023Z</time>
      </trkpt>
      <trkpt lat="46.527874" lon="12.010071">
        <ele>2666.719</ele>
        <time>2026-10-02T14:40:58.023Z</time>
      </trkpt>
      <trkpt lat="46.527875" lon="12.010004">
        <ele>2667.109</ele>
        <time>2026-10-02T14:41:02.023Z</time>
      </trkpt>
      <trkpt lat="46.527839" lon="12.010050">
        <ele>2667.619</ele>
        <time>2026-10-02T14:41:07.023Z</time>
      </trkpt>
      <trkpt lat="46.527802" lon="12.010103">
        <ele>2668.109</ele>
        <time>2026-10-02T14:41:12.023Z</time>
      </trkpt>
      <trkpt lat="46.527746" lon="12.010136">
        <ele>2668.663</ele>
        <time>2026-10-02T14:41:18.023Z</time>
      </trkpt>
      <trkpt lat="46.527792" lon="12.010150">
        <ele>2669.179</ele>
        <time>2026-10-02T14:41:47.023Z</time>
      </trkpt>
      <trkpt lat="46.527787" lon="12.010077">
        <ele>2669.620</ele>
        <time>2026-10-02T14:41:52.024Z</time>
      </trkpt>
      <trkpt lat="46.527790" lon="12.009996">
        <ele>2669.931</ele>
        <time>2026-10-02T14:41:57.024Z</time>
      </trkpt>
      <trkpt lat="46.527789" lon="12.009915">
        <ele>2670.275</ele>
        <time>2026-10-02T14:42:04.024Z</time>
      </trkpt>
      <trkpt lat="46.527784" lon="12.009850">
        <ele>2670.672</ele>
        <time>2026-10-02T14:42:09.024Z</time>
      </trkpt>
      <trkpt lat="46.527793" lon="12.009780">
        <ele>2671.666</ele>
        <time>2026-10-02T14:42:17.024Z</time>
      </trkpt>
      <trkpt lat="46.527786" lon="12.009714">
        <ele>2672.566</ele>
        <time>2026-10-02T14:42:25.024Z</time>
      </trkpt>
      <trkpt lat="46.527762" lon="12.009656">
        <ele>2673.493</ele>
        <time>2026-10-02T14:43:05.024Z</time>
      </trkpt>
      <trkpt lat="46.527751" lon="12.009591">
        <ele>2674.218</ele>
        <time>2026-10-02T14:43:41.024Z</time>
      </trkpt>
      <trkpt lat="46.527725" lon="12.009520">
        <ele>2674.798</ele>
        <time>2026-10-02T14:44:11.025Z</time>
      </trkpt>
      <trkpt lat="46.527712" lon="12.009451">
        <ele>2675.417</ele>
        <time>2026-10-02T14:44:37.025Z</time>
      </trkpt>
      <trkpt lat="46.527670" lon="12.009418">
        <ele>2676.109</ele>
        <time>2026-10-02T14:45:01.025Z</time>
      </trkpt>
      <trkpt lat="46.527630" lon="12.009377">
        <ele>2676.743</ele>
        <time>2026-10-02T14:45:50.025Z</time>
      </trkpt>
      <trkpt lat="46.527625" lon="12.009311">
        <ele>2677.859</ele>
        <time>2026-10-02T14:46:39.025Z</time>
      </trkpt>
      <trkpt lat="46.527591" lon="12.009268">
        <ele>2679.070</ele>
        <time>2026-10-02T14:46:50.025Z</time>
      </trkpt>
      <trkpt lat="46.527568" lon="12.009203">
        <ele>2680.121</ele>
        <time>2026-10-02T14:47:06.025Z</time>
      </trkpt>
      <trkpt lat="46.527613" lon="12.009190">
        <ele>2681.375</ele>
        <time>2026-10-02T14:47:33.025Z</time>
      </trkpt>
      <trkpt lat="46.527635" lon="12.009254">
        <ele>2682.012</ele>
        <time>2026-10-02T14:47:41.025Z</time>
      </trkpt>
      <trkpt lat="46.527653" lon="12.009325">
        <ele>2682.066</ele>
        <time>2026-10-02T14:47:49.025Z</time>
      </trkpt>
      <trkpt lat="46.527636" lon="12.009397">
        <ele>2682.096</ele>
        <time>2026-10-02T14:48:05.025Z</time>
      </trkpt>
      <trkpt lat="46.527658" lon="12.009454">
        <ele>2681.563</ele>
        <time>2026-10-02T14:48:13.025Z</time>
      </trkpt>
      <trkpt lat="46.527683" lon="12.009516">
        <ele>2680.422</ele>
        <time>2026-10-02T14:48:27.025Z</time>
      </trkpt>
      <trkpt lat="46.527713" lon="12.009460">
        <ele>2679.562</ele>
        <time>2026-10-02T14:49:26.025Z</time>
      </trkpt>
      <trkpt lat="46.527718" lon="12.009385">
        <ele>2678.808</ele>
        <time>2026-10-02T14:49:33.025Z</time>
      </trkpt>
      <trkpt lat="46.527709" lon="12.009286">
        <ele>2678.809</ele>
        <time>2026-10-02T14:49:44.025Z</time>
      </trkpt>
      <trkpt lat="46.527729" lon="12.009216">
        <ele>2678.654</ele>
        <time>2026-10-02T14:50:16.026Z</time>
      </trkpt>
      <trkpt lat="46.527733" lon="12.009149">
        <ele>2678.810</ele>
        <time>2026-10-02T14:50:21.025Z</time>
      </trkpt>
      <trkpt lat="46.527744" lon="12.009072">
        <ele>2679.441</ele>
        <time>2026-10-02T14:50:26.025Z</time>
      </trkpt>
      <trkpt lat="46.527747" lon="12.008999">
        <ele>2679.862</ele>
        <time>2026-10-02T14:50:31.025Z</time>
      </trkpt>
      <trkpt lat="46.527790" lon="12.008956">
        <ele>2680.166</ele>
        <time>2026-10-02T14:50:37.025Z</time>
      </trkpt>
      <trkpt lat="46.527789" lon="12.008887">
        <ele>2680.793</ele>
        <time>2026-10-02T14:50:56.025Z</time>
      </trkpt>
      <trkpt lat="46.527812" lon="12.008825">
        <ele>2681.397</ele>
        <time>2026-10-02T14:51:00.025Z</time>
      </trkpt>
      <trkpt lat="46.527828" lon="12.008757">
        <ele>2681.867</ele>
        <time>2026-10-02T14:51:05.025Z</time>
      </trkpt>
      <trkpt lat="46.527840" lon="12.008678">
        <ele>2682.364</ele>
        <time>2026-10-02T14:51:09.025Z</time>
      </trkpt>
      <trkpt lat="46.527845" lon="12.008602">
        <ele>2682.955</ele>
        <time>2026-10-02T14:51:13.025Z</time>
      </trkpt>
      <trkpt lat="46.527807" lon="12.008668">
        <ele>2683.407</ele>
        <time>2026-10-02T14:51:16.025Z</time>
      </trkpt>
      <trkpt lat="46.527759" lon="12.008707">
        <ele>2684.117</ele>
        <time>2026-10-02T14:51:21.025Z</time>
      </trkpt>
      <trkpt lat="46.527725" lon="12.008763">
        <ele>2684.509</ele>
        <time>2026-10-02T14:51:25.025Z</time>
      </trkpt>
      <trkpt lat="46.527693" lon="12.008824">
        <ele>2685.167</ele>
        <time>2026-10-02T14:51:30.025Z</time>
      </trkpt>
      <trkpt lat="46.527662" lon="12.008875">
        <ele>2685.343</ele>
        <time>2026-10-02T14:51:35.025Z</time>
      </trkpt>
      <trkpt lat="46.527620" lon="12.008849">
        <ele>2685.874</ele>
        <time>2026-10-02T14:51:52.025Z</time>
      </trkpt>
      <trkpt lat="46.527632" lon="12.008785">
        <ele>2686.445</ele>
        <time>2026-10-02T14:52:06.025Z</time>
      </trkpt>
      <trkpt lat="46.527639" lon="12.008717">
        <ele>2687.449</ele>
        <time>2026-10-02T14:52:13.025Z</time>
      </trkpt>
      <trkpt lat="46.527651" lon="12.008644">
        <ele>2688.176</ele>
        <time>2026-10-02T14:52:18.025Z</time>
      </trkpt>
      <trkpt lat="46.527658" lon="12.008579">
        <ele>2689.170</ele>
        <time>2026-10-02T14:52:24.026Z</time>
      </trkpt>
      <trkpt lat="46.527675" lon="12.008513">
        <ele>2690.790</ele>
        <time>2026-10-02T14:52:38.026Z</time>
      </trkpt>
      <trkpt lat="46.527656" lon="12.008442">
        <ele>2691.957</ele>
        <time>2026-10-02T14:52:45.026Z</time>
      </trkpt>
      <trkpt lat="46.527670" lon="12.008364">
        <ele>2693.046</ele>
        <time>2026-10-02T14:52:51.026Z</time>
      </trkpt>
      <trkpt lat="46.527664" lon="12.008289">
        <ele>2694.388</ele>
        <time>2026-10-02T14:52:57.026Z</time>
      </trkpt>
      <trkpt lat="46.527656" lon="12.008219">
        <ele>2695.716</ele>
        <time>2026-10-02T14:53:02.026Z</time>
      </trkpt>
      <trkpt lat="46.527649" lon="12.008150">
        <ele>2697.009</ele>
        <time>2026-10-02T14:53:13.026Z</time>
      </trkpt>
      <trkpt lat="46.527655" lon="12.008083">
        <ele>2698.166</ele>
        <time>2026-10-02T14:53:19.026Z</time>
      </trkpt>
      <trkpt lat="46.527647" lon="12.008015">
        <ele>2699.462</ele>
        <time>2026-10-02T14:53:30.026Z</time>
      </trkpt>
      <trkpt lat="46.527645" lon="12.007946">
        <ele>2700.263</ele>
        <time>2026-10-02T14:53:35.026Z</time>
      </trkpt>
      <trkpt lat="46.527670" lon="12.007878">
        <ele>2700.284</ele>
        <time>2026-10-02T14:53:43.026Z</time>
      </trkpt>
      <trkpt lat="46.527688" lon="12.007947">
        <ele>2700.268</ele>
        <time>2026-10-02T14:53:56.026Z</time>
      </trkpt>
      <trkpt lat="46.527735" lon="12.007949">
        <ele>2700.255</ele>
        <time>2026-10-02T14:54:03.026Z</time>
      </trkpt>
      <trkpt lat="46.527754" lon="12.007890">
        <ele>2700.249</ele>
        <time>2026-10-02T14:54:11.026Z</time>
      </trkpt>
      <trkpt lat="46.527698" lon="12.007871">
        <ele>2700.239</ele>
        <time>2026-10-02T14:54:28.027Z</time>
      </trkpt>
      <trkpt lat="46.527645" lon="12.007865">
        <ele>2700.326</ele>
        <time>2026-10-02T14:54:33.027Z</time>
      </trkpt>
      <trkpt lat="46.527631" lon="12.007930">
        <ele>2700.416</ele>
        <time>2026-10-02T14:54:37.027Z</time>
      </trkpt>
      <trkpt lat="46.527626" lon="12.007997">
        <ele>2700.476</ele>
        <time>2026-10-02T14:54:41.027Z</time>
      </trkpt>
      <trkpt lat="46.527627" lon="12.008063">
        <ele>2700.413</ele>
        <time>2026-10-02T14:54:45.027Z</time>
      </trkpt>
      <trkpt lat="46.527669" lon="12.008116">
        <ele>2700.409</ele>
        <time>2026-10-02T14:55:05.027Z</time>
      </trkpt>
      <trkpt lat="46.527642" lon="12.008183">
        <ele>2700.313</ele>
        <time>2026-10-02T14:55:21.027Z</time>
      </trkpt>
      <trkpt lat="46.527595" lon="12.008212">
        <ele>2700.379</ele>
        <time>2026-10-02T14:55:36.027Z</time>
      </trkpt>
      <trkpt lat="46.527620" lon="12.008271">
        <ele>2700.310</ele>
        <time>2026-10-02T14:55:40.027Z</time>
      </trkpt>
      <trkpt lat="46.527645" lon="12.008335">
        <ele>2700.371</ele>
        <time>2026-10-02T14:55:46.027Z</time>
      </trkpt>
      <trkpt lat="46.527645" lon="12.008407">
        <ele>2700.285</ele>
        <time>2026-10-02T14:55:52.027Z</time>
      </trkpt>
      <trkpt lat="46.527642" lon="12.008474">
        <ele>2699.542</ele>
        <time>2026-10-02T14:55:58.027Z</time>
      </trkpt>
      <trkpt lat="46.527636" lon="12.008553">
        <ele>2698.046</ele>
        <time>2026-10-02T14:56:05.027Z</time>
      </trkpt>
      <trkpt lat="46.527628" lon="12.008618">
        <ele>2696.696</ele>
        <time>2026-10-02T14:56:08.027Z</time>
      </trkpt>
      <trkpt lat="46.527610" lon="12.008690">
        <ele>2695.243</ele>
        <time>2026-10-02T14:56:13.027Z</time>
      </trkpt>
      <trkpt lat="46.527616" lon="12.008764">
        <ele>2694.065</ele>
        <time>2026-10-02T14:56:24.027Z</time>
      </trkpt>
      <trkpt lat="46.527610" lon="12.008834">
        <ele>2693.068</ele>
        <time>2026-10-02T14:56:31.027Z</time>
      </trkpt>
      <trkpt lat="46.527593" lon="12.008912">
        <ele>2691.614</ele>
        <time>2026-10-02T14:56:37.029Z</time>
      </trkpt>
      <trkpt lat="46.527578" lon="12.008990">
        <ele>2689.909</ele>
        <time>2026-10-02T14:56:41.029Z</time>
      </trkpt>
      <trkpt lat="46.527612" lon="12.009048">
        <ele>2688.518</ele>
        <time>2026-10-02T14:56:45.029Z</time>
      </trkpt>
      <trkpt lat="46.527568" lon="12.009084">
        <ele>2687.864</ele>
        <time>2026-10-02T14:56:52.029Z</time>
      </trkpt>
      <trkpt lat="46.527519" lon="12.009067">
        <ele>2687.645</ele>
        <time>2026-10-02T14:56:58.029Z</time>
      </trkpt>
      <trkpt lat="46.527484" lon="12.008992">
        <ele>2687.676</ele>
        <time>2026-10-02T14:57:06.029Z</time>
      </trkpt>
      <trkpt lat="46.527433" lon="12.008979">
        <ele>2687.640</ele>
        <time>2026-10-02T14:57:11.029Z</time>
      </trkpt>
      <trkpt lat="46.527384" lon="12.008991">
        <ele>2687.527</ele>
        <time>2026-10-02T14:57:16.029Z</time>
      </trkpt>
      <trkpt lat="46.527249" lon="12.009009">
        <ele>2687.241</ele>
        <time>2026-10-02T14:57:22.103Z</time>
      </trkpt>
      <trkpt lat="46.527568" lon="12.008784">
        <ele>2689.261</ele>
        <time>2026-10-02T14:57:55.065Z</time>
      </trkpt>
      <trkpt lat="46.527529" lon="12.008729">
        <ele>2689.368</ele>
        <time>2026-10-02T14:57:56.067Z</time>
      </trkpt>
      <trkpt lat="46.527580" lon="12.008739">
        <ele>2689.426</ele>
        <time>2026-10-02T14:57:58.029Z</time>
      </trkpt>
      <trkpt lat="46.527540" lon="12.008783">
        <ele>2689.647</ele>
        <time>2026-10-02T14:58:00.029Z</time>
      </trkpt>
      <trkpt lat="46.527547" lon="12.008882">
        <ele>2689.811</ele>
        <time>2026-10-02T14:58:04.029Z</time>
      </trkpt>
      <trkpt lat="46.527502" lon="12.008957">
        <ele>2690.209</ele>
        <time>2026-10-02T14:58:07.029Z</time>
      </trkpt>
      <trkpt lat="46.527453" lon="12.009004">
        <ele>2690.634</ele>
        <time>2026-10-02T14:58:09.029Z</time>
      </trkpt>
      <trkpt lat="46.527413" lon="12.009034">
        <ele>2690.670</ele>
        <time>2026-10-02T14:58:10.029Z</time>
      </trkpt>
      <trkpt lat="46.527374" lon="12.009070">
        <ele>2690.691</ele>
        <time>2026-10-02T14:58:11.029Z</time>
      </trkpt>
      <trkpt lat="46.527322" lon="12.009071">
        <ele>2690.632</ele>
        <time>2026-10-02T14:58:13.029Z</time>
      </trkpt>
      <trkpt lat="46.527276" lon="12.009077">
        <ele>2690.656</ele>
        <time>2026-10-02T14:58:16.029Z</time>
      </trkpt>
      <trkpt lat="46.527241" lon="12.009123">
        <ele>2690.673</ele>
        <time>2026-10-02T14:58:18.029Z</time>
      </trkpt>
      <trkpt lat="46.527206" lon="12.009165">
        <ele>2690.657</ele>
        <time>2026-10-02T14:58:20.029Z</time>
      </trkpt>
      <trkpt lat="46.527155" lon="12.009219">
        <ele>2690.787</ele>
        <time>2026-10-02T14:58:23.029Z</time>
      </trkpt>
      <trkpt lat="46.527329" lon="12.009216">
        <ele>2690.864</ele>
        <time>2026-10-02T14:58:25.104Z</time>
      </trkpt>
      <trkpt lat="46.527645" lon="12.009314">
        <ele>2690.772</ele>
        <time>2026-10-02T14:58:53.091Z</time>
      </trkpt>
      <trkpt lat="46.527613" lon="12.009385">
        <ele>2690.713</ele>
        <time>2026-10-02T14:58:54.092Z</time>
      </trkpt>
      <trkpt lat="46.527613" lon="12.009296">
        <ele>2690.714</ele>
        <time>2026-10-02T14:58:55.074Z</time>
      </trkpt>
      <trkpt lat="46.527606" lon="12.008107">
        <ele>2690.709</ele>
        <time>2026-10-02T14:58:58.073Z</time>
      </trkpt>
      <trkpt lat="46.527608" lon="12.007946">
        <ele>2690.719</ele>
        <time>2026-10-02T14:58:59.071Z</time>
      </trkpt>
      <trkpt lat="46.527598" lon="12.007872">
        <ele>2690.745</ele>
        <time>2026-10-02T14:59:02.059Z</time>
      </trkpt>
      <trkpt lat="46.527600" lon="12.007783">
        <ele>2690.816</ele>
        <time>2026-10-02T14:59:06.057Z</time>
      </trkpt>
      <trkpt lat="46.527596" lon="12.007712">
        <ele>2691.317</ele>
        <time>2026-10-02T14:59:11.050Z</time>
      </trkpt>
      <trkpt lat="46.527562" lon="12.007771">
        <ele>2691.751</ele>
        <time>2026-10-02T14:59:16.050Z</time>
      </trkpt>
      <trkpt lat="46.527551" lon="12.007881">
        <ele>2692.778</ele>
        <time>2026-10-02T14:59:18.051Z</time>
      </trkpt>
      <trkpt lat="46.527567" lon="12.008102">
        <ele>2693.652</ele>
        <time>2026-10-02T14:59:19.053Z</time>
      </trkpt>
      <trkpt lat="46.527604" lon="12.008062">
        <ele>2693.712</ele>
        <time>2026-10-02T14:59:21.049Z</time>
      </trkpt>
      <trkpt lat="46.527615" lon="12.007991">
        <ele>2693.879</ele>
        <time>2026-10-02T14:59:24.045Z</time>
      </trkpt>
      <trkpt lat="46.527612" lon="12.007900">
        <ele>2693.953</ele>
        <time>2026-10-02T14:59:26.046Z</time>
      </trkpt>
      <trkpt lat="46.527618" lon="12.007819">
        <ele>2693.904</ele>
        <time>2026-10-02T14:59:29.045Z</time>
      </trkpt>
      <trkpt lat="46.527651" lon="12.008135">
        <ele>2693.914</ele>
        <time>2026-10-02T14:59:45.042Z</time>
      </trkpt>
      <trkpt lat="46.527662" lon="12.008681">
        <ele>2693.909</ele>
        <time>2026-10-02T14:59:47.042Z</time>
      </trkpt>
      <trkpt lat="46.527672" lon="12.008745">
        <ele>2693.997</ele>
        <time>2026-10-02T14:59:51.042Z</time>
      </trkpt>
      <trkpt lat="46.527673" lon="12.008820">
        <ele>2693.933</ele>
        <time>2026-10-02T14:59:52.043Z</time>
      </trkpt>
      <trkpt lat="46.527676" lon="12.008889">
        <ele>2693.924</ele>
        <time>2026-10-02T14:59:59.043Z</time>
      </trkpt>
      <trkpt lat="46.527663" lon="12.008953">
        <ele>2693.985</ele>
        <time>2026-10-02T15:00:09.044Z</time>
      </trkpt>
      <trkpt lat="46.527615" lon="12.008930">
        <ele>2693.989</ele>
        <time>2026-10-02T15:00:16.042Z</time>
      </trkpt>
      <trkpt lat="46.527559" lon="12.008473">
        <ele>2694.096</ele>
        <time>2026-10-02T15:05:21.044Z</time>
      </trkpt>
      <trkpt lat="46.527529" lon="12.008403">
        <ele>2693.260</ele>
        <time>2026-10-02T15:05:29.043Z</time>
      </trkpt>
      <trkpt lat="46.527494" lon="12.008340">
        <ele>2692.440</ele>
        <time>2026-10-02T15:05:32.042Z</time>
      </trkpt>
      <trkpt lat="46.527460" lon="12.008284">
        <ele>2692.217</ele>
        <time>2026-10-02T15:05:34.043Z</time>
      </trkpt>
      <trkpt lat="46.527420" lon="12.008357">
        <ele>2692.086</ele>
        <time>2026-10-02T15:05:36.043Z</time>
      </trkpt>
      <trkpt lat="46.527445" lon="12.008803">
        <ele>2690.460</ele>
        <time>2026-10-02T15:07:18.043Z</time>
      </trkpt>
      <trkpt lat="46.527428" lon="12.009032">
        <ele>2690.426</ele>
        <time>2026-10-02T15:07:19.045Z</time>
      </trkpt>
      <trkpt lat="46.527488" lon="12.008939">
        <ele>2690.409</ele>
        <time>2026-10-02T15:07:21.047Z</time>
      </trkpt>
      <trkpt lat="46.527487" lon="12.008805">
        <ele>2690.310</ele>
        <time>2026-10-02T15:07:23.050Z</time>
      </trkpt>
      <trkpt lat="46.527512" lon="12.008863">
        <ele>2690.396</ele>
        <time>2026-10-02T15:07:31.059Z</time>
      </trkpt>
      <trkpt lat="46.527518" lon="12.008948">
        <ele>2690.337</ele>
        <time>2026-10-02T15:07:34.061Z</time>
      </trkpt>
      <trkpt lat="46.527532" lon="12.009039">
        <ele>2690.328</ele>
        <time>2026-10-02T15:07:37.059Z</time>
      </trkpt>
      <trkpt lat="46.527510" lon="12.008682">
        <ele>2690.432</ele>
        <time>2026-10-02T15:07:47.050Z</time>
      </trkpt>
      <trkpt lat="46.527554" lon="12.008723">
        <ele>2690.579</ele>
        <time>2026-10-02T15:07:48.051Z</time>
      </trkpt>
      <trkpt lat="46.527602" lon="12.008852">
        <ele>2690.573</ele>
        <time>2026-10-02T15:07:51.052Z</time>
      </trkpt>
      <trkpt lat="46.527564" lon="12.008777">
        <ele>2690.713</ele>
        <time>2026-10-02T15:07:54.050Z</time>
      </trkpt>
      <trkpt lat="46.527574" lon="12.008713">
        <ele>2690.970</ele>
        <time>2026-10-02T15:07:58.050Z</time>
      </trkpt>
      <trkpt lat="46.527517" lon="12.008666">
        <ele>2691.928</ele>
        <time>2026-10-02T15:09:31.044Z</time>
      </trkpt>
      <trkpt lat="46.527471" lon="12.008720">
        <ele>2692.589</ele>
        <time>2026-10-02T15:09:32.042Z</time>
      </trkpt>
      <trkpt lat="46.527532" lon="12.008690">
        <ele>2693.217</ele>
        <time>2026-10-02T15:09:54.041Z</time>
      </trkpt>
      <trkpt lat="46.527533" lon="12.008570">
        <ele>2693.309</ele>
        <time>2026-10-02T15:11:34.040Z</time>
      </trkpt>
      <trkpt lat="46.527580" lon="12.008509">
        <ele>2693.324</ele>
        <time>2026-10-02T15:14:42.040Z</time>
      </trkpt>
    </trkseg>
  </trk></gpx>`,Yt=111320,Nc=100,jc=2.15,Gc=.95,Oc=62e-5,kt=.4,Nn=.0275,di=4702541,Hc=1100,Uc=2400;function Qc(c,e){const t=(c.lat+e.lat)/2*(Math.PI/180),a=(e.lon-c.lon)*Yt*Math.cos(t),n=(e.lat-c.lat)*Yt;return Math.hypot(a,n)}function qc(c){if(c.length<2)return c;const e=[c[0]];for(let t=1;t<c.length;t+=1){const a=e[e.length-1];Qc(a,c[t])<=Nc&&e.push(c[t])}return e}function Kc(c){if(c.length<=2)return c;const e=[];for(let a=0;a<c.length;a+=8)e.push(c[a]);const t=c[c.length-1];return e[e.length-1]!==t&&e.push(t),e}function Vc(){const e=[...new DOMParser().parseFromString(Fc,"application/xml").querySelectorAll("trkpt")].map(t=>{const a=t.querySelector("ele");return{lat:Number(t.getAttribute("lat")),lon:Number(t.getAttribute("lon")),ele:a?Number(a.textContent):0}});return Kc(qc(e))}function Wc(c){const e=c.map(r=>r.lat),t=c.map(r=>r.lon),a=c.map(r=>r.ele),n=(Math.min(...e)+Math.max(...e))/2,i=(Math.min(...t)+Math.max(...t))/2,o=Math.min(...a),s=Yt*Math.cos(n*Math.PI/180);return c.map(r=>new F((r.lon-i)*s,(r.ele-o)*jc,-(r.lat-n)*Yt))}function Ga(c){const e=document.createElement("div");e.className="path-points-ele",e.textContent=`${Math.round(c)} m`;const t=new Rc(e);return t.center.set(.5,.5),t}function Oa(c){const e=new Wt(new zo(Nn,20,16),new $e({color:di,depthTest:!1,depthWrite:!1,transparent:!0,opacity:1}));return e.position.copy(c),e.renderOrder=2,e}function Yc(c){const e=Math.random()*Math.PI*2,t=Math.acos(2*Math.random()-1),a=.07+Math.random()*.16;return c.set(Math.sin(t)*Math.cos(e)*a,Math.abs(Math.cos(t))*a*.9+.055+Math.random()*.07,Math.sin(t)*Math.sin(e)*a),c}function Xc(c,e){if(!e.length)return;const t=document.createElement("canvas");t.className="path-points-canvas",t.setAttribute("aria-hidden","true"),c.replaceChildren(t);const a=new ri({canvas:t,antialias:!0,alpha:!0});a.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),a.setClearColor(0,0),a.outputColorSpace=ne;const n=new Pc;n.domElement.className="path-points-labels",c.appendChild(n.domElement);const i=new si,o=new On(32,1,.1,200),s=new xt;i.add(s);const r=Wc(e);for(const D of r)D.y*=Gc;const p=new Hn().setFromPoints(r),d=new F,h=new F;p.getCenter(d),p.getSize(h);const g=3.4/Math.max(h.x,h.y,h.z,1),A=r.map(D=>D.clone().sub(d).multiplyScalar(g)),b=new Float32Array(A.length*3);for(let D=0;D<A.length;D+=1)b[D*3]=A[D].x,b[D*3+1]=A[D].y,b[D*3+2]=A[D].z;const f=new Et;f.setAttribute("position",new tt(b,3)),f.attributes.position.usage=Lo;const k=new Je({color:di,size:kt,sizeAttenuation:!0,transparent:!0,opacity:.92,depthWrite:!1}),w=new _t(f,k);s.add(w);const M=A[0],T=A[A.length-1],R=Oa(M),E=Oa(T);s.add(R),s.add(E);const x=Ga(e[0].ele);x.position.copy(M),x.position.y+=Nn*3.75,s.add(x);const X=Ga(e[e.length-1].ele);X.position.copy(T),X.position.y+=Nn*3.75,s.add(X),o.position.set(.6,3.6,8.6),o.lookAt(0,-.35,0);const S=new Float32Array(b);let L=null,P="idle",B=0;const H=new F,ae=new F(0,0,0),V=()=>{const D=Math.max(1,c.clientWidth),j=Math.max(1,c.clientHeight);a.setSize(D,j,!1),n.setSize(D,j),o.aspect=D/j,o.updateProjectionMatrix()};function Ee(D){R.position.set(D[0],D[1],D[2]);const j=(A.length-1)*3;E.position.set(D[j],D[j+1],D[j+2])}function St(){P="idle",L=null,b.set(S),f.attributes.position.needsUpdate=!0,k.opacity=.92,k.size=kt,R.position.copy(M),E.position.copy(T),R.material.opacity=1,E.material.opacity=1,R.visible=!0,E.visible=!0,x.visible=!0,X.visible=!0}function Be(){b.set(S),f.attributes.position.needsUpdate=!0,L=null,x.visible=!1,X.visible=!1,k.opacity=.92,k.size=kt,B=performance.now(),P="gather"}function Re(){const D=f.attributes.position.array;L=new Float32Array(A.length*3);for(let j=0;j<A.length;j+=1){const K=j*3;D[K]=ae.x,D[K+1]=ae.y,D[K+2]=ae.z,Yc(H);const $=.85+Math.random()*.55;L[K]=H.x*$,L[K+1]=H.y*$,L[K+2]=H.z*$}f.attributes.position.needsUpdate=!0,Ee(D),B=performance.now(),P="burst"}const ie=()=>{if(requestAnimationFrame(ie),P==="gather"){const D=performance.now()-B,j=Math.min(1,D/Hc),K=j*j*(3-2*j),$=f.attributes.position,re=$.array;for(let se=0;se<A.length;se+=1){const U=se*3;re[U]=S[U]+(ae.x-S[U])*K,re[U+1]=S[U+1]+(ae.y-S[U+1])*K,re[U+2]=S[U+2]+(ae.z-S[U+2])*K}$.needsUpdate=!0,Ee(re),k.size=kt*(1+K*.6),j>=1&&Re()}else if(P==="burst"&&L){const D=performance.now()-B,j=Math.min(1,D/Uc),K=f.attributes.position,$=K.array;for(let se=0;se<A.length;se+=1){const U=se*3;L[U+1]-=.00135,L[U]*=.985,L[U+1]*=.985,L[U+2]*=.985,$[U]+=L[U],$[U+1]+=L[U+1],$[U+2]+=L[U+2]}K.needsUpdate=!0,Ee($);const re=Math.max(0,1-j*j);k.opacity=.92*re,k.size=kt*(1.6+j*1.4),R.material.opacity=re,E.material.opacity=re,j>=1&&(P="idle",R.visible=!1,E.visible=!1)}else P==="idle"&&(s.rotation.y+=Oc);a.render(i,o),n.render(i,o)};return new ResizeObserver(V).observe(c),V(),ie(),{triggerFirework:Be,reset:St,resize:V}}const Jc="/experiencing/assets/home-bed-DdPufzUq.mp3",$c="/experiencing/assets/Lagazuoi-C2ZSf5F1.m4a",e0="/experiencing/assets/Sopra%20Ponte%20Outo-da%20Sentiero%2010-rifugio%20Lagazuoi%202-D8YU2a0U.m4a",t0={...Object.assign({"./geo.js":Co,"./info-float.js":Io,"./info-main.js":Do,"./info-sphere.js":Zo,"./info-styles.css":Bo,"./objViewer.js":Ro,"./pathPoints.js":Po,"./stories-data.js":Fo,"./styles.css":No,"./terrain.js":jo,"./trail-main.js":Go,"./trail-styles.css":Oo,"./trail3d.js":Ho}),...Object.assign({"../content/lagazuoi-contesto.md":Uo,"../content/storie-photopoint.md":Qo}),...Object.assign({"../scripts/export-story-zooms.py":qo,"../scripts/export-trail.py":Ko}),...Object.assign({"../index.html":Vo,"../package.json":Wo,"../trail.html":Yo,"../vite.config.js":Xo})},Ln=Object.assign({"../assets/media/15513/00-wide.jpg":Jo,"../assets/media/15513/01.jpg":$o,"../assets/media/15513/02.jpg":er,"../assets/media/15513/Screenshot 2026-10-04 alle 09.34.41.jpg":tr,"../assets/media/15513/phone/15513-phone-01-falzarego.jpg":nr,"../assets/media/15513/phone/15513-phone-02-tornante.jpg":ar,"../assets/media/15513/phone/15513-phone-03-forcella.jpg":ir,"../assets/media/15513/phone/15513-phone-04-baracca.jpg":or,"../assets/media/15513/phone/15513-phone-05-acqua.jpg":rr,"../assets/media/15513/phone/15513-phone-06-rifugio.jpg":sr,"../assets/media/15513/phone/15513-phone-07-vetta.jpg":lr,"../assets/media/29235/00-wide.jpg":cr,"../assets/media/29235/01-cane.jpg":pr,"../assets/media/29235/03-visitatrice.jpg":hr,"../assets/media/29235/04.jpg":dr,"../assets/media/29235/gopro/29235-gopro-01-trail.jpg":mr,"../assets/media/29235/gopro/29235-gopro-02-humans.jpg":ur,"../assets/media/29235/gopro/29235-gopro-03-sniff.jpg":gr,"../assets/media/29235/gopro/29235-gopro-04-deck.jpg":Ar,"../assets/media/29235/gopro/29235-gopro-05-pass.jpg":fr,"../assets/media/29235/roll/29235-roll-04-canon-borsa.jpg":br,"../assets/media/29235/roll/29235-roll-05-phone-zampe.jpg":vr,"../assets/media/29235/roll/29235-roll-06-phone-bagagliaio.jpg":kr,"../assets/media/46544/00-wide.jpg":wr,"../assets/media/46544/01.jpg":yr,"../assets/media/46544/04.jpg":Tr,"../assets/media/46544/roll/46544-roll-01-nonno-print.jpg":_r,"../assets/media/46544/roll/46544-roll-02-phone-galleria.jpg":xr,"../assets/media/46544/roll/46544-roll-05-canon-baracca.jpg":Er,"../assets/media/46544/roll/46544-roll-06-map-ravenstein-1914.jpg":Mr,"../assets/media/55826/00-wide.jpg":Sr,"../assets/media/55826/01-bacio.jpg":Lr,"../assets/media/55826/02-bacio.jpg":zr,"../assets/media/55826/03-bacio.jpg":Cr,"../assets/media/55826/04.jpg":Ir,"../assets/media/55826/roll/55826-roll-03-canon-lago.jpg":Dr,"../assets/media/55826/roll/55826-roll-04-film-bacio.jpg":Zr,"../assets/media/55826/roll/55826-roll-05-canon-canederli.jpg":Br,"../assets/media/55826/roll/55826-roll-06-scan-scontrini.jpg":Rr,"../assets/media/57198/00-wide.jpg":Pr,"../assets/media/57198/01.jpg":Fr,"../assets/media/57198/02.jpg":Nr,"../assets/media/57198/04.jpg":jr,"../assets/media/57198/phone/57198-phone-01-ref-sheep-pellets.jpg":Gr,"../assets/media/57198/phone/57198-phone-02-ref-elk-pellets.jpg":Or,"../assets/media/57198/phone/57198-phone-03-camoscio-ghiaia.jpg":Hr,"../assets/media/57198/phone/57198-phone-04-pellets-calcare.jpg":Ur,"../assets/media/57198/phone/57198-phone-06-cervo-umido.jpg":Qr,"../assets/media/57198/phone/57198-phone-07-pellets-muschio.jpg":qr,"../assets/media/57198/phone/57198-phone-08-volpe-pino.jpg":Kr,"../assets/media/62537/00-wide.jpg":Vr,"../assets/media/62537/01-pomeriggio.jpg":Wr,"../assets/media/62537/02-ingresso-sella.jpg":Yr,"../assets/media/62537/IMG_3348.jpg":Xr,"../assets/media/62537/IMG_3434.jpg":Jr,"../assets/media/62537/IMG_3435.jpg":$r,"../assets/media/62537/IMG_3436.jpg":es,"../assets/media/62537/IMG_3437.jpg":ts,"../assets/media/62537/IMG_3440.jpg":ns,"../assets/media/62537/IMG_3441.jpg":as,"../assets/media/62537/IMG_3442.mp4":is,"../assets/media/62537/IMG_3453.mp4":os,"../assets/media/62537/IMG_3457.jpg":rs,"../assets/media/62537/IMG_3464.jpg":ss,"../assets/media/62537/IMG_3466.jpg":ls,"../assets/media/62537/IMG_3471.jpg":cs,"../assets/media/62537/IMG_3473.mp4":ps,"../assets/media/62537/IMG_3474.mp4":hs,"../assets/media/62537/IMG_3475.jpg":ds,"../assets/media/62537/IMG_3489.mp4":ms,"../assets/media/62537/_DSF4706 1.jpg":us,"../assets/media/62537/_DSF4706.jpg":gs,"../assets/media/62537/_DSF4906.jpg":As,"../assets/media/65761/00-wide.jpg":fs,"../assets/media/65761/01.jpg":bs,"../assets/media/65761/WhatsApp Image 2026-10-03 at 14.39.37.jpeg":vs,"../assets/media/65761/roll/65761-roll-01-canon-cortina.jpg":ks,"../assets/media/65761/roll/65761-roll-02-phone-venezia.jpg":ws,"../assets/media/65761/roll/65761-roll-03-phone-cambio.jpg":ys,"../assets/media/65761/roll/65761-roll-05-film-venezia.jpg":Ts,"../assets/media/65761/roll/65761-roll-06-film-funivia.jpg":_s,"../assets/media/65761/roll/Screenshot 2026-10-04 alle 09.33.59.jpg":xs,"../assets/media/65761/roll/Screenshot 2026-10-04 alle 09.34.18.jpg":Es,"../assets/media/65761/roll/Screenshot 2026-10-04 alle 09.34.29.jpg":Ms,"../assets/media/67091/00-wide.jpg":Ss,"../assets/media/67091/01-famiglia.jpg":Ls,"../assets/media/67091/02.jpg":zs,"../assets/media/67091/phone/67091-phone-01-aereo-cabina.jpg":Cs,"../assets/media/67091/phone/67091-phone-02-aereo-corridoio.jpg":Is,"../assets/media/67091/phone/67091-phone-03-auto-bagagliaio.jpg":Ds,"../assets/media/67091/phone/67091-phone-04-cockpit-bambino.jpg":Zs,"../assets/media/67091/phone/67091-phone-06-auto-seggiolino.jpg":Bs,"../assets/media/67091/phone/67091-phone-08-bagagli-aeroporto.jpg":Rs,"../assets/media/67091/roll/67091-roll-01-phone-pausa.jpg":Ps,"../assets/media/72700/00-wide.jpg":Fs,"../assets/media/72700/02.jpg":Ns,"../assets/media/72700/Screenshot 2026-10-04 alle 09.33.39.jpg":js,"../assets/media/72700/phone/72700-phone-01-fucile-mannlicher.jpg":Gs,"../assets/media/72700/phone/72700-phone-02-fucile-banco.jpg":Os,"../assets/media/72700/phone/72700-phone-03-fucile-caccia.jpg":Hs,"../assets/media/72700/phone/72700-phone-04-imbalsamato-lupo.jpg":Us,"../assets/media/72700/phone/72700-phone-05-imbalsamato-daino.jpg":Qs,"../assets/media/72700/phone/72700-phone-06-forum-avvicinare.jpg":qs,"../assets/media/72700/phone/72700-phone-07-imbalsamato-testa.jpg":Ks,"../assets/media/72700/phone/72700-phone-08-imbalsamato-parete.jpg":Vs,"../assets/media/72700/roll/72700-roll-01-phone-alba.jpg":Ws,"../assets/media/83531/00-wide.jpg":Ys,"../assets/media/83531/01-colette.jpg":Xs,"../assets/media/83531/02-cannocchiale.jpg":Js,"../assets/media/83531/03-valle.jpg":$s,"../assets/media/83531/experience/IMG_3326.jpg":el,"../assets/media/83531/experience/IMG_3339.jpg":tl,"../assets/media/83531/experience/IMG_3340.jpg":nl,"../assets/media/83531/experience/IMG_3370.jpg":al,"../assets/media/92239/00-wide.jpg":il,"../assets/media/92239/01.png":ol,"../assets/media/92239/02_10_2026 3/02_10_2026.mtl":rl,"../assets/media/92239/02_10_2026 3/02_10_2026.obj":sl,"../assets/media/92239/02_10_2026 3/textures/004d15d1014b13893a7fe92ec0cb6e3b.jpg":ll,"../assets/media/92239/Gelato 3x/Gelato 3x.obj":cl,"../assets/media/92239/Gelato 3x/Gelato_3x.mtl":pl,"../assets/media/92239/Gelato 3x/textures/5045ae23f6aba02cd4529548833b61de.jpg":hl,"../assets/media/92239/Gelato 3x/textures/b73650e1e66d64d0deea2417e93d64ed.jpg":dl,"../assets/media/92239/Gelato 3x/textures/f03ce1edf811c1b908234d23451c1c89.jpg":ml,"../assets/media/92239/IMG_3377.mp4":ul,"../assets/media/92239/_DSF4659.jpg":gl,"../assets/media/92239/_DSF4686.jpg":Al,"../assets/media/92239/_DSF4748.jpg":fl,"../assets/media/92239/_DSF4776.jpg":bl,"../assets/media/92239/_DSF4822.jpg":vl,"../assets/media/92239/_DSF4856.jpg":kl,"../assets/media/92239/_DSF4872.jpg":wl,"../assets/media/92239/camminata-lunga.mp4":yl,"../assets/media/92239/giulio rotation.mp4":Tl,"../assets/media/92239/phon2_test.glb":_l}),qn=/\.(jpe?g|png|webp|gif|avif)$/i,n0=/\.(mp4|webm|mov)$/i,mi=/\.obj$/i,ui=/\.gl(b|tf)$/i,gi=/\.mtl$/i,a0=/(?:^|\/)textures\//i;function Ai(c){return a0.test(c)||gi.test(c)}function i0(c){return Ai(c)?null:ui.test(c)?"glb":mi.test(c)?"obj":n0.test(c)?"video":qn.test(c)?"image":null}function o0(c,e){return!mi.test(c)||!/phon\s*2/i.test(c)?!1:e.some(t=>ui.test(t)&&/phon\s*2/i.test(t))}function r0(c,e){const t=c.lastIndexOf("/"),a=t>=0?c.slice(0,t+1):"",n={};for(const[i,o]of Object.entries(e)){if(!i.startsWith(a)||!qn.test(i))continue;const s=i.slice(a.length);n[s]=o;const r=s.split("/").pop();r&&(n[r]=o)}return n}function s0(c,e){const t=c.lastIndexOf("/"),a=t>=0?c.slice(0,t+1):"";for(const[n,i]of Object.entries(e))if(n.startsWith(a)&&gi.test(n))return i;return null}const jn=33.25,Ha=jn*1.1,Ua=6.17,wt=.08,l0=.05,zn=280,Cn=520,c0=3200,p0=6200,h0=4,d0=8,m0=.8,u0=new Set(["83531"]),In=90,g0=10,A0=90,f0=.22,b0=.12,Qa=5,v0=1,k0=62e-5*180/Math.PI,w0=.55,y0=4.5,qa={it:`10 esperienze
pezzi di vita vissuta o di vita generata?`,en:`10 experiences
really lived or ai generated?`},Ka={it:"no, questa esperienza è in larga parte generata",en:"no, this experience is largely generated"},Va={it:"sì, questa esperienza è stata generata",en:"yes, this experience was generated"},Wa={it:"sì, questo è un pezzo di vita realmente vissuta",en:"yes, this is a piece of life truly lived"},Ut=1.2,yt=1e3,T0=18e3,_0=48e3,x0=8e3,E0=22e3,M0=.315,S0=.55;function L0(){const c=new Map;for(const[e,t]of Object.entries(Ln)){const a=e.match(/\/(\d{5})\//);if(!a)continue;const n=a[1],i=e.slice(e.lastIndexOf(`/${n}/`)+n.length+2);c.has(n)||c.set(n,[]),c.get(n)?.push({name:i,url:t,path:e})}return[...c.entries()].filter(([e])=>!u0.has(e)).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>{const a=xl[e]??{title:e.slice(-3),datetime:"",brief:"",full:"",quotes:[],real:!1,en:{brief:"",full:"",quotes:[]}},n=t.sort((h,m)=>h.name.localeCompare(m.name)),i=n.map(h=>h.name),o=n.map(h=>{const m=i0(h.name);return!m||m==="obj"&&o0(h.name,i)?null:m==="obj"?{url:h.url,name:h.name,kind:m,path:h.path,mtlUrl:s0(h.path,Ln),textureMap:r0(h.path,Ln)}:{url:h.url,name:h.name,kind:m,path:h.path}}).filter(Boolean),s=n.filter(h=>qn.test(h.name)&&!Ai(h.name)),r=e==="15513"?Mt([...s]):s,p={it:{brief:a.brief,full:a.full??"",quotes:[...a.quotes??[]]},en:{brief:a.en?.brief??a.brief,full:a.en?.full??a.full??"",quotes:[...a.en?.quotes??a.quotes??[]]}},d=ee==="en"?p.en:p.it;return{id:e,title:a.title,datetime:a.datetime,brief:d.brief,full:d.full,quotes:[...d.quotes],real:a.real===!0,i18n:p,frames:r.map(h=>h.url),gallery:o}}).filter(e=>e.frames.length>0)}let ee=new URLSearchParams(window.location.search).get("lang")?.toLowerCase()==="en"?"en":"it";function De(c,e){return c+Math.random()*(e-c)}function Mt(c){for(let e=c.length-1;e>0;e-=1){const t=Math.floor(Math.random()*(e+1)),a=c[e];c[e]=c[t],c[t]=a}return c}function z0(c){const e=[...c],t=e.findIndex(n=>{const i=n.name.split("/").pop()??n.name;return/wide/i.test(i)});if(t<0)return Mt(e);const[a]=e.splice(t,1);return Mt(e),[a,...e]}function C0(c,e){const a=(e??[]).map(o=>String(o).trim()).filter(Boolean).map((o,s)=>({kind:"quote",name:`quote-${s+1}`,url:"",text:I0(o)}));if(!a.length)return[...c];if(!c.length)return a;const n=[...c],i=Math.max(1,Math.floor(n.length/(a.length+1)));return a.forEach((o,s)=>{const r=Math.min(n.length,Math.max(1,i*(s+1)+s));n.splice(r,0,o)}),n}function I0(c){return String(c??"").trim().replace(/\.\s+/g,`.
`)}function D0(c){return 1-(1-c)**5}function Z0(c){return(1-c)**4}function Qt(c,e){!e.naturalWidth||!e.naturalHeight||(c.style.aspectRatio=`${e.naturalWidth} / ${e.naturalHeight}`)}function Ze(c,e){c.style.webkitTransform=e,c.style.transform=e}function B0(){const c=document.querySelector("#rig"),e=document.querySelector("#path-points"),t=document.querySelector("#spin"),a=document.querySelector("#home-ring"),n=document.querySelector("#lang-switch"),i=document.querySelector("#lang-it"),o=document.querySelector("#lang-en"),s=document.querySelector("#info-btn"),r=document.querySelector("#story-panel"),p=document.querySelector("#story-panel-datetime"),d=document.querySelector("#story-panel-body"),h=document.querySelector("#story-auth"),m=document.querySelector("#story-auth-real"),g=document.querySelector("#story-auth-fake"),A=document.querySelector("#story-auth-or"),b=document.querySelector(".story-auth-mark"),f=document.querySelector("#story-media"),k=document.querySelector("#story-media-grid"),w=document.querySelector("#story-browse-hint"),M=document.querySelector("#view"),T=document.querySelector(".title"),R=document.querySelector("#title-home"),E=document.querySelector(".title-prompt"),x=document.querySelector("#boot-splash"),X=document.querySelector("#boot-wide-stack"),S=document.querySelector("#real-confirm"),L=document.querySelector("#void-404"),P=document.querySelector("#lightbox"),B=document.querySelector("#lightbox-image"),H=document.querySelector("#lightbox-video"),ae=document.querySelector("#lightbox-close"),V=document.querySelector("#code-reveal"),Ee=document.querySelector("#code-reveal-rig"),St=document.querySelector("#code-reveal-caption");let Be=[],Re=[],ie=[],Ge=0,D=0,j=[],K=0,$=!1,re=null,se=!1,U=!1,Jt=null,Oe=null,le=!1,Q=!1,ue=!1,st=null,lt=null,ct=null,pt=null,ht=null,dt=null;if(!(c instanceof HTMLElement)||!(e instanceof HTMLElement)||!(t instanceof HTMLButtonElement)||!(a instanceof HTMLButtonElement)||!(n instanceof HTMLElement)||!(i instanceof HTMLButtonElement)||!(o instanceof HTMLButtonElement)||!(s instanceof HTMLElement)||!(r instanceof HTMLElement)||!(p instanceof HTMLElement)||!(d instanceof HTMLElement)||!(h instanceof HTMLElement)||!(m instanceof HTMLButtonElement)||!(g instanceof HTMLButtonElement)||!(A instanceof HTMLElement)||!(b instanceof HTMLElement)||!(f instanceof HTMLElement)||!(k instanceof HTMLElement)||!(w instanceof HTMLElement)||!(M instanceof HTMLElement)||!(T instanceof HTMLElement)||!(R instanceof HTMLButtonElement)||!(E instanceof HTMLElement)||!(x instanceof HTMLButtonElement)||!(X instanceof HTMLElement)||!(S instanceof HTMLElement)||!(L instanceof HTMLElement)||!(V instanceof HTMLElement)||!(Ee instanceof HTMLElement)||!(St instanceof HTMLElement)||!(P instanceof HTMLElement)||!(B instanceof HTMLImageElement)||!(H instanceof HTMLVideoElement)||!(ae instanceof HTMLButtonElement))return;const be=L0();if(!be.length){console.warn("No story zoom frames found");return}const mt=[...be,...be],$t=mt.length,Pe=360/$t,fi=jn/$t*Ua,en=Ha/$t*Ua*1.15,bi=en*.5,Kn=4.35,vi=en*Kn,ki=en*(Kn-2.55)*.5,Vn=[],Fe=[],wi=be.map(l=>l.gallery.find(v=>{if(v.kind!=="image")return!1;const y=v.name.split("/").pop()??v.name;return/wide/i.test(y)})?.url??null).filter(l=>l!=null),He=[];let Lt=0,tn=0,nn=!1;X.replaceChildren(),wi.forEach((l,u)=>{const v=document.createElement("img");v.src=l,v.alt="",v.draggable=!1,v.loading="eager",v.setAttribute("aria-hidden","true"),u===0&&v.classList.add("is-active"),v.addEventListener("load",()=>{v.classList.contains("is-active")&&Qt(X,v)},{once:!0}),X.appendChild(v),He.push(v)});const an=x.querySelector(".boot-splash-label");if(an instanceof HTMLElement&&He.length>0){const l=()=>{nn=!0,x.classList.add("is-wide-preview"),tn=performance.now()},u=()=>{nn=!1,x.classList.remove("is-wide-preview")};an.addEventListener("pointerenter",l),an.addEventListener("pointerleave",u),x.addEventListener("focusin",l),x.addEventListener("focusout",v=>{x.contains(v.relatedTarget)||u()})}function yi(l){if(!nn||He.length<2||l<tn||!document.body.classList.contains("is-booting"))return;He[Lt].classList.remove("is-active"),Lt=(Lt+1)%He.length;const u=He[Lt];u.classList.add("is-active"),Qt(X,u),tn=l+De(zn,Cn)}mt.forEach((l,u)=>{const v=u*Pe,y=document.createElement("div");y.className="carousel-item",y.dataset.story=l.id,y.style.width=`${fi}vw`,Ze(y,["translateX(-50%)","translateY(-50%)","rotateX(0deg)",`rotateY(${v}deg)`,`translateZ(${jn}vw)`].join(" "));const C=document.createElement("div");C.className="frame-stack";const Z=[];l.frames.forEach((Ji,ka)=>{const ye=document.createElement("img");ye.src=Ji,ye.alt=`Storia ${l.title} · frame ${ka+1}`,ye.draggable=!1,ye.loading="eager",ka===0&&ye.classList.add("is-active"),ye.addEventListener("load",()=>{ye.classList.contains("is-active")&&Qt(C,ye)},{once:!0}),C.appendChild(ye),Z.push(ye)}),y.appendChild(C),c.appendChild(y);const _=document.createElement("article");_.className="text-item",_.dataset.story=l.id,_.style.width=`${bi}vw`,_.style.height=`${vi}vw`,Ze(_,["translateX(-50%)","translateY(-50%)","translateY(10pt)",`translateY(${ki}vw)`,"translateY(var(--brief-y-extra))","rotateX(0deg)",`rotateY(${v}deg)`,`translateZ(${Ha}vw)`].join(" "));const G=document.createElement("p");G.className="text-item-head",G.textContent=l.datetime;const fe=document.createElement("p");fe.className="text-item-brief",fe.textContent=l.brief,_.append(G,fe),c.appendChild(_),Fe.push({storyId:l.id,image:y,text:_});const Ce=De(zn,Cn);Vn.push({stack:C,imgs:Z,index:0,interval:Ce,nextAt:performance.now()+De(0,Ce)})});function zt(l){document.documentElement.style.setProperty("--settle-fade-ms",`${yt}ms`),Fe.forEach((u,v)=>{const y=l===null||v===l;u.image.classList.toggle("is-hidden",!y),u.text.classList.remove("is-fading-out"),u.text.classList.toggle("is-hidden",!y)})}function Ue(){P.hidden=!0,B.hidden=!0,B.removeAttribute("src"),H.pause(),H.removeAttribute("src"),H.load(),H.hidden=!0}function Ti(l,u="image"){u==="video"?(B.hidden=!0,B.removeAttribute("src"),H.hidden=!1,H.muted=Ne,H.src=l,H.play().catch(()=>{})):(H.pause(),H.removeAttribute("src"),H.load(),H.hidden=!0,B.hidden=!1,B.src=l),P.hidden=!1}function on(l){const u=j.length;if(!u)return;K=(l%u+u)%u;const v=j[K];Ti(v.url,v.kind)}function Wn(l){P.hidden||j.length<2||on(K+l)}function ut(){Ue(),Ct(),se=!1,Jt=null;for(const l of Be)l();Be=[];for(const l of Re)l.pause(),l.removeAttribute("src"),l.load();Re=[],r.classList.remove("is-visible"),r.hidden=!0,p.textContent="",d.textContent="",h.classList.remove("is-visible"),h.hidden=!0,h.setAttribute("aria-hidden","true"),m.textContent="",g.textContent="",A.textContent="",b.textContent="",m.disabled=!1,g.disabled=!1,t.hidden=!1,f.classList.remove("is-visible"),f.hidden=!0,k.replaceChildren(),ie=[],Ge=0,D=0,j=[],K=0,$=!1,re=null}function Yn(){return ee==="en"?"scroll to browse the memories":"scorri per sfogliare i ricordi"}function Ct(){Oe!=null&&(window.clearTimeout(Oe),Oe=null),U=!1,w.classList.remove("is-visible","is-over-media"),w.hidden=!0,w.setAttribute("aria-hidden","true"),w.textContent=""}function _i(l,u){for(const v of ie){if(Number.parseFloat(v.style.opacity||"1")<.2)continue;const C=v.getBoundingClientRect();if(l>=C.left&&l<=C.right&&u>=C.top&&u<=C.bottom)return!0}return!1}function Xn(l,u){w.style.left=`${l}px`,w.style.top=`${u}px`,w.classList.toggle("is-over-media",_i(l,u))}function xi(l,u){ie.length<2||(w.textContent=Yn(),w.hidden=!1,w.setAttribute("aria-hidden","false"),Xn(l,u),U=!0,requestAnimationFrame(()=>{w.classList.add("is-visible")}),Oe!=null&&window.clearTimeout(Oe),Oe=window.setTimeout(()=>{Ct()},4200))}function Ei(l){if(!(l.pointerType&&l.pointerType!=="mouse")&&!(!W||f.hidden||ie.length<2)&&!(le||Q||ue)){if(se){se=!1,xi(l.clientX,l.clientY);return}U&&Xn(l.clientX,l.clientY)}}function rn(){L.classList.remove("is-visible"),L.hidden=!0,L.setAttribute("aria-hidden","true")}function Mi(){L.textContent=ee==="en"?Va.en:Va.it,L.hidden=!1,L.setAttribute("aria-hidden","false"),window.requestAnimationFrame(()=>{window.requestAnimationFrame(()=>{L.classList.add("is-visible")})})}function Jn(){lt!==null&&(window.clearTimeout(lt),lt=null),ct!==null&&(window.clearTimeout(ct),ct=null),pt!==null&&(window.clearTimeout(pt),pt=null),ht!==null&&(window.clearTimeout(ht),ht=null),dt!==null&&(window.clearTimeout(dt),dt=null)}function sn(){Jn(),rn(),document.body.classList.remove("is-void-collapse","is-void-invert-home"),document.querySelectorAll(".is-void-fall, .is-void-falling, .is-void-rushing").forEach(l=>{l.classList.remove("is-void-fall","is-void-falling","is-void-rushing"),l instanceof HTMLElement&&(l.style.transitionDelay="")}),le=!1}function Si(){N?.active||(Jn(),rn(),W=!1,ut(),zt(null),a.hidden=!0,z.targetIncrement=wt,t.disabled=!1,document.body.classList.remove("is-spinning","is-void-collapse"),document.body.classList.add("is-void-invert-home"),document.querySelectorAll(".is-void-fall, .is-void-falling, .is-void-rushing").forEach(l=>{l instanceof HTMLElement&&(l.style.transition="none",l.style.transitionDelay="",l.classList.remove("is-void-fall","is-void-falling","is-void-rushing"),l.offsetWidth,l.style.transition="")}),ze(),dt=window.setTimeout(()=>{dt=null,document.body.classList.remove("is-void-invert-home"),le=!1},800))}function $n(l){if(l.hidden)return!1;const u=window.getComputedStyle(l);return!(u.display==="none"||u.visibility==="hidden"||Number.parseFloat(u.opacity||"1")<.05)}function Li(){if(le||ue||Q)return;le=!0,Ue(),m.disabled=!0,g.disabled=!0,document.body.classList.add("is-void-collapse");const l=[T,t,a,s,r,h,f,M].filter($n);l.includes(n)||l.push(n);const u=$n(e);l.forEach(v=>{v.classList.add("is-void-fall")}),u&&e.classList.add("is-void-fall"),lt=window.setTimeout(()=>{lt=null;const v=l.map(G=>({el:G,kind:"fall"}));u&&v.push({el:e,kind:"rush"}),Mt(v),v.forEach((G,fe)=>{const Ce=Math.round(fe*110+Math.random()*140);G.el.style.transitionDelay=`${Ce}ms`,window.requestAnimationFrame(()=>{G.el.classList.add(G.kind==="rush"?"is-void-rushing":"is-void-falling")})});const y=v.length>0?(v.length-1)*110+140:0,Z=Math.round((y+1600+250)*.85),_=Math.max(280,Math.round(y*.35));ct=window.setTimeout(()=>{ct=null,Mi(),pt=window.setTimeout(()=>{pt=null,rn()},2e3)},_),ht=window.setTimeout(()=>{ht=null,Si()},Z)},1500)}function ln(){Q=!1,Me=!1,gt=!1,V.classList.remove("is-visible"),document.body.classList.remove("is-code-reveal"),V.hidden=!0,V.setAttribute("aria-hidden","true")}let It=-35,Dt=0,Zt=1,Me=!1,gt=!1,cn=0,pn=0;function Bt(){Ze(Ee,[`rotateY(${It}deg)`,`rotateX(${Dt}deg)`,`scale(${Zt})`].join(" "))}function zi(){It=-35,Dt=0,Zt=1,Me=!1,gt=!1,Bt()}function Ci(){Ee.replaceChildren();const l=Object.entries(t0).map(([C,Z])=>({path:C.replace(/^\.\.\//,"").replace(/^\.\//,"src/"),text:String(Z??"")})).filter(C=>C.text.length>0);for(let C=l.length-1;C>0;C--){const Z=Math.floor(Math.random()*(C+1)),_=l[C];l[C]=l[Z],l[Z]=_}const u=l.length;if(!u)return;const v=3.6,y=(u-1)*v/2;l.forEach((C,Z)=>{const _=Z*v-y,G=document.createElement("pre");G.className="code-page",G.setAttribute("aria-hidden","true");const fe=document.createElement("span");fe.className="code-page-name",fe.textContent=C.path;const Ce=document.createElement("code");Ce.className="code-page-body",Ce.textContent=C.text.slice(0,12e3),G.append(fe,Ce),G.style.transform=`translate3d(0, 0, ${_}vw) translate(-50%, -50%)`,G.style.webkitTransform=G.style.transform,Ee.appendChild(G)})}function Ii(){Q||le||ue||(Q=!0,Ue(),la(),m.disabled=!0,g.disabled=!0,ut(),Ci(),zi(),ha(),V.classList.remove("is-visible"),V.hidden=!1,V.setAttribute("aria-hidden","false"),document.body.classList.add("is-code-reveal"),a.hidden=!1,t.disabled=!0,requestAnimationFrame(()=>{requestAnimationFrame(()=>{Q&&V.classList.add("is-visible")})}))}function ea(l){if(!(le||Q||ue||!W)){if(l==="real"&&$){Oi();return}if(l==="real"&&!$){Ii();return}l==="fake"&&!$&&Li()}}function Di(l,u,v){let y=l-u;return y-=v*Math.round(y/v),y}function ta(){const l=ie.length;if(!l)return;const u=24.2,v=41.8;ie.forEach((y,C)=>{const Z=l===1?0:Di(C,Ge,l);Ze(y,["translate(-50%, -50%)",`translateX(${-Z*u}vw)`,`translateZ(${-Z*v}vw)`].join(" "));const _=Math.max(0,1-Math.abs(Z)*.42);y.style.opacity=String(_),y.style.zIndex=String(Math.round(200-Math.abs(Z)*10)),y.style.pointerEvents=Math.abs(Z)<.55?"auto":"none"})}function Zi(l){const u=ie.length;if(u<2)return;l.preventDefault(),Ct(),se=!1;const v=Math.sign(l.deltaY)*Math.min(1.15,Math.abs(l.deltaY)/100)*.55;Ge=((Ge+v)%u+u)%u,ta()}function hn(l){const u=Jt!==l.id;re=l,p.textContent=`${l.datetime}
#${l.title}`,d.textContent=l.full,r.hidden=!1,$=l.real===!0,ee==="en"?(m.textContent="real",g.textContent="fake",A.textContent="or",h.setAttribute("aria-label","real or fake?")):(m.textContent="reale",g.textContent="finto",A.textContent="o",h.setAttribute("aria-label","reale o finto?")),b.textContent="?",m.disabled=!1,g.disabled=!1,h.hidden=!1,h.setAttribute("aria-hidden","false"),t.hidden=!0;for(const y of Be)y();Be=[],Re=[],k.replaceChildren(),ie=[],Ge=0;const v=C0(z0(l.gallery??[]),l.quotes??[]);if(D=Math.max(0,v.length-1),j=v.filter(y=>y.kind==="image"||y.kind==="video").map(y=>({url:y.url,kind:y.kind})),K=0,u?(Ct(),Jt=l.id,se=v.length>=2):w.hidden||(w.textContent=Yn()),v.length){Fe.forEach(y=>{y.image.classList.add("is-hidden")});for(const y of v){if(y.kind==="quote"){const _=document.createElement("div");_.className="story-media-card story-media-quote",_.setAttribute("role","note"),_.setAttribute("aria-label","Citazione");const G=document.createElement("blockquote");G.className="story-media-quote-text",G.textContent=y.text??"",_.appendChild(G),k.appendChild(_),ie.push(_);continue}if(y.kind==="obj"||y.kind==="glb"){const _=document.createElement("div");_.className="story-media-card story-media-obj",k.appendChild(_),ie.push(_);const G=Bc(_,{url:y.url,format:y.kind,mtlUrl:y.mtlUrl??null,textureMap:y.textureMap??{},label:y.name});Be.push(G);continue}const C=j.findIndex(_=>_.url===y.url),Z=document.createElement("button");if(Z.type="button",Z.className="story-media-card",Z.setAttribute("aria-label",y.kind==="video"?"Ingrandisci video":"Ingrandisci immagine"),y.kind==="video"){const _=document.createElement("video");_.src=y.url,_.muted=!0,_.defaultMuted=!0,_.loop=!0,_.autoplay=!0,_.playsInline=!0,_.setAttribute("playsinline",""),_.setAttribute("muted",""),_.preload="auto";const G=()=>{_.play().catch(()=>{})};_.addEventListener("canplay",G),Z.appendChild(_),Re.push(_),Z.addEventListener("click",fe=>{fe.stopPropagation(),on(C)}),G()}else{const _=document.createElement("img");_.src=y.url,_.alt="",_.loading="lazy",_.draggable=!1,Z.appendChild(_),Z.addEventListener("click",G=>{G.stopPropagation(),on(C)})}k.appendChild(Z),ie.push(Z)}ta(),f.hidden=!1,f.setAttribute("aria-hidden","false")}else f.hidden=!0,f.setAttribute("aria-hidden","true");requestAnimationFrame(()=>{requestAnimationFrame(()=>{if(W){r.classList.add("is-visible"),h.classList.add("is-visible"),v.length&&f.classList.add("is-visible");for(const y of Re)y.play().catch(()=>{})}})})}ae.addEventListener("click",l=>{l.stopPropagation(),Ue()}),H.addEventListener("click",l=>{l.stopPropagation()}),P.addEventListener("click",()=>{Ue()}),document.addEventListener("keydown",l=>{if(!P.hidden){if(l.key==="Escape"){Ue();return}if(l.key==="ArrowRight"){l.preventDefault(),Wn(1);return}l.key==="ArrowLeft"&&(l.preventDefault(),Wn(-1))}});function dn(l){const u=new URL(window.location.href);l?u.searchParams.set("story",l):u.searchParams.delete("story"),window.history.replaceState({},"",u)}function Bi(l){if(!l)return-1;const u=l.trim().toLowerCase().replace(/^#/,"");if(!u)return-1;let v=be.findIndex(y=>y.id.toLowerCase()===u);return v<0&&(v=be.findIndex(y=>y.title.toLowerCase()===u)),v}function na(l,u={}){if(l<0||l>=be.length)return;const v=l,y=mt[v];if(qe=!1,N=null,le=!1,Q=!1,sn(),ln(),kn(),ut(),z.rotation=-v*Pe,z.increment=0,z.targetIncrement=0,z.dragDelta=0,z.wheel=0,W=!0,a.hidden=!1,t.disabled=!1,document.body.classList.remove("is-spinning"),Aa(),dn(y.id),wn(),u.immediate){zt(v);const C=Fe[v];C&&C.text.classList.add("is-hidden"),hn(y);return}aa(v)}function aa(l){document.documentElement.style.setProperty("--settle-fade-ms",`${yt}ms`);const u=mt[l];dn(u.id),Fe.forEach((v,y)=>{const C=y===l;if(v.image.classList.toggle("is-hidden",!C),v.text.classList.remove("is-fading-out"),!C){v.text.classList.add("is-hidden");return}v.text.classList.remove("is-hidden"),requestAnimationFrame(()=>{requestAnimationFrame(()=>{v.text.classList.add("is-fading-out")})})}),window.setTimeout(()=>{const v=Fe[l];!v||!W||(v.text.classList.add("is-hidden"),hn(u))},yt+40)}const z={rotation:0,increment:wt,targetIncrement:wt,dragDelta:0,wheel:0};let N=null,W=!1,ce=[],ia=-1,he=0,ge=0,Rt=z.rotation,Pt=Math.floor(-z.rotation/Pe),Qe=!1;function Ri(){if(ce.length===0&&(ce=Mt(Array.from({length:be.length},(u,v)=>v)),ce.length>1&&ce[ce.length-1]===ia)){const u=Math.floor(Math.random()*(ce.length-1)),v=ce[ce.length-1];ce[ce.length-1]=ce[u],ce[u]=v}const l=ce.pop();return ia=l,l}let qe=!1,mn=0;const oa=window.AudioContext||window.webkitAudioContext;let q=oa?new oa:null,At=null,ve=null,J=null,Ae=[],Ft=new Set,ft=null,ke=[],Se=[],Ke=!1,we=!0,Ne=!1,un=!1,Le=0,bt=null;q&&(fetch(Jc).then(l=>l.arrayBuffer()).then(l=>q.decodeAudioData(l)).then(l=>{At=l,un=!0,!W&&!N?.active&&ze()}).catch(l=>{console.warn("Bed audio decode failed",l)}),Promise.all([$c,e0].map(l=>fetch(l).then(u=>u.arrayBuffer()).then(u=>q.decodeAudioData(u)))).then(l=>{Ae=l.filter(Boolean),ke=Ae.map(()=>null),Se=Ae.map(()=>!1),Ke&&ra()}).catch(l=>{console.warn("Bed overlay decode failed",l)}));async function gn(){if(!q)return null;if(q.state==="suspended")try{await q.resume()}catch{}return q}function An(){if(ve){try{ve.onended=null,ve.stop()}catch{}try{ve.disconnect()}catch{}ve=null}}function Pi(){ke.forEach((l,u)=>{l!==null&&clearTimeout(l),ke[u]=null})}function fn(){Ke=!1,Pi();for(const l of Ft){try{l.onended=null,l.stop()}catch{}try{l.disconnect()}catch{}}Ft.clear(),Se=Se.map(()=>!1)}function bn(l,u=!1){if(ke[l]!=null&&(clearTimeout(ke[l]),ke[l]=null),!Ke||!q||!we||Ne||W||N?.active||!Ae[l])return;const v=u?De(x0,E0):De(T0,_0);ke[l]=setTimeout(()=>{ke[l]=null,Fi(l)},v)}function Fi(l){if(!Ke||!q||!we||Ne||W||N?.active||!Ae[l])return;if(Se[l]||Math.random()>S0){bn(l,!1);return}ft||(ft=q.createGain(),ft.gain.value=M0,ft.connect(q.destination));const u=q.createBufferSource();u.buffer=Ae[l],u.connect(ft),u.onended=()=>{Ft.delete(u),Se[l]=!1};try{u.start(0),Ft.add(u),Se[l]=!0}catch(v){console.warn("Bed overlay play failed",v),Se[l]=!1}bn(l,!1)}function ra(){if(!(W||N?.active)){if(Ae.length===0){Ke=!0;return}Ke=!0,ke.length!==Ae.length&&(ke=Ae.map(()=>null),Se=Ae.map(()=>!1)),Ae.forEach((l,u)=>{bn(u,!0)})}}function vn(l){if(!q||!At||!we||Ne)return;An(),J||(J=q.createGain(),J.connect(q.destination));try{J.gain.cancelScheduledValues(q.currentTime),J.gain.setValueAtTime(Ut,q.currentTime)}catch{J.gain.value=Ut}const u=q.createBufferSource();u.buffer=At,u.loop=!0,u.playbackRate.value=l,u.connect(J),u.start(0),ve=u}function sa(l){ve&&(ve.playbackRate.value=l)}function Nt(){bt!==null&&(clearTimeout(bt),bt=null)}function ze(){Nt(),we=!0;const l=++Le;gn().then(u=>{!u||l!==Le||!we||Ne||W||N?.active||!un||!At||(vn(v0),ra())})}function Ni(){Nt(),fn(),we=!0;const l=++Le;gn().then(u=>{!u||l!==Le||!we||Ne||!un||!At||vn(Qa)})}function ji(l){if(!we||Ne)return;const u=Z0(Math.min(1,Math.max(0,l))),v=Math.max(.35,Qa*u);if(!ve){vn(v);return}sa(v)}function la(){if(Nt(),fn(),we=!1,Le+=1,q&&J)try{J.gain.cancelScheduledValues(q.currentTime),J.gain.setValueAtTime(0,q.currentTime)}catch{J.gain.value=0}An(),J&&(J.gain.value=Ut)}function Gi(){if(Nt(),fn(),!q||!J||!ve){la();return}const l=q,u=J,v=Le,y=l.currentTime,C=yt/1e3;try{u.gain.cancelScheduledValues(y),u.gain.setValueAtTime(Math.max(u.gain.value,1e-4),y),u.gain.exponentialRampToValueAtTime(1e-4,y+C)}catch{u.gain.value=0}bt=setTimeout(()=>{if(bt=null,v===Le&&(we=!1,Le+=1,An(),J)){try{J.gain.cancelScheduledValues(l.currentTime)}catch{}J.gain.value=Ut}},yt+40)}function ca(){i.classList.toggle("is-active",ee==="it"),o.classList.toggle("is-active",ee==="en"),i.setAttribute("aria-pressed",ee==="it"?"true":"false"),o.setAttribute("aria-pressed",ee==="en"?"true":"false"),document.documentElement.lang=ee==="en"?"en":"it"}function pa(){const l=x.querySelector(".boot-splash-label")??x;l.textContent=ee==="en"?qa.en:qa.it}function ha(){St.textContent=ee==="en"?Ka.en:Ka.it}function da(){S.textContent=ee==="en"?Wa.en:Wa.it}function kn(){ue=!1,S.classList.remove("is-visible"),S.hidden=!0,S.setAttribute("aria-hidden","true"),document.body.classList.remove("is-real-confirm"),st?.reset(),requestAnimationFrame(()=>st?.resize())}function Oi(){ue||le||Q||(ue=!0,m.disabled=!0,g.disabled=!0,h.classList.remove("is-visible"),h.hidden=!0,h.setAttribute("aria-hidden","true"),t.hidden=!0,da(),S.hidden=!1,S.setAttribute("aria-hidden","false"),document.body.classList.add("is-real-confirm"),a.hidden=!1,requestAnimationFrame(()=>{st?.resize(),requestAnimationFrame(()=>{ue&&(st?.triggerFirework(),S.classList.add("is-visible"))})}))}function Hi(){for(const l of be){const u=ee==="en"?l.i18n.en:l.i18n.it;l.brief=u.brief,l.full=u.full,l.quotes=[...u.quotes]}Fe.forEach((l,u)=>{const v=l.text.querySelector(".text-item-brief");v&&(v.textContent=mt[u].brief)}),W&&re&&!ue&&!Q&&hn(re),pa(),ha(),da(),ca()}function ma(){if(!(s instanceof HTMLAnchorElement))return;const l=new URL("/experiencing/info.html",window.location.href);ee==="en"?l.searchParams.set("lang","en"):l.searchParams.delete("lang"),s.href=`${l.pathname}${l.search}`}function ua(l){if(l!=="it"&&l!=="en"||l===ee)return;ee=l;const u=new URL(window.location.href);l==="en"?u.searchParams.set("lang","en"):u.searchParams.delete("lang"),window.history.replaceState({},"",u),Hi(),ma()}i.addEventListener("click",l=>{l.stopPropagation(),ua("it")}),o.addEventListener("click",l=>{l.stopPropagation(),ua("en")}),i.addEventListener("pointerdown",l=>l.stopPropagation()),o.addEventListener("pointerdown",l=>l.stopPropagation()),s.addEventListener("pointerdown",l=>l.stopPropagation()),ma(),s.addEventListener("click",l=>{l.stopPropagation()}),ca();let ga=!1;function Ve(){ga||(ga=!0,document.removeEventListener("pointerdown",Ve,!0),document.removeEventListener("keydown",Ve,!0),gn().then(()=>{!W&&!N?.active&&!le&&!Q&&!ue&&ze()}))}document.addEventListener("pointerdown",Ve,{capture:!0}),document.addEventListener("keydown",Ve,{capture:!0});function wn(){Ze(c,`rotateY(${z.rotation}deg)`)}function Aa(){he=0,ge=0,Qe=!1,Rt=z.rotation,Pt=Math.floor(-z.rotation/Pe),Ze(E,"rotate(0deg)")}function Ui(){const l=z.rotation-Rt;Rt=z.rotation;const u=Math.abs(l);if(Qe&&N?.active){he<In&&u>0&&(he=Math.min(In,he+u*(In/A0)));const v=Math.floor(-z.rotation/Pe);v!==Pt&&(ge=g0,Pt=v)}else he>.05||ge>.05?(he+=(0-he)*b0,he<.05&&(he=0)):Qe||(he=0,ge=0);if(ge+=(0-ge)*f0,ge<.05&&(ge=0),!Qe&&he===0&&ge===0){Ze(E,"rotate(0deg)");return}Ze(E,`rotate(${he+ge}deg)`)}function Qi(l){for(const u of Vn){if(u.imgs.length<2||l<u.nextAt)continue;u.imgs[u.index].classList.remove("is-active"),u.index=(u.index+1)%u.imgs.length;const v=u.imgs[u.index];v.classList.add("is-active"),Qt(u.stack,v),u.interval=De(zn,Cn),u.nextAt=l+u.interval}}function qi(){if(N?.active||le||Q||ue||document.body.classList.contains("is-booting"))return;qe=!1,W=!1,a.hidden=!0,sn(),ln(),kn(),ut(),zt(null),z.increment=0,z.targetIncrement=0,z.dragDelta=0,z.wheel=0;const u=Ri()+(Math.random()<.5?0:be.length),v=Math.floor(De(h0,d0+1)),y=De(c0,p0)/m0;let Z=-u*Pe-v*360;for(;Z>=z.rotation;)Z-=360;for(;z.rotation-Z<v*360;)Z-=360;N={active:!0,start:performance.now(),from:z.rotation,to:Z,duration:y,slotIndex:u},Qe=!0,Rt=z.rotation,Pt=Math.floor(-z.rotation/Pe),ge=0,Ni(),t.disabled=!0,document.body.classList.add("is-spinning")}function fa(l){if(N?.active){const u=Math.min(1,(l-N.start)/N.duration),v=D0(u);z.rotation=N.from+(N.to-N.from)*v,u>=1?(z.rotation=N.to,aa(N.slotIndex),sa(.35),Gi(),N.active=!1,N=null,Qe=!1,t.disabled=!1,document.body.classList.remove("is-spinning"),W=!0,a.hidden=!1,z.targetIncrement=0,z.increment=0):ji(u)}else z.increment+=(z.targetIncrement-z.increment)*.08,z.wheel*=.9,z.rotation-=z.increment+z.dragDelta+z.wheel,z.dragDelta=0;Qi(l),yi(l),wn(),Ui(),Q&&!Me&&(It+=k0,Bt()),requestAnimationFrame(fa)}function Ki(l){N?.active||le||Q||document.body.classList.contains("is-booting")||l.target instanceof Element&&l.target.closest("#spin")||l.target instanceof Node&&(f.contains(l.target)||r.contains(l.target)||h.contains(l.target)||n.contains(l.target)||s.contains(l.target)||P.contains(l.target))||(qe=!0,mn=l.clientX,z.targetIncrement=0)}function Vi(l){if(!qe||N?.active||Q)return;const u=l.clientX-mn;mn=l.clientX,z.dragDelta+=-u*l0*10}function ba(){qe&&(qe=!1,N?.active||(z.targetIncrement=W?0:wt))}function Wi(l){if(le||Q){l.preventDefault();return}if(!P.contains(l.target)){if(W&&f.classList.contains("is-visible")&&D>0){Zi(l);return}if(N?.active){l.preventDefault();return}l.preventDefault(),z.wheel+=l.deltaY*.01,z.targetIncrement=0}}function jt(){N?.active||document.body.classList.contains("is-booting")||(W=!1,sn(),ln(),kn(),ut(),zt(null),a.hidden=!0,z.targetIncrement=wt,t.disabled=!1,document.body.classList.remove("is-spinning"),Aa(),dn(null),ze())}m.addEventListener("click",l=>{l.stopPropagation(),ea("real")}),g.addEventListener("click",l=>{l.stopPropagation(),ea("fake")}),m.addEventListener("pointerdown",l=>l.stopPropagation()),g.addEventListener("pointerdown",l=>l.stopPropagation()),t.addEventListener("click",l=>{l.stopPropagation(),qi()}),t.addEventListener("pointerdown",l=>l.stopPropagation()),a.addEventListener("pointerdown",l=>{l.stopPropagation(),!N?.active&&!Q&&ze()}),a.addEventListener("click",l=>{l.stopPropagation(),jt()}),R.addEventListener("pointerdown",l=>{l.stopPropagation(),!N?.active&&!Q&&ze()}),R.addEventListener("click",l=>{l.stopPropagation(),jt()}),V.addEventListener("pointerdown",l=>{if(Q&&!(l.target instanceof Element&&l.target.closest("#home-ring"))){l.stopPropagation(),Me=!0,gt=!1,cn=l.clientX,pn=l.clientY;try{V.setPointerCapture(l.pointerId)}catch{}}}),V.addEventListener("pointermove",l=>{if(!Me||!Q)return;l.stopPropagation();const u=l.clientX-cn,v=l.clientY-pn;cn=l.clientX,pn=l.clientY,Math.abs(u)+Math.abs(v)>2&&(gt=!0),It+=u*.4,Dt=Math.max(-80,Math.min(80,Dt-v*.4)),Bt()}),V.addEventListener("pointerup",l=>{if(Me){l.stopPropagation(),Me=!1;try{V.releasePointerCapture(l.pointerId)}catch{}!gt&&Q&&jt()}}),V.addEventListener("pointercancel",()=>{Me=!1}),V.addEventListener("wheel",l=>{if(!Q)return;l.preventDefault(),l.stopPropagation();const u=l.deltaY>0?.9:1.1;Zt=Math.min(y0,Math.max(w0,Zt*u)),Bt()},{passive:!1}),window.addEventListener("keydown",l=>{l.key==="Escape"&&Q&&(l.preventDefault(),jt())}),document.body.addEventListener("pointerdown",Ki),window.addEventListener("pointermove",Vi),window.addEventListener("pointermove",Ei),window.addEventListener("pointerup",ba),window.addEventListener("pointercancel",ba),window.addEventListener("wheel",Wi,{passive:!1}),wn(),requestAnimationFrame(fa);const va=new URLSearchParams(window.location.search),Gt=Bi(va.get("story")),Yi=va.get("rings")==="1";let yn=!1;pa(),st=Xc(e,Vc())??null;function Xi(l){l?.preventDefault?.(),l?.stopPropagation?.(),!(yn||!document.body.classList.contains("is-booting"))&&(yn=!0,Ve(),ze(),document.body.classList.remove("is-booting"),x.classList.add("is-leaving"),x.disabled=!0,window.setTimeout(()=>{x.hidden=!0,x.classList.remove("is-leaving")},550),Gt>=0?na(Gt,{immediate:!0}):!W&&!N?.active&&(t.disabled=!1))}if(Yi){const l=new URL(window.location.href);l.searchParams.delete("rings"),window.history.replaceState({},"",l),yn=!0,x.hidden=!0,x.disabled=!0,document.body.classList.remove("is-booting"),Ve(),ze(),Gt>=0?na(Gt,{immediate:!0}):t.disabled=!1}else x.hidden=!1,document.body.classList.add("is-booting"),t.disabled=!0,x.addEventListener("click",Xi),x.addEventListener("pointerdown",l=>l.stopPropagation())}B0();

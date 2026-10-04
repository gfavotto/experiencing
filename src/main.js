import "./styles.css";
import { STORY_COPY } from "./stories-data.js";
import { mountObjViewer } from "./objViewer.js";
import { loadGpxPoints, mountPathPoints } from "./pathPoints.js";
import bedUrl from "../assets/media/audio/home-bed.mp3?url";
import bedOverlayAUrl from "../assets/media/audio/Lagazuoi.m4a?url";
import bedOverlayBUrl from "../assets/media/audio/Sopra Ponte Outo-da Sentiero 10-rifugio Lagazuoi 2.m4a?url";

/** Project sources for the “false real” code wall (dense, not meant to be read). */
const codeRawModules = {
  ...import.meta.glob("./**/*.{js,css}", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
  ...import.meta.glob("../content/**/*.md", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
  ...import.meta.glob("../scripts/**/*.py", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
  ...import.meta.glob(
    "../{index.html,trail.html,vite.config.js,package.json}",
    {
      eager: true,
      query: "?raw",
      import: "default",
    },
  ),
};

/**
 * Frenzy Image landscape carousel — fixed camera, spinning rings only.
 * Inner ring: story image sequences.
 * Outer ring (+10% radius): brief texts, same angles as matching stories.
 * #spin: fortune-wheel stop on a random story.
 */

/** All media under each story folder (and subfolders), incl. OBJ/GLB (+ MTL for materials). */
/** @type {Record<string, string>} */
const frameModules = import.meta.glob(
  "../assets/media/[0-9][0-9][0-9][0-9][0-9]/**/*.{jpg,jpeg,png,webp,gif,avif,mp4,webm,mov,obj,mtl,glb,gltf}",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

const CAROUSEL_IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const VIDEO_RE = /\.(mp4|webm|mov)$/i;
const OBJ_RE = /\.obj$/i;
const GLB_RE = /\.gl(b|tf)$/i;
const MTL_RE = /\.mtl$/i;
/** Photogrammetry texture packs — gallery/carousel noise, keep for OBJ loading. */
const TEXTURE_DIR_RE = /(?:^|\/)textures\//i;

/**
 * @param {string} name path relative to story id folder
 */
function isTexturePackFile(name) {
  return TEXTURE_DIR_RE.test(name) || MTL_RE.test(name);
}

/**
 * @param {string} name
 * @returns {"image" | "video" | "obj" | "glb" | null}
 */
function galleryKind(name) {
  if (isTexturePackFile(name)) return null;
  if (GLB_RE.test(name)) return "glb";
  if (OBJ_RE.test(name)) return "obj";
  if (VIDEO_RE.test(name)) return "video";
  if (CAROUSEL_IMAGE_RE.test(name)) return "image";
  return null;
}

/**
 * Drop Phon 2.obj when phon2_test.glb (or similar) is present in the same story.
 * @param {string} name
 * @param {string[]} names
 */
function isObjReplacedByGlb(name, names) {
  if (!OBJ_RE.test(name) || !/phon\s*2/i.test(name)) return false;
  return names.some((n) => GLB_RE.test(n) && /phon\s*2/i.test(n));
}

/**
 * Map relative texture paths next to an OBJ to Vite URLs.
 * @param {string} objPath glob key of the .obj
 * @param {Record<string, string>} modules
 */
function textureMapForObj(objPath, modules) {
  const slash = objPath.lastIndexOf("/");
  const dir = slash >= 0 ? objPath.slice(0, slash + 1) : "";
  /** @type {Record<string, string>} */
  const map = {};
  for (const [path, url] of Object.entries(modules)) {
    if (!path.startsWith(dir)) continue;
    if (!CAROUSEL_IMAGE_RE.test(path)) continue;
    const rel = path.slice(dir.length);
    map[rel] = url;
    const base = rel.split("/").pop();
    if (base) map[base] = url;
  }
  return map;
}

/**
 * @param {string} objPath
 * @param {Record<string, string>} modules
 */
function mtlUrlForObj(objPath, modules) {
  const slash = objPath.lastIndexOf("/");
  const dir = slash >= 0 ? objPath.slice(0, slash + 1) : "";
  for (const [path, url] of Object.entries(modules)) {
    if (path.startsWith(dir) && MTL_RE.test(path)) return url;
  }
  return null;
}

const RADIUS = 33.25; // vw (5% under previous 35)
const RADIUS_TEXT = RADIUS * 1.1; // outer circumference
const SIZE_FACTOR = 6.17;
const AUTO_INCREMENT = 0.08;
const DRAG_SPEED = 0.05;
const FRAME_MS_MIN = 280;
const FRAME_MS_MAX = 520;
const SPIN_MS_MIN = 3200;
const SPIN_MS_MAX = 6200;
const SPIN_TURNS_MIN = 4;
const SPIN_TURNS_MAX = 8;
/** Peak spin angular speed scale (1 = previous; 0.8 ≈ 20% slower peak). */
const SPIN_SPEED_SCALE = 0.8;
/** Story ids hidden from the two circumferences (and spin deck). */
const RING_EXCLUDE_IDS = new Set(["83531"]);
/** “prompt” hangs as a pointer during spin (deg). */
const PROMPT_POINTER_DEG = 90;
/** Extra flex when a story peg passes the pointer (deg). */
const PROMPT_FLEX_DEG = 10;
/** Ring degrees of travel to fully deploy the 90° pointer pose. */
const PROMPT_DEPLOY_RING_DEG = 90;
/** Per-frame spring toward 0 after each peg hit. */
const PROMPT_FLEX_SPRING = 0.22;
/** Per-frame return of the base pointer angle after settle. */
const PROMPT_RETURN_SPRING = 0.12;
/** Peak rate at spin start (Web Audio BufferSource — works better than HTMLAudio on Safari). */
const BED_RATE_SPIN_MAX = 5;
const BED_RATE_HOME = 1;
/** Idle yaw for code-reveal pages — same pace as GPS cloud (~0.00062 rad/frame). */
const CODE_REVEAL_SPIN_DEG = (0.00062 * 180) / Math.PI;
/** Wheel zoom limits for the code-page stack. */
const CODE_REVEAL_SCALE_MIN = 0.55;
const CODE_REVEAL_SCALE_MAX = 4.5;
/** Intro splash copy — dismissed by clicking the green text (unlocks audio). */
const BOOT_SPLASH_COPY = {
  it: "10 esperienze\nquali sono vissute e quali no?",
  en: "10 experiences\nwhich are lived and which are not?",
};
const CODE_REVEAL_CAPTION_COPY = {
  it: "no, non è un'esperienza realmente vissuta",
  en: "no, this is not a truly lived experience",
};
const REAL_CONFIRM_COPY = {
  it: "sì, questo è un pezzo di vita realmente vissuta",
  en: "yes, this is a piece of life truly lived",
};
/** Home bed loop level (+20% vs unity). */
const BED_GAIN_HOME = 1.2;
/** Fade-out duration for bed + outer text after settle. */
const BED_STOP_DELAY_MS = 1000;
/** Sparse random gaps — overlays appear occasionally, not as a continuous layer. */
const BED_OVERLAY_GAP_MIN_MS = 18000;
const BED_OVERLAY_GAP_MAX_MS = 48000;
/** First cue after home bed starts (still sparse). */
const BED_OVERLAY_FIRST_MIN_MS = 8000;
const BED_OVERLAY_FIRST_MAX_MS = 22000;
/** Quiet under the bed so home-bed stays dominant. */
const BED_OVERLAY_GAIN = 0.315;
/** Chance a scheduled cue actually plays (keeps arrivals irregular). */
const BED_OVERLAY_PLAY_CHANCE = 0.55;

/**
 * @returns {{
 *   id: string,
 *   frames: string[],
 *   gallery: {
 *     url: string,
 *     name: string,
 *     kind: "image" | "video" | "obj" | "glb" | "quote",
 *     path: string,
 *     text?: string,
 *     mtlUrl?: string | null,
 *     textureMap?: Record<string, string>,
 *   }[],
 *   title: string,
 *   datetime: string,
 *   brief: string,
 *   full: string,
 *   quotes: string[],
 *   real: boolean,
 * }[]}
 */
function loadStories() {
  /** @type {Map<string, { name: string, url: string, path: string }[]>} */
  const byId = new Map();

  for (const [path, url] of Object.entries(frameModules)) {
    const match = path.match(/\/(\d{5})\//);
    if (!match) continue;
    const id = match[1];
    const name = path.slice(path.lastIndexOf(`/${id}/`) + id.length + 2);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)?.push({
      name,
      url: /** @type {string} */ (url),
      path,
    });
  }

  return [...byId.entries()]
    .filter(([id]) => !RING_EXCLUDE_IDS.has(id))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, frames]) => {
      const copy = STORY_COPY[id] ?? {
        title: id.slice(-3),
        datetime: "",
        brief: "",
        full: "",
        quotes: [],
        real: false,
        en: { brief: "", full: "", quotes: [] },
      };
      const sorted = frames.sort((a, b) => a.name.localeCompare(b.name));
      const allNames = sorted.map((f) => f.name);
      // Gallery: images / videos / OBJ / GLB (not MTL or /textures/)
      const gallery = sorted
        .map((f) => {
          const kind = galleryKind(f.name);
          if (!kind) return null;
          if (kind === "obj" && isObjReplacedByGlb(f.name, allNames)) return null;
          if (kind === "obj") {
            return {
              url: f.url,
              name: f.name,
              kind,
              path: f.path,
              mtlUrl: mtlUrlForObj(f.path, frameModules),
              textureMap: textureMapForObj(f.path, frameModules),
            };
          }
          return { url: f.url, name: f.name, kind, path: f.path };
        })
        .filter(Boolean);
      // Carousel: stills only — never OBJ, video, or texture packs
      const carouselSource = sorted.filter(
        (f) => CAROUSEL_IMAGE_RE.test(f.name) && !isTexturePackFile(f.name),
      );
      // 15513 carousel: random frame order each load
      const frameList =
        id === "15513"
          ? shuffleInPlace([...carouselSource])
          : carouselSource;
      const i18n = {
        it: {
          brief: copy.brief,
          full: copy.full ?? "",
          quotes: [...(copy.quotes ?? [])],
        },
        en: {
          brief: copy.en?.brief ?? copy.brief,
          full: copy.en?.full ?? copy.full ?? "",
          quotes: [...(copy.en?.quotes ?? copy.quotes ?? [])],
        },
      };
      const pack = storyLang === "en" ? i18n.en : i18n.it;
      return {
        id,
        title: copy.title,
        datetime: copy.datetime,
        brief: pack.brief,
        full: pack.full,
        quotes: [...pack.quotes],
        real: copy.real === true,
        i18n,
        frames: frameList.map((f) => f.url),
        gallery,
      };
    })
    .filter((s) => s.frames.length > 0);
}

/** UI language for story prose: `?lang=en` or default Italian. */
let storyLang =
  new URLSearchParams(window.location.search).get("lang")?.toLowerCase() ===
  "en"
    ? "en"
    : "it";

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

/** Fisher–Yates shuffle (in place). */
function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/**
 * Depth stack order: "wide" media first when present; shuffle the rest.
 * @template {{ name: string }} T
 * @param {T[]} gallery
 * @returns {T[]}
 */
function orderGalleryWithWideFirst(gallery) {
  const items = [...gallery];
  const wideIdx = items.findIndex((item) => {
    const base = item.name.split("/").pop() ?? item.name;
    return /wide/i.test(base);
  });
  if (wideIdx < 0) return shuffleInPlace(items);
  const [wide] = items.splice(wideIdx, 1);
  shuffleInPlace(items);
  return [wide, ...items];
}

/**
 * Insert diary/chat quotes into the depth stack (never first if media exists).
 * @template {{ name: string, kind: string }} T
 * @param {T[]} gallery
 * @param {string[]} quotes
 * @returns {(T | { kind: "quote", name: string, url: string, text: string })[]}
 */
function withQuoteSlides(gallery, quotes) {
  const lines = (quotes ?? []).map((t) => String(t).trim()).filter(Boolean);
  /** @type {{ kind: "quote", name: string, url: string, text: string }[]} */
  const quoteCards = lines.map((text, i) => ({
    kind: "quote",
    name: `quote-${i + 1}`,
    url: "",
    text: formatQuoteLineBreaks(text),
  }));
  if (!quoteCards.length) return [...gallery];
  if (!gallery.length) return quoteCards;

  const result = [...gallery];
  const step = Math.max(1, Math.floor(result.length / (quoteCards.length + 1)));
  quoteCards.forEach((card, i) => {
    const at = Math.min(result.length, Math.max(1, step * (i + 1) + i));
    result.splice(at, 0, card);
  });
  return result;
}

/** New line after each sentence-ending period (keeps the “.”). */
function formatQuoteLineBreaks(text) {
  return String(text ?? "")
    .trim()
    .replace(/\.\s+/g, ".\n");
}

const PHOTOPOINT_URL = "https://lagazuoi.it/IT/fotopoint.php";

/** @param {string} text */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Full story prose with Photopoint → external link (new window). */
function renderStoryFullHtml(full) {
  return escapeHtml(full).replace(
    /Photopoint/g,
    `<a class="story-photopoint-link" href="${PHOTOPOINT_URL}" target="_blank" rel="noopener noreferrer">Photopoint</a>`,
  );
}

/** @param {number} t */
function easeOutQuint(t) {
  return 1 - (1 - t) ** 5;
}

/** Normalized angular speed for easeOutQuint (1 at t=0 → 0 at t=1). */
function easeOutQuintSpeed(t) {
  return (1 - t) ** 4;
}

/**
 * @param {HTMLElement} stack
 * @param {HTMLImageElement} img
 */
function syncStackAspect(stack, img) {
  if (!img.naturalWidth || !img.naturalHeight) return;
  stack.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
}

/**
 * @param {HTMLElement} el
 * @param {string} value
 */
function setTransform(el, value) {
  el.style.webkitTransform = value;
  el.style.transform = value;
}

function boot() {
  const rig = document.querySelector("#rig");
  const pathPointsHost = document.querySelector("#path-points");
  const spinBtn = document.querySelector("#spin");
  const homeBtn = document.querySelector("#home-ring");
  const langSwitch = document.querySelector("#lang-switch");
  const langItBtn = document.querySelector("#lang-it");
  const langEnBtn = document.querySelector("#lang-en");
  const storyPanel = document.querySelector("#story-panel");
  const storyPanelDatetime = document.querySelector("#story-panel-datetime");
  const storyPanelBody = document.querySelector("#story-panel-body");
  const storyAuth = document.querySelector("#story-auth");
  const storyAuthReal = document.querySelector("#story-auth-real");
  const storyAuthFake = document.querySelector("#story-auth-fake");
  const storyAuthOr = document.querySelector("#story-auth-or");
  const storyMedia = document.querySelector("#story-media");
  const storyMediaGrid = document.querySelector("#story-media-grid");
  const storyBrowseHint = document.querySelector("#story-browse-hint");
  const viewEl = document.querySelector("#view");
  const titleEl = document.querySelector(".title");
  const titleHome = document.querySelector("#title-home");
  const titlePrompt = document.querySelector(".title-prompt");
  const bootSplash = document.querySelector("#boot-splash");
  const bootWideStack = document.querySelector("#boot-wide-stack");
  const realConfirm = document.querySelector("#real-confirm");
  const void404 = document.querySelector("#void-404");
  const lightbox = document.querySelector("#lightbox");
  const lightboxImage = document.querySelector("#lightbox-image");
  const lightboxVideo = document.querySelector("#lightbox-video");
  const lightboxClose = document.querySelector("#lightbox-close");
  const codeReveal = document.querySelector("#code-reveal");
  const codeRevealRig = document.querySelector("#code-reveal-rig");
  const codeRevealCaption = document.querySelector("#code-reveal-caption");
  /** @type {(() => void)[]} */
  let activeObjDisposers = [];
  /** @type {HTMLVideoElement[]} */
  let activeGalleryVideos = [];
  /** @type {HTMLElement[]} */
  let mediaCards = [];
  /** Scroll position along the depth stack (0 = first item in front). */
  let mediaDepth = 0;
  let mediaDepthMax = 0;
  /** Lightbox sequence (images + videos only). */
  /** @type {{ url: string, kind: "image" | "video" }[]} */
  let lightboxItems = [];
  let lightboxIndex = 0;
  /** Authenticity of the settled story currently on screen. */
  let activeStoryReal = false;
  /** @type {ReturnType<typeof loadStories>[number] | null} */
  let activeSettledStory = null;
  /** Arm once per story entry: first pointer move shows browse hint. */
  let storyBrowseHintPending = false;
  /** Hint is visible and should track the cursor. */
  let storyBrowseHintTracking = false;
  /** @type {string | null} */
  let storyBrowseHintStoryId = null;
  /** @type {number | null} */
  let storyBrowseHintHideTimer = null;
  let voidCollapsing = false;
  let codeRevealing = false;
  let realConfirming = false;
  /** @type {{ triggerFirework: () => void, reset: () => void, resize: () => void } | null} */
  let pathPointsApi = null;
  /** @type {number | null} */
  let voidHoldTimer = null;
  /** @type {number | null} */
  let void404Timer = null;
  /** @type {number | null} */
  let void404HideTimer = null;
  /** @type {number | null} */
  let voidHomeTimer = null;
  /** @type {number | null} */
  let voidInvertTimer = null;
  if (
    !(rig instanceof HTMLElement) ||
    !(pathPointsHost instanceof HTMLElement) ||
    !(spinBtn instanceof HTMLButtonElement) ||
    !(homeBtn instanceof HTMLButtonElement) ||
    !(langSwitch instanceof HTMLElement) ||
    !(langItBtn instanceof HTMLButtonElement) ||
    !(langEnBtn instanceof HTMLButtonElement) ||
    !(storyPanel instanceof HTMLElement) ||
    !(storyPanelDatetime instanceof HTMLElement) ||
    !(storyPanelBody instanceof HTMLElement) ||
    !(storyAuth instanceof HTMLElement) ||
    !(storyAuthReal instanceof HTMLButtonElement) ||
    !(storyAuthFake instanceof HTMLButtonElement) ||
    !(storyAuthOr instanceof HTMLElement) ||
    !(storyMedia instanceof HTMLElement) ||
    !(storyMediaGrid instanceof HTMLElement) ||
    !(storyBrowseHint instanceof HTMLElement) ||
    !(viewEl instanceof HTMLElement) ||
    !(titleEl instanceof HTMLElement) ||
    !(titleHome instanceof HTMLButtonElement) ||
    !(titlePrompt instanceof HTMLElement) ||
    !(bootSplash instanceof HTMLButtonElement) ||
    !(bootWideStack instanceof HTMLElement) ||
    !(realConfirm instanceof HTMLElement) ||
    !(void404 instanceof HTMLElement) ||
    !(codeReveal instanceof HTMLElement) ||
    !(codeRevealRig instanceof HTMLElement) ||
    !(codeRevealCaption instanceof HTMLElement) ||
    !(lightbox instanceof HTMLElement) ||
    !(lightboxImage instanceof HTMLImageElement) ||
    !(lightboxVideo instanceof HTMLVideoElement) ||
    !(lightboxClose instanceof HTMLButtonElement)
  ) {
    return;
  }

  const stories = loadStories();
  if (!stories.length) {
    console.warn("No story zoom frames found");
    return;
  }

  const ring = [...stories, ...stories];
  const count = ring.length;
  const itemAngle = 360 / count;
  const itemWidth = (RADIUS / count) * SIZE_FACTOR;
  const textWidthBase = (RADIUS_TEXT / count) * SIZE_FACTOR * 1.15;
  const textWidth = textWidthBase * 0.5;
  // Tall brief cells — grow downward from the prior 2.55× box
  const textHeightMul = 4.35;
  const textHeight = textWidthBase * textHeightMul;
  const textDownShiftVw = textWidthBase * (textHeightMul - 2.55) * 0.5;

  /** @type {{ stack: HTMLElement, imgs: HTMLImageElement[], index: number, nextAt: number, interval: number }[]} */
  const sequences = [];
  /** @type {{ storyId: string, image: HTMLElement, text: HTMLElement }[]} */
  const slots = [];

  /** Boot splash: one “wide” still per story, cycled on hover behind the copy. */
  const bootWideUrls = stories
    .map((story) => {
      const wide = story.gallery.find((g) => {
        if (g.kind !== "image") return false;
        const base = g.name.split("/").pop() ?? g.name;
        return /wide/i.test(base);
      });
      return wide?.url ?? null;
    })
    .filter((u) => u != null);

  /** @type {HTMLImageElement[]} */
  const bootWideImgs = [];
  let bootWideIndex = 0;
  let bootWideNextAt = 0;
  let bootWidePreviewing = false;

  bootWideStack.replaceChildren();
  bootWideUrls.forEach((src, i) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.draggable = false;
    img.loading = "eager";
    img.setAttribute("aria-hidden", "true");
    if (i === 0) img.classList.add("is-active");
    img.addEventListener(
      "load",
      () => {
        if (img.classList.contains("is-active")) {
          syncStackAspect(bootWideStack, img);
        }
      },
      { once: true },
    );
    bootWideStack.appendChild(img);
    bootWideImgs.push(img);
  });

  const bootSplashLabel = bootSplash.querySelector(".boot-splash-label");
  if (bootSplashLabel instanceof HTMLElement && bootWideImgs.length > 0) {
    const startBootWidePreview = () => {
      bootWidePreviewing = true;
      bootSplash.classList.add("is-wide-preview");
      bootWideNextAt = performance.now();
    };
    const stopBootWidePreview = () => {
      bootWidePreviewing = false;
      bootSplash.classList.remove("is-wide-preview");
    };
    bootSplashLabel.addEventListener("pointerenter", startBootWidePreview);
    bootSplashLabel.addEventListener("pointerleave", stopBootWidePreview);
    bootSplash.addEventListener("focusin", startBootWidePreview);
    bootSplash.addEventListener("focusout", (e) => {
      if (!bootSplash.contains(/** @type {Node} */ (e.relatedTarget))) {
        stopBootWidePreview();
      }
    });
  }

  function advanceBootWide(now) {
    if (
      !bootWidePreviewing ||
      bootWideImgs.length < 2 ||
      now < bootWideNextAt ||
      !document.body.classList.contains("is-booting")
    ) {
      return;
    }
    bootWideImgs[bootWideIndex].classList.remove("is-active");
    bootWideIndex = (bootWideIndex + 1) % bootWideImgs.length;
    const active = bootWideImgs[bootWideIndex];
    active.classList.add("is-active");
    syncStackAspect(bootWideStack, active);
    bootWideNextAt = now + randBetween(FRAME_MS_MIN, FRAME_MS_MAX);
  }

  ring.forEach((story, i) => {
    const angle = i * itemAngle;

    const item = document.createElement("div");
    item.className = "carousel-item";
    item.dataset.story = story.id;
    item.style.width = `${itemWidth}vw`;
    setTransform(
      item,
      [
        "translateX(-50%)",
        "translateY(-50%)",
        "rotateX(0deg)",
        `rotateY(${angle}deg)`,
        `translateZ(${RADIUS}vw)`,
      ].join(" "),
    );

    const stack = document.createElement("div");
    stack.className = "frame-stack";

    /** @type {HTMLImageElement[]} */
    const imgs = [];
    story.frames.forEach((src, fi) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = `Storia ${story.title} · frame ${fi + 1}`;
      img.draggable = false;
      img.loading = "eager";
      if (fi === 0) img.classList.add("is-active");
      img.addEventListener(
        "load",
        () => {
          if (img.classList.contains("is-active")) syncStackAspect(stack, img);
        },
        { once: true },
      );
      stack.appendChild(img);
      imgs.push(img);
    });

    item.appendChild(stack);
    rig.appendChild(item);

    const textItem = document.createElement("article");
    textItem.className = "text-item";
    textItem.dataset.story = story.id;
    textItem.style.width = `${textWidth}vw`;
    textItem.style.height = `${textHeight}vw`;
    setTransform(
      textItem,
      [
        "translateX(-50%)",
        "translateY(-50%)",
        "translateY(10pt)",
        `translateY(${textDownShiftVw}vw)`,
        // Extra drop on large viewports (see --brief-y-extra in CSS)
        "translateY(var(--brief-y-extra))",
        "rotateX(0deg)",
        `rotateY(${angle}deg)`,
        `translateZ(${RADIUS_TEXT}vw)`,
      ].join(" "),
    );

    const headEl = document.createElement("p");
    headEl.className = "text-item-head";
    headEl.textContent = story.datetime;

    const briefEl = document.createElement("p");
    briefEl.className = "text-item-brief";
    briefEl.textContent = story.brief;

    textItem.append(headEl, briefEl);
    rig.appendChild(textItem);

    slots.push({ storyId: story.id, image: item, text: textItem });

    const interval = randBetween(FRAME_MS_MIN, FRAME_MS_MAX);
    sequences.push({
      stack,
      imgs,
      index: 0,
      interval,
      nextAt: performance.now() + randBetween(0, interval),
    });
  });

  /**
   * @param {number | null} keepIndex
   */
  function setRingVisibility(keepIndex) {
    document.documentElement.style.setProperty(
      "--settle-fade-ms",
      `${BED_STOP_DELAY_MS}ms`,
    );
    slots.forEach((slot, i) => {
      const show = keepIndex === null || i === keepIndex;
      slot.image.classList.toggle("is-hidden", !show);
      slot.text.classList.remove("is-fading-out");
      slot.text.classList.toggle("is-hidden", !show);
    });
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImage.hidden = true;
    lightboxImage.removeAttribute("src");
    lightboxVideo.pause();
    lightboxVideo.removeAttribute("src");
    lightboxVideo.load();
    lightboxVideo.hidden = true;
  }

  /**
   * @param {string} src
   * @param {"image" | "video"} [kind]
   */
  function openLightbox(src, kind = "image") {
    if (kind === "video") {
      lightboxImage.hidden = true;
      lightboxImage.removeAttribute("src");
      lightboxVideo.hidden = false;
      lightboxVideo.muted = soundMuted;
      lightboxVideo.src = src;
      lightboxVideo.play().catch(() => {});
    } else {
      lightboxVideo.pause();
      lightboxVideo.removeAttribute("src");
      lightboxVideo.load();
      lightboxVideo.hidden = true;
      lightboxImage.hidden = false;
      lightboxImage.src = src;
    }
    lightbox.hidden = false;
  }

  /**
   * @param {number} index
   */
  function showLightboxAt(index) {
    const n = lightboxItems.length;
    if (!n) return;
    lightboxIndex = ((index % n) + n) % n;
    const item = lightboxItems[lightboxIndex];
    openLightbox(item.url, item.kind);
  }

  /**
   * @param {-1 | 1} dir
   */
  function stepLightbox(dir) {
    if (lightbox.hidden || lightboxItems.length < 2) return;
    showLightboxAt(lightboxIndex + dir);
  }

  function hideStoryPanel() {
    closeLightbox();
    hideStoryBrowseHint();
    storyBrowseHintPending = false;
    storyBrowseHintStoryId = null;
    for (const dispose of activeObjDisposers) dispose();
    activeObjDisposers = [];
    for (const vid of activeGalleryVideos) {
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
    }
    activeGalleryVideos = [];
    storyPanel.classList.remove("is-visible");
    storyPanel.hidden = true;
    storyPanelDatetime.textContent = "";
    storyPanelBody.innerHTML = "";
    storyAuth.classList.remove("is-visible");
    storyAuth.hidden = true;
    storyAuth.setAttribute("aria-hidden", "true");
    storyAuthReal.textContent = "";
    storyAuthFake.textContent = "";
    storyAuthOr.textContent = "or";
    storyAuthReal.disabled = false;
    storyAuthFake.disabled = false;
    spinBtn.hidden = false;
    storyMedia.classList.remove("is-visible");
    storyMedia.hidden = true;
    storyMediaGrid.replaceChildren();
    mediaCards = [];
    mediaDepth = 0;
    mediaDepthMax = 0;
    lightboxItems = [];
    lightboxIndex = 0;
    activeStoryReal = false;
    activeSettledStory = null;
  }

  function storyBrowseHintCopy() {
    return storyLang === "en"
      ? "scroll to browse the memories"
      : "scorri per sfogliare i ricordi";
  }

  function hideStoryBrowseHint() {
    if (storyBrowseHintHideTimer != null) {
      window.clearTimeout(storyBrowseHintHideTimer);
      storyBrowseHintHideTimer = null;
    }
    storyBrowseHintTracking = false;
    storyBrowseHint.classList.remove("is-visible", "is-over-media");
    storyBrowseHint.hidden = true;
    storyBrowseHint.setAttribute("aria-hidden", "true");
    storyBrowseHint.textContent = "";
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  function isPointerOverStoryMedia(clientX, clientY) {
    for (const card of mediaCards) {
      const opacity = Number.parseFloat(card.style.opacity || "1");
      if (opacity < 0.2) continue;
      const r = card.getBoundingClientRect();
      if (
        clientX >= r.left &&
        clientX <= r.right &&
        clientY >= r.top &&
        clientY <= r.bottom
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  function placeStoryBrowseHint(clientX, clientY) {
    storyBrowseHint.style.left = `${clientX}px`;
    storyBrowseHint.style.top = `${clientY}px`;
    storyBrowseHint.classList.toggle(
      "is-over-media",
      isPointerOverStoryMedia(clientX, clientY),
    );
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  function showStoryBrowseHintAt(clientX, clientY) {
    if (mediaCards.length < 2) return;
    storyBrowseHint.textContent = storyBrowseHintCopy();
    storyBrowseHint.hidden = false;
    storyBrowseHint.setAttribute("aria-hidden", "false");
    placeStoryBrowseHint(clientX, clientY);
    storyBrowseHintTracking = true;
    requestAnimationFrame(() => {
      storyBrowseHint.classList.add("is-visible");
    });
    if (storyBrowseHintHideTimer != null) {
      window.clearTimeout(storyBrowseHintHideTimer);
    }
    storyBrowseHintHideTimer = window.setTimeout(() => {
      hideStoryBrowseHint();
    }, 4200);
  }

  /**
   * @param {PointerEvent} e
   */
  function onStoryBrowseHintPointerMove(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    if (!settled || storyMedia.hidden || mediaCards.length < 2) return;
    if (voidCollapsing || codeRevealing || realConfirming) return;

    if (storyBrowseHintPending) {
      storyBrowseHintPending = false;
      showStoryBrowseHintAt(e.clientX, e.clientY);
      return;
    }

    if (storyBrowseHintTracking) {
      placeStoryBrowseHint(e.clientX, e.clientY);
    }
  }

  function hideVoid404() {
    void404.classList.remove("is-visible");
    void404.hidden = true;
    void404.setAttribute("aria-hidden", "true");
  }

  function showVoid404() {
    void404.textContent = storyLang === "en" ? "fake" : "finto";
    void404.hidden = false;
    void404.setAttribute("aria-hidden", "false");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void404.classList.add("is-visible");
      });
    });
  }

  function clearVoidTimers() {
    if (voidHoldTimer !== null) {
      window.clearTimeout(voidHoldTimer);
      voidHoldTimer = null;
    }
    if (void404Timer !== null) {
      window.clearTimeout(void404Timer);
      void404Timer = null;
    }
    if (void404HideTimer !== null) {
      window.clearTimeout(void404HideTimer);
      void404HideTimer = null;
    }
    if (voidHomeTimer !== null) {
      window.clearTimeout(voidHomeTimer);
      voidHomeTimer = null;
    }
    if (voidInvertTimer !== null) {
      window.clearTimeout(voidInvertTimer);
      voidInvertTimer = null;
    }
  }

  function resetVoidCollapse() {
    clearVoidTimers();
    hideVoid404();
    document.body.classList.remove("is-void-collapse", "is-void-invert-home");
    document
      .querySelectorAll(".is-void-fall, .is-void-falling, .is-void-rushing")
      .forEach((el) => {
        el.classList.remove("is-void-fall", "is-void-falling", "is-void-rushing");
        if (el instanceof HTMLElement) el.style.transitionDelay = "";
      });
    voidCollapsing = false;
  }

  /** Restore home after void: keep negative look briefly, then normalize. */
  function goHomeFromVoid() {
    if (fortune?.active) return;
    clearVoidTimers();
    hideVoid404();

    settled = false;
    hideStoryPanel();
    setRingVisibility(null);
    homeBtn.hidden = true;
    state.targetIncrement = AUTO_INCREMENT;
    spinBtn.disabled = false;
    document.body.classList.remove("is-spinning", "is-void-collapse");
    // Keep invert on before clearing fallers so the negative look never flashes off.
    document.body.classList.add("is-void-invert-home");
    // Kill exit transitions so scale/translate snap back with no size jump.
    document
      .querySelectorAll(".is-void-fall, .is-void-falling, .is-void-rushing")
      .forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.style.transition = "none";
        el.style.transitionDelay = "";
        el.classList.remove("is-void-fall", "is-void-falling", "is-void-rushing");
        void el.offsetWidth;
        el.style.transition = "";
      });
    playBedHome();

    voidInvertTimer = window.setTimeout(() => {
      voidInvertTimer = null;
      document.body.classList.remove("is-void-invert-home");
      voidCollapsing = false;
    }, 800);
  }

  /**
   * @param {HTMLElement} el
   */
  function isVoidEligible(el) {
    if (el.hidden) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number.parseFloat(style.opacity || "1") < 0.05) return false;
    return true;
  }

  /**
   * User marked a fake story as fake: invert + hold, then exits —
   * most elements fall; GPS rushes toward camera (same phase).
   */
  function triggerVoidCollapse() {
    if (voidCollapsing || realConfirming || codeRevealing) return;
    voidCollapsing = true;
    closeLightbox();
    storyAuthReal.disabled = true;
    storyAuthFake.disabled = true;
    document.body.classList.add("is-void-collapse");

    /** @type {HTMLElement[]} */
    const fallers = [
      titleEl,
      spinBtn,
      homeBtn,
      storyPanel,
      storyAuth,
      storyMedia,
      viewEl,
    ].filter(isVoidEligible);
    // Always include language switch (same collapse as spin / chrome)
    if (!fallers.includes(langSwitch)) fallers.push(langSwitch);

    const gpsEligible = isVoidEligible(pathPointsHost);

    // Phase 1: stay inverted (negative) for 1.5s
    fallers.forEach((el) => {
      el.classList.add("is-void-fall");
    });
    if (gpsEligible) pathPointsHost.classList.add("is-void-fall");

    voidHoldTimer = window.setTimeout(() => {
      voidHoldTimer = null;
      // Phase 2: fallers drop; GPS rushes toward camera — same beat, random stagger
      /** @type {{ el: HTMLElement, kind: "fall" | "rush" }[]} */
      const exits = fallers.map((el) => ({ el, kind: /** @type {"fall"} */ ("fall") }));
      if (gpsEligible) {
        exits.push({ el: pathPointsHost, kind: "rush" });
      }
      shuffleInPlace(exits);
      exits.forEach((item, i) => {
        const delayMs = Math.round(i * 110 + Math.random() * 140);
        item.el.style.transitionDelay = `${delayMs}ms`;
        window.requestAnimationFrame(() => {
          item.el.classList.add(
            item.kind === "rush" ? "is-void-rushing" : "is-void-falling",
          );
        });
      });

      const lastDelay =
        exits.length > 0 ? (exits.length - 1) * 110 + 140 : 0;
      // Fall/rush CSS ~1.5s — wait until everything is off-screen before home
      // Black hold after collapse: ~15% shorter
      const exitAnimMs = 1600;
      const homeMs = Math.round((lastDelay + exitAnimMs + 250) * 0.85);

      // Fake label briefly, early — then black until exits finish
      const show404Ms = Math.max(280, Math.round(lastDelay * 0.35));
      void404Timer = window.setTimeout(() => {
        void404Timer = null;
        showVoid404();
        void404HideTimer = window.setTimeout(() => {
          void404HideTimer = null;
          hideVoid404();
        }, 950);
      }, show404Ms);

      voidHomeTimer = window.setTimeout(() => {
        voidHomeTimer = null;
        goHomeFromVoid();
      }, homeMs);
    }, 1500);
  }

  function hideCodeReveal() {
    codeRevealing = false;
    codeRevealDragging = false;
    codeRevealMoved = false;
    codeReveal.classList.remove("is-visible");
    document.body.classList.remove("is-code-reveal");
    codeReveal.hidden = true;
    codeReveal.setAttribute("aria-hidden", "true");
  }

  /** @type {number} */
  let codeRevealRotY = -35;
  /** @type {number} */
  let codeRevealRotX = 0;
  /** @type {number} */
  let codeRevealScale = 1;
  let codeRevealDragging = false;
  let codeRevealMoved = false;
  let codeRevealLastX = 0;
  let codeRevealLastY = 0;

  function applyCodeRevealTransform() {
    setTransform(
      codeRevealRig,
      [
        `rotateY(${codeRevealRotY}deg)`,
        `rotateX(${codeRevealRotX}deg)`,
        `scale(${codeRevealScale})`,
      ].join(" "),
    );
  }

  function resetCodeRevealOrbit() {
    codeRevealRotY = -35;
    codeRevealRotX = 0;
    codeRevealScale = 1;
    codeRevealDragging = false;
    codeRevealMoved = false;
    applyCodeRevealTransform();
  }

  /** Build one parallelepiped: upright pages in a spaced sequence (shuffled each open). */
  function buildCodeRevealPages() {
    codeRevealRig.replaceChildren();

    /** @type {{ path: string, text: string }[]} */
    const pages = Object.entries(codeRawModules)
      .map(([path, text]) => ({
        path: path.replace(/^\.\.\//, "").replace(/^\.\//, "src/"),
        text: String(text ?? ""),
      }))
      .filter((p) => p.text.length > 0);

    // Fresh random stack order every time the reveal opens
    for (let i = pages.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pages[i];
      pages[i] = pages[j];
      pages[j] = tmp;
    }

    const n = pages.length;
    if (!n) return;

    // Parallel vertical planes along Z → one rectangular volume with air gaps
    const gapZ = 3.6; // vw between faces
    const originZ = ((n - 1) * gapZ) / 2;

    pages.forEach((page, i) => {
      const z = i * gapZ - originZ;

      const el = document.createElement("pre");
      el.className = "code-page";
      el.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "code-page-name";
      name.textContent = page.path;

      const body = document.createElement("code");
      body.className = "code-page-body";
      // Cap length — density over readability
      body.textContent = page.text.slice(0, 12000);

      el.append(name, body);
      el.style.transform = `translate3d(0, 0, ${z}vw) translate(-50%, -50%)`;
      el.style.webkitTransform = el.style.transform;
      codeRevealRig.appendChild(el);
    });
  }

  /**
   * User marked a fake story as real: strip the world, show the source wall.
   */
  function triggerCodeReveal() {
    if (codeRevealing || voidCollapsing || realConfirming) return;
    codeRevealing = true;
    closeLightbox();
    stopBed();
    storyAuthReal.disabled = true;
    storyAuthFake.disabled = true;
    hideStoryPanel();
    buildCodeRevealPages();
    resetCodeRevealOrbit();
    syncCodeRevealCaption();
    codeReveal.classList.remove("is-visible");
    codeReveal.hidden = false;
    codeReveal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-code-reveal");
    homeBtn.hidden = false;
    spinBtn.disabled = true;
    // Double rAF so the browser paints opacity:0 before fading in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (codeRevealing) codeReveal.classList.add("is-visible");
      });
    });
  }

  /**
   * @param {"real" | "fake"} guess
   */
  function onAuthGuess(guess) {
    if (voidCollapsing || codeRevealing || realConfirming || !settled) return;
    if (guess === "real" && activeStoryReal) {
      triggerRealConfirm();
      return;
    }
    if (guess === "real" && !activeStoryReal) {
      triggerCodeReveal();
      return;
    }
    if (guess === "fake" && !activeStoryReal) {
      triggerVoidCollapse();
    }
  }

  /**
   * Shortest signed offset on a loop of length `n`.
   * @param {number} i
   * @param {number} depth
   * @param {number} n
   */
  function wrappedCardOffset(i, depth, n) {
    let o = i - depth;
    o -= n * Math.round(o / n);
    return o;
  }

  /** Place gallery cards along a leftward + depth axis from `mediaDepth` (loops). */
  function layoutMediaDepth() {
    const n = mediaCards.length;
    if (!n) return;
    const STEP_X = 24.2; // vw to the left between cards (+10%)
    const STEP_Z = 41.8; // vw into the screen per card (+10%)
    mediaCards.forEach((card, i) => {
      const o = n === 1 ? 0 : wrappedCardOffset(i, mediaDepth, n);
      setTransform(
        card,
        [
          "translate(-50%, -50%)",
          `translateX(${-o * STEP_X}vw)`,
          `translateZ(${-o * STEP_Z}vw)`,
        ].join(" "),
      );
      const fade = Math.max(0, 1 - Math.abs(o) * 0.42);
      card.style.opacity = String(fade);
      card.style.zIndex = String(Math.round(200 - Math.abs(o) * 10));
      card.style.pointerEvents = Math.abs(o) < 0.55 ? "auto" : "none";
    });
  }

  /**
   * @param {WheelEvent} event
   */
  function scrollMediaDepth(event) {
    const n = mediaCards.length;
    if (n < 2) return;
    event.preventDefault();
    hideStoryBrowseHint();
    storyBrowseHintPending = false;
    const step =
      Math.sign(event.deltaY) *
      Math.min(1.15, Math.abs(event.deltaY) / 100) *
      0.55;
    mediaDepth = (((mediaDepth + step) % n) + n) % n;
    layoutMediaDepth();
  }

  /**
   * @param {{
   *   title: string,
   *   datetime: string,
   *   full: string,
   *   gallery?: {
   *     url: string,
   *     name: string,
   *     kind: "image" | "video" | "obj" | "glb" | "quote",
   *     text?: string,
   *     mtlUrl?: string | null,
   *     textureMap?: Record<string, string>,
   *   }[],
   *   quotes?: string[],
   *   real?: boolean,
   * }} story
   */
  function showStoryPanel(story) {
    const isNewEntry = storyBrowseHintStoryId !== story.id;
    activeSettledStory = story;
    storyPanelDatetime.textContent = `${story.datetime}\n#${story.title}`;
    storyPanelBody.innerHTML = renderStoryFullHtml(story.full);
    storyPanel.hidden = false;
    activeStoryReal = story.real === true;
    if (storyLang === "en") {
      storyAuthReal.textContent = "real";
      storyAuthFake.textContent = "fake";
      storyAuthOr.textContent = "or";
      storyAuth.setAttribute("aria-label", "real or fake?");
    } else {
      storyAuthReal.textContent = "reale";
      storyAuthFake.textContent = "finto";
      storyAuthOr.textContent = "o";
      storyAuth.setAttribute("aria-label", "reale o finto?");
    }
    storyAuthReal.disabled = false;
    storyAuthFake.disabled = false;
    storyAuth.hidden = false;
    storyAuth.setAttribute("aria-hidden", "false");
    spinBtn.hidden = true;

    for (const dispose of activeObjDisposers) dispose();
    activeObjDisposers = [];
    activeGalleryVideos = [];
    storyMediaGrid.replaceChildren();
    mediaCards = [];
    mediaDepth = 0;
    const gallery = withQuoteSlides(
      orderGalleryWithWideFirst(story.gallery ?? []),
      story.quotes ?? [],
    );
    mediaDepthMax = Math.max(0, gallery.length - 1);
    lightboxItems = gallery
      .filter((item) => item.kind === "image" || item.kind === "video")
      .map((item) => ({
        url: item.url,
        kind: /** @type {"image" | "video"} */ (item.kind),
      }));
    lightboxIndex = 0;

    if (isNewEntry) {
      hideStoryBrowseHint();
      storyBrowseHintStoryId = story.id;
      storyBrowseHintPending = gallery.length >= 2;
    } else if (!storyBrowseHint.hidden) {
      storyBrowseHint.textContent = storyBrowseHintCopy();
    }

    if (gallery.length) {
      // Depth stack replaces the settled B&W carousel face
      slots.forEach((slot) => {
        slot.image.classList.add("is-hidden");
      });

      for (const item of gallery) {
        if (item.kind === "quote") {
          const card = document.createElement("div");
          card.className = "story-media-card story-media-quote";
          card.setAttribute("role", "note");
          card.setAttribute("aria-label", "Citazione");
          const quoteEl = document.createElement("blockquote");
          quoteEl.className = "story-media-quote-text";
          quoteEl.textContent = item.text ?? "";
          card.appendChild(quoteEl);
          storyMediaGrid.appendChild(card);
          mediaCards.push(card);
          continue;
        }

        if (item.kind === "obj" || item.kind === "glb") {
          const cell = document.createElement("div");
          cell.className = "story-media-card story-media-obj";
          storyMediaGrid.appendChild(cell);
          mediaCards.push(cell);
          const dispose = mountObjViewer(cell, {
            url: item.url,
            format: item.kind,
            mtlUrl: item.mtlUrl ?? null,
            textureMap: item.textureMap ?? {},
            label: item.name,
          });
          activeObjDisposers.push(dispose);
          continue;
        }

        const lightboxAt = lightboxItems.findIndex((entry) => entry.url === item.url);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "story-media-card";
        btn.setAttribute(
          "aria-label",
          item.kind === "video" ? "Ingrandisci video" : "Ingrandisci immagine",
        );
        if (item.kind === "video") {
          const vid = document.createElement("video");
          vid.src = item.url;
          vid.muted = true;
          vid.defaultMuted = true;
          vid.loop = true;
          vid.autoplay = true;
          vid.playsInline = true;
          vid.setAttribute("playsinline", "");
          vid.setAttribute("muted", "");
          vid.preload = "auto";
          const tryPlay = () => {
            vid.play().catch(() => {});
          };
          vid.addEventListener("canplay", tryPlay);
          btn.appendChild(vid);
          activeGalleryVideos.push(vid);
          btn.addEventListener("click", (event) => {
            event.stopPropagation();
            showLightboxAt(lightboxAt);
          });
          tryPlay();
        } else {
          const img = document.createElement("img");
          img.src = item.url;
          img.alt = "";
          img.loading = "lazy";
          img.draggable = false;
          btn.appendChild(img);
          btn.addEventListener("click", (event) => {
            event.stopPropagation();
            showLightboxAt(lightboxAt);
          });
        }
        storyMediaGrid.appendChild(btn);
        mediaCards.push(btn);
      }
      layoutMediaDepth();
      storyMedia.hidden = false;
      storyMedia.setAttribute("aria-hidden", "false");
    } else {
      storyMedia.hidden = true;
      storyMedia.setAttribute("aria-hidden", "true");
    }

    // Next frame so opacity transition runs
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!settled) return;
        storyPanel.classList.add("is-visible");
        storyAuth.classList.add("is-visible");
        if (gallery.length) storyMedia.classList.add("is-visible");
        for (const vid of activeGalleryVideos) {
          vid.play().catch(() => {});
        }
      });
    });
  }

  lightboxClose.addEventListener("click", (event) => {
    event.stopPropagation();
    closeLightbox();
  });
  lightboxVideo.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  lightbox.addEventListener("click", () => {
    closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "Escape") {
      closeLightbox();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepLightbox(1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepLightbox(-1);
    }
  });

  /**
   * Deep-link / share URL: `?story=92239` (folder id) or `?story=683` (title).
   * @param {string | null | undefined} storyId
   */
  function syncStoryUrl(storyId) {
    const url = new URL(window.location.href);
    if (storyId) url.searchParams.set("story", storyId);
    else url.searchParams.delete("story");
    window.history.replaceState({}, "", url);
  }

  /**
   * @param {string | null} raw
   * @returns {number} index in `stories`, or -1
   */
  function resolveStoryParam(raw) {
    if (!raw) return -1;
    const q = raw.trim().toLowerCase().replace(/^#/, "");
    if (!q) return -1;
    let idx = stories.findIndex((s) => s.id.toLowerCase() === q);
    if (idx < 0) {
      idx = stories.findIndex((s) => s.title.toLowerCase() === q);
    }
    return idx;
  }

  /**
   * Jump to a story as if the wheel had just landed (no spin).
   * @param {number} storyIndex index in `stories`
   * @param {{ immediate?: boolean }} [opts]
   */
  function landOnStory(storyIndex, opts = {}) {
    if (storyIndex < 0 || storyIndex >= stories.length) return;
    const slotIndex = storyIndex; // first copy on the duplicated ring
    const story = ring[slotIndex];
    dragging = false;
    fortune = null;
    voidCollapsing = false;
    codeRevealing = false;
    resetVoidCollapse();
    hideCodeReveal();
    hideRealConfirm();
    hideStoryPanel();
    state.rotation = -slotIndex * itemAngle;
    state.increment = 0;
    state.targetIncrement = 0;
    state.dragDelta = 0;
    state.wheel = 0;
    settled = true;
    homeBtn.hidden = false;
    spinBtn.disabled = false;
    document.body.classList.remove("is-spinning");
    resetPromptPointer();
    syncStoryUrl(story.id);
    render();
    if (opts.immediate) {
      setRingVisibility(slotIndex);
      const slot = slots[slotIndex];
      if (slot) slot.text.classList.add("is-hidden");
      showStoryPanel(story);
      return;
    }
    settleRing(slotIndex);
  }

  /** Keep winner image; fade outer text with the bed dissolve. */
  function settleRing(keepIndex) {
    document.documentElement.style.setProperty(
      "--settle-fade-ms",
      `${BED_STOP_DELAY_MS}ms`,
    );
    const story = ring[keepIndex];
    syncStoryUrl(story.id);
    slots.forEach((slot, i) => {
      const keep = i === keepIndex;
      slot.image.classList.toggle("is-hidden", !keep);
      slot.text.classList.remove("is-fading-out");
      if (!keep) {
        slot.text.classList.add("is-hidden");
        return;
      }
      slot.text.classList.remove("is-hidden");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          slot.text.classList.add("is-fading-out");
        });
      });
    });
    window.setTimeout(() => {
      const slot = slots[keepIndex];
      if (!slot || !settled) return;
      slot.text.classList.add("is-hidden");
      // Full story fades in after brief text is gone (cols 1–2 of 5)
      showStoryPanel(story);
    }, BED_STOP_DELAY_MS + 40);
  }

  const state = {
    rotation: 0,
    increment: AUTO_INCREMENT,
    targetIncrement: AUTO_INCREMENT,
    dragDelta: 0,
    wheel: 0,
  };

  /** @type {{ active: boolean, start: number, from: number, to: number, duration: number, slotIndex: number } | null} */
  let fortune = null;
  /** After a fortune stop, keep the wheel still until the next spin. */
  let settled = false;
  /** Story indices for spin outcomes — reshuffled when empty (no repeats until cycle ends). */
  let fortuneDeck = /** @type {number[]} */ ([]);
  /** Last landed story index in `stories` — avoid back-to-back across reshuffle. */
  let lastFortuneStory = -1;

  /** “prompt” pointer: base hang angle + flex from peg hits. */
  let promptBase = 0;
  let promptFlex = 0;
  let promptPrevRot = state.rotation;
  let promptLastSlot = Math.floor((-state.rotation) / itemAngle);
  let promptActive = false;

  /** Draw next fortune story index with a shuffled deck (more even outcomes). */
  function drawFortuneStoryIndex() {
    if (fortuneDeck.length === 0) {
      fortuneDeck = shuffleInPlace(
        Array.from({ length: stories.length }, (_, i) => i),
      );
      if (
        fortuneDeck.length > 1 &&
        fortuneDeck[fortuneDeck.length - 1] === lastFortuneStory
      ) {
        const swapWith = Math.floor(Math.random() * (fortuneDeck.length - 1));
        const tmp = fortuneDeck[fortuneDeck.length - 1];
        fortuneDeck[fortuneDeck.length - 1] = fortuneDeck[swapWith];
        fortuneDeck[swapWith] = tmp;
      }
    }
    const storyIndex = /** @type {number} */ (fortuneDeck.pop());
    lastFortuneStory = storyIndex;
    return storyIndex;
  }

  let dragging = false;
  let lastX = 0;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  /** @type {AudioContext | null} */
  let bedCtx = AudioCtx ? new AudioCtx() : null;
  /** @type {AudioBuffer | null} */
  let bedBuffer = null;
  /** @type {AudioBufferSourceNode | null} */
  let bedSource = null;
  /** @type {GainNode | null} */
  let bedGain = null;
  /** @type {AudioBuffer[]} */
  let bedOverlayBuffers = [];
  /** Active one-shots layered on top of the looping bed (may overlap). */
  /** @type {Set<AudioBufferSourceNode>} */
  let bedOverlaySources = new Set();
  /** @type {GainNode | null} */
  let bedOverlayGain = null;
  /** Per-overlay independent timers (not a single queue). */
  /** @type {(ReturnType<typeof setTimeout> | null)[]} */
  let bedOverlayTimers = [];
  /** @type {boolean[]} */
  let bedOverlayPlaying = [];
  let bedOverlayEnabled = false;
  let bedAllowed = true;
  let soundMuted = false;
  let bedReady = false;
  let bedEpoch = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let bedStopTimer = null;

  if (bedCtx) {
    fetch(bedUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => bedCtx.decodeAudioData(buf))
      .then((decoded) => {
        bedBuffer = decoded;
        bedReady = true;
        if (!settled && !fortune?.active) playBedHome();
      })
      .catch((err) => {
        console.warn("Bed audio decode failed", err);
      });

    Promise.all(
      [bedOverlayAUrl, bedOverlayBUrl].map((url) =>
        fetch(url)
          .then((r) => r.arrayBuffer())
          .then((buf) => bedCtx.decodeAudioData(buf)),
      ),
    )
      .then((decoded) => {
        bedOverlayBuffers = decoded.filter(Boolean);
        bedOverlayTimers = bedOverlayBuffers.map(() => null);
        bedOverlayPlaying = bedOverlayBuffers.map(() => false);
        if (bedOverlayEnabled) startBedOverlays();
      })
      .catch((err) => {
        console.warn("Bed overlay decode failed", err);
      });
  }

  async function ensureBedCtx() {
    if (!bedCtx) return null;
    if (bedCtx.state === "suspended") {
      try {
        await bedCtx.resume();
      } catch {
        /* ignore */
      }
    }
    return bedCtx;
  }

  function stopBedSource() {
    if (bedSource) {
      try {
        bedSource.onended = null;
        bedSource.stop();
      } catch {
        /* already stopped */
      }
      try {
        bedSource.disconnect();
      } catch {
        /* ignore */
      }
      bedSource = null;
    }
  }

  function clearBedOverlayTimers() {
    bedOverlayTimers.forEach((timer, i) => {
      if (timer !== null) clearTimeout(timer);
      bedOverlayTimers[i] = null;
    });
  }

  function stopBedOverlays() {
    bedOverlayEnabled = false;
    clearBedOverlayTimers();
    for (const src of bedOverlaySources) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
    }
    bedOverlaySources.clear();
    bedOverlayPlaying = bedOverlayPlaying.map(() => false);
  }

  /**
   * Independent per-track scheduler: next cue is timed from now, not from
   * clip end, so overlays can layer on the bed (and on each other).
   * @param {number} index
   * @param {boolean} [immediate]
   */
  function scheduleBedOverlay(index, immediate = false) {
    if (bedOverlayTimers[index] != null) {
      clearTimeout(bedOverlayTimers[index]);
      bedOverlayTimers[index] = null;
    }
    if (
      !bedOverlayEnabled ||
      !bedCtx ||
      !bedAllowed ||
      soundMuted ||
      settled ||
      fortune?.active ||
      !bedOverlayBuffers[index]
    ) {
      return;
    }
    const delay = immediate
      ? randBetween(BED_OVERLAY_FIRST_MIN_MS, BED_OVERLAY_FIRST_MAX_MS)
      : randBetween(BED_OVERLAY_GAP_MIN_MS, BED_OVERLAY_GAP_MAX_MS);
    bedOverlayTimers[index] = setTimeout(() => {
      bedOverlayTimers[index] = null;
      playBedOverlay(index);
    }, delay);
  }

  /**
   * @param {number} index
   */
  function playBedOverlay(index) {
    if (
      !bedOverlayEnabled ||
      !bedCtx ||
      !bedAllowed ||
      soundMuted ||
      settled ||
      fortune?.active ||
      !bedOverlayBuffers[index]
    ) {
      return;
    }
    // Don't stack the same clip on itself; still keep its random cue going.
    if (bedOverlayPlaying[index] || Math.random() > BED_OVERLAY_PLAY_CHANCE) {
      scheduleBedOverlay(index, false);
      return;
    }
    if (!bedOverlayGain) {
      bedOverlayGain = bedCtx.createGain();
      bedOverlayGain.gain.value = BED_OVERLAY_GAIN;
      bedOverlayGain.connect(bedCtx.destination);
    }
    const src = bedCtx.createBufferSource();
    src.buffer = bedOverlayBuffers[index];
    src.connect(bedOverlayGain);
    src.onended = () => {
      bedOverlaySources.delete(src);
      bedOverlayPlaying[index] = false;
    };
    try {
      src.start(0);
      bedOverlaySources.add(src);
      bedOverlayPlaying[index] = true;
    } catch (err) {
      console.warn("Bed overlay play failed", err);
      bedOverlayPlaying[index] = false;
    }
    // Next cue from now — bed keeps looping; other overlays may already be up.
    scheduleBedOverlay(index, false);
  }

  function startBedOverlays() {
    if (soundMuted || settled || fortune?.active) return;
    if (bedOverlayBuffers.length === 0) {
      bedOverlayEnabled = true;
      return;
    }
    bedOverlayEnabled = true;
    if (bedOverlayTimers.length !== bedOverlayBuffers.length) {
      bedOverlayTimers = bedOverlayBuffers.map(() => null);
      bedOverlayPlaying = bedOverlayBuffers.map(() => false);
    }
    bedOverlayBuffers.forEach((_, index) => {
      scheduleBedOverlay(index, true);
    });
  }

  /**
   * @param {number} rate
   */
  function startBedSource(rate) {
    if (!bedCtx || !bedBuffer || !bedAllowed || soundMuted) return;
    stopBedSource();
    if (!bedGain) {
      bedGain = bedCtx.createGain();
      bedGain.connect(bedCtx.destination);
    }
    try {
      bedGain.gain.cancelScheduledValues(bedCtx.currentTime);
      bedGain.gain.setValueAtTime(BED_GAIN_HOME, bedCtx.currentTime);
    } catch {
      bedGain.gain.value = BED_GAIN_HOME;
    }
    const src = bedCtx.createBufferSource();
    src.buffer = bedBuffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(bedGain);
    src.start(0);
    bedSource = src;
  }

  function setBedRate(rate) {
    if (bedSource) {
      bedSource.playbackRate.value = rate;
    }
  }

  function clearBedStopTimer() {
    if (bedStopTimer !== null) {
      clearTimeout(bedStopTimer);
      bedStopTimer = null;
    }
  }

  function playBedHome() {
    clearBedStopTimer();
    bedAllowed = true;
    if (soundMuted) return;
    const epoch = ++bedEpoch;
    ensureBedCtx().then((ctx) => {
      if (!ctx || epoch !== bedEpoch || !bedAllowed || soundMuted) return;
      if (settled || fortune?.active) return;
      if (!bedReady || !bedBuffer) return;
      startBedSource(BED_RATE_HOME);
      startBedOverlays();
    });
  }

  function startBedSpin() {
    clearBedStopTimer();
    stopBedOverlays();
    bedAllowed = true;
    if (soundMuted) return;
    const epoch = ++bedEpoch;
    ensureBedCtx().then((ctx) => {
      if (!ctx || epoch !== bedEpoch || !bedAllowed || soundMuted) return;
      if (!bedReady || !bedBuffer) return;
      startBedSource(BED_RATE_SPIN_MAX);
    });
  }

  /** Match bed rate to instantaneous spin speed (ease-out). */
  function syncBedToSpin(t) {
    if (!bedAllowed || soundMuted) return;
    const speed = easeOutQuintSpeed(Math.min(1, Math.max(0, t)));
    // Map ease speed → [~0.35x … 5x]; keep a quiet floor until delayed stop
    const rate = Math.max(0.35, BED_RATE_SPIN_MAX * speed);
    if (!bedSource) {
      startBedSource(rate);
      return;
    }
    setBedRate(rate);
  }

  function stopBed() {
    clearBedStopTimer();
    stopBedOverlays();
    bedAllowed = false;
    bedEpoch += 1;
    if (bedCtx && bedGain) {
      try {
        bedGain.gain.cancelScheduledValues(bedCtx.currentTime);
        bedGain.gain.setValueAtTime(0, bedCtx.currentTime);
      } catch {
        bedGain.gain.value = 0;
      }
    }
    stopBedSource();
    if (bedGain) bedGain.gain.value = BED_GAIN_HOME;
  }

  /**
   * Fade bed out over BED_STOP_DELAY_MS after the ring settles,
   * then stop the source.
   */
  function scheduleStopBedAfterSettle() {
    clearBedStopTimer();
    stopBedOverlays();
    if (!bedCtx || !bedGain || !bedSource) {
      stopBed();
      return;
    }

    const ctx = bedCtx;
    const gain = bedGain;
    const epoch = bedEpoch;
    const now = ctx.currentTime;
    const fadeSec = BED_STOP_DELAY_MS / 1000;

    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
    } catch {
      gain.gain.value = 0;
    }

    bedStopTimer = setTimeout(() => {
      bedStopTimer = null;
      if (epoch !== bedEpoch) return;
      bedAllowed = false;
      bedEpoch += 1;
      stopBedSource();
      if (bedGain) {
        try {
          bedGain.gain.cancelScheduledValues(ctx.currentTime);
        } catch {
          /* ignore */
        }
        bedGain.gain.value = BED_GAIN_HOME;
      }
    }, BED_STOP_DELAY_MS + 40);
  }

  function syncLangButtons() {
    langItBtn.classList.toggle("is-active", storyLang === "it");
    langEnBtn.classList.toggle("is-active", storyLang === "en");
    langItBtn.setAttribute("aria-pressed", storyLang === "it" ? "true" : "false");
    langEnBtn.setAttribute("aria-pressed", storyLang === "en" ? "true" : "false");
    document.documentElement.lang = storyLang === "en" ? "en" : "it";
  }

  function syncBootSplashText() {
    const label =
      bootSplash.querySelector(".boot-splash-label") ?? bootSplash;
    label.textContent =
      storyLang === "en" ? BOOT_SPLASH_COPY.en : BOOT_SPLASH_COPY.it;
  }

  function syncCodeRevealCaption() {
    codeRevealCaption.textContent =
      storyLang === "en"
        ? CODE_REVEAL_CAPTION_COPY.en
        : CODE_REVEAL_CAPTION_COPY.it;
  }

  function syncRealConfirmText() {
    realConfirm.textContent =
      storyLang === "en" ? REAL_CONFIRM_COPY.en : REAL_CONFIRM_COPY.it;
  }

  function hideRealConfirm() {
    realConfirming = false;
    realConfirm.classList.remove("is-visible");
    realConfirm.hidden = true;
    realConfirm.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-real-confirm");
    pathPointsApi?.reset();
    requestAnimationFrame(() => pathPointsApi?.resize());
  }

  /**
   * User marked a real story as real: affirm + firework on the GPS trail.
   */
  function triggerRealConfirm() {
    if (realConfirming || voidCollapsing || codeRevealing) return;
    realConfirming = true;
    storyAuthReal.disabled = true;
    storyAuthFake.disabled = true;
    storyAuth.classList.remove("is-visible");
    storyAuth.hidden = true;
    storyAuth.setAttribute("aria-hidden", "true");
    spinBtn.hidden = true;
    syncRealConfirmText();
    realConfirm.hidden = false;
    realConfirm.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-real-confirm");
    homeBtn.hidden = false;
    // Expand GPS host to full viewport, then burst after layout
    requestAnimationFrame(() => {
      pathPointsApi?.resize();
      requestAnimationFrame(() => {
        if (!realConfirming) return;
        pathPointsApi?.triggerFirework();
        realConfirm.classList.add("is-visible");
      });
    });
  }

  /**
   * Apply current `storyLang` to story objects + visible UI.
   */
  function applyStoryLocale() {
    for (const story of stories) {
      const pack = storyLang === "en" ? story.i18n.en : story.i18n.it;
      story.brief = pack.brief;
      story.full = pack.full;
      story.quotes = [...pack.quotes];
    }
    slots.forEach((slot, i) => {
      const briefEl = slot.text.querySelector(".text-item-brief");
      if (briefEl) briefEl.textContent = ring[i].brief;
    });
    if (settled && activeSettledStory && !realConfirming && !codeRevealing) {
      showStoryPanel(activeSettledStory);
    }
    syncBootSplashText();
    syncCodeRevealCaption();
    syncRealConfirmText();
    syncLangButtons();
  }

  /**
   * @param {"it" | "en"} lang
   */
  function setStoryLang(lang) {
    if (lang !== "it" && lang !== "en") return;
    if (lang === storyLang) return;
    storyLang = lang;
    const url = new URL(window.location.href);
    if (lang === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    window.history.replaceState({}, "", url);
    applyStoryLocale();
  }

  langItBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setStoryLang("it");
  });
  langEnBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setStoryLang("en");
  });
  langItBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  langEnBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  syncLangButtons();

  // Unlock AudioContext on first gesture (Safari/Chrome autoplay policy).
  // Use capture so child stopPropagation (lang, spin, title) cannot skip unlock.
  let bedGestureUnlocked = false;
  function unlockBed() {
    if (bedGestureUnlocked) return;
    bedGestureUnlocked = true;
    document.removeEventListener("pointerdown", unlockBed, true);
    document.removeEventListener("keydown", unlockBed, true);
    ensureBedCtx().then(() => {
      if (
        !settled &&
        !fortune?.active &&
        !voidCollapsing &&
        !codeRevealing &&
        !realConfirming
      ) {
        playBedHome();
      }
    });
  }
  document.addEventListener("pointerdown", unlockBed, { capture: true });
  document.addEventListener("keydown", unlockBed, { capture: true });

  function render() {
    setTransform(rig, `rotateY(${state.rotation}deg)`);
  }

  /**
   * “prompt” as a flexible fortune-wheel pointer:
   * deploys to 90° at a rate tied to ring travel, flicks +10° on each
   * story crossing, then springs back.
   */
  function resetPromptPointer() {
    promptBase = 0;
    promptFlex = 0;
    promptActive = false;
    promptPrevRot = state.rotation;
    promptLastSlot = Math.floor((-state.rotation) / itemAngle);
    setTransform(titlePrompt, "rotate(0deg)");
  }

  function updatePromptPointer() {
    const dRot = state.rotation - promptPrevRot;
    promptPrevRot = state.rotation;
    const ringTravel = Math.abs(dRot);

    if (promptActive && fortune?.active) {
      // Deploy 90° proportionally to how fast the rings are moving
      if (promptBase < PROMPT_POINTER_DEG && ringTravel > 0) {
        promptBase = Math.min(
          PROMPT_POINTER_DEG,
          promptBase +
            ringTravel * (PROMPT_POINTER_DEG / PROMPT_DEPLOY_RING_DEG),
        );
      }

      // Peg hit: a story slot just crossed the front indicator line
      const slot = Math.floor((-state.rotation) / itemAngle);
      if (slot !== promptLastSlot) {
        promptFlex = PROMPT_FLEX_DEG;
        promptLastSlot = slot;
      }
    } else if (promptBase > 0.05 || promptFlex > 0.05) {
      // Fold the pointer back after the wheel settles
      promptBase += (0 - promptBase) * PROMPT_RETURN_SPRING;
      if (promptBase < 0.05) promptBase = 0;
    } else if (!promptActive) {
      promptBase = 0;
      promptFlex = 0;
    }

    // Flexible return after each peg (and after settle)
    promptFlex += (0 - promptFlex) * PROMPT_FLEX_SPRING;
    if (promptFlex < 0.05) promptFlex = 0;

    if (!promptActive && promptBase === 0 && promptFlex === 0) {
      setTransform(titlePrompt, "rotate(0deg)");
      return;
    }

    setTransform(titlePrompt, `rotate(${promptBase + promptFlex}deg)`);
  }

  function advanceSequences(now) {
    for (const seq of sequences) {
      if (seq.imgs.length < 2 || now < seq.nextAt) continue;
      seq.imgs[seq.index].classList.remove("is-active");
      seq.index = (seq.index + 1) % seq.imgs.length;
      const active = seq.imgs[seq.index];
      active.classList.add("is-active");
      syncStackAspect(seq.stack, active);
      seq.interval = randBetween(FRAME_MS_MIN, FRAME_MS_MAX);
      seq.nextAt = now + seq.interval;
    }
  }

  function startFortuneSpin() {
    if (
      fortune?.active ||
      voidCollapsing ||
      codeRevealing ||
      realConfirming ||
      document.body.classList.contains("is-booting")
    ) {
      return;
    }

    dragging = false;
    settled = false;
    homeBtn.hidden = true;
    resetVoidCollapse();
    hideCodeReveal();
    hideRealConfirm();
    hideStoryPanel();
    setRingVisibility(null);
    state.increment = 0;
    state.targetIncrement = 0;
    state.dragDelta = 0;
    state.wheel = 0;

    const storyIndex = drawFortuneStoryIndex();
    // Either copy of the duplicated ring — same story, different travel distance
    const slotIndex =
      storyIndex + (Math.random() < 0.5 ? 0 : stories.length);
    const extraTurns = Math.floor(randBetween(SPIN_TURNS_MIN, SPIN_TURNS_MAX + 1));
    // Same travel distance, longer duration → ~20% lower peak speed
    const duration = randBetween(SPIN_MS_MIN, SPIN_MS_MAX) / SPIN_SPEED_SCALE;

    // Item faces camera when parent rotateY + slotAngle ≈ 0
    const landing = -slotIndex * itemAngle;
    let to = landing - extraTurns * 360;
    // Keep spinning in the same direction as idle (rotation decreases)
    while (to >= state.rotation) to -= 360;
    while (state.rotation - to < extraTurns * 360) to -= 360;

    fortune = {
      active: true,
      start: performance.now(),
      from: state.rotation,
      to,
      duration,
      slotIndex,
    };

    promptActive = true;
    promptPrevRot = state.rotation;
    promptLastSlot = Math.floor((-state.rotation) / itemAngle);
    promptFlex = 0;

    startBedSpin();
    spinBtn.disabled = true;
    document.body.classList.add("is-spinning");
  }

  function frame(now) {
    if (fortune?.active) {
      const t = Math.min(1, (now - fortune.start) / fortune.duration);
      const e = easeOutQuint(t);
      state.rotation = fortune.from + (fortune.to - fortune.from) * e;
      if (t >= 1) {
        state.rotation = fortune.to;
        settleRing(fortune.slotIndex);
        // Outer text + bed dissolve together over BED_STOP_DELAY_MS
        setBedRate(0.35);
        scheduleStopBedAfterSettle();
        fortune.active = false;
        fortune = null;
        promptActive = false;
        spinBtn.disabled = false;
        document.body.classList.remove("is-spinning");
        settled = true;
        homeBtn.hidden = false;
        state.targetIncrement = 0;
        state.increment = 0;
      } else {
        syncBedToSpin(t);
      }
    } else {
      state.increment += (state.targetIncrement - state.increment) * 0.08;
      state.wheel *= 0.9;
      state.rotation -= state.increment + state.dragDelta + state.wheel;
      state.dragDelta = 0;
    }

    advanceSequences(now);
    advanceBootWide(now);
    render();
    updatePromptPointer();
    if (codeRevealing && !codeRevealDragging) {
      codeRevealRotY += CODE_REVEAL_SPIN_DEG;
      applyCodeRevealTransform();
    }
    requestAnimationFrame(frame);
  }

  function onPointerDown(e) {
    if (
      fortune?.active ||
      voidCollapsing ||
      codeRevealing ||
      document.body.classList.contains("is-booting")
    ) {
      return;
    }
    if (e.target instanceof Element && e.target.closest("#spin")) return;
    if (
      e.target instanceof Node &&
      (storyMedia.contains(e.target) ||
        storyPanel.contains(e.target) ||
        storyAuth.contains(e.target) ||
        langSwitch.contains(e.target) ||
        lightbox.contains(e.target))
    ) {
      return;
    }
    dragging = true;
    lastX = e.clientX;
    state.targetIncrement = 0;
  }

  function onPointerMove(e) {
    if (!dragging || fortune?.active || codeRevealing) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    state.dragDelta += -dx * DRAG_SPEED * 10;
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    if (!fortune?.active) {
      state.targetIncrement = settled ? 0 : AUTO_INCREMENT;
    }
  }

  function onWheel(e) {
    if (voidCollapsing || codeRevealing) {
      e.preventDefault();
      return;
    }
    if (lightbox.contains(/** @type {Node} */ (e.target))) return;
    if (
      settled &&
      storyMedia.classList.contains("is-visible") &&
      mediaDepthMax > 0
    ) {
      scrollMediaDepth(e);
      return;
    }
    if (fortune?.active) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    state.wheel += e.deltaY * 0.01;
    state.targetIncrement = 0;
  }

  function goHome() {
    if (fortune?.active) return;
    if (document.body.classList.contains("is-booting")) return;
    settled = false;
    resetVoidCollapse();
    hideCodeReveal();
    hideRealConfirm();
    hideStoryPanel();
    setRingVisibility(null);
    homeBtn.hidden = true;
    state.targetIncrement = AUTO_INCREMENT;
    spinBtn.disabled = false;
    document.body.classList.remove("is-spinning");
    resetPromptPointer();
    syncStoryUrl(null);
    playBedHome();
  }

  storyAuthReal.addEventListener("click", (e) => {
    e.stopPropagation();
    onAuthGuess("real");
  });
  storyAuthFake.addEventListener("click", (e) => {
    e.stopPropagation();
    onAuthGuess("fake");
  });
  storyAuthReal.addEventListener("pointerdown", (e) => e.stopPropagation());
  storyAuthFake.addEventListener("pointerdown", (e) => e.stopPropagation());

  spinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startFortuneSpin();
  });
  spinBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

  homeBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    // Restart bed in the same user gesture (required by Safari/autoplay rules).
    if (!fortune?.active && !codeRevealing) playBedHome();
  });
  homeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    goHome();
  });

  titleHome.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (!fortune?.active && !codeRevealing) playBedHome();
  });
  titleHome.addEventListener("click", (e) => {
    e.stopPropagation();
    goHome();
  });

  codeReveal.addEventListener("pointerdown", (e) => {
    if (!codeRevealing) return;
    if (e.target instanceof Element && e.target.closest("#home-ring")) return;
    e.stopPropagation();
    codeRevealDragging = true;
    codeRevealMoved = false;
    codeRevealLastX = e.clientX;
    codeRevealLastY = e.clientY;
    try {
      codeReveal.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
  codeReveal.addEventListener("pointermove", (e) => {
    if (!codeRevealDragging || !codeRevealing) return;
    e.stopPropagation();
    const dx = e.clientX - codeRevealLastX;
    const dy = e.clientY - codeRevealLastY;
    codeRevealLastX = e.clientX;
    codeRevealLastY = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) codeRevealMoved = true;
    // Classic orbit: horizontal → yaw, vertical → pitch
    codeRevealRotY += dx * 0.4;
    codeRevealRotX = Math.max(-80, Math.min(80, codeRevealRotX - dy * 0.4));
    applyCodeRevealTransform();
  });
  codeReveal.addEventListener("pointerup", (e) => {
    if (!codeRevealDragging) return;
    e.stopPropagation();
    codeRevealDragging = false;
    try {
      codeReveal.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    // Tap without drag still exits (home / Escape also work)
    if (!codeRevealMoved && codeRevealing) goHome();
  });
  codeReveal.addEventListener("pointercancel", () => {
    codeRevealDragging = false;
  });
  codeReveal.addEventListener(
    "wheel",
    (e) => {
      if (!codeRevealing) return;
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      codeRevealScale = Math.min(
        CODE_REVEAL_SCALE_MAX,
        Math.max(CODE_REVEAL_SCALE_MIN, codeRevealScale * factor),
      );
      applyCodeRevealTransform();
    },
    { passive: false },
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && codeRevealing) {
      e.preventDefault();
      goHome();
    }
  });

  document.body.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointermove", onStoryBrowseHintPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("wheel", onWheel, { passive: false });

  render();
  requestAnimationFrame(frame);

  const deepStory = resolveStoryParam(
    new URLSearchParams(window.location.search).get("story"),
  );

  // Intro: stay on green copy until click — that gesture unlocks bed audio
  let bootEntered = false;
  syncBootSplashText();
  bootSplash.hidden = false;
  document.body.classList.add("is-booting");
  spinBtn.disabled = true;
  // Prefetch GPS while waiting (hidden under is-booting)
  pathPointsApi = mountPathPoints(pathPointsHost, loadGpxPoints()) ?? null;

  function enterFromBootSplash(e) {
    e.preventDefault();
    e.stopPropagation();
    if (bootEntered || !document.body.classList.contains("is-booting")) return;
    bootEntered = true;

    // Same user gesture → unlock + start home bed
    unlockBed();
    playBedHome();

    document.body.classList.remove("is-booting");
    bootSplash.classList.add("is-leaving");
    bootSplash.disabled = true;
    window.setTimeout(() => {
      bootSplash.hidden = true;
      bootSplash.classList.remove("is-leaving");
    }, 550);

    if (deepStory >= 0) {
      landOnStory(deepStory, { immediate: true });
    } else if (!settled && !fortune?.active) {
      spinBtn.disabled = false;
    }
  }

  bootSplash.addEventListener("click", enterFromBootSplash);
  bootSplash.addEventListener("pointerdown", (e) => e.stopPropagation());
}

boot();

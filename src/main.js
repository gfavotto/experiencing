import "./styles.css";
import { STORY_COPY } from "./stories-data.js";
import { mountObjViewer } from "./objViewer.js";
import bedUrl from "../assets/media/audio/home-bed.mp3?url";

/**
 * Frenzy Image landscape carousel — fixed camera, spinning rings only.
 * Inner ring: story image sequences.
 * Outer ring (+10% radius): brief texts, same angles as matching stories.
 * #spin: fortune-wheel stop on a random story.
 */

/** All media under each story folder (and subfolders), incl. OBJ (+ MTL for materials). */
/** @type {Record<string, string>} */
const frameModules = import.meta.glob(
  "../assets/media/[0-9][0-9][0-9][0-9][0-9]/**/*.{jpg,jpeg,png,webp,gif,avif,mp4,webm,mov,obj,mtl}",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

const CAROUSEL_IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const VIDEO_RE = /\.(mp4|webm|mov)$/i;
const OBJ_RE = /\.obj$/i;
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
 * @returns {"image" | "video" | "obj" | null}
 */
function galleryKind(name) {
  if (isTexturePackFile(name)) return null;
  if (OBJ_RE.test(name)) return "obj";
  if (VIDEO_RE.test(name)) return "video";
  if (CAROUSEL_IMAGE_RE.test(name)) return "image";
  return null;
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

const RADIUS = 35; // vw
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
/** Peak rate at spin start (Web Audio BufferSource — works better than HTMLAudio on Safari). */
const BED_RATE_SPIN_MAX = 5;
const BED_RATE_HOME = 1;
/** Fade-out duration for bed + outer text after settle. */
const BED_STOP_DELAY_MS = 1000;

/**
 * @returns {{
 *   id: string,
 *   frames: string[],
 *   gallery: {
 *     url: string,
 *     name: string,
 *     kind: "image" | "video" | "obj",
 *     path: string,
 *     mtlUrl?: string | null,
 *     textureMap?: Record<string, string>,
 *   }[],
 *   title: string,
 *   datetime: string,
 *   brief: string,
 *   full: string,
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
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, frames]) => {
      const copy = STORY_COPY[id] ?? {
        title: id.slice(-3),
        datetime: "",
        brief: "",
        full: "",
      };
      const sorted = frames.sort((a, b) => a.name.localeCompare(b.name));
      // Gallery: images / videos / OBJ (not MTL or /textures/)
      const gallery = sorted
        .map((f) => {
          const kind = galleryKind(f.name);
          if (!kind) return null;
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
      return {
        id,
        title: copy.title,
        datetime: copy.datetime,
        brief: copy.brief,
        full: copy.full ?? "",
        frames: frameList.map((f) => f.url),
        gallery,
      };
    })
    .filter((s) => s.frames.length > 0);
}

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
  const spinBtn = document.querySelector("#spin");
  const homeBtn = document.querySelector("#home-ring");
  const muteBtn = document.querySelector("#mute");
  const storyPanel = document.querySelector("#story-panel");
  const storyPanelDatetime = document.querySelector("#story-panel-datetime");
  const storyPanelBody = document.querySelector("#story-panel-body");
  const storyMedia = document.querySelector("#story-media");
  const storyMediaGrid = document.querySelector("#story-media-grid");
  const lightbox = document.querySelector("#lightbox");
  const lightboxImage = document.querySelector("#lightbox-image");
  const lightboxClose = document.querySelector("#lightbox-close");
  /** @type {(() => void)[]} */
  let activeObjDisposers = [];
  /** @type {HTMLVideoElement[]} */
  let activeGalleryVideos = [];
  if (
    !(rig instanceof HTMLElement) ||
    !(spinBtn instanceof HTMLButtonElement) ||
    !(homeBtn instanceof HTMLButtonElement) ||
    !(muteBtn instanceof HTMLButtonElement) ||
    !(storyPanel instanceof HTMLElement) ||
    !(storyPanelDatetime instanceof HTMLElement) ||
    !(storyPanelBody instanceof HTMLElement) ||
    !(storyMedia instanceof HTMLElement) ||
    !(storyMediaGrid instanceof HTMLElement) ||
    !(lightbox instanceof HTMLElement) ||
    !(lightboxImage instanceof HTMLImageElement) ||
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
  const textHeight = textWidthBase * 2;

  /** @type {{ stack: HTMLElement, imgs: HTMLImageElement[], index: number, nextAt: number, interval: number }[]} */
  const sequences = [];
  /** @type {{ storyId: string, image: HTMLElement, text: HTMLElement }[]} */
  const slots = [];

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
    lightboxImage.removeAttribute("src");
  }

  /**
   * @param {string} src
   */
  function openLightbox(src) {
    lightboxImage.src = src;
    lightbox.hidden = false;
  }

  function hideStoryPanel() {
    closeLightbox();
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
    storyPanelBody.textContent = "";
    storyMedia.classList.remove("is-visible");
    storyMedia.hidden = true;
    storyMediaGrid.replaceChildren();
  }

  /**
   * Gallery thumbs: 50% of intrinsic media size.
   * @param {HTMLImageElement | HTMLVideoElement} el
   */
  function sizeGalleryMediaHalf(el) {
    if (el instanceof HTMLImageElement) {
      if (!el.naturalWidth || !el.naturalHeight) return;
      el.style.width = `${Math.max(1, Math.round(el.naturalWidth * 0.5))}px`;
      el.style.height = `${Math.max(1, Math.round(el.naturalHeight * 0.5))}px`;
      return;
    }
    if (!el.videoWidth || !el.videoHeight) return;
    el.style.width = `${Math.max(1, Math.round(el.videoWidth * 0.5))}px`;
    el.style.height = `${Math.max(1, Math.round(el.videoHeight * 0.5))}px`;
  }

  /**
   * @param {{
   *   title: string,
   *   datetime: string,
   *   full: string,
   *   gallery?: {
   *     url: string,
   *     name: string,
   *     kind: "image" | "video" | "obj",
   *     mtlUrl?: string | null,
   *     textureMap?: Record<string, string>,
   *   }[],
   * }} story
   */
  function showStoryPanel(story) {
    storyPanelDatetime.textContent = `${story.datetime}\n#${story.title}`;
    storyPanelBody.textContent = story.full;
    storyPanel.hidden = false;

    for (const dispose of activeObjDisposers) dispose();
    activeObjDisposers = [];
    activeGalleryVideos = [];
    storyMediaGrid.replaceChildren();
    const gallery = shuffleInPlace([...(story.gallery ?? [])]);
    if (gallery.length) {
      for (const item of gallery) {
        if (item.kind === "obj") {
          const cell = document.createElement("div");
          cell.className = "story-media-obj";
          storyMediaGrid.appendChild(cell);
          const dispose = mountObjViewer(cell, {
            objUrl: item.url,
            mtlUrl: item.mtlUrl ?? null,
            textureMap: item.textureMap ?? {},
            label: item.name,
          });
          activeObjDisposers.push(dispose);
          continue;
        }

        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute(
          "aria-label",
          item.kind === "video" ? "Video della storia" : "Ingrandisci immagine",
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
          vid.addEventListener("loadedmetadata", () => sizeGalleryMediaHalf(vid));
          const tryPlay = () => {
            vid.play().catch(() => {});
          };
          vid.addEventListener("canplay", tryPlay);
          btn.appendChild(vid);
          activeGalleryVideos.push(vid);
          // no lightbox — keep looping inline
          btn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (vid.paused) tryPlay();
          });
          tryPlay();
        } else {
          const img = document.createElement("img");
          img.src = item.url;
          img.alt = "";
          img.loading = "lazy";
          img.draggable = false;
          if (img.complete) sizeGalleryMediaHalf(img);
          else img.addEventListener("load", () => sizeGalleryMediaHalf(img));
          btn.appendChild(img);
          btn.addEventListener("click", (event) => {
            event.stopPropagation();
            openLightbox(item.url);
          });
        }
        storyMediaGrid.appendChild(btn);
      }
      storyMedia.hidden = false;
    } else {
      storyMedia.hidden = true;
    }

    // Next frame so opacity transition runs
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!settled) return;
        storyPanel.classList.add("is-visible");
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
  lightbox.addEventListener("click", () => {
    closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lightbox.hidden) closeLightbox();
  });

  /** Keep winner image; fade outer text with the bed dissolve. */
  function settleRing(keepIndex) {
    document.documentElement.style.setProperty(
      "--settle-fade-ms",
      `${BED_STOP_DELAY_MS}ms`,
    );
    const story = ring[keepIndex];
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
      bedGain.gain.setValueAtTime(1, bedCtx.currentTime);
    } catch {
      bedGain.gain.value = 1;
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
    });
  }

  function startBedSpin() {
    clearBedStopTimer();
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
    if (bedGain) bedGain.gain.value = 1;
  }

  /**
   * Fade bed out over BED_STOP_DELAY_MS after the ring settles,
   * then stop the source.
   */
  function scheduleStopBedAfterSettle() {
    clearBedStopTimer();
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
        bedGain.gain.value = 1;
      }
    }, BED_STOP_DELAY_MS + 40);
  }

  function setSoundMuted(muted) {
    soundMuted = muted;
    muteBtn.classList.toggle("is-muted", muted);
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.setAttribute(
      "aria-label",
      muted ? "Attiva audio" : "Disattiva audio",
    );
    if (muted) {
      clearBedStopTimer();
      bedEpoch += 1;
      stopBedSource();
      return;
    }
    if (fortune?.active) {
      startBedSpin();
      return;
    }
    if (!settled) playBedHome();
  }

  muteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setSoundMuted(!soundMuted);
  });

  // Unlock AudioContext on first gesture (Safari requirement).
  function unlockBed() {
    ensureBedCtx().then(() => {
      if (!settled && !fortune?.active) playBedHome();
    });
  }
  document.body.addEventListener("pointerdown", unlockBed, { once: true });

  function render() {
    setTransform(rig, `rotateY(${state.rotation}deg)`);
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
    if (fortune?.active) return;

    dragging = false;
    settled = false;
    homeBtn.hidden = true;
    hideStoryPanel();
    setRingVisibility(null);
    state.increment = 0;
    state.targetIncrement = 0;
    state.dragDelta = 0;
    state.wheel = 0;

    const storyIndex = Math.floor(Math.random() * stories.length);
    // Prefer the front copy of the duplicated ring
    const slotIndex = storyIndex;
    const extraTurns = Math.floor(randBetween(SPIN_TURNS_MIN, SPIN_TURNS_MAX + 1));
    const duration = randBetween(SPIN_MS_MIN, SPIN_MS_MAX);

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
    render();
    requestAnimationFrame(frame);
  }

  function onPointerDown(e) {
    if (fortune?.active) return;
    if (e.target instanceof Element && e.target.closest("#spin")) return;
    dragging = true;
    lastX = e.clientX;
    state.targetIncrement = 0;
  }

  function onPointerMove(e) {
    if (!dragging || fortune?.active) return;
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
    const target = e.target;
    if (
      target instanceof Node &&
      (storyMedia.contains(target) ||
        lightbox.contains(target) ||
        storyPanel.contains(target))
    ) {
      // Let gallery / text / lightbox scroll natively
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
    settled = false;
    hideStoryPanel();
    setRingVisibility(null);
    homeBtn.hidden = true;
    state.targetIncrement = AUTO_INCREMENT;
    spinBtn.disabled = false;
    document.body.classList.remove("is-spinning");
    playBedHome();
  }

  spinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startFortuneSpin();
  });
  spinBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

  homeBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    // Restart bed in the same user gesture (required by Safari/autoplay rules).
    if (!fortune?.active) playBedHome();
  });
  homeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    goHome();
  });

  document.body.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("wheel", onWheel, { passive: false });

  render();
  requestAnimationFrame(frame);
}

boot();

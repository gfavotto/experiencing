import "./info-styles.css";
import { createFloatingPhoto } from "./info-float.js";
import { createInfoSphere } from "./info-sphere.js";
import groupPhotoUrl from "../assets/media/peak prompt - lagazuoi - 2026 - group.jpeg?url";

/**
 * Lazy glob — avoid shipping 1400 eager URL imports in the first module
 * (that delayed CSS/paint and flashed a white page).
 */
const photopointLoaders = import.meta.glob(
  "../assets/media/photopoint/*.{jpg,jpeg,png,webp}",
  {
    query: "?url",
    import: "default",
  },
);

/** @type {"it" | "en"} */
const infoLang =
  new URLSearchParams(window.location.search).get("lang")?.toLowerCase() ===
  "en"
    ? "en"
    : "it";

const PHOTOPOINT_HREF =
  infoLang === "en"
    ? "https://lagazuoi.it/EN/fotopoint.php"
    : "https://lagazuoi.it/IT/fotopoint.php";

const INFO_COPY = {
  it: {
    homeAria: "Torna alla home",
    ringsAria: "Torna alle circonferenze",
    hintOutside: "scroll o doppio click per entrare",
    hintInside: "scroll o doppio click per uscire",
    paragraphs: [
      [
        "Nell’overdose di AI che stiamo vivendo, mi chiedo quanto l’esperienza vissuta sia una ricchezza in via di estinzione. Abbiamo percorso assieme il percorso di salita da Passo Falzarego fino al rifugio Lagazuoi. Abbiamo raccolto contenuti per trovare forme di racconto delle nostre esperienze. Molti contenuti, in molte forme. Una volta raggiunta la vetta abbiamo scattato una foto tramite il ",
        { href: PHOTOPOINT_HREF, label: "Photopoint" },
        ", servizio di scatto-upload immagini dei rifugio. Mi sono interessato a queste immagini e alle storie che documentano; momenti reali di persone che hanno condiviso un tempo assieme. Ho scaricato e osservato le fotografie scattate tramite Photopoint negli ultimi 3 mesi, selezionandone 10, tra cui la mia. Ho chiesto ad alcuni modelli AI di analizzare queste immagini ed inventare delle storie possibili che raccontassero le persone ritratte. Da queste storie, ho guidato i modelli AI nel generare immagini e video compatibili con le storie inventate, nonché l’intero sito che stai esplorando. In alcune storie ho usato contenuti che raccontavano in realtà la mia esperienza o miei ricordi. Ogni storia ha trovato una forma di racconto, ma quella storia appartiene alle persone ritratte?",
      ],
      [
        "Questo progetto sviluppato grazie a ",
        { href: "https://pittogramma.xyz", label: "Pittogramma" },
        ", sotto la guida sapiente di ",
        { href: "https://gigadesignstudio.com", label: "Giga Design Studio" },
        " mi ha permesso di fare esperienza di nuovi strumenti di narrazione.",
      ],
      "Un sentito grazie a chi ha reso possibile tutto ciò.",
      "Giulio Favotto, 2026.",
    ],
  },
  en: {
    homeAria: "Back to home",
    ringsAria: "Back to the rings",
    hintOutside: "scroll or double-click to enter",
    hintInside: "scroll or double-click to exit",
    paragraphs: [
      [
        "In the AI overdose we are living through, I wonder how much lived experience is a form of wealth on the way to extinction. Together we walked the climb from Passo Falzarego up to Rifugio Lagazuoi. We gathered content to find ways of telling our experiences. Many pieces of content, in many forms. Once we reached the summit we took a photo through the ",
        { href: PHOTOPOINT_HREF, label: "Photopoint" },
        ", the hut’s capture-and-upload photo service. I became interested in these images and the stories they document; real moments of people who shared time together. I downloaded and looked through the photographs taken via Photopoint over the last three months, selecting ten of them, including my own. I asked some AI models to analyze these images and invent possible stories that might tell of the people portrayed. From those stories, I guided the AI models in generating images and videos compatible with the invented stories, as well as the entire site you are exploring. In some stories I used content that in fact told my own experience or my memories. Each story found a form of telling — but does that story belong to the people portrayed?",
      ],
      [
        "This project, developed thanks to ",
        { href: "https://pittogramma.xyz", label: "Pittogramma" },
        ", under the wise guidance of ",
        { href: "https://gigadesignstudio.com", label: "Giga Design Studio" },
        ", allowed me to experience new tools for narration.",
      ],
      "Heartfelt thanks to everyone who made this possible.",
      "Giulio Favotto, 2026.",
    ],
  },
};

/**
 * @param {HTMLElement} host
 * @param {typeof INFO_COPY.it} pack
 */
function renderInfoCopy(host, pack) {
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
          a.href = part.href;
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
  return `${url.pathname}${url.search}${url.hash}`;
}

async function resolvePhotopointUrls() {
  const entries = Object.entries(photopointLoaders).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const urls = await Promise.all(
    entries.map(async ([, load]) => String(await load())),
  );
  return urls.filter(Boolean);
}

async function boot() {
  const canvas = document.querySelector("#info-canvas");
  const floatCanvas = document.querySelector("#info-float-canvas");
  const home = document.querySelector("#info-home");
  const homeRing = document.querySelector("#info-home-ring");
  const hint = document.querySelector("#info-browse-hint");
  const copy = document.querySelector("#info-copy");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  if (!(floatCanvas instanceof HTMLCanvasElement)) return;
  if (!(hint instanceof HTMLElement)) return;
  if (!(copy instanceof HTMLElement)) return;

  const pack = INFO_COPY[infoLang];
  document.documentElement.lang = infoLang;
  renderInfoCopy(copy, pack);

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

  const urls = await resolvePhotopointUrls();
  if (!urls.length) return;

  /** @type {"outside" | "inside"} */
  let mode = "outside";
  let hintPending = true;
  let hintTracking = false;
  /** @type {number | null} */
  let hintHideTimer = null;
  /** @type {number | null} */
  let copyRevealTimer = null;
  let sphereGone = false;
  /** @type {(() => void) | null} */
  let disposeSphere = null;
  /** @type {(() => void) | null} */
  let disposeFloat = null;

  function dismissSphere() {
    if (sphereGone) return;
    sphereGone = true;
    hideHint();
    hintPending = false;
    document.body.classList.add("is-info-sphere-gone");
    document.body.style.cursor = "default";

    // Group photo floats in behind as the sphere fades out
    disposeFloat = createFloatingPhoto(floatCanvas, groupPhotoUrl);
    requestAnimationFrame(() => {
      document.body.classList.add("is-info-float-visible");
    });

    window.setTimeout(() => {
      disposeSphere?.();
      disposeSphere = null;
    }, 900);
  }

  function hintCopy() {
    return mode === "inside" ? pack.hintInside : pack.hintOutside;
  }

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
    hint.style.left = `${clientX}px`;
    hint.style.top = `${clientY}px`;
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
      dismissSphere();
    },
  });
}

boot();

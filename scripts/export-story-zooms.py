#!/usr/bin/env python3
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

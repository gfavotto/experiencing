import "./trail-styles.css";
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

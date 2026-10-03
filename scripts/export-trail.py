#!/usr/bin/env python3
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

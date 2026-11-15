#!/usr/bin/env python3
"""
science_layers.py: SIMULATED / DERIVED science layers for the Jezero atlas (relief proxy, radiation, texture classes).

READ THIS FIRST. The repository contains NO radiation measurements, NO spectral (CRISM/OMEGA) data and NO elevation
model (MOLA/HiRISE DEM). Every product written by this script is derived from only three inputs: the CTX
brightness image (web/images/jezero-ctx-mosaic.jpg), the crater list (web/data/craters-data.js) and the physical
heuristics written below. Nothing here is a measurement and none of it may be used for real navigation or safety.
The UI labels all three layers "simulated / derived, not measured data".

Same spirit as crater_detector.py: classical image processing (numpy / scipy / opencv / scikit-learn), seeded,
deterministic, no hand labels. It reuses the sun direction measured there (craters meta `sun_bright_wall_deg`).

------------------------------------------------------------------------------------------------------
(a) TOPOGRAPHIC PROXY ("relative relief", NOT metres from a DEM)
  1. Shape-from-shading. For a Lambertian surface lit at low sun, brightness is approximately linear in the
     slope along the sun direction: I - I0 = -k * (grad h . L), L = unit vector from the ground towards the sun.
     The CTX image is high-passed (Gaussian sigma 30 px) and lightly blurred, then h is recovered in the Fourier
     domain with a Wiener-regularised inverse of the directional derivative, H = -D conj(G) / (|G|^2 + lam^2),
     G = 2 pi i (f . L). Wavelengths longer than ~60 px (~580 m) are suppressed (lam), because they cannot be
     recovered from shading, and relief ACROSS the sun direction is not recoverable at all (G = 0). Albedo
     variations (dark / bright patches) are indistinguishable from slopes in a single image, so they leak in as
     false relief. The result is normalised to a standard deviation of RELIEF_STD_M (an ASSUMED vertical scale).
  2. Crater bowls from the detector's crater list (centre, radius): parabolic bowl of depth BOWL_DEPTH_RATIO * D
     with a low raised rim, added to the shading relief so catalogue craters are always lows.
  3. Output: a 0..100 "relative relief index" (1st..99th percentile stretch), and contour lines are drawn from it
     in the browser. The vertical scale is assumed (RELIEF_STD_M, BOWL_DEPTH_RATIO), not measured.

(b) RADIATION: surface dose-equivalent rate in microSv/h
  Baseline. MSL/RAD measured on the Gale crater floor, Hassler et al. 2014, Science 343, 1244797: galactic
  cosmic ray (GCR) surface dose equivalent 0.64 +/- 0.12 mSv/day (about 230 mSv/yr), absorbed dose in water
  0.21 mGy/day. Note: "0.2-0.3 mSv/day" often quoted is the ABSORBED dose (mGy); the dose EQUIVALENT in Sv, the
  quantity the unit microSv/h denotes, is ~3x larger. We use 0.64 mSv/day = 26.7 microSv/h (BASELINE_MSV_DAY; change
  that constant to 0.25 for the lower figure). Uncertainty +/-19 % (RAD's own), plus: Gale is ~2 km lower than
  Jezero (thicker atmosphere there), so Jezero would be a few percent higher; RAD also shows ~+-5 % seasonal
  (pressure) variation. Not modelled.
  Shielding. dose = BASELINE * max(1 - SHIELD_GAIN * (1 - SVF), SHIELD_MIN=0.6) * zone_factor * (SPE multiplier if enabled), where
  SVF = sky-view factor from the relief proxy: SVF = 1 - mean over 16 azimuths of sin^2(horizon elevation)
  (Zaksek et al. 2011), horizon searched up to ~1.5 km, using the assumed vertical scale of (a). Low enclosed areas
  (crater floors, channels) get lower SVF and so lower dose. Honest note: with real crater depths (tens of metres)
  the true GCR shielding effect would be only a few percent; SHIELD_GAIN = 3 deliberately exaggerates it so the
  effect is visible. The wall/overhang effect is only what the heightmap holds; true overhangs cannot exist in a
  2.5-D heightmap.
  Deliberate zones (scenario, not physics): 2 "hot" zones at the highest smoothed relief (exposed rises, assumed
  thin regolith/rock cover, x1.45) and 2 "cool" zones at the lowest smoothed relief (assumed deeper dust/ice
  cover, x0.70), Gaussian, sigma 14 grid cells (~540 m); positions are reported in the data (meta.zones).
  Solar particle event (SPE) option. Atlas.radiation.solarEvent(true) multiplies the whole map by SPE_MULTIPLIER
  = 2.5. A large SPE can raise the surface dose rate several-fold for days (scenario value, not a forecast).
  Limits (scenario thresholds in microSv/h, NOT regulatory values): caution 36 (1.35 x baseline, i.e. 0.86 mSv/day),
  danger 55 (about 2 x baseline, 1.3 mSv/day). The numbers are chosen so that only hot zones cross
  "caution" in quiet conditions and a solar event pushes much of the map to "danger".

(c) SPECTRAL: "texture class" map, NOT mineralogy
  k-means (k = 5, seed 7) on three features per 1/4-resolution cell (block-mean brightness, local brightness
  standard deviation = texture, gradient magnitude), standardised, then a 3x3 median filter on the labels.
  Classes are sorted dark -> bright so labels are stable. They group similar-looking terrain in this ONE
  panchromatic image. They are not minerals (no CRISM / OMEGA bands are in the repository), not geological units.

Output: web/data/science-layers-data.js with window.JEZERO_SCIENCE = {meta, topo, radiation, spectral}. Grids are
1/4 resolution (286 x 199), uint8 quantised, base64 encoded, rows top to bottom. Deterministic: run twice, same bytes.

Usage:  python3 model/science_layers.py            (needs numpy, scipy, scikit-learn, opencv-python-headless)
"""
import argparse, base64, json, math, re
from pathlib import Path
import cv2
import numpy as np
from scipy import ndimage
from sklearn.cluster import KMeans

ROOT = Path(__file__).resolve().parent.parent
IMAGE = ROOT / "web" / "images" / "jezero-ctx-mosaic.jpg"
CRATERS_JS = ROOT / "web" / "data" / "craters-data.js"
OUT_JS = ROOT / "web" / "data" / "science-layers-data.js"

DOWN = 4                      # grid = image / 4
PAGE_W, PAGE_H = 1990, 1390
BASELINE_MSV_DAY = 0.64       # Hassler et al. 2014 (MSL/RAD) GCR dose equivalent at the surface
BASELINE_UNCERTAINTY = 0.19   # fractional, RAD's +-0.12 / 0.64
SHIELD_GAIN = 3.0             # deliberate exaggeration of terrain shielding (see docstring)
SHIELD_MIN = 0.6              # terrain alone never removes more than 40 % (no overhangs in a heightmap)
HOT_FACTOR, COOL_FACTOR = 1.45, 0.70
ZONE_SIGMA_CELLS = 14
SPE_MULTIPLIER = 2.5
CAUTION_FACTOR, DANGER_FACTOR = 1.35, 2.06   # of baseline -> 36 and 55 microSv/h
RELIEF_STD_M = 6.0            # ASSUMED vertical scale of the shading relief
BOWL_DEPTH_RATIO = 0.12       # ASSUMED crater depth / diameter (degraded craters)
SFS_CUTOFF_PX = 60.0
K_CLASSES = 5
SEED = 7
SPECTRAL_COLORS = ["#332288", "#0072B2", "#009E73", "#E69F00", "#F0E442"]   # Okabe-Ito based, colour-blind safe


def load_craters():
    s = CRATERS_JS.read_text()
    d = json.loads(s[s.index("{"):s.rindex("}") + 1])
    return d["meta"], d["craters"]


def shape_from_shading(img, sun_bright_deg):
    """Relative height (arbitrary units, unit std) from one image. Image y axis points down, as do array rows."""
    f = img.astype(np.float64)
    f = cv2.GaussianBlur(f, (0, 0), 1.5) - cv2.GaussianBlur(f, (0, 0), 30)
    f /= f.std() + 1e-9
    a = math.radians(sun_bright_deg)                       # direction (from crater centre) of the sunlit inner wall
    lx, ly = -math.cos(a), -math.sin(a)                    # direction towards the sun is the opposite
    h, w = f.shape
    fx = np.fft.fftfreq(w)[None, :]
    fy = np.fft.fftfreq(h)[:, None]
    g = 2j * np.pi * (fx * lx + fy * ly)
    lam = 2 * np.pi / SFS_CUTOFF_PX * 0.5
    H = -np.fft.fft2(f) * np.conj(g) / (np.abs(g) ** 2 + lam ** 2)
    r = np.real(np.fft.ifft2(H))
    return (r - r.mean()) / (r.std() + 1e-9)


def crater_bowls(shape, craters, px_per_page):
    """Height in metres of parabolic bowls + rims for the catalogue craters (image pixel grid)."""
    hh, ww = shape
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float64)
    out = np.zeros(shape)
    for c in craters:
        cx, cy, r = c["page"][0] * px_per_page, c["page"][1] * px_per_page, c["page"][2] * px_per_page
        depth = BOWL_DEPTH_RATIO * c["diameter_m"]
        rho = np.hypot(xx - cx, yy - cy) / max(r, 1e-6)
        out += np.where(rho < 1, -depth * (1 - rho ** 2), 0.0) + 0.25 * depth * np.exp(-((rho - 1) / 0.25) ** 2) * (rho >= 1)
    return out


def sky_view(hm, cell_m, n_az=16, dists=(1, 2, 3, 4, 6, 8, 11, 15, 20, 28, 40)):
    hh, ww = hm.shape
    acc = np.zeros_like(hm)
    for k in range(n_az):
        az = 2 * np.pi * k / n_az
        dx, dy = math.cos(az), math.sin(az)
        best = np.zeros_like(hm)
        for d in dists:
            sh = ndimage.shift(hm, (-dy * d, -dx * d), order=1, mode="nearest")   # sh[p] = hm[p + d*dir]
            best = np.maximum(best, (sh - hm) / (d * cell_m))
        acc += np.sin(np.arctan(best)) ** 2
    return 1.0 - acc / n_az


def pick_peaks(z, n, sign, sep):
    """Deterministic: n extreme points of z (sign=+1 highest, -1 lowest) at least `sep` cells apart, away from the border."""
    zz = sign * z.copy()
    zz[:sep // 2, :] = -1e9; zz[-sep // 2:, :] = -1e9; zz[:, :sep // 2] = -1e9; zz[:, -sep // 2:] = -1e9
    pts = []
    for _ in range(n):
        j, i = np.unravel_index(np.argmax(zz), zz.shape)
        pts.append((int(i), int(j)))
        yy, xx = np.ogrid[:z.shape[0], :z.shape[1]]
        zz[(yy - j) ** 2 + (xx - i) ** 2 < sep ** 2] = -1e9
    return pts


def q8(a, lo, hi):
    return np.clip(np.round((a - lo) / (hi - lo) * 255), 0, 255).astype(np.uint8)


def b64(a):
    return base64.b64encode(a.tobytes()).decode("ascii")


def build():
    cmeta, craters = load_craters()
    img = cv2.imread(str(IMAGE), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise SystemExit(f"cannot read {IMAGE}")
    ih, iw = img.shape
    gw, gh = iw // DOWN, ih // DOWN
    px_per_page = iw / PAGE_W
    sun = float(cmeta.get("sun_bright_wall_deg", -28))
    mpp = float(cmeta.get("m_per_px", 9.7))
    cell_m = mpp * DOWN

    # (a) relief proxy
    sfs = shape_from_shading(img.astype(np.float32) / 255.0, sun) * RELIEF_STD_M
    rel_m = sfs + crater_bowls(img.shape, craters, px_per_page)           # ASSUMED metres, only used for shielding
    rel_g = cv2.resize(rel_m.astype(np.float32), (gw, gh), interpolation=cv2.INTER_AREA).astype(np.float64)
    lo, hi = np.percentile(rel_g, [1, 99])
    topo_q = q8(rel_g, lo, hi)

    # (b) radiation
    svf = sky_view(rel_g, cell_m)
    base = BASELINE_MSV_DAY * 1000 / 24.0
    shield = np.maximum(1 - SHIELD_GAIN * (1 - svf), SHIELD_MIN)
    smooth = ndimage.gaussian_filter(rel_g, 6)
    hot = pick_peaks(smooth, 2, +1, 40)
    cool = pick_peaks(smooth, 2, -1, 40)
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float64)
    zone = np.ones((gh, gw))
    for (i, j), fac in [(p, HOT_FACTOR) for p in hot] + [(p, COOL_FACTOR) for p in cool]:
        zone *= 1 + (fac - 1) * np.exp(-((xx - i) ** 2 + (yy - j) ** 2) / (2 * ZONE_SIGMA_CELLS ** 2))
    dose = base * shield * zone
    dmin, dmax = round(float(dose.min()) - 0.05, 1), round(float(dose.max()) + 0.05, 1)
    dose_q = q8(dose, dmin, dmax)
    zones = [{"kind": k, "x": round((i + .5) * PAGE_W / gw, 1), "y": round((j + .5) * PAGE_H / gh, 1), "factor": f}
             for k, pts, f in (("hot", hot, HOT_FACTOR), ("cool", cool, COOL_FACTOR)) for (i, j) in pts]

    # (c) texture classes
    g = cv2.resize(img.astype(np.float32), (gw, gh), interpolation=cv2.INTER_AREA)
    f32 = img.astype(np.float32)
    mean_f = cv2.blur(f32, (DOWN * 2 + 1, DOWN * 2 + 1))
    std_f = np.sqrt(np.maximum(cv2.blur(f32 ** 2, (DOWN * 2 + 1,) * 2) - mean_f ** 2, 0))
    gm = np.hypot(cv2.Sobel(cv2.GaussianBlur(f32, (0, 0), 1.0), cv2.CV_32F, 1, 0), cv2.Sobel(cv2.GaussianBlur(f32, (0, 0), 1.0), cv2.CV_32F, 0, 1))
    feats = np.stack([g.ravel()] + [cv2.resize(a, (gw, gh), interpolation=cv2.INTER_AREA).ravel() for a in (std_f, gm)], 1)
    z = (feats - feats.mean(0)) / (feats.std(0) + 1e-9)
    km = KMeans(n_clusters=K_CLASSES, n_init=10, random_state=SEED).fit(z)
    order = np.argsort([g.ravel()[km.labels_ == c].mean() for c in range(K_CLASSES)])
    remap = np.zeros(K_CLASSES, int); remap[order] = np.arange(K_CLASSES)
    lab = ndimage.median_filter(remap[km.labels_].reshape(gh, gw), size=3).astype(np.uint8)
    classes = []
    for c in range(K_CLASSES):
        m = lab == c
        classes.append({"id": c, "color": SPECTRAL_COLORS[c], "share": round(float(m.mean()), 3),
                        "brightness": int(round(float(g[m].mean()))) if m.any() else 0,
                        "texture": round(float(feats[:, 1].reshape(gh, gw)[m].mean()), 1) if m.any() else 0})

    note = "SIMULATED / DERIVED, NOT MEASURED DATA"
    return {
        "meta": {"note": note, "w": gw, "h": gh, "page": [PAGE_W, PAGE_H], "cell_m": round(cell_m, 1), "seed": SEED,
                 "sun_bright_wall_deg": sun, "source": "CTX brightness image + crater list + heuristics; see model/science_layers.py",
                 "zones": zones},
        "topo": {"grid": b64(topo_q), "w": gw, "h": gh, "unit": "relative relief index (0-100)",
                 "contour_interval": 10, "assumed_relief_std_m": RELIEF_STD_M, "label": "Relative relief (shading-derived)",
                 "note": "Relative relief from shape-from-shading plus catalogue crater bowls; not metres, not a DEM."},
        "radiation": {"grid": b64(dose_q), "w": gw, "h": gh, "min": dmin, "max": dmax, "unit": "µSv/h",
                      "baseline": round(base, 2), "baseline_msv_day": BASELINE_MSV_DAY, "baseline_uncertainty": BASELINE_UNCERTAINTY,
                      "baseline_source": "MSL/RAD, Hassler et al. 2014, Science 343:1244797 (GCR dose equivalent 0.64 +/- 0.12 mSv/day)",
                      "limits": {"caution": round(base * CAUTION_FACTOR), "danger": round(base * DANGER_FACTOR)},
                      "spe": {"multiplier": SPE_MULTIPLIER, "note": "scenario value: a large solar particle event can raise the surface dose rate several-fold for days; not a forecast"},
                      "shield_gain": SHIELD_GAIN, "note": "Simulated dose-equivalent rate: Mars GCR baseline x terrain shielding x scenario zones. Not measured."},
        "spectral": {"grid": b64(lab), "w": gw, "h": gh, "classes": classes, "label": "Texture classes (not mineralogy)",
                     "note": "k-means texture/brightness classes of the CTX image; NOT mineralogy, no CRISM data in this repository."},
    }, {"rel_m": rel_m, "dose": dose, "svf": svf}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--out", default=str(OUT_JS))
    a = ap.parse_args()
    data, dbg = build()
    txt = ("/* Generated by model/science_layers.py (integration/web_bridge.py layers). Do not edit by hand. "
           "SIMULATED / DERIVED, NOT MEASURED. */\nwindow.JEZERO_SCIENCE = " + json.dumps(data, separators=(",", ":"), sort_keys=True) + ";\n")
    Path(a.out).write_text(txt)
    d = data["radiation"]
    print(f"wrote {a.out} ({len(txt) // 1024} KB); dose {dbg['dose'].min():.1f}..{dbg['dose'].max():.1f} uSv/h, "
          f"limits {d['limits']}, zones {data['meta']['zones']}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Crater detector for the Jezero CTX mosaic (stage 1 of a walking-hazard mapper).

How it works
  1. Flatten the illumination of the image (high-pass + CLAHE).
  2. Measure the sun direction from two unmistakable craters (shading dipole).
  3. Build a TRAINING SET without hand labels:
       positives = synthetic craters (parabolic bowl + raised rim, lit from the
                   measured sun direction, random depth, size, erosion, blur and noise)
                   pasted onto REAL terrain patches from this very image
       negatives = plain real terrain patches (rough rock, dunes, scarps, smooth plains)
  4. Train a RandomForest on HOG + radial profile + sun-axis dipole features.
  5. Slide candidate circles over the image at 8 scales, score each with the forest,
     keep the confident ones, remove duplicates (non-maximum suppression).
  6. Write craters.json (pixel, page and lon/lat coordinates, diameter, size class,
     confidence) and a preview PNG.

To improve it with real labels, pass --labels labels.json, a list such as
  [{"x": 812, "y": 640, "r": 14, "label": 1}, {"x": 90, "y": 30, "r": 9, "label": 0}]
(pixels of the input image). Those examples are added to the training set with extra weight.

Usage
  python detect_craters.py ctx.jpg --out craters.json --preview preview.png
"""
import argparse, json, math
import cv2
import numpy as np
from multiprocessing import Pool
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

LON0, LON1, LAT0, LAT1 = 77.10, 77.80, 18.10, 18.75     # extent of the mosaic
KM_PER_DEG = 59.27                                       # Mars, 1 degree of latitude
PAGE_W, PAGE_H = 1990, 1848                              # coordinate space of the web map
SIZE, SPAN = 32, 2.6                                     # patch pixels, patch width in crater radii
SCALES = [6, 8, 11, 15, 21, 29, 40, 55]                  # candidate radii in pixels (~20 m/px)
SEEDS = [(221, 1795, 45), (1790, 643, 38)]               # two obvious craters, used for the sun angle

RNG = np.random.default_rng(11)
SUN = {"phi": 0.0}                                       # direction of the bright inner wall (radians)
FLAT = None


def flatten(img):
    f = img.astype(np.float32)
    f = f - cv2.GaussianBlur(f, (0, 0), 40)
    f = cv2.normalize(f, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    return cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(f)


def estimate_sun(img):
    angs = []
    for x, y, r in SEEDS:
        p = img[int(y - r):int(y + r), int(x - r):int(x + r)].astype(np.float32)
        p -= p.mean()
        yy, xx = np.mgrid[-r:r, -r:r]
        m = (xx ** 2 + yy ** 2) < (0.85 * r) ** 2
        angs.append(math.atan2((p * yy * m).sum(), (p * xx * m).sum()))
    return math.atan2(sum(math.sin(a) for a in angs), sum(math.cos(a) for a in angs))


def patch(img, cx, cy, r):
    half = r * SPAN
    k = SIZE / (2 * half)
    m = np.float32([[k, 0, SIZE / 2 - cx * k], [0, k, SIZE / 2 - cy * k]])
    return cv2.warpAffine(img, m, (SIZE, SIZE), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REFLECT)


def hog(p, cell=8, bins=9):
    p = p.astype(np.float32)
    gx = np.zeros_like(p); gy = np.zeros_like(p)
    gx[:, 1:-1] = p[:, 2:] - p[:, :-2]
    gy[1:-1, :] = p[2:, :] - p[:-2, :]
    mag = np.hypot(gx, gy)
    ang = (np.arctan2(gy, gx) % np.pi) / np.pi * bins
    n = p.shape[0] // cell
    out = np.zeros((n, n, bins), np.float32)
    for i in range(n):
        for j in range(n):
            sl = (slice(i * cell, (i + 1) * cell), slice(j * cell, (j + 1) * cell))
            b = np.minimum(ang[sl].ravel().astype(int), bins - 1)
            out[i, j] = np.bincount(b, weights=mag[sl].ravel(), minlength=bins)
    return (out / (np.linalg.norm(out) + 1e-3)).ravel()


_yy, _xx = np.mgrid[0:SIZE, 0:SIZE]
_u, _v = (_xx - (SIZE - 1) / 2) / (SIZE / SPAN), (_yy - (SIZE - 1) / 2) / (SIZE / SPAN)   # units of r
_rho = np.hypot(_u, _v)


def describe(p):
    pf = p.astype(np.float32)
    hg = hog(p)
    prof = np.array([pf[(_rho >= a) & (_rho < a + 0.2)].mean() for a in np.arange(0, 1.6, 0.2)], np.float32)
    prof = (prof - prof.mean()) / (prof.std() + 1e-3)
    inner = (_rho < 0.9)
    q = pf[inner] - pf.mean()
    ax = math.cos(SUN["phi"]) * _u[inner] + math.sin(SUN["phi"]) * _v[inner]
    ortho = -math.sin(SUN["phi"]) * _u[inner] + math.cos(SUN["phi"]) * _v[inner]
    den = np.abs(q).sum() + 1e-3
    return np.concatenate([hg, prof, [(q * ax).sum() / den, (q * ortho).sum() / den,
                                      pf.std() / 64.0, pf[inner].std() / 64.0, pf[_rho > 1.2].std() / 64.0]])


def synth(bg):
    """Add a randomly shaded synthetic crater to a real background patch."""
    d = RNG.uniform(0.08, 0.24)                     # bowl depth (units of r)
    rim = RNG.uniform(0.0, 0.07)                    # rim height
    w = RNG.uniform(0.10, 0.25)                     # rim width
    ell = RNG.uniform(0.85, 1.15)
    rho = np.hypot(_u * ell, _v / ell)
    h = np.where(rho < 1, -d * (1 - rho ** 2), 0.0) + rim * np.exp(-((rho - 1) / w) ** 2)
    h = h + np.where(rho > 1, 0.3 * rim * np.exp(-(rho - 1) / 0.8), 0.0)
    h *= 1 + 0.25 * cv2.GaussianBlur(RNG.normal(size=h.shape).astype(np.float32), (0, 0), 2.0) * 3   # erosion
    gy, gx = np.gradient(h)
    s = (math.cos(SUN["phi"] + math.pi), math.sin(SUN["phi"] + math.pi))
    shade = -(gx * s[0] + gy * s[1]) * (SIZE / SPAN)
    shade = cv2.GaussianBlur(shade.astype(np.float32), (0, 0), RNG.uniform(0.4, 1.1))
    gain = float(np.exp(RNG.uniform(math.log(5), math.log(70))))   # real CTX craters are faintly shaded
    out = bg.astype(np.float32) + gain * shade + RNG.normal(0, 2.0, bg.shape)
    return np.clip(out, 0, 255).astype(np.uint8)


def random_bg(flat):
    h, w = flat.shape
    r = float(np.exp(RNG.uniform(math.log(SCALES[0]), math.log(SCALES[-1]))))
    cx, cy = RNG.uniform(r * SPAN, w - r * SPAN), RNG.uniform(r * SPAN, h - r * SPAN)
    return patch(flat, cx, cy, r)


def build_training(flat, n=3500):
    X, y = [], []
    for _ in range(n):
        X.append(describe(synth(random_bg(flat)))); y.append(1)
        X.append(describe(random_bg(flat))); y.append(0)
    return np.array(X), np.array(y)


def _init(flat, phi):
    global FLAT
    FLAT = flat
    SUN["phi"] = phi


def _score_batch(pts):
    return [describe(patch(FLAT, x, y, r)) for x, y, r in pts]


MF_SCALES = [6, 8, 10, 13, 17, 22, 29, 38, 50, 65]


def template(r, kind):
    S = int(round(2 * 1.8 * r)) | 1
    c = S // 2
    yy, xx = np.mgrid[0:S, 0:S]
    u, v = (xx - c) / r, (yy - c) / r
    rho = np.hypot(u, v)
    if kind == "dark":                                   # dark floor, any lighting
        t = -np.exp(-(rho / 0.9) ** 4)
    else:                                                # bowl + rim lit from the measured sun direction
        h = np.where(rho < 1, -0.16 * (1 - rho ** 2), 0.0) + 0.05 * np.exp(-((rho - 1) / 0.18) ** 2)
        gy, gx = np.gradient(h)
        sx, sy = math.cos(SUN["phi"] + math.pi), math.sin(SUN["phi"] + math.pi)
        t = cv2.GaussianBlur((-(gx * sx + gy * sy)).astype(np.float32), (0, 0), max(0.8, r * 0.06))
    t = t.astype(np.float32)
    win = (rho < 1.5).astype(np.float32)
    return (t - (t * win).sum() / win.sum()) * win


def candidates(gray, zmin=4.5):
    """Matched-filter proposals: correlate crater templates at 10 scales, keep strong local maxima (z-scores)."""
    f = gray.astype(np.float32)
    f -= cv2.GaussianBlur(f, (0, 0), 25)
    out = []
    for r in MF_SCALES:
        for kind in ("shade", "dark"):
            t = template(r, kind)
            m = cv2.matchTemplate(f, t, cv2.TM_CCOEFF_NORMED)
            z = (m - m.mean()) / (m.std() + 1e-6)
            pk = (z == cv2.dilate(z, np.ones((int(r * 1.2) | 1,) * 2, np.uint8))) & (z >= zmin)
            off = t.shape[0] // 2
            for yy, xx in zip(*np.nonzero(pk)):
                out.append((float(xx + off), float(yy + off), float(r), float(z[yy, xx])))
    return out


def ring_support(edges, cx, cy, r, n=72):
    """Fraction of the rim circle that lies on an image edge (+-1.5 px)."""
    h, w = edges.shape
    hit = 0
    for k in range(n):
        ang = 2 * math.pi * k / n
        for dr in (-1.5, 0, 1.5):
            x = int(round(cx + (r + dr) * math.cos(ang))); y = int(round(cy + (r + dr) * math.sin(ang)))
            if 0 <= x < w and 0 <= y < h and edges[y, x]:
                hit += 1
                break
    return hit / n


def nms(items):
    items = sorted(items, key=lambda d: -d["score"])
    keep = []
    for it in items:
        ok = True
        for k in keep:
            dist = math.hypot(it["x"] - k["x"], it["y"] - k["y"])
            if dist < 0.7 * max(it["r"], k["r"]) and 0.55 < it["r"] / k["r"] < 1.8:
                ok = False; break
        if ok:
            keep.append(it)
    return keep


def main():
    global FLAT
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", default="craters.json")
    ap.add_argument("--preview", default="preview.png")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--support", type=float, default=0.4, help="minimum rim-circle edge coverage")
    ap.add_argument("--labels")
    a = ap.parse_args()

    img = cv2.imread(a.image, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise SystemExit("cannot read image")
    H, W = img.shape
    FLAT = flatten(img)
    SUN["phi"] = estimate_sun(img)
    print("bright-wall direction: %.0f deg" % math.degrees(SUN["phi"]))

    X, y = build_training(FLAT)
    wts = np.ones(len(y))
    if a.labels:
        lab = json.load(open(a.labels))
        X = np.vstack([X, [describe(patch(FLAT, d["x"], d["y"], d["r"])) for d in lab]])
        y = np.concatenate([y, [d["label"] for d in lab]])
        wts = np.concatenate([wts, np.full(len(lab), 20.0)])
    Xtr, Xte, ytr, yte, wtr, _ = train_test_split(X, y, wts, test_size=0.2, random_state=0, stratify=y)
    clf = RandomForestClassifier(n_estimators=300, min_samples_leaf=2, n_jobs=-1, random_state=0)
    clf.fit(Xtr, ytr, sample_weight=wtr)
    print("held-out accuracy on synthetic-vs-real patches: %.3f" % clf.score(Xte, yte))
    clf.fit(X, y, sample_weight=wts)

    cands = candidates(img)
    print("candidates:", len(cands))
    pts = [c[:3] for c in cands]
    chunks = [pts[i:i + 2000] for i in range(0, len(pts), 2000)]
    with Pool(initializer=_init, initargs=(FLAT, SUN["phi"])) as pool:
        feats = [f for part in pool.map(_score_batch, chunks) for f in part]
    prob = clf.predict_proba(np.array(feats))[:, 1]
    F = np.array(feats)
    # self-training: the most convincing real matches become extra positives, then refit once
    zs = np.array([c[3] for c in cands])
    strong = zs >= np.percentile(zs, 85)
    X2 = np.vstack([X, F[strong]]); y2 = np.concatenate([y, np.ones(strong.sum())])
    clf.fit(X2, y2, sample_weight=np.concatenate([wts, np.full(strong.sum(), 1.0)]))
    prob = clf.predict_proba(F)[:, 1]
    good = [{"x": c[0], "y": c[1], "r": c[2], "score": float(0.5 * p + 0.5 * min(1.0, c[3] / 8.0)), "z": c[3]}
            for c, p in zip(cands, prob) if p >= a.threshold]
    print("above threshold:", len(good))
    final = nms(good)

    mx = (LON1 - LON0) * KM_PER_DEG * math.cos(math.radians(18.4)) * 1000 / W
    my = (LAT1 - LAT0) * KM_PER_DEG * 1000 / H
    mpp = (mx + my) / 2
    out = []
    for i, d in enumerate(sorted(final, key=lambda d: d["y"])):
        diam = 2 * d["r"] * mpp
        cls = "small" if diam < 250 else "medium" if diam < 700 else "large"
        out.append({
            "id": i + 1,
            "lon": round(LON0 + d["x"] / W * (LON1 - LON0), 5),
            "lat": round(LAT1 - d["y"] / H * (LAT1 - LAT0), 5),
            "diameter_m": int(round(diam, -1)), "class": cls, "confidence": round(d["score"], 2),
            "px": [round(d["x"], 1), round(d["y"], 1), round(d["r"], 1)],
            "page": [round(d["x"] / W * PAGE_W, 1), round(d["y"] / H * PAGE_H, 1), round(d["r"] / W * PAGE_W, 1)],
        })
    json.dump({"meta": {"image": a.image, "m_per_px": round(mpp, 1), "threshold": a.threshold,
                        "sun_bright_wall_deg": round(math.degrees(SUN["phi"])), "count": len(out)},
               "craters": out}, open(a.out, "w"), indent=1)
    print("craters kept:", len(out), "->", a.out)
    for c in ("small", "medium", "large"):
        print(c, sum(1 for o in out if o["class"] == c))
    vis = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    col = {"small": (255, 200, 60), "medium": (60, 220, 255), "large": (80, 120, 255)}
    for o in out:
        x, yv, r = o["px"]
        cv2.circle(vis, (int(x), int(yv)), max(2, int(r)), col[o["class"]], 2)
    cv2.imwrite(a.preview, vis)


if __name__ == "__main__":
    main()

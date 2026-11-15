#!/usr/bin/env python3
"""
Download a patch of the Murray Lab global CTX mosaic of Mars and save it as a grayscale JPEG.

  python integration/fetch_ctx.py --nw 18.57188 77.22318 --se 18.44176 77.41956 --out web/images/jezero-ctx-mosaic.jpg

--nw / --se are LAT LON of the north-west and south-east corners. The image covers exactly that box.

Source: https://murray-lab.caltech.edu/CTX/ (V01 tiles, 256 px Web Mercator, TMS row order, deepest level 13,
about 9.65 m/pixel on Mars at this latitude). Only the tiles that touch the box are downloaded.
"""
import argparse, io, math, subprocess
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

BASE = "https://murray-lab.caltech.edu/CTX/V01/kml/MurrayLab_GlobalCTXMosaic_V01/{block}/{z}/{x}/{y}.png"
BLOCK = "E060_E076_N08_N20"      # the quad that holds Jezero (the page's 77 E, 18 N); change it for other regions
T = 256


def to_px(lat, lon, z):
    """Global Web Mercator pixel (x from west, y from north) at zoom z."""
    n = T * 2 ** z
    return ((lon + 180) / 360 * n,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def get(z, x, y):
    ty = 2 ** z - 1 - y                                   # the server numbers rows from the south
    url = BASE.format(block=BLOCK, z=z, x=x, y=ty)
    # curl uses the system certificate store (python.org builds of Python often have none)
    data = subprocess.run(["curl", "-sSfL", "--retry", "3", "-m", "60", url], check=True, capture_output=True).stdout
    return Image.open(io.BytesIO(data)).convert("L")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nw", nargs=2, type=float, required=True, metavar=("LAT", "LON"))
    ap.add_argument("--se", nargs=2, type=float, required=True, metavar=("LAT", "LON"))
    ap.add_argument("--zoom", type=int, default=13)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    x0, y0 = to_px(*a.nw, a.zoom)
    x1, y1 = to_px(*a.se, a.zoom)
    if not (x1 > x0 and y1 > y0):
        raise SystemExit("--nw must be north-west of --se")
    tx0, tx1, ty0, ty1 = int(x0 // T), int(x1 // T), int(y0 // T), int(y1 // T)
    jobs = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    print(f"downloading {len(jobs)} tiles at zoom {a.zoom}")
    with ThreadPoolExecutor(6) as ex:
        tiles = dict(zip(jobs, ex.map(lambda j: get(a.zoom, *j), jobs)))
    sheet = Image.new("L", ((tx1 - tx0 + 1) * T, (ty1 - ty0 + 1) * T))
    for (tx, ty), im in tiles.items():
        sheet.paste(im, ((tx - tx0) * T, (ty - ty0) * T))
    ox, oy = x0 - tx0 * T, y0 - ty0 * T
    out = sheet.crop((round(ox), round(oy), round(ox + (x1 - x0)), round(oy + (y1 - y0))))
    out.save(a.out, quality=92)
    print(f"wrote {a.out}: {out.width} x {out.height} px")


if __name__ == "__main__":
    main()

"""
Builds the animatable SVG rig of the Seal English mascot from the flat reference illustration.

Every body part is cut from the character silhouette with a hand-tuned region polygon.
Regions overlap generously inside the body, so rotating a part (waving flipper, head tilt,
tail/feet wiggle) never reveals a seam: overlapping pieces share the same flat colour.

Face features (eyes, brows, mouth variants) are drawn as clean primitives in the React
component; this script only emits traced geometry + measured anchor points.

Usage:  python design/mascot/build_rig.py
Outputs: src/components/mascot/seal-geometry.ts, design/mascot/out/*.png (previews)
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "design" / "mascot" / "seal-reference.png"
OUT_TS = ROOT / "src" / "components" / "mascot" / "seal-geometry.ts"
OUT_DIR = ROOT / "design" / "mascot" / "out"

img = np.array(Image.open(REF).convert("RGB")).astype(np.int32)
H, W, _ = img.shape


def near(rgb, tol):
    return ((img - np.array(rgb)) ** 2).sum(-1) < tol * tol


# ───────────── colour classes ─────────────
white = img.min(-1) > 236
_bgc = (img.min(-1) > 246).astype(np.uint8) * 255
flood = np.zeros((H + 2, W + 2), np.uint8)
cv2.floodFill(_bgc, flood, (0, 0), 128)
bg = _bgc == 128
sil = cv2.morphologyEx((~bg).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)).astype(bool)

navy = (img.sum(-1) < 360) & (img[:, :, 2] > img[:, :, 0] + 30)
# Whiskers stick out of the head outline: open the silhouette only inside the whisker zones.
_opened = cv2.morphologyEx(sil.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))).astype(bool)
_wz = np.zeros((H, W), bool)
_wz[440:545, 320:445] = True
_wz[365:465, 738:800] = True
sil = np.where(_wz, _opened, sil)
coral = near((252, 124, 101), 48) | near((242, 157, 140), 30)
light = near((233, 243, 252), 16)  # belly / muzzle
page_blue = near((203, 227, 253), 20)
stroke = near((78, 138, 200), 34) & ~navy
body = sil & ~navy & ~coral & ~light & ~white & ~page_blue


def poly_mask(points):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(points, np.int32)], 1)
    return m.astype(bool)


def ellipse_mask(cx, cy, rx, ry, angle=0):
    m = np.zeros((H, W), np.uint8)
    cv2.ellipse(m, (int(cx), int(cy)), (int(rx), int(ry)), angle, 0, 360, 1, -1)
    return m.astype(bool)


def components(mask, min_area=40):
    k, cc, stats, cent = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    out = []
    for j in range(1, k):
        x, y, w, h, a = stats[j]
        if a >= min_area:
            out.append(((x, y, w, h), cc == j))
    return out


def in_box(mask, x0, y0, x1, y1):
    m = np.zeros_like(mask)
    m[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    return m


# ───────────── contour → smooth SVG path ─────────────
def smooth_closed(pts, sigma):
    n = len(pts)
    if n < 8 or sigma <= 0:
        return pts
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    ext = np.concatenate([pts[-r:], pts, pts[:r]])
    xs = np.convolve(ext[:, 0], k, mode="valid")
    ys = np.convolve(ext[:, 1], k, mode="valid")
    return np.stack([xs, ys], 1)


def fmt(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def contour_path(pts, eps, corner_deg=48):
    approx = cv2.approxPolyDP(pts.astype(np.float32).reshape(-1, 1, 2), eps, True)[:, 0, :].astype(float)
    n = len(approx)
    if n < 3:
        return ""
    # Sharp corners (book-like) get guide points 3px away on both sides so the
    # midpoint spline keeps them crisp; everything else is smoothed.
    dense = []
    for i in range(n):
        prev, cur, nxt = approx[i - 1], approx[i], approx[(i + 1) % n]
        v1, v2 = cur - prev, nxt - cur
        l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
        turn = 0.0
        if l1 > 0 and l2 > 0:
            turn = np.degrees(np.arccos(np.clip(np.dot(v1, v2) / (l1 * l2), -1, 1)))
        if turn > corner_deg and l1 > 8 and l2 > 8:
            dense.append(cur - v1 / l1 * 3)
            dense.append(cur)
            dense.append(cur + v2 / l2 * 3)
        else:
            dense.append(cur)
    approx = np.array(dense)
    n = len(approx)
    # quadratic B-spline through midpoints → smooth, no overshoot
    mids = [(approx[i] + approx[(i + 1) % n]) / 2 for i in range(n)]
    d = [f"M{fmt(mids[-1][0])} {fmt(mids[-1][1])}"]
    for i in range(n):
        p, m = approx[i], mids[i]
        d.append(f"Q{fmt(p[0])} {fmt(p[1])} {fmt(m[0])} {fmt(m[1])}")
    return "".join(d) + "Z"


def mask_path(mask, sigma=2.4, eps=1.2, min_area=30, holes=True):
    m = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    mode = cv2.RETR_CCOMP if holes else cv2.RETR_EXTERNAL
    cs, _ = cv2.findContours(m, mode, cv2.CHAIN_APPROX_NONE)
    parts = []
    for c in cs:
        if abs(cv2.contourArea(c)) < min_area:
            continue
        pts = smooth_closed(c[:, 0, :].astype(float), sigma)
        p = contour_path(pts, eps)
        if p:
            parts.append(p)
    return "".join(parts)


# ───────────── region polygons (reference pixel space) ─────────────
HAIR_REGION = [(440, 120), (578, 120), (578, 232), (440, 232)]
HEAD_REGION = [
    (180, 90), (440, 90), (440, 206), (556, 206), (556, 90), (960, 90), (960, 330),
    (772, 330), (766, 446), (712, 490), (662, 528), (600, 548), (330, 552), (180, 552),
]
ARM_REGION = [
    (628, 516), (698, 474), (744, 436), (756, 370), (980, 370), (980, 740),
    (748, 740), (700, 690), (655, 630), (625, 565),
]
TORSO_REGION = [
    (180, 430), (605, 430), (647, 516), (688, 562), (728, 632), (752, 702), (756, 786),
    (690, 912), (446, 912), (371, 786), (180, 786),
]
FOOT_L_REGION = [(200, 740), (360, 745), (420, 790), (500, 960), (200, 960)]
FOOT_R_REGION = [(640, 960), (700, 790), (760, 745), (960, 740), (960, 960)]
HAND_REGION = [(398, 632), (446, 634), (500, 700), (503, 764), (474, 792), (398, 792)]
BOOK_BOX = (400, 560, 712, 792)

def erode(mask, px):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.erode(mask.astype(np.uint8), k).astype(bool)


# Internal cut edges must always sit on top of a same-coloured layer, otherwise
# anti-aliasing leaves hairline seams. Hence: the blue head is pulled 8px up from its
# cut line (the muzzle / torso continue underneath) and the arm tucks 14px under the head.
hair = sil & poly_mask(HAIR_REGION)
head = sil & erode(poly_mask(HEAD_REGION), 8)
arm = sil & poly_mask(ARM_REGION) & ~erode(poly_mask(HEAD_REGION), 14)
torso = sil & poly_mask(TORSO_REGION)
foot_l = sil & poly_mask(FOOT_L_REGION)
foot_r = sil & poly_mask(FOOT_R_REGION)

# light areas: muzzle on the head, chest + belly on the torso (filled in behind the book)
ROWS = np.arange(H)[:, None]
inner = cv2.erode(sil.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))).astype(bool)
light_all = cv2.morphologyEx((light & inner).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool)
light_main = np.any([m for (b, m) in components(light_all, 5000)], axis=0)
def fill_holes(mask):
    m = mask.astype(np.uint8) * 255
    fl = np.zeros((H + 2, W + 2), np.uint8)
    cv2.floodFill(m, fl, (0, 0), 128)
    return mask | (m == 0)


muzzle = fill_holes(light_main & poly_mask(HEAD_REGION) & (ROWS < 552))
hull_src = np.argwhere(light_main & (ROWS >= 600))[:, ::-1]
belly_hull = np.zeros((H, W), np.uint8)
cv2.fillPoly(belly_hull, [cv2.convexHull(hull_src.astype(np.int32))], 1)
belly = fill_holes(((light_main & (ROWS >= 500)) | belly_hull.astype(bool)) & sil)

# book
book_box = in_box(np.ones((H, W), bool), *BOOK_BOX)
book_cover = coral & book_box
book_spine = navy & in_box(np.ones((H, W), bool), 520, 650, 565, 790)
page_white = white & book_box & ~bg
book_pages_light = (page_blue | page_white) & book_box & ~poly_mask(HAND_REGION)
book_pages_light = cv2.morphologyEx(book_pages_light.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)).astype(bool)
book_pages_light = np.any([m for (b, m) in components(book_pages_light, 400)], axis=0)
page_white = cv2.morphologyEx(page_white.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)).astype(bool)

hand = (body | stroke) & poly_mask(HAND_REGION)
hand = cv2.morphologyEx(hand.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)).astype(bool)

strokes = {
    "arm": stroke & in_box(np.ones((H, W), bool), 795, 450, 880, 560),
    "hand": stroke & in_box(np.ones((H, W), bool), 398, 640, 492, 776),
    "footL": stroke & in_box(np.ones((H, W), bool), 270, 840, 386, 912),
    "footR": stroke & in_box(np.ones((H, W), bool), 710, 842, 824, 910),
}

# face: traced details used for the default expression
face_box = in_box(np.ones((H, W), bool), 330, 240, 790, 540)
brows = [m for (b, m) in components(navy & face_box, 150) if b[3] < 32 and b[2] < 70 and b[1] < 340]
whisk = [m for (b, m) in components(navy & face_box, 150) if (b[0] < 440 and b[1] > 450) or (b[0] > 700 and b[1] > 370)]
mouth_all = [m for (b, m) in components(navy & in_box(np.ones((H, W), bool), 500, 380, 625, 480), 500)]
tongue = coral & in_box(np.ones((H, W), bool), 540, 450, 600, 490)

brow_l = next(m for m in brows if np.argwhere(m)[:, 1].mean() < 550)
brow_r = next(m for m in brows if np.argwhere(m)[:, 1].mean() >= 550)
whisk_l = np.any([m for m in whisk if np.argwhere(m)[:, 1].mean() < 550], axis=0)
whisk_r = np.any([m for m in whisk if np.argwhere(m)[:, 1].mean() >= 550], axis=0)
nose_mouth = mouth_all[0]
# nose + the philtrum stem that joins the smile (from the reference artwork)
nose = nose_mouth & (ellipse_mask(557, 403, 40, 22) | poly_mask([(549, 412), (572, 412), (566, 446), (557.5, 446)]))
mouth = nose_mouth & ~nose
# the open mouth is navy under the tongue: merge so no light gap shows around the tongue
mouth = mouth | cv2.dilate(tongue.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
mouth = cv2.morphologyEx(mouth.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool)


def centroid(mask):
    ys, xs = np.nonzero(mask)
    return float(xs.mean()), float(ys.mean())


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


geometry = {
    "viewBox": [190, 110, 760, 860],
    "palette": {
        "body": "#8CC1F2",
        "bodyShade": "#7AB3EC",
        "light": "#EAF3FC",
        "navy": "#16447A",
        "navySoft": "#2B609D",
        "stroke": "#4F8ACB",
        "coral": "#FB7B63",
        "coralDeep": "#E8664F",
        "cheek": "#F99A85",
        "page": "#CBE3FD",
        "white": "#FFFFFF",
    },
    "paths": {
        "hair": mask_path(hair, sigma=4, eps=1.4),
        "arm": mask_path(arm, sigma=4, eps=1.4),
        "footL": mask_path(foot_l, sigma=4, eps=1.4),
        "footR": mask_path(foot_r, sigma=4, eps=1.4),
        "torso": mask_path(torso, sigma=4, eps=1.4),
        "belly": mask_path(belly, sigma=4, eps=1.4),
        "head": mask_path(head, sigma=4, eps=1.4),
        "muzzle": mask_path(muzzle, sigma=3.2, eps=1.2),
        "hand": mask_path(hand),
        "strokeArm": mask_path(strokes["arm"], sigma=1.2),
        "strokeHand": mask_path(strokes["hand"], sigma=1.2),
        "strokeFootL": mask_path(strokes["footL"], sigma=1.2),
        "strokeFootR": mask_path(strokes["footR"], sigma=1.2),
        "browL": mask_path(brow_l, sigma=1.0),
        "browR": mask_path(brow_r, sigma=1.0),
        "whiskersL": mask_path(whisk_l, sigma=1.0, eps=0.6),
        "whiskersR": mask_path(whisk_r, sigma=1.0, eps=0.6),
        "nose": mask_path(nose, sigma=1.2),
    },
    "anchors": {
        "headPivot": [560, 545],
        "armPivot": [714, 600],
        "hairPivot": [505, 222],
        "footLPivot": [430, 862],
        "footRPivot": [712, 862],
        "browL": [round(v, 1) for v in centroid(brow_l)],
        "browR": [round(v, 1) for v in centroid(brow_r)],
        "whiskersL": [430, 486],
        "whiskersR": [708, 408],
        "nose": [round(v, 1) for v in centroid(nose)],
        "mouth": [round(v, 1) for v in centroid(mouth)],
        "bookSpineTop": [542, 655],
    },
    "boxes": {
        "tongue": bbox(tongue),
        "mouth": bbox(mouth),
        "nose": bbox(nose),
    },
}

OUT_TS.parent.mkdir(parents=True, exist_ok=True)
OUT_TS.write_text(
    "// AUTO-GENERATED by design/mascot/build_rig.py — do not edit by hand.\n"
    "/* eslint-disable */\n"
    f"export const SEAL = {json.dumps(geometry, ensure_ascii=False, indent=2)} as const;\n",
    encoding="utf-8",
)
sizes = {k: len(v) for k, v in geometry["paths"].items()}
print("paths:", sizes, "total", sum(sizes.values()))

# debug previews of region masks
OUT_DIR.mkdir(parents=True, exist_ok=True)
dbg = np.zeros((H, W, 3), np.uint8) + 255
colors = {
    "hair": (255, 200, 0), "arm": (255, 120, 120), "footL": (120, 200, 120), "footR": (120, 200, 120),
    "torso": (140, 190, 240), "head": (90, 140, 220),
}
for name, m in [("torso", torso), ("arm", arm), ("footL", foot_l), ("footR", foot_r), ("head", head), ("hair", hair)]:
    dbg[m] = (dbg[m] * 0.35 + np.array(colors[name]) * 0.65).astype(np.uint8)
Image.fromarray(dbg).save(OUT_DIR / "regions.png")

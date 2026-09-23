"""
Vectorises the face elements from the owner's parts sheet (design/mascot/seal-parts-sheet.webp):
mouths (open with tongue, two "w" smiles, "o", flat line) and closed "^" eyes, then places them
on Сілі's face (reference artwork coordinates, same head tilt).

Edges are traced on an 8× bicubic-upsampled soft mask, so the tiny sheet elements become smooth curves.

    python design/mascot/build_face_parts.py   → src/components/mascot/seal-face.ts
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHEET = np.asarray(Image.open(ROOT / "design/mascot/seal-parts-sheet.webp").convert("RGBA")).astype(np.float32) / 255
OUT = ROOT / "src/components/mascot/seal-face.ts"
U = 8  # supersampling factor

# element boxes on the sheet (x0, y0, x1, y1), with a little padding
BOXES = {
    "mouthOpen": (44, 354, 114, 403),
    "smile1": (121, 364, 186, 389),
    "smile2": (197, 364, 263, 391),
    "mouthO": (280, 357, 314, 395),
    "flat": (172, 406, 224, 425),
    "eyeClosed1": (303, 298, 358, 328),
    "eyeClosed2": (368, 298, 424, 328),
}


def soft(box, kind):
    x0, y0, x1, y1 = box
    c = SHEET[y0:y1, x0:x1]
    rgb, a = c[..., :3], c[..., 3]
    if kind == "navy":
        lum = rgb.mean(-1)
        w = np.clip((0.62 - lum) / 0.3, 0, 1) * np.clip((rgb[..., 2] - rgb[..., 0]) / 0.12, 0, 1)
    else:  # coral
        w = np.clip((rgb[..., 0] - rgb[..., 2] - 0.2) / 0.2, 0, 1)
    m = (a * w).astype(np.float32)
    big = np.asarray(Image.fromarray(m, mode="F").resize(((x1 - x0) * U, (y1 - y0) * U), Image.BICUBIC))
    return big


def smooth_closed(pts, sigma):
    r = int(3 * sigma)
    if len(pts) < 2 * r + 2:
        return pts
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    ext = np.concatenate([pts[-r:], pts, pts[:r]])
    return np.stack([np.convolve(ext[:, 0], k, "valid"), np.convolve(ext[:, 1], k, "valid")], 1)


def fmt(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def to_path(big, box, affine, sigma=4.0, eps=1.0, min_area=40):
    """Contours of the upsampled mask → smooth quadratic path in target coordinates."""
    mask = (big > 0.5).astype(np.uint8)
    cs, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    parts = []
    for c in cs:
        if abs(cv2.contourArea(c)) < min_area * U:
            continue
        pts = smooth_closed(c[:, 0, :].astype(float), sigma * U / 4)
        pts = cv2.approxPolyDP(pts.astype(np.float32).reshape(-1, 1, 2), eps, True)[:, 0, :].astype(float)
        if len(pts) < 3:
            continue
        # sheet coordinates
        pts = pts / U + np.array(box[:2], float)
        pts = affine(pts)
        n = len(pts)
        mids = [(pts[i] + pts[(i + 1) % n]) / 2 for i in range(n)]
        d = [f"M{fmt(mids[-1][0])} {fmt(mids[-1][1])}"]
        for i in range(n):
            d.append(f"Q{fmt(pts[i][0])} {fmt(pts[i][1])} {fmt(mids[i][0])} {fmt(mids[i][1])}")
        parts.append("".join(d) + "Z")
    return "".join(parts)


def placer(src_anchor, dst_anchor, scale, rot_deg, flip_y=False):
    t = math.radians(rot_deg)
    ct, st = math.cos(t), math.sin(t)

    def f(pts):
        p = pts - np.array(src_anchor)
        if flip_y:
            p[:, 1] = -p[:, 1]
        p = p * scale
        x = p[:, 0] * ct - p[:, 1] * st
        y = p[:, 0] * st + p[:, 1] * ct
        return np.stack([x, y], 1) + np.array(dst_anchor)

    return f


def navy_anchor(name, mode="top-center"):
    """Anchor on an element: horizontal centre of the navy ink, and its top (or centre)."""
    big = soft(BOXES[name], "navy")
    ys, xs = np.nonzero(big > 0.5)
    x0, y0 = BOXES[name][:2]
    cx = (xs.min() + xs.max()) / 2 / U + x0
    if mode == "center":
        cy = (ys.min() + ys.max()) / 2 / U + y0
    else:
        # top of the ink in the central column band (the "w" middle bump)
        band = np.abs(xs / U + x0 - cx) < 2.5
        cy = ys[band].min() / U + y0
    width = (xs.max() - xs.min()) / U
    return (cx, cy), width


# ───────────── placement on the reference face ─────────────
HEAD_TILT = -12  # the face in the artwork is tilted counter-clockwise
MOUTH_ANCHOR = (561.5, 438.5)  # bottom of the philtrum = middle bump of the "w"
REF_W_WIDTH = 102  # width of the smile on the reference artwork

(_, _), open_w = navy_anchor("mouthOpen")
K = REF_W_WIDTH / open_w  # one scale for every mouth keeps proportions of the sheet

out: dict[str, dict[str, str]] = {}


def mouth(name, dst=MOUTH_ANCHOR, scale=1.0, flip=False, coral=False, anchor_mode="top-center"):
    (a, _w) = navy_anchor(name, anchor_mode)
    f = placer(a, dst, K * scale, HEAD_TILT, flip_y=flip)
    navy = soft(BOXES[name], "navy")
    entry = {}
    if coral:
        red = soft(BOXES[name], "coral")
        # the open mouth is navy *under* the tongue: union + close, so no light seam appears
        union = np.clip(navy + red + 0.35 * np.minimum(navy.max(), 1) * (cv2.GaussianBlur(red, (0, 0), U) > 0.25), 0, 1).astype(np.float32)
        union = cv2.morphologyEx((union > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3 * U, 3 * U))).astype(np.float32)
        entry["navy"] = to_path(union, BOXES[name], f, sigma=6)
        entry["coral"] = to_path(cv2.erode(red, np.ones((U // 2, U // 2), np.uint8)), BOXES[name], f, sigma=6)
    else:
        entry["navy"] = to_path(navy, BOXES[name], f, sigma=5)
    return entry


out["open"] = mouth("mouthOpen", coral=True)
out["grin"] = mouth("mouthOpen", scale=1.16, coral=True)
out["smile"] = mouth("smile1")
out["smallSmile"] = mouth("smile2", scale=0.72)
out["o"] = mouth("mouthO", dst=(563.5, 446), scale=0.95, coral=True)
out["sad"] = mouth("smile2", dst=(562.5, 452), scale=0.62, flip=True)
out["flat"] = mouth("flat", dst=(562, 446), scale=0.62, anchor_mode="center")

# closed eyes (^ for happy, flipped ‿ for sleepy), centred on each eye with its own tilt
EYES = [(450.7, 408, -16), (650.9, 356, -7.4)]
for i, (ex, ey, rot) in enumerate(EYES):
    src = "eyeClosed1" if i == 0 else "eyeClosed2"
    (a, w) = navy_anchor(src, "center")
    k = 78 / w
    out[f"eyeHappy{i}"] = {"navy": to_path(soft(BOXES[src], "navy"), BOXES[src], placer(a, (ex, ey), k, rot))}
    out[f"eyeClosed{i}"] = {"navy": to_path(soft(BOXES[src], "navy"), BOXES[src], placer(a, (ex, ey + 8), k * 0.92, rot, flip_y=True))}

OUT.write_text(
    "// AUTO-GENERATED by design/mascot/build_face_parts.py from the owner's parts sheet.\n"
    f"export const FACE = {json.dumps(out, indent=2)} as const;\n",
    encoding="utf-8",
)
print({k: {kk: len(vv) for kk, vv in v.items()} for k, v in out.items()}, "scale", round(K, 3))

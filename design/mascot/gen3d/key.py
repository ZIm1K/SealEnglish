"""
Cuts the green background out of the raw Gemini renders and puts every frame on one shared canvas.

- chroma key with soft edges + green despill;
- base poses are scaled so the seal (feet to head top) has the same height and stands on the same
  baseline, so switching poses doesn't make it jump;
- edited frames are aligned to their source frame (phase correlation on the silhouette), which
  removes the few-pixel drift image edits introduce, so cross-fades don't wobble.

Usage:  python design/mascot/gen3d/key.py
Outputs: public/mascot3d/<name>.webp, design/mascot/gen3d/preview.jpg
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from generate import JOBS

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
OUT = HERE.parents[2] / "public" / "mascot3d"

W, H = 900, 1200          # 3:4 canvas for the seal frames
BODY_H = 1000             # feet → head top
BASELINE = H - 40
ICE_W = 1200


def key(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = g - np.maximum(r, b)
    alpha = 1 - np.clip((green - 35) / 90, 0, 1)
    g2 = np.minimum(g, np.maximum(r, b))  # despill
    rgba = np.dstack([r, g2, b, alpha * 255]).clip(0, 255).astype(np.uint8)
    # drop specks: keep components that are a real part of the drawing
    solid = (alpha > 0.5).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(solid, 8)
    if n > 1:
        big = stats[1:, cv2.CC_STAT_AREA].max()
        keep = np.zeros(n, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] > big * 0.002
        grown = cv2.dilate((keep[lab]).astype(np.uint8), np.ones((5, 5), np.uint8))
        rgba[..., 3] = (rgba[..., 3] * grown).astype(np.uint8)
    return rgba


def metrics(rgba: np.ndarray) -> tuple[float, float, float]:
    """(feet y, head-top y, body centre x) — robust to a raised flipper."""
    m = rgba[..., 3] > 128
    ys, xs = np.nonzero(m)
    bottom = ys.max()
    top_all = ys.min()
    lower = m[int(top_all + (bottom - top_all) * 0.6):]
    lys, lxs = np.nonzero(lower)
    cx = lxs.mean()
    span = lxs.max() - lxs.min()
    mid = m[:, int(cx - span * 0.18): int(cx + span * 0.18)]
    top = np.nonzero(mid.any(1))[0].min()
    return float(bottom), float(top), float(cx)


def place(rgba: np.ndarray, scale: float, dx: float, dy: float, size: tuple[int, int]) -> np.ndarray:
    M = np.float32([[scale, 0, dx], [0, scale, dy]])
    return cv2.warpAffine(rgba, M, size, flags=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def align(frame: np.ndarray, ref: np.ndarray) -> np.ndarray:
    fa = frame[..., 3].astype(np.float32) / 255
    ra = ref[..., 3].astype(np.float32) / 255
    (sx, sy), _ = cv2.phaseCorrelate(ra, fa)
    if abs(sx) > 60 or abs(sy) > 60:  # the edit moved the pose itself — don't force it
        return frame
    return place(frame, 1, -sx, -sy, (frame.shape[1], frame.shape[0]))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    done: dict[str, np.ndarray] = {}
    order = [n for n in JOBS if (RAW / f"{n}.png").exists()]
    # sources before their edits
    order.sort(key=lambda n: 0 if JOBS[n][0] is None else (1 if JOBS[JOBS[n][0]][0] is None else 2))
    for name in order:
        src = JOBS[name][0]
        rgba = key(Image.open(RAW / f"{name}.png"))
        if name == "ice":
            ys, xs = np.nonzero(rgba[..., 3] > 128)
            crop = rgba[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
            s = ICE_W / crop.shape[1]
            placed = cv2.resize(crop, (ICE_W, round(crop.shape[0] * s)), interpolation=cv2.INTER_AREA)
        elif src is None:
            bottom, top, cx = metrics(rgba)
            s = BODY_H / (bottom - top)
            placed = place(rgba, s, W / 2 - cx * s, BASELINE - bottom * s, (W, H))
        else:
            # same transform as the source's raw → canvas, then snap to the source frame
            bottom, top, cx = metrics(rgba)
            sb, st, scx = metrics(done[src])
            s = (sb - st) / (bottom - top)
            placed = place(rgba, s, scx - cx * s, sb - bottom * s, (W, H))
            placed = align(placed, done[src])
        done[name] = placed
        Image.fromarray(placed, "RGBA").save(OUT / f"{name}.webp", quality=88, method=6)
        print(f"{name}: ok")
    preview(done)


def preview(frames: dict[str, np.ndarray]) -> None:
    names = [n for n in frames if n != "ice"]
    cols, tw = 6, 240
    th = tw * H // W
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 28) + (160 if "ice" in frames else 0)), (15, 30, 60))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        x, y = (i % cols) * tw, (i // cols) * (th + 28)
        im = Image.fromarray(frames[n], "RGBA").resize((tw, th), Image.LANCZOS)
        sheet.paste(im, (x, y), im)
        d.text((x + 8, y + th + 6), n, fill=(220, 235, 255))
    if "ice" in frames:
        im = Image.fromarray(frames["ice"], "RGBA")
        im = im.resize((480, round(im.height * 480 / im.width)), Image.LANCZOS)
        sheet.paste(im, (10, sheet.height - 150), im)
    sheet.save(HERE / "preview.jpg", quality=88)


if __name__ == "__main__":
    main()

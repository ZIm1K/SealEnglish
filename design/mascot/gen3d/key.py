"""
Cuts the green background out of the raw Gemini renders and puts every frame on one shared canvas.

- chroma key with soft edges + green despill;
- base poses are scaled so the seal (feet to head top) has the same height and stands on the same
  baseline, so switching poses doesn't make it jump;
- edited frames are aligned to their source frame (phase correlation on the silhouette), which
  removes the few-pixel drift image edits introduce, so cross-fades don't wobble.

- all seal frames are then cropped to their common bounding box and saved at two sizes
  (<name>.webp and a half-size <name>.sm.webp for small placements);
- the list of frames and the canvas geometry go to src/components/mascot/seal3d-frames.ts, which the
  Seal3D component reads (an empty list there makes the site fall back to the 2D mascot).

Usage:  python design/mascot/gen3d/key.py
Outputs: public/mascot3d/*.webp, src/components/mascot/seal3d-frames.ts, design/mascot/gen3d/preview.jpg
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from generate import JOBS

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
ROOT = HERE.parents[2]
OUT = ROOT / "public" / "mascot3d"
MANIFEST = ROOT / "src" / "components" / "mascot" / "seal3d-frames.ts"

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


def premul(rgba: np.ndarray) -> np.ndarray:
    f = rgba.astype(np.float32)
    f[..., :3] *= f[..., 3:] / 255
    return f


def unpremul(f: np.ndarray) -> np.ndarray:
    a = f[..., 3:]
    f[..., :3] = np.where(a > 0.5, f[..., :3] * 255 / np.maximum(a, 1e-3), 0)
    return f.clip(0, 255).round().astype(np.uint8)


def place(rgba: np.ndarray, scale: float, dx: float, dy: float, size: tuple[int, int]) -> np.ndarray:
    # resample premultiplied, or the keyed-out (black) background bleeds into the edges as a dark halo
    M = np.float32([[scale, 0, dx], [0, scale, dy]])
    f = cv2.warpAffine(premul(rgba), M, size, flags=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    return unpremul(np.clip(f, 0, None))


def resize(rgba: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    return unpremul(cv2.resize(premul(rgba), size, interpolation=cv2.INTER_AREA))


def align(frame: np.ndarray, ref: np.ndarray) -> np.ndarray:
    fa = frame[..., 3].astype(np.float32) / 255
    ra = ref[..., 3].astype(np.float32) / 255
    (sx, sy), _ = cv2.phaseCorrelate(ra, fa)
    if abs(sx) > 60 or abs(sy) > 60:  # the edit moved the pose itself — don't force it
        return frame
    return place(frame, 1, -sx, -sy, (frame.shape[1], frame.shape[0]))


def depth(name: str) -> int:
    src = JOBS[name][0]
    return 0 if src is None else 1 + depth(src)


def save(rgba: np.ndarray, name: str) -> bytes:
    h, w = rgba.shape[:2]
    data = b""
    for suffix, im in (("", rgba), (".sm", resize(rgba, (round(w / 2), round(h / 2))))):
        path = OUT / f"{name}{suffix}.webp"
        Image.fromarray(im, "RGBA").save(path, quality=88, method=6)
        data += path.read_bytes()
    return data


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    done: dict[str, np.ndarray] = {}
    # sources before their edits
    order = sorted((n for n in JOBS if (RAW / f"{n}.png").exists()), key=depth)
    for name in order:
        src = JOBS[name][0]
        rgba = key(Image.open(RAW / f"{name}.png"))
        if name == "ice":
            ys, xs = np.nonzero(rgba[..., 3] > 128)
            crop = rgba[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
            placed = resize(crop, (ICE_W, round(crop.shape[0] * ICE_W / crop.shape[1])))
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
        print(f"{name}: ok")

    seals = [n for n in done if n != "ice"]
    if not seals:
        return
    # one crop for every frame, so they stay interchangeable (and layers line up in the browser)
    solid = np.zeros((H, W), bool)
    for n in seals:
        solid |= done[n][..., 3] > 8
    ys, xs = np.nonzero(solid)
    pad = 16
    # symmetric around the body, so layouts that centre the mascot centre the seal, not the flipper
    half = max(W // 2 - (xs.min() - pad), xs.max() + 1 + pad - W // 2)
    x0, x1 = max(0, W // 2 - half), min(W, W // 2 + half)
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad)
    for n in seals:
        a = done[n][..., 3] > 8
        if a[:2].any() or a[:, :2].any() or a[:, -2:].any():
            print(f"WARNING: {n} touches the canvas edge — something (a raised flipper?) is cut off")

    digest = hashlib.sha1()
    for n in seals:
        digest.update(save(done[n][y0:y1, x0:x1], n))
    if "ice" in done:
        digest.update(save(done["ice"], "ice"))

    # feet width on the base poses, for the contact shadow
    feet = []
    for n in seals:
        if JOBS[n][0] is None:
            row = done[n][BASELINE - 30, :, 3] > 128
            if row.any():
                cols = np.nonzero(row)[0]
                feet.append(cols.max() - cols.min())
    ice = done.get("ice")
    MANIFEST.write_text(
        "// Generated by design/mascot/gen3d/key.py — do not edit by hand.\n"
        "// Frames live in public/mascot3d/<name>.webp (+ <name>.sm.webp at half size).\n"
        "// An empty SEAL3D_FRAMES list makes Seal3D fall back to the 2D SVG mascot.\n\n"
        f"export const SEAL3D_FRAMES: readonly string[] = {sorted(seals)!r};\n\n".replace("'", '"')
        + "/** Frame size (px, full resolution) and landmarks inside it. */\n"
        f"export const SEAL3D_CANVAS = {{ w: {x1 - x0}, h: {y1 - y0}, baseline: {BASELINE - y0}, "
        f"headTop: {BASELINE - BODY_H - y0}, cx: {W // 2 - x0}, bodyH: {BODY_H}, "
        f"feetW: {int(np.median(feet)) if feet else 400} }};\n\n"
        + (f"export const SEAL3D_ICE: {{ w: number; h: number }} | null = {{ w: {ice.shape[1]}, h: {ice.shape[0]} }};\n\n"
           if ice is not None else "export const SEAL3D_ICE: { w: number; h: number } | null = null;\n\n")
        + f'/** Cache buster: changes whenever a frame changes. */\nexport const SEAL3D_VERSION = "{digest.hexdigest()[:8]}";\n'
    )
    print(f"crop {x1 - x0}x{y1 - y0}, manifest → {MANIFEST.name}")
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

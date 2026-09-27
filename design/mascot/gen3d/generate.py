"""
Generates the 3D-look Seally frames for the marketing site with the Gemini image API.

Pipeline: 3 base poses are drawn from the reference sheets, every other frame (emotions, blinks,
second wave frame) is an *edit* of its source frame so the body stays put and frames can be
cross-faded. Raw renders land on a flat #00FF00 background; key.py cuts them out.

Usage (needs GEMINI_API_KEY in the environment):
  python design/mascot/gen3d/generate.py --probe          # one cheap call: checks key/model/config
  python design/mascot/gen3d/generate.py                  # all missing frames (resumable)
  python design/mascot/gen3d/generate.py --only wave-joy  # regenerate specific frames (--force to overwrite)
Outputs: design/mascot/gen3d/raw/<name>.png
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
REF = HERE / "ref"
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MODELS = ["gemini-3.1-flash-image", "gemini-3-pro-image-preview", "gemini-2.5-flash-image"]

CHARACTER = (
    "Use the attached character sheets as the exact reference. Draw Seally the seal mascot — the same character with the "
    "same proportions, colors, materials and details: soft matte blue 3D toy look, white belly and muzzle, big glossy navy "
    "eyes with white highlights, coral-pink cheeks, navy brows and whiskers, small three-hair tuft on top of the head, "
    "coral-red book with a navy spine and cream pages."
)
FRAMING = (
    "Cute high-quality 3D render, soft studio light from the top left. Vertical 3:4 frame, character centered, whole body "
    "visible with empty space around it, the seal takes about 80% of the frame height, feet near the bottom with a small margin. "
    "Background: solid flat pure green #00FF00, no gradient, no floor, no shadow, no text, no labels, no other objects. "
    "No green reflections or green tint on the character."
)
HAPPY = "Expression: happy — eyes open looking at the viewer, friendly open-mouth smile."

POSES = {
    "wave": "Pose: full body, standing, facing the viewer with a slight 3/4 turn. One flipper holds an open coral-red book "
            "against the chest, the other flipper is raised high, waving hello.",
    "read": "Pose: full body, standing, facing the viewer with a slight 3/4 turn. Holds an open coral-red book with both "
            "flippers in front of the belly, glancing up at the viewer over the book.",
    "stand": "Pose: full body, standing relaxed, facing the viewer with a slight 3/4 turn. Both flippers down along the body, "
             "a closed coral-red book tucked under one flipper.",
}

EMOTIONS = {
    "joy": "both eyes squeezed shut into happy upward arcs (^ ^), wide open-mouth laugh, brows raised, extra rosy cheeks",
    "surprised": 'eyes wide open, small round "o" mouth, brows raised high',
    "love": "both eyes closed in soft happy arcs, gentle closed-mouth smile, very rosy blushing cheeks",
    "wink": "one eye open, the other closed in a happy arc (a playful wink), open-mouth grin",
    "neutral": "eyes open looking at the viewer, calm small closed-mouth smile",
    "sad": "eyes open looking slightly down, small downturned mouth, brows tilted up in the middle, paler cheeks",
}

KEEP = ("Keep everything else exactly identical — same pose, same flipper and book positions, same size and position in "
        "the frame, same lighting, same solid pure green #00FF00 background.")


def emotion_edit(e: str) -> str:
    return f"Change ONLY the facial expression of this seal to: {EMOTIONS[e]}. {KEEP}"


BLINK = f"Change ONLY the eyes: both eyes gently closed mid-blink (soft curved closed eyelids), keep the mouth and brows exactly as they are. {KEEP}"
WAVE_B = ("Change ONLY the raised waving flipper: tilt it about 30 degrees further outward and slightly lower, the other "
          "moment of a waving motion. Keep the face, body, book and everything else exactly identical, same size and "
          "position in the frame, same solid pure green #00FF00 background.")
ICE = ("A small ice floe in the same soft matte 3D toy style as the attached character sheets — white and light icy blue, "
       "rounded smooth edges, viewed slightly from above, wide oval shape like a little stage for a character to stand on. "
       "Wide 16:9 frame, the floe fills about 85% of the width. Background: solid flat pure green #00FF00, no shadow, nothing else.")

# name -> (source frame or None for reference-based generation, prompt, aspect ratio)
JOBS: dict[str, tuple[str | None, str, str]] = {}
for pose, desc in POSES.items():
    JOBS[f"{pose}-happy"] = (None, f"{CHARACTER}\n\n{desc}\n{HAPPY}\n\n{FRAMING}", "3:4")
for pose, emos in {"wave": ["joy", "surprised", "love", "wink"], "read": ["joy", "neutral"],
                   "stand": ["joy", "surprised", "sad", "neutral", "wink"]}.items():
    for e in emos:
        JOBS[f"{pose}-{e}"] = (f"{pose}-happy", emotion_edit(e), "3:4")
for src in ["wave-happy", "read-happy", "stand-happy", "read-neutral"]:
    JOBS[f"{src}-blink"] = (src, BLINK, "3:4")
JOBS["wave-happy-b"] = ("wave-happy", WAVE_B, "3:4")
JOBS["wave-joy-b"] = ("wave-joy", WAVE_B, "3:4")
JOBS["ice"] = (None, ICE, "16:9")


def png_part(img: Image.Image) -> dict:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG")
    return {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(buf.getvalue()).decode()}}


def call(key: str, model: str, parts: list[dict], aspect: str, size: str) -> Image.Image:
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect, "imageSize": size}},
    }
    req = urllib.request.Request(API.format(model=model), data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:600]
            if e.code in (429, 500, 503) and attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code} from {model}: {msg}") from None
    for cand in data.get("candidates", []):
        for p in cand.get("content", {}).get("parts", []):
            blob = p.get("inlineData") or p.get("inline_data")
            if blob:
                return Image.open(io.BytesIO(base64.b64decode(blob["data"]))).convert("RGB")
    raise RuntimeError(f"No image in response: {json.dumps(data)[:600]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--model", default=os.environ.get("GEMINI_IMAGE_MODEL", MODELS[0]))
    ap.add_argument("--size", default="2K")
    args = ap.parse_args()

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY is not set")
    RAW.mkdir(exist_ok=True)
    refs = [png_part(Image.open(REF / f)) for f in ("sheet-poses.webp", "sheet-parts.webp")]

    if args.probe:
        for model in [args.model] + [m for m in MODELS if m != args.model]:
            try:
                img = call(key, model, [{"text": "A small blue cartoon seal, solid green background."}], "3:4", "1K")
                print(f"OK {model}: {img.size}")
                return
            except RuntimeError as e:
                print(f"FAIL {model}: {e}")
        sys.exit(1)

    names = args.only or list(JOBS)
    for name in names:
        src, prompt, aspect = JOBS[name]
        out = RAW / f"{name}.png"
        if out.exists() and not args.force:
            continue
        if src:
            src_path = RAW / f"{src}.png"
            if not src_path.exists():
                sys.exit(f"{name}: source frame {src} is missing — generate it first")
            parts = [png_part(Image.open(src_path)), {"text": prompt}]
        else:
            parts = [*refs, {"text": prompt}]
        t = time.time()
        img = call(key, args.model, parts, aspect, args.size)
        img.save(out)
        print(f"{name}: {img.size} in {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main()

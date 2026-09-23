"""Preview of all emotions built from the parts-sheet face elements.  python design/mascot/preview_face.py"""
import io
import json
import re
import sys
from pathlib import Path

import resvg_py
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "design/mascot"))
import preview_rig as pr  # noqa: E402

face = json.loads(re.search(r"export const FACE = (\{.*\}) as const;", (ROOT / "src/components/mascot/seal-face.ts").read_text(encoding="utf-8"), re.S).group(1))
P, C = pr.P, pr.C

PHILTRUM = ""


def mouth(name):
    m = face[name]
    s = f'<path d="{m["navy"]}" fill="{C["navy"]}"/>'
    if "coral" in m:
        s += f'<path d="{m["coral"]}" fill="{C["coral"]}"/>'
    return s


def head(eyes: str, mouth_name: str) -> str:
    body = f'<path d="{P["hair"]}" fill="{C["body"]}"/><path d="{P["head"]}" fill="{C["body"]}"/>'
    halos = "".join(
        f'<ellipse cx="{e["cx"]}" cy="{e["cy"]}" rx="{e["rx"] + 12}" ry="{e["ry"] + 13}" fill="#9ACBF7" transform="rotate({e["rot"]} {e["cx"]} {e["cy"]})"/>' for e in pr.EYES
    )
    if eyes == "open":
        eye_svg = "".join(pr.eye(e, i) for i, e in enumerate(pr.EYES))
    elif eyes == "wink":
        eye_svg = ""
    else:
        eye_svg = "".join(f'<path d="{face[f"{eyes}{i}"]["navy"]}" fill="{C["navy"]}"/>' for i in range(2))
    if eyes == "wink":
        eye_svg = pr.eye(pr.EYES[0], 0) + f'<path d="{face["eyeHappy1"]["navy"]}" fill="{C["navy"]}"/>'
    return (
        body + halos + f'<path d="{P["muzzle"]}" fill="{C["light"]}"/>'
        + f'<ellipse cx="432.9" cy="469.6" rx="21" ry="20" fill="{C["cheek"]}"/><ellipse cx="690.7" cy="408" rx="21" ry="20" fill="{C["cheek"]}"/>'
        + eye_svg
        + f'<path d="{P["browL"]}" fill="{C["navy"]}"/><path d="{P["browR"]}" fill="{C["navy"]}"/>'
        + PHILTRUM + mouth(mouth_name) + f'<path d="{P["nose"]}" fill="{C["navy"]}"/>'
        + f'<path d="{P["whiskersL"]}" fill="{C["navy"]}"/><path d="{P["whiskersR"]}" fill="{C["navy"]}"/>'
    )


COMBOS = [
    ("happy", "open", "open"),
    ("joy", "eyeHappy", "grin"),
    ("neutral", "open", "smallSmile"),
    ("love", "eyeHappy", "smile"),
    ("surprised", "open", "o"),
    ("sad", "open", "sad"),
    ("wink", "wink", "grin"),
    ("sleepy", "eyeClosed", "flat"),
]

tiles = []
for name, eyes, m in COMBOS:
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="330 160 460 400" width="460" height="400"><rect x="330" y="160" width="460" height="400" fill="#fff"/>{head(eyes, m)}</svg>'
    tiles.append(Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=svg)))).convert("RGB"))
sheet = Image.new("RGB", (460 * 4, 400 * 2), "white")
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 4) * 460, (i // 4) * 400))
sheet.save(ROOT / "design/mascot/out/emotions.png")

# zoomed default mouth vs reference
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="490 370 150 130" width="750" height="650"><rect x="0" y="0" width="1100" height="1100" fill="#fff"/>{head("open", "open")}</svg>'
ours = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=svg)))).convert("RGB")
ref = Image.open(ROOT / "design/mascot/seal-reference.png").convert("RGB").crop((490, 370, 640, 500)).resize((750, 650), Image.LANCZOS)
cmp = Image.new("RGB", (1510, 650), "white")
cmp.paste(ref, (0, 0))
cmp.paste(ours, (760, 0))
cmp.save(ROOT / "design/mascot/out/mouth_compare.png")
print("ok")

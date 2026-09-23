"""Renders the rig (static pose) next to the reference for visual QA.  python design/mascot/preview_rig.py"""
import json
import math
import re
from pathlib import Path

import numpy as np
import resvg_py
from PIL import Image
import io

ROOT = Path(__file__).resolve().parents[2]
src = (ROOT / "src/components/mascot/seal-geometry.ts").read_text(encoding="utf-8")
geo = json.loads(re.search(r"export const SEAL = (\{.*\}) as const;", src, re.S).group(1))
P, C, A = geo["paths"], geo["palette"], geo["anchors"]

EYES = [
    # cx, cy, rot, rx, ry, iris dx, iris dy, iris rx, iris ry, highlight (world offset from eye centre)
    dict(cx=450.7, cy=404.5, rot=-19, rx=41.5, ry=45.7, idx=8, idy=3, irx=36.5, iry=42, hx=15, hy=-20.5, hr=8.2),
    dict(cx=650.9, cy=352.7, rot=-7.4, rx=41, ry=45.7, idx=-8, idy=4, irx=36.5, iry=42, hx=-22.7, hy=-10.8, hr=8.2),
]


def eye(e, i):
    rot = f"rotate({e['rot']} {e['cx']} {e['cy']})"
    icx, icy = e["cx"] + e["idx"], e["cy"] + e["idy"]
    return f"""
    <g>
      <ellipse cx="{e['cx']}" cy="{e['cy']}" rx="{e['rx'] + 11}" ry="{e['ry'] + 13}" fill="#9ACBF7" transform="{rot}"/>
      <clipPath id="sc{i}"><ellipse cx="{e['cx']}" cy="{e['cy']}" rx="{e['rx']}" ry="{e['ry']}" transform="{rot}"/></clipPath>
      <ellipse cx="{e['cx']}" cy="{e['cy']}" rx="{e['rx']}" ry="{e['ry']}" fill="#fff" stroke="{C['navy']}" stroke-width="5" transform="{rot}"/>
      <g clip-path="url(#sc{i})">
        <clipPath id="ir{i}"><ellipse cx="{icx}" cy="{icy}" rx="{e['irx']}" ry="{e['iry']}" transform="rotate({e['rot']} {icx} {icy})"/></clipPath>
        <ellipse cx="{icx}" cy="{icy}" rx="{e['irx']}" ry="{e['iry']}" fill="{C['navy']}" transform="rotate({e['rot']} {icx} {icy})"/>
        <g clip-path="url(#ir{i})">
          <ellipse cx="{icx + 2}" cy="{icy + e['iry'] * 0.92}" rx="{e['irx'] * 0.78}" ry="{e['iry'] * 0.42}" fill="{C['navySoft']}" transform="rotate({e['rot']} {icx} {icy})"/>
        </g>
        <circle cx="{e['cx'] + e['hx']}" cy="{e['cy'] + e['hy']}" r="{e['hr']}" fill="#fff"/>
      </g>
    </g>"""


BOOK = """
    <g stroke-linejoin="round">
      <path d="M411 590 L534 654 L526 777 L406 714 Z" fill="#FB7B63" stroke="#FB7B63" stroke-width="6"/>
      <path d="M560 657 L699 618 L675 734 L544 777 Z" fill="#FB7B63" stroke="#FB7B63" stroke-width="6"/>
      <path d="M411 589 L427 572 C478 578 522 604 548 644 L552 652 L533 654 Z" fill="#CBE3FD"/>
      <path d="M552 652 L556 646 C585 612 630 596 691 594 L699 617 L560 657 Z" fill="#CBE3FD"/>
      <g fill="none" stroke="#fff" stroke-linecap="round">
        <path d="M428 573 C478 579 522 605 548 645" stroke-width="5"/>
        <path d="M420 581 C470 588 515 612 543 650" stroke-width="3.5"/>
        <path d="M414 588 C466 596 512 620 538 654" stroke-width="3"/>
        <path d="M556 646 C585 613 630 597 690 595" stroke-width="5"/>
        <path d="M558 652 C590 624 636 608 694 604" stroke-width="3.5"/>
        <path d="M561 657 C594 632 640 618 697 614" stroke-width="3"/>
      </g>
      <path d="M533 654 C541 661 553 661 560 656 L544 777 C539 783 530 782 526 776 Z" fill="#16447A"/>
    </g>
"""


def svg(show_face=True):
    vb = geo["viewBox"]
    body = f"""
    <path d="{P['hair']}" fill="{C['body']}"/>
    <path d="{P['arm']}" fill="{C['body']}"/><path d="{P['strokeArm']}" fill="{C['stroke']}"/>
    <path d="{P['footL']}" fill="{C['body']}"/><path d="{P['strokeFootL']}" fill="{C['stroke']}"/>
    <path d="{P['footR']}" fill="{C['body']}"/><path d="{P['strokeFootR']}" fill="{C['stroke']}"/>
    <path d="{P['torso']}" fill="{C['body']}"/>
    <path d="{P['belly']}" fill="{C['light']}"/>
    {BOOK}
    <path d="{P['hand']}" fill="{C['body']}"/><path d="{P['strokeHand']}" fill="{C['stroke']}"/>
    <path d="{P['head']}" fill="{C['body']}"/>
    """
    face = ""
    if show_face:
        face = "".join(eye(e, i) for i, e in enumerate(EYES)) + f"""
    <path d="{P['muzzle']}" fill="{C['light']}"/>
    <ellipse cx="432.9" cy="469.6" rx="21" ry="20" fill="{C['cheek']}"/>
    <ellipse cx="690.7" cy="408" rx="21" ry="20" fill="{C['cheek']}"/>
    <path d="{P['browL']}" fill="{C['navy']}"/><path d="{P['browR']}" fill="{C['navy']}"/>
    <path d="{P['mouth']}" fill="{C['navy']}"/><path d="{P['tongue']}" fill="{C['coral']}"/>
    <path d="{P['nose']}" fill="{C['navy']}"/>
    <path d="{P['whiskersL']}" fill="{C['navy']}"/><path d="{P['whiskersR']}" fill="{C['navy']}"/>
    """
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1092 1092" width="1092" height="1092"><rect width="1092" height="1092" fill="#fff"/>{body}{face}</svg>'


def render(s):
    png = bytes(resvg_py.svg_to_bytes(svg_string=s))
    return Image.open(io.BytesIO(png)).convert("RGB")


if __name__ == "__main__":
    out = ROOT / "design/mascot/out"
    out.mkdir(parents=True, exist_ok=True)
    ours = render(svg())
    ref = Image.open(ROOT / "design/mascot/seal-reference.png").convert("RGB")
    side = Image.new("RGB", (2184, 1092), "white")
    side.paste(ref, (0, 0))
    side.paste(ours, (1092, 0))
    side.crop((200, 120, 2184 - 150, 960)).save(out / "compare.png")
    diff = np.abs(np.array(ref, int) - np.array(ours, int)).sum(-1)
    Image.fromarray((255 - np.clip(diff, 0, 255)).astype(np.uint8)).save(out / "diff.png")
    ours.crop((360, 250, 760, 520)).resize((800, 540)).save(out / "face_ours.png")
    ref.crop((360, 250, 760, 520)).resize((800, 540)).save(out / "face_ref.png")
    print("mean abs diff", round(float(diff.mean()), 2))

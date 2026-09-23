"""
Brand assets for Seal English: app icon, horizontal logo (light & dark), favicons, PWA icons, OG image.
Text is converted to outlines (Unbounded) so every SVG is font-independent.

    python design/brand/build_brand.py
"""
from __future__ import annotations

import io
import json
import re
from pathlib import Path

import resvg_py
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "public"
BRAND = PUB / "brand"
BRAND.mkdir(parents=True, exist_ok=True)

geo = json.loads(
    re.search(r"export const SEAL = (\{.*\}) as const;", (ROOT / "src/components/mascot/seal-geometry.ts").read_text(encoding="utf-8"), re.S).group(1)
)
P, C = geo["paths"], geo["palette"]

OCEAN_900, OCEAN_800, SEAL_700 = "#0a2142", "#0f2f5c", "#2f69ad"
SEAL_600, SEAL_300 = "#4f8acb", "#a9d0f7"

# ───────────── fonts → outlines ─────────────
FONT_DIR = ROOT / "node_modules/@fontsource-variable/unbounded/files"
_fonts: dict[tuple[str, int], TTFont] = {}


def font(subset: str, weight: int) -> TTFont:
    key = (subset, weight)
    if key not in _fonts:
        f = TTFont(FONT_DIR / f"unbounded-{subset}-wght-normal.woff2")
        f.flavor = None
        _fonts[key] = instancer.instantiateVariableFont(f, {"wght": weight}, overlap=instancer.OverlapMode.REMOVE)
    return _fonts[key]


def text_path(text: str, size: float, x: float, baseline: float, weight: int = 700, tracking: float = -0.02):
    """Returns (svg path d, advance width) for text set in Unbounded."""
    ds, cursor = [], x
    for ch in text:
        f = None
        for subset in ("latin", "cyrillic", "latin-ext"):
            cand = font(subset, weight)
            if ord(ch) in cand.getBestCmap():
                f = cand
                break
        if f is None:
            continue
        upm = f["head"].unitsPerEm
        scale = size / upm
        gname = f.getBestCmap()[ord(ch)]
        gs = f.getGlyphSet()
        pen = SVGPathPen(gs)
        gs[gname].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        ds.append(pen.getCommands())
        cursor += f["hmtx"][gname][0] * scale + tracking * size
    return " ".join(ds), cursor - x


# ───────────── seal pieces ─────────────
EYES = [
    dict(cx=450.7, cy=404.5, rot=-19, rx=41.5, ry=45.7, ix=458.7, iy=407.5, hx=465.7, hy=384),
    dict(cx=650.9, cy=352.7, rot=-7.4, rx=41, ry=45.7, ix=642.9, iy=356.7, hx=628.2, hy=341.9),
]


def seal_head() -> str:
    eyes = "".join(
        f'<ellipse cx="{e["cx"]}" cy="{e["cy"]}" rx="{e["rx"] + 12}" ry="{e["ry"] + 13}" fill="#9ACBF7" opacity=".85" transform="rotate({e["rot"]} {e["cx"]} {e["cy"]})"/>'
        for e in EYES
    )
    pupils = "".join(
        f'<ellipse cx="{e["cx"]}" cy="{e["cy"]}" rx="{e["rx"]}" ry="{e["ry"]}" fill="#fff" stroke="{C["navy"]}" stroke-width="5" transform="rotate({e["rot"]} {e["cx"]} {e["cy"]})"/>'
        f'<ellipse cx="{e["ix"]}" cy="{e["iy"]}" rx="36" ry="42" fill="{C["navy"]}" transform="rotate({e["rot"]} {e["ix"]} {e["iy"]})"/>'
        f'<circle cx="{e["hx"]}" cy="{e["hy"]}" r="8.5" fill="#fff"/>'
        for e in EYES
    )
    return (
        f'<path d="{P["hair"]}" fill="{C["body"]}"/><path d="{P["head"]}" fill="{C["body"]}"/>{eyes}'
        f'<path d="{P["muzzle"]}" fill="{C["light"]}"/>'
        f'<ellipse cx="432.9" cy="469.6" rx="21" ry="20" fill="{C["cheek"]}"/><ellipse cx="690.7" cy="408" rx="21" ry="20" fill="{C["cheek"]}"/>'
        f"{pupils}"
        f'<path d="{P["browL"]}" fill="{C["navy"]}"/><path d="{P["browR"]}" fill="{C["navy"]}"/>'
        f'<path d="{P["mouth"]}" fill="{C["navy"]}"/><path d="{P["tongue"]}" fill="{C["coral"]}"/><path d="{P["nose"]}" fill="{C["navy"]}"/>'
        f'<path d="{P["whiskersL"]}" fill="{C["navy"]}"/><path d="{P["whiskersR"]}" fill="{C["navy"]}"/>'
    )


BOOK = (
    '<g stroke-linejoin="round">'
    '<path d="M411 590 L534 654 L526 777 L406 714 Z" fill="#FB7B63" stroke="#FB7B63" stroke-width="6"/>'
    '<path d="M560 657 L699 618 L675 734 L544 777 Z" fill="#FB7B63" stroke="#FB7B63" stroke-width="6"/>'
    '<path d="M411 589 L427 572 C478 578 522 604 548 644 L552 652 L533 654 Z" fill="#CBE3FD"/>'
    '<path d="M552 652 L556 646 C585 612 630 596 691 594 L699 617 L560 657 Z" fill="#CBE3FD"/>'
    '<g fill="none" stroke="#fff" stroke-linecap="round">'
    '<path d="M428 573 C478 579 522 605 548 645" stroke-width="5"/><path d="M420 581 C470 588 515 612 543 650" stroke-width="3.5"/>'
    '<path d="M414 588 C466 596 512 620 538 654" stroke-width="3"/><path d="M556 646 C585 613 630 597 690 595" stroke-width="5"/>'
    '<path d="M558 652 C590 624 636 608 694 604" stroke-width="3.5"/><path d="M561 657 C594 632 640 618 697 614" stroke-width="3"/></g>'
    '<path d="M533 654 C541 661 553 661 560 656 L544 777 C539 783 530 782 526 776 Z" fill="#16447A"/></g>'
)


def seal_full() -> str:
    return (
        f'<path d="{P["footL"]}" fill="{C["body"]}"/><path d="{P["strokeFootL"]}" fill="{C["stroke"]}"/>'
        f'<path d="{P["footR"]}" fill="{C["body"]}"/><path d="{P["strokeFootR"]}" fill="{C["stroke"]}"/>'
        f'<path d="{P["arm"]}" fill="{C["body"]}"/><path d="{P["strokeArm"]}" fill="{C["stroke"]}"/>'
        f'<path d="{P["torso"]}" fill="{C["body"]}"/><path d="{P["belly"]}" fill="{C["light"]}"/>{BOOK}'
        f'<path d="{P["hand"]}" fill="{C["body"]}"/><path d="{P["strokeHand"]}" fill="{C["stroke"]}"/>{seal_head()}'
    )


def defs(uid: str) -> str:
    return (
        f'<linearGradient id="bg{uid}" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{OCEAN_900}"/><stop offset=".55" stop-color="{OCEAN_800}"/><stop offset="1" stop-color="{SEAL_700}"/></linearGradient>'
        f'<radialGradient id="gl{uid}" cx=".88" cy=".08" r=".6"><stop offset="0" stop-color="#8cc1f2" stop-opacity=".55"/><stop offset="1" stop-color="#8cc1f2" stop-opacity="0"/></radialGradient>'
    )


# The head sits like in the site header: 115% wide, dropped by 20% so it peeks out of the tile.
HEAD_T = "translate({ox} {oy}) scale({s}) translate(-330 -160)"


def icon_svg(size=1024, radius=0.225, uid="i") -> str:
    s = size * 1.08 / 460
    ox = (size - 460 * s) / 2
    oy = size * 0.12
    rx = size * radius
    clip = f'<clipPath id="c{uid}"><rect width="{size}" height="{size}" rx="{rx}"/></clipPath>' if radius else ""
    clip_attr = f' clip-path="url(#c{uid})"' if radius else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
        f"<defs>{defs(uid)}{clip}</defs>"
        f"<g{clip_attr}>"
        f'<rect width="{size}" height="{size}" fill="url(#bg{uid})"/><rect width="{size}" height="{size}" fill="url(#gl{uid})"/>'
        f'<g transform="{HEAD_T.format(ox=round(ox, 2), oy=round(oy, 2), s=round(s, 5))}">{seal_head()}</g>'
        "</g></svg>"
    )


def logo_svg(dark_bg: bool) -> str:
    h = 200
    icon_size = 200
    fs = 92
    seal_d, w1 = text_path("Seal", fs, icon_size + 44, 132)
    eng_d, w2 = text_path("English", fs, icon_size + 44 + w1 + 4, 132)
    width = int(icon_size + 44 + w1 + 4 + w2 + 8)
    c1 = "#ffffff" if dark_bg else OCEAN_900
    c2 = SEAL_300 if dark_bg else SEAL_600
    icon = icon_svg(icon_size, uid="l").replace('<svg xmlns="http://www.w3.org/2000/svg"', "<svg")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {h}" width="{width}" height="{h}">'
        f"{icon}"
        f'<path d="{seal_d}" fill="{c1}"/><path d="{eng_d}" fill="{c2}"/></svg>'
    )


def og_svg() -> str:
    W, H = 1200, 630
    title_d, _ = text_path("Seal English", 88, 80, 262)
    l1, _ = text_path("Англійська, якою", 46, 80, 352, weight=600)
    l2, _ = text_path("хочеться говорити", 46, 80, 412, weight=600)
    tag, tag_w = text_path("Перший урок — безкоштовно", 26, 110, 518, weight=500, tracking=0)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
        f"<defs>{defs('o')}"
        '<radialGradient id="a1" cx=".15" cy=".1" r=".6"><stop offset="0" stop-color="#4f8acb" stop-opacity=".55"/><stop offset="1" stop-color="#4f8acb" stop-opacity="0"/></radialGradient>'
        '<radialGradient id="a2" cx=".9" cy=".95" r=".55"><stop offset="0" stop-color="#fb7b63" stop-opacity=".28"/><stop offset="1" stop-color="#fb7b63" stop-opacity="0"/></radialGradient>'
        '<radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#a9d0f7" stop-opacity=".45"/><stop offset="1" stop-color="#a9d0f7" stop-opacity="0"/></radialGradient>'
        "</defs>"
        f'<rect width="{W}" height="{H}" fill="#061428"/><rect width="{W}" height="{H}" fill="url(#a1)"/><rect width="{W}" height="{H}" fill="url(#a2)"/>'
        '<circle cx="930" cy="330" r="300" fill="url(#halo)"/>'
        '<ellipse cx="930" cy="578" rx="215" ry="24" fill="#a9d0f7" opacity=".7"/><ellipse cx="930" cy="570" rx="210" ry="20" fill="#eaf5ff"/>'
        f'<g transform="translate(700 70) scale(0.62) translate(-200 -120)">{seal_full()}</g>'
        f'<path d="{title_d}" fill="#fff"/>'
        f'<path d="{l1}" fill="#cbe3fd"/><path d="{l2}" fill="#8cc1f2"/>'
        f'<rect x="80" y="478" width="{tag_w + 60:.0f}" height="60" rx="30" fill="#fb7b63"/>'
        f'<path d="{tag}" fill="#fff"/>'
        "</svg>"
    )


def png(svg: str, path: Path, width: int | None = None):
    data = bytes(resvg_py.svg_to_bytes(svg_string=svg, width=width, skip_system_fonts=True))
    path.write_bytes(data)


if __name__ == "__main__":
    icon = icon_svg()
    (BRAND / "seal-english-icon.svg").write_text(icon, encoding="utf-8")
    png(icon, BRAND / "seal-english-icon-1024.png", 1024)
    png(icon, BRAND / "seal-english-icon-512.png", 512)

    for dark in (False, True):
        name = "seal-english-logo-white" if dark else "seal-english-logo"
        svg = logo_svg(dark)
        (BRAND / f"{name}.svg").write_text(svg, encoding="utf-8")
        png(svg, BRAND / f"{name}.png", 1600)

    # site icons
    (PUB / "favicon.svg").write_text(icon, encoding="utf-8")
    png(icon, PUB / "favicon-32.png", 32)
    square = icon_svg(radius=0, uid="s")
    png(square, PUB / "apple-touch-icon.png", 180)
    png(square, PUB / "icon-192.png", 192)
    png(square, PUB / "icon-512.png", 512)
    ico = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=icon, width=256)))).convert("RGBA")
    ico.save(PUB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    og = og_svg()
    png(og, PUB / "og.png", 1200)
    (BRAND / "og.svg").write_text(og, encoding="utf-8")
    print("brand assets written to", BRAND)

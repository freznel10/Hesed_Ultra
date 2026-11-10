"""Turn the upscaled family reference image into game-sized pixel sprites.

    python3 tools/prep_characters.py

Reads  assets/characters/reference/family-front.jpg (4 people, left to right:
Freznel, Diane, Rafa, Ellie) and writes, per member:
  assets/characters/<name>_front.png      native size, transparent background
  assets/characters/preview/<name>@4x.png  enlarged for checking

Steps: find each figure by its non-white columns, cut out the white
background, shrink by the art's own pixel size with a per-block majority
colour (keeps edges crisp, unlike smooth resizing), then reduce to a small
palette to remove JPG noise.
"""
from collections import Counter
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "characters" / "reference" / "family-front.jpg"
OUT = ROOT / "assets" / "characters"
NAMES = ["freznel", "diane", "rafa", "ellie"]
BLOCK = 17          # size of one art pixel in the reference image, measured by eye
WHITE = 236         # anything brighter on all channels counts as background


def is_bg(p):
    return p[0] > WHITE and p[1] > WHITE and p[2] > WHITE


def figure_spans(img):
    w, h = img.size
    px = img.load()
    cols = [any(not is_bg(px[x, y]) for y in range(0, h, 3)) for x in range(w)]
    spans, start = [], None
    for x, on in enumerate(cols + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            if x - start > 80:
                spans.append((start, x))
            start = None
    return spans


def shrink(crop):
    w, h = crop.size
    out = Image.new("RGBA", (w // BLOCK + 1, h // BLOCK + 1), (0, 0, 0, 0))
    src, dst = crop.load(), out.load()
    for by in range(0, h, BLOCK):
        for bx in range(0, w, BLOCK):
            votes = Counter()
            bg = 0
            # sample the middle of the block to avoid edge bleed
            for y in range(by + 4, min(by + BLOCK - 4, h)):
                for x in range(bx + 4, min(bx + BLOCK - 4, w)):
                    p = src[x, y]
                    if is_bg(p):
                        bg += 1
                    else:
                        votes[(p[0] // 12 * 12, p[1] // 12 * 12, p[2] // 12 * 12)] += 1
            total = bg + sum(votes.values())
            if total and bg < total * 0.5 and votes:
                c = votes.most_common(1)[0][0]
                dst[bx // BLOCK, by // BLOCK] = (*c, 255)
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def reduce_palette(img, colors=24):
    alpha = img.getchannel("A")
    q = img.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert("RGBA")
    q.putalpha(alpha)
    return q


def main():
    img = Image.open(SRC).convert("RGB")
    spans = figure_spans(img)
    if len(spans) != len(NAMES):
        raise SystemExit(f"expected {len(NAMES)} figures, found {len(spans)}: {spans}")
    (OUT / "preview").mkdir(parents=True, exist_ok=True)
    sprites = []
    for name, (x0, x1) in zip(NAMES, spans):
        crop = img.crop((x0, 0, x1, img.height))
        sprite = reduce_palette(shrink(crop))
        sprite.save(OUT / f"{name}_front.png")
        sprite.resize((sprite.width * 4, sprite.height * 4), Image.NEAREST).save(OUT / "preview" / f"{name}@4x.png")
        sprites.append(sprite)
        print(f"{name}: {sprite.width}x{sprite.height}")
    # line-up preview, feet aligned
    gap = 6
    h = max(s.height for s in sprites)
    w = sum(s.width for s in sprites) + gap * (len(sprites) + 1)
    lineup = Image.new("RGBA", (w, h + 4), (150, 206, 236, 255))
    x = gap
    for s in sprites:
        lineup.alpha_composite(s, (x, h - s.height + 2))
        x += s.width + gap
    lineup.resize((w * 4, (h + 4) * 4), Image.NEAREST).save(OUT / "preview" / "family@4x.png")


if __name__ == "__main__":
    main()

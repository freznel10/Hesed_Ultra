"""Turn the upscaled family reference image into game-sized pixel sprites.

    python3 tools/prep_characters.py

Reads  assets/characters/reference/family-front.jpg (4 people, left to right:
Freznel, Diane, Rafa, Ellie) and writes, per member:
  assets/characters/<name>_front.png      native size, transparent background
  assets/characters/preview/<name>@4x.png  enlarged for checking

Steps: find each figure by its non-white columns, cut out the white
background, shrink by the art's own pixel size (about 8.25 image px per art pixel, grid position auto-detected) with a per-block majority
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
BLOCK = 8.25        # size of one art pixel in the reference image (measured from edge spacing)
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


def grid_phase(gray, axis):
    """Find where the art's pixel grid starts, from where colour edges fall modulo BLOCK."""
    px, (w, h) = gray.load(), gray.size
    buckets = Counter()
    if axis == "x":
        for y in range(0, h, 5):
            for x in range(1, w):
                if abs(px[x, y] - px[x - 1, y]) > 40:
                    buckets[round((x % BLOCK) * 4) / 4] += 1
    else:
        for x in range(0, w, 5):
            for y in range(1, h):
                if abs(px[x, y] - px[x, y - 1]) > 40:
                    buckets[round((y % BLOCK) * 4) / 4] += 1
    return buckets.most_common(1)[0][0] if buckets else 0.0


def shrink(crop):
    gray = crop.convert("L")
    ox, oy = grid_phase(gray, "x"), grid_phase(gray, "y")
    w, h = crop.size
    cols, rows = int((w - ox) / BLOCK), int((h - oy) / BLOCK)
    out = Image.new("RGBA", (cols, rows), (0, 0, 0, 0))
    src, dst = crop.load(), out.load()
    m = BLOCK * 0.3  # sample the middle of each block to avoid edge bleed
    for r in range(rows):
        for c in range(cols):
            x0, y0 = ox + c * BLOCK, oy + r * BLOCK
            votes, bg, total = Counter(), 0, 0
            for y in range(int(y0 + m), int(y0 + BLOCK - m) + 1):
                for x in range(int(x0 + m), int(x0 + BLOCK - m) + 1):
                    if x >= w or y >= h:
                        continue
                    p = src[x, y]
                    total += 1
                    if is_bg(p):
                        bg += 1
                    else:
                        votes[(p[0] // 8 * 8, p[1] // 8 * 8, p[2] // 8 * 8)] += 1
            if votes and bg < total * 0.5:
                dst[c, r] = (*votes.most_common(1)[0][0], 255)
            else:
                dst[c, r] = PAPER  # white for now; see clear_background
    out = keep_largest(clear_background(out))
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


PAPER = (248, 248, 248, 255)


def clear_background(img):
    """Make white transparent only where it touches the outside, so eye whites,
    teeth and white shoes inside a figure stay white."""
    w, h = img.size
    px = img.load()
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if 0 <= x < w and 0 <= y < h and px[x, y] == PAPER:
            px[x, y] = (0, 0, 0, 0)
            # include diagonals so thin gaps (between an arm and the body) are reached
            stack += [(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]
    return img


def keep_largest(img):
    """Drop stray specks (bits of neighbouring figures, JPG noise) around the main figure."""
    w, h = img.size
    px = img.load()
    seen, best = set(), []
    for sy in range(h):
        for sx in range(w):
            if (sx, sy) in seen or px[sx, sy][3] == 0:
                continue
            comp, stack = [], [(sx, sy)]
            seen.add((sx, sy))
            while stack:
                x, y = stack.pop()
                comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny][3]:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    keep = set(best)
    for y in range(h):
        for x in range(w):
            if px[x, y][3] and (x, y) not in keep:
                px[x, y] = (0, 0, 0, 0)
    return img


def reduce_palette(img, colors=64):
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

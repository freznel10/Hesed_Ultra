"""Convert the walk poses and portraits in the family sheet into game sprites.

    python3 tools/prep_sheet.py

Reads  assets/characters/reference/family-sheet.jpg
Writes assets/characters/<name>_walk.png      6 frames in a row, each CELL_W x CELL_H,
                                               feet on the bottom edge, centred
       assets/characters/portraits/<name>_<n>.png
       assets/characters/preview/walk@4x.png, portraits@3x.png

Frame order in each walk strip follows the sheet: top row left to right, then
bottom row left to right. WALK_FRAMES says what each frame shows; it is written
to assets/characters/walk.json for the app. Left-facing walks are made in the
app by mirroring the right-facing frames.
"""
from collections import Counter
from pathlib import Path
import sys

import json

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import prep_characters as pc

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "characters" / "reference" / "family-sheet.jpg"
OUT = ROOT / "assets" / "characters"
CELL_W, CELL_H = 32, 66

# x, y, w, h of each white panel in the sheet
WALK_PANELS = {
    "freznel": (501, 55, 498, 498),
    "rafa": (1026, 55, 507, 498),
    "diane": (501, 579, 499, 532),
    "ellie": (1026, 579, 507, 532),
}
WALK_BLOCK = 4.16
# What each of the 6 frames shows. "skip" marks frames that are off-model in the sheet.
WALK_FRAMES = {
    "freznel": ["front", "back", "right", "left", "right", "right"],
    "rafa": ["front", "back", "front_walk", "left", "back_walk", "right"],
    "diane": ["front", "back", "right", "skip", "right", "right"],
    "ellie": ["front", "back", "right", "left", "back_walk", "right"],
}
# name, panel-relative cell (x, y, w, h), art pixel size
PORTRAITS = [
    ("freznel_neutral", (1559, 55, 216, 250), 4.16),
    ("diane_happy", (1780, 55, 211, 250), 4.16),
    ("diane_smile", (1559, 320, 216, 234), 4.16),
    ("diane_laugh", (1780, 320, 211, 234), 4.16),
    ("freznel_surprised", (1559, 585, 218, 252), 4.16),
    ("ellie_surprised", (1780, 585, 211, 252), 4.16),
    ("rafa_surprised", (1559, 867, 216, 244), 4.16),
    ("ellie_worried", (1780, 867, 211, 244), 4.16),
]


def convert(img, box, block):
    x, y, w, h = box
    pc.BLOCK = block
    return pc.reduce_palette(pc.shrink(img.crop((x, y, x + w, y + h))), 48)


def main():
    img = Image.open(SRC).convert("RGB")
    (OUT / "preview").mkdir(parents=True, exist_ok=True)
    (OUT / "portraits").mkdir(parents=True, exist_ok=True)

    strips = []
    for name, (px, py, pw, ph) in WALK_PANELS.items():
        strip = Image.new("RGBA", (CELL_W * 6, CELL_H), (0, 0, 0, 0))
        for i in range(6):
            col, row = i % 3, i // 3
            cell = (px + col * pw // 3, py + row * ph // 2, pw // 3, ph // 2)
            frame = convert(img, cell, WALK_BLOCK)
            if frame.width > CELL_W or frame.height > CELL_H:
                raise SystemExit(f"{name} frame {i} is {frame.size}, larger than the cell")
            strip.alpha_composite(frame, (i * CELL_W + (CELL_W - frame.width) // 2, CELL_H - frame.height))
        strip.save(OUT / f"{name}_walk.png")
        strips.append(strip)
        print(name, "walk strip", strip.size)

    manifest = {"cell": [CELL_W, CELL_H], "frames": WALK_FRAMES}
    (OUT / "walk.json").write_text(json.dumps(manifest, indent=2) + "\n")

    sheet = Image.new("RGBA", (CELL_W * 6, CELL_H * len(strips)), (150, 206, 236, 255))
    for i, s in enumerate(strips):
        sheet.alpha_composite(s, (0, i * CELL_H))
    sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST).save(OUT / "preview" / "walk@4x.png")

    faces = []
    for name, box, block in PORTRAITS:
        face = convert(img, box, block)
        face.save(OUT / "portraits" / f"{name}.png")
        faces.append(face)
        print(name, face.size)
    w = max(f.width for f in faces) + 4
    h = max(f.height for f in faces) + 4
    grid = Image.new("RGBA", (w * 4, h * 2), (150, 206, 236, 255))
    for i, f in enumerate(faces):
        grid.alpha_composite(f, ((i % 4) * w + 2, (i // 4) * h + 2))
    grid.resize((grid.width * 3, grid.height * 3), Image.NEAREST).save(OUT / "preview" / "portraits@3x.png")


if __name__ == "__main__":
    main()

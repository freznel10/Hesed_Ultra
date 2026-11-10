"""Draw the place sprites for Hesed Ultra as true pixel art.

Every building is drawn at native resolution on a transparent background,
then a x4 preview and a combined town preview are written next to it.

    python3 tools/gen_places.py

Output: assets/places/*.png (native) and assets/places/preview/*.png (x4).
The buildings are stylised impressions, not exact replicas; tweak the
colours and details in the functions below to match the real places.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "places"
PREVIEW = OUT / "preview"

# ---------------------------------------------------------------- palette
P = {
    "clear": (0, 0, 0, 0),
    "outline": (34, 32, 52, 255),
    "white": (245, 242, 232, 255),
    "cream": (234, 222, 196, 255),
    "cream_d": (204, 188, 158, 255),
    "grey": (150, 156, 168, 255),
    "grey_d": (102, 108, 122, 255),
    "grey_l": (196, 202, 210, 255),
    "glass": (120, 178, 214, 255),
    "glass_l": (178, 220, 240, 255),
    "glass_d": (70, 120, 168, 255),
    "roof_red": (176, 70, 58, 255),
    "roof_red_d": (130, 48, 44, 255),
    "wood": (150, 98, 60, 255),
    "wood_d": (106, 66, 42, 255),
    "green": (92, 160, 72, 255),
    "green_d": (56, 112, 58, 255),
    "green_l": (150, 204, 98, 255),
    "blue": (40, 76, 150, 255),
    "blue_d": (26, 48, 104, 255),
    "blue_l": (92, 132, 206, 255),
    "gold": (232, 182, 64, 255),
    "gold_d": (184, 132, 40, 255),
    "wine": (128, 34, 64, 255),
    "wine_l": (176, 62, 96, 255),
    "pink": (226, 120, 150, 255),
    "orange": (232, 128, 56, 255),
    "teal": (56, 150, 150, 255),
    "teal_d": (36, 104, 110, 255),
    "black": (24, 22, 30, 255),
    "path": (198, 186, 160, 255),
    "path_d": (168, 154, 128, 255),
    "road": (84, 86, 96, 255),
    "road_line": (230, 220, 170, 255),
    "sky": (150, 206, 236, 255),
    "sky_l": (196, 230, 246, 255),
}

# 3x5 pixel font (uppercase, digits, a few symbols)
FONT = {
    "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"],
    "C": ["011", "100", "100", "100", "011"], "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"], "F": ["111", "100", "110", "100", "100"],
    "G": ["011", "100", "101", "101", "011"], "H": ["101", "101", "111", "101", "101"],
    "I": ["111", "010", "010", "010", "111"], "J": ["001", "001", "001", "101", "010"],
    "K": ["101", "101", "110", "101", "101"], "L": ["100", "100", "100", "100", "111"],
    "M": ["10001", "11011", "10101", "10001", "10001"], "N": ["1001", "1101", "1011", "1001", "1001"],
    "O": ["010", "101", "101", "101", "010"], "P": ["110", "101", "110", "100", "100"],
    "Q": ["010", "101", "101", "110", "011"], "R": ["110", "101", "110", "101", "101"],
    "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"], "V": ["101", "101", "101", "101", "010"],
    "W": ["10001", "10001", "10101", "11011", "10001"], "X": ["101", "101", "010", "101", "101"],
    "Y": ["101", "101", "010", "010", "010"], "Z": ["111", "001", "010", "100", "111"],
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["110", "001", "010", "100", "111"], "3": ["110", "001", "010", "001", "110"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
    "6": ["011", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "110"],
    " ": ["000", "000", "000", "000", "000"], "-": ["000", "000", "111", "000", "000"],
    ".": ["000", "000", "000", "000", "010"], "&": ["010", "101", "010", "101", "011"],
    "'": ["010", "010", "000", "000", "000"],
}


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w, h), P["clear"])
        self.px = self.img.load()

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = P[c] if isinstance(c, str) else c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, c)

    def box(self, x, y, w, h, fill, line="outline"):
        self.rect(x, y, w, h, line)
        self.rect(x + 1, y + 1, w - 2, h - 2, fill)

    def hline(self, x, y, w, c):
        self.rect(x, y, w, 1, c)

    def vline(self, x, y, h, c):
        self.rect(x, y, 1, h, c)

    def text_width(self, s):
        return sum(len(FONT.get(ch, FONT[" "])[0]) + 1 for ch in s.upper()) - 1

    def text(self, x, y, s, c):
        for ch in s.upper():
            glyph = FONT.get(ch, FONT[" "])
            for gy, row in enumerate(glyph):
                for gx, bit in enumerate(row):
                    if bit == "1":
                        self.put(x + gx, y + gy, c)
            x += len(glyph[0]) + 1

    def text_center(self, cx, y, s, c):
        self.text(cx - self.text_width(s) // 2, y, s, c)

    def sign(self, cx, y, s, bg, fg, pad=2):
        w = self.text_width(s) + pad * 2 + 2
        x = cx - w // 2
        self.box(x, y, w, 9, bg)
        self.text(x + pad + 1, y + 2, s, fg)

    def window(self, x, y, w=6, h=7, frame="white"):
        self.rect(x, y, w, h, frame)
        self.rect(x + 1, y + 1, w - 2, h - 2, "glass")
        self.put(x + 1, y + 1, "glass_l")
        self.put(x + 2, y + 1, "glass_l")
        self.put(x + 1, y + 2, "glass_l")

    def tree(self, x, y):
        """Small round tree, (x, y) = top-left of a 9x13 box."""
        self.rect(x + 4, y + 8, 2, 5, "wood_d")
        for yy, (a, b) in enumerate([(3, 6), (1, 8), (0, 9), (0, 9), (0, 9), (1, 8), (2, 7), (3, 6)]):
            for xx in range(a, b):
                self.put(x + xx, y + yy, "green")
        for yy, (a, b) in enumerate([(3, 6), (1, 4), (1, 3)]):
            for xx in range(a, b):
                self.put(x + xx, y + yy + 1, "green_l")
        for xx in range(2, 8):
            self.put(x + xx, y + 7, "green_d")

    def bush(self, x, y, w=8):
        self.rect(x, y + 1, w, 3, "green")
        self.rect(x + 1, y, w - 2, 1, "green")
        self.hline(x + 1, y + 1, w // 2, "green_l")
        self.hline(x, y + 3, w, "green_d")

    def save(self, name):
        OUT.mkdir(parents=True, exist_ok=True)
        PREVIEW.mkdir(parents=True, exist_ok=True)
        self.img.save(OUT / f"{name}.png")
        self.img.resize((self.w * 4, self.h * 4), Image.NEAREST).save(PREVIEW / f"{name}@4x.png")
        return self.img


def ground(c, y, h=6):
    """Grass strip with a path in front of every building."""
    c.rect(0, y, c.w, h, "green")
    for x in range(0, c.w, 5):
        c.put(x + 1, y, "green_l")
        c.put(x + 3, y + h - 1, "green_d")


# ---------------------------------------------------------------- places
def house():
    """Family home: two-storey suburban house with gate and garden."""
    c = Canvas(96, 80)
    ground(c, 72, 8)
    # second storey + roof
    c.box(18, 30, 60, 42, "cream")
    c.rect(19, 50, 58, 1, "cream_d")
    for i in range(14):  # gable roof
        c.hline(14 + i, 30 - i, 68 - i * 2, "roof_red" if i % 3 else "roof_red_d")
    c.hline(14, 30, 68, "outline")
    for i in range(14):
        c.put(14 + i, 30 - i, "outline")
        c.put(81 - i, 30 - i, "outline")
    c.hline(28, 16, 40, "outline")
    # windows upstairs
    for x in (24, 40, 56, 66):
        c.window(x, 35, 6, 8)
    # balcony rail
    c.hline(20, 47, 56, "outline")
    for x in range(21, 76, 3):
        c.vline(x, 44, 3, "white")
    # door + windows downstairs
    c.box(44, 55, 10, 17, "wood")
    c.put(51, 63, "gold")
    c.window(24, 55, 12, 9)
    c.window(60, 55, 12, 9)
    # chimney
    c.box(66, 14, 6, 10, "roof_red_d")
    # gate and fence
    for x in range(2, 94, 4):
        if 40 <= x <= 56:
            continue
        c.vline(x, 66, 7, "black")
    c.hline(2, 67, 38, "black")
    c.hline(58, 67, 36, "black")
    c.rect(44, 72, 10, 8, "path")
    c.tree(2, 54)
    c.tree(84, 54)
    c.bush(24, 68, 10)
    c.bush(62, 68, 10)
    # plant pots by the door
    c.rect(40, 68, 3, 4, "orange")
    c.rect(55, 68, 3, 4, "orange")
    c.put(41, 67, "green")
    c.put(56, 67, "green")
    return c.save("house")


def church():
    """New Wine Church Alabang, as a modern worship hall with a tall cross wall."""
    c = Canvas(112, 88)
    ground(c, 80, 8)
    # main hall
    c.box(10, 40, 92, 40, "white")
    c.rect(11, 41, 90, 3, "grey_l")
    # tall feature wall with cross
    c.box(44, 8, 24, 72, "wine")
    c.rect(45, 9, 3, 70, "wine_l")
    c.rect(55, 14, 3, 22, "gold")
    c.rect(50, 20, 13, 3, "gold")
    c.vline(57, 14, 22, "gold_d")
    # glass entrance
    c.box(48, 60, 16, 20, "glass_d")
    c.rect(49, 61, 14, 19, "glass")
    c.vline(56, 61, 19, "outline")
    c.rect(50, 62, 2, 4, "glass_l")
    # side windows (long horizontal glass bands)
    c.box(14, 48, 28, 8, "glass")
    c.box(70, 48, 28, 8, "glass")
    c.hline(15, 49, 10, "glass_l")
    c.hline(71, 49, 10, "glass_l")
    # canopy
    c.rect(40, 57, 32, 2, "grey_d")
    # sign
    c.sign(27, 64, "NEW WINE", "white", "wine")
    c.text_center(27, 74, "ALABANG", "outline")
    c.rect(48, 80, 16, 8, "path")
    c.tree(0, 68)
    c.tree(102, 68)
    c.bush(76, 75, 22)
    return c.save("church")


def school(name, label, main, main_d, accent, key):
    """A campus building with a central tower, arched entrance and a field."""
    c = Canvas(120, 88)
    ground(c, 80, 8)
    # wings
    c.box(4, 40, 44, 40, "cream")
    c.box(72, 40, 44, 40, "cream")
    for x0 in (4, 72):
        c.rect(x0 + 1, 41, 42, 3, main)
        for row in (48, 62):
            for col in range(4):
                c.window(x0 + 4 + col * 10, row, 6, 8)
    # central tower
    c.box(44, 18, 32, 62, main)
    c.rect(45, 19, 3, 60, main_d)
    for i in range(10):  # pointed roof
        c.hline(44 + i, 18 - i, 32 - i * 2, main_d if i % 2 else accent)
    c.put(60, 6, "gold")
    c.vline(60, 3, 4, "gold")
    # clock / seal
    c.rect(55, 24, 10, 10, "white")
    c.rect(56, 25, 8, 8, accent)
    c.rect(59, 26, 2, 4, "white")
    c.rect(59, 29, 4, 1, "white")
    # arched entrance
    c.rect(52, 62, 16, 18, "outline")
    c.rect(53, 64, 14, 16, "wood")
    c.hline(54, 63, 12, "wood")
    c.vline(60, 64, 16, "wood_d")
    c.window(48, 40, 8, 10)
    c.window(64, 40, 8, 10)
    # banner sign
    c.sign(60, 52, label, "white", main_d)
    c.rect(52, 80, 16, 8, "path")
    c.tree(0, 68)
    c.tree(111, 68)
    c.bush(20, 76, 14)
    c.bush(86, 76, 14)
    return c.save(key)


def mall(label, key, main="teal", main_d="teal_d", accent="gold"):
    """Big modern mall: glass atrium, wide facade, name sign, palm trees."""
    c = Canvas(128, 80)
    ground(c, 72, 8)
    c.box(2, 28, 124, 44, "grey_l")
    c.rect(3, 29, 122, 6, main)
    c.rect(3, 35, 122, 1, main_d)
    # store fronts
    for i, col in enumerate(["orange", "pink", "blue_l", "gold", "green_l", "wine_l"]):
        x = 6 + i * 20
        if 48 <= x <= 72:
            continue
        c.rect(x, 56, 14, 16, "outline")
        c.rect(x + 1, 57, 12, 15, "glass")
        c.rect(x, 52, 14, 4, col)
        c.put(x + 2, 58, "glass_l")
        c.put(x + 3, 58, "glass_l")
    # glass atrium
    c.box(46, 10, 36, 62, "glass_d")
    for yy in range(11, 71, 6):
        c.hline(47, yy, 34, "glass")
    for xx in range(47, 81, 8):
        c.vline(xx, 11, 60, "glass_l")
    c.rect(56, 58, 16, 14, "outline")
    c.rect(57, 59, 14, 13, "glass_l")
    c.vline(64, 59, 13, "outline")
    # sign on the atrium
    c.sign(64, 16, label, "white", main_d)
    # palm trees
    for px in (8, 112):
        c.rect(px + 3, 52, 2, 20, "wood")
        for dx, dy in [(-3, 0), (-2, -1), (-1, -1), (0, -2), (1, -2), (2, -2), (3, -2), (4, -1), (5, -1), (6, -1), (7, 0), (8, 1),
                       (-4, 1), (1, -1), (2, -1), (3, -1), (5, 0), (6, 0)]:
            c.put(px + dx + 1, 52 + dy, "green")
        c.put(px + 3, 50, "green_d")
        c.put(px + 5, 50, "green_d")
    c.rect(56, 72, 16, 8, "path")
    return c.save(key)


def office():
    """Glass office tower with a lobby."""
    c = Canvas(72, 112)
    ground(c, 104, 8)
    c.box(10, 12, 52, 92, "glass_d")
    for row in range(16, 86, 6):
        for col in range(14, 58, 8):
            c.rect(col, row, 6, 4, "glass")
            c.put(col, row, "glass_l")
            c.put(col + 1, row, "glass_l")
    c.rect(11, 13, 3, 90, "grey_d")
    # crown
    c.box(18, 4, 36, 9, "grey")
    c.vline(36, 0, 5, "grey_d")
    c.put(36, 0, "roof_red")
    # lobby
    c.box(8, 88, 56, 16, "grey_l")
    c.box(26, 92, 20, 12, "glass")
    c.vline(36, 93, 11, "outline")
    c.rect(8, 86, 56, 2, "grey_d")
    c.sign(36, 77, "OFFICE", "white", "blue_d")
    c.rect(28, 104, 16, 8, "path")
    c.tree(0, 92)
    c.tree(63, 92)
    return c.save("office")


# Malls in rotation. Add or rename freely; the label is the sign text.
MALLS = [
    ("SM MARIKINA", "mall_sm_marikina", "blue", "blue_d"),
    ("SM AURA", "mall_sm_aura", "teal", "teal_d"),
    ("FELIZ", "mall_ayala_feliz", "green", "green_d"),
    ("UP TOWN", "mall_up_town_center", "wine", "wine"),
    ("FESTIVAL", "mall_festival", "orange", "roof_red_d"),
    ("ATC", "mall_alabang_town_center", "green_d", "green_d"),
]


def town_preview(sprites):
    """Lay every sprite out on a simple street so they can be judged together."""
    pad = 6
    w = sum(s.width for s in sprites) + pad * (len(sprites) + 1)
    h = max(s.height for s in sprites) + 24
    img = Image.new("RGBA", (w, h), P["sky"])
    px = img.load()
    for y in range(0, h // 3):
        for x in range(0, w, 7):
            if (x // 7 + y) % 9 == 0:
                px[x, y] = P["sky_l"]
    ground_y = h - 16
    for y in range(ground_y, h):
        for x in range(w):
            px[x, y] = P["green"] if y < ground_y + 4 else P["road"]
    for x in range(0, w, 12):
        for xx in range(x, min(x + 6, w)):
            px[xx, h - 6] = P["road_line"]
    x = pad
    for s in sprites:
        img.alpha_composite(s, (x, ground_y - s.height + 4))
        x += s.width + pad
    img.resize((w * 3, h * 3), Image.NEAREST).save(PREVIEW / "town@3x.png")


if __name__ == "__main__":
    made = [
        house(),
        church(),
        school("Miriam", "MIRIAM", "blue_l", "blue", "gold", "school_miriam"),
        school("Ateneo", "ATENEO", "blue", "blue_d", "white", "school_ateneo"),
        office(),
    ]
    malls = [mall(label, key, m, md) for label, key, m, md in MALLS]
    town_preview(made + malls[:2])
    # a second strip with every mall
    pad = 6
    w = sum(m.width for m in malls) + pad * (len(malls) + 1)
    strip = Image.new("RGBA", (w, 90), P["sky"])
    x = pad
    for m in malls:
        strip.alpha_composite(m, (x, 90 - m.height - 2))
        x += m.width + pad
    strip.resize((w * 2, 180), Image.NEAREST).save(PREVIEW / "malls@2x.png")
    print("wrote", len(made) + len(malls), "place sprites to", OUT)

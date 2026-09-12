# -*- coding: utf-8 -*-
"""Regenerate app icons for the course-table app.
Keeps the exact same filenames as required.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", "images"))

# Brand colors
BLUE_TOP = (32, 138, 239)     # #208AEF
BLUE_BOT = (18, 96, 184)      # deeper blue
WHITE = (255, 255, 255, 255)
MONO = (102, 102, 102, 255)   # #666666

# Design is authored on a 1024 grid, then scaled to each target size.
DESIGN = 1024


def blue_gradient(size):
    img = Image.new("RGB", (size, size), BLUE_TOP)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(BLUE_TOP[0] + (BLUE_BOT[0] - BLUE_TOP[0]) * t)
        g = int(BLUE_TOP[1] + (BLUE_BOT[1] - BLUE_TOP[1]) * t)
        b = int(BLUE_TOP[2] + (BLUE_BOT[2] - BLUE_TOP[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img.convert("RGBA")


def calendar_shape_mask(size):
    """'L' mode mask of the calendar glyph, centered in a size x size canvas."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    s = size / DESIGN
    cx = cy = size / 2

    # Calendar body
    bw, bh = 400 * s, 330 * s
    bx0, bx1 = cx - bw / 2, cx + bw / 2
    body_top = cy - 165 * s + 25 * s
    body_bot = cy + 165 * s + 25 * s
    d.rounded_rectangle([bx0, body_top, bx1, body_bot], radius=56 * s, fill=255)

    # Top binder rings
    rw, rh = 30 * s, 58 * s
    rxo = 96 * s
    ry0 = body_top - 30 * s
    ry1 = body_top + 18 * s
    d.rounded_rectangle([cx - rxo - rw / 2, ry0, cx - rxo + rw / 2, ry1], radius=12 * s, fill=255)
    d.rounded_rectangle([cx + rxo - rw / 2, ry0, cx + rxo + rw / 2, ry1], radius=12 * s, fill=255)

    # Cut out inner slits (transparent) so background shows through
    pad_x = 48 * s
    slit_h = 14 * s
    line_h = 26 * s
    x0i, x1i = bx0 + pad_x, bx1 - pad_x

    # Header separator slit
    hdr_y = body_top + 78 * s
    d.rectangle([x0i, hdr_y, x1i, hdr_y + slit_h], fill=0)

    # Three course lines
    for off in (120, 182, 244):
        sy = body_top + off * s
        d.rounded_rectangle([x0i, sy, x1i, sy + line_h], radius=line_h / 2, fill=0)

    return m


def glyph_layer(size, color):
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = calendar_shape_mask(size)
    layer.paste(Image.new("RGBA", (size, size), color), (0, 0), mask)
    return layer


def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p)
    print("saved", name, img.size)


def main():
    # 1) icon.png 1024x1024
    bg = blue_gradient(DESIGN)
    bg.alpha_composite(glyph_layer(DESIGN, WHITE))
    save(bg, "icon.png")

    # 2) android-icon-background.png 512x512
    save(blue_gradient(512), "android-icon-background.png")

    # 3) android-icon-foreground.png 512x512 (transparent, white glyph in safe zone)
    save(glyph_layer(512, WHITE), "android-icon-foreground.png")

    # 4) android-icon-monochrome.png 432x432
    save(glyph_layer(432, MONO), "android-icon-monochrome.png")

    # 5) favicon.png 48x48
    fav = blue_gradient(48)
    fav.alpha_composite(glyph_layer(48, WHITE))
    save(fav, "favicon.png")

    # 6) splash-icon.png 228x213 (transparent, white glyph)
    sp = glyph_layer(228, WHITE).crop((0, 0, 228, 213))
    save(sp, "splash-icon.png")


if __name__ == "__main__":
    main()

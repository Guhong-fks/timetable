# -*- coding: utf-8 -*-
"""Build anime-style app icons from _main.png (full scene) and _char.png (character on white)."""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPTS = os.path.join(ROOT, "scripts")
OUT = os.path.join(ROOT, "assets", "images")

MAIN = os.path.join(SCRIPTS, "_main.png")
CHAR = os.path.join(SCRIPTS, "_char.png")


def cutout_white_bg(path):
    """Flood-fill white background from the corners, return RGBA with transparency."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    # Mark connected near-white regions starting from all four corners
    MARK = (0, 255, 0)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(im, seed, MARK, thresh=35)
    # Build alpha: green mark -> transparent, else opaque
    px = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if g > 180 and r < 120 and b < 120:
                op[x, y] = (0, 0, 0, 0)
            else:
                # take original RGB from char image
                op[x, y] = (r, g, b, 255)
    # slight alpha-edge cleanup
    alpha = out.split()[3].filter(ImageFilter.GaussianBlur(0.6))
    out.putalpha(alpha)
    return out


def bbox_transparent(im):
    """Bounding box of non-transparent pixels."""
    alpha = im.split()[3]
    return alpha.getbbox()


def blue_pink_gradient(size):
    """Soft blue->pink gradient echoing the main icon sky."""
    top = (135, 206, 250)     # sky blue
    bot = (255, 200, 220)     # light pink
    im = Image.new("RGB", (size, size), top)
    px = im.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return im.convert("RGBA")


def place_char(char_rgba, canvas_size, target_h):
    """Resize char to target_h and center on transparent canvas_size x canvas_size."""
    cw, ch = char_rgba.size
    scale = target_h / ch
    nw, nh = int(cw * scale), int(ch * scale)
    resized = char_rgba.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.paste(resized, ((canvas_size - nw) // 2, (canvas_size - nh) // 2), resized)
    return canvas


def save(im, name):
    p = os.path.join(OUT, name)
    im.save(p)
    print("saved", name, im.size)


def main():
    # 1) icon.png = full scene, already 1024
    main_im = Image.open(MAIN).convert("RGBA")
    if main_im.size != (1024, 1024):
        main_im = main_im.resize((1024, 1024), Image.LANCZOS)
    save(main_im, "icon.png")

    # character cutout
    char = cutout_white_bg(CHAR)
    bbox = bbox_transparent(char)
    char = char.crop(bbox)
    print("char cropped to", char.size)

    # 2) android background: soft gradient
    save(blue_pink_gradient(512), "android-icon-background.png")

    # 3) android foreground: char centered in safe zone (~66% of 512)
    fg = place_char(char, 512, target_h=330)
    save(fg, "android-icon-foreground.png")

    # 4) monochrome: char as flat grey silhouette, 432
    grey = Image.new("RGBA", char.size, (102, 102, 102, 255))
    grey.putalpha(char.split()[3])
    mono = place_char(grey, 432, target_h=290)
    save(mono, "android-icon-monochrome.png")

    # 5) favicon: downscaled full scene
    fav = main_im.resize((48, 48), Image.LANCZOS)
    save(fav, "favicon.png")

    # 6) splash: white silhouette of char on transparent (sits on #208AEF)
    white = Image.new("RGBA", char.size, (255, 255, 255, 255))
    white.putalpha(char.split()[3])
    sp = place_char(white, 228, target_h=200)
    sp = sp.crop((0, 0, 228, 213))
    save(sp, "splash-icon.png")


if __name__ == "__main__":
    main()

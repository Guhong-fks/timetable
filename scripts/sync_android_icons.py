# -*- coding: utf-8 -*-
"""Sync newly generated icons from assets/images into android mipmap dirs (webp)."""
import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS = os.path.join(ROOT, "assets", "images")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

# density -> (legacy launcher size, adaptive layer size)
DENSITIES = {
    "mdpi":     (48, 108),
    "hdpi":     (72, 162),
    "xhdpi":    (96, 216),
    "xxhdpi":   (144, 324),
    "xxxhdpi":  (192, 432),
}


def load(name):
    return Image.open(os.path.join(ASSETS, name)).convert("RGBA")


def save_webp(img, path, size):
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path, "WEBP", quality=90, lossless=False)


def main():
    icon = load("icon.png")
    bg = load("android-icon-background.png")
    fg = load("android-icon-foreground.png")
    mono = load("android-icon-monochrome.png")

    for dens, (legacy, layer) in DENSITIES.items():
        d = os.path.join(RES, f"mipmap-{dens}")
        save_webp(icon, os.path.join(d, "ic_launcher.webp"), legacy)
        save_webp(icon, os.path.join(d, "ic_launcher_round.webp"), legacy)
        save_webp(bg, os.path.join(d, "ic_launcher_background.webp"), layer)
        save_webp(fg, os.path.join(d, "ic_launcher_foreground.webp"), layer)
        save_webp(mono, os.path.join(d, "ic_launcher_monochrome.webp"), layer)
        print("synced", dens)


if __name__ == "__main__":
    main()

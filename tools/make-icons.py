#!/usr/bin/env python3
"""Generate AdCuck's toolbar icons.

One shield glyph, two states: a tick when blocking, pause bars when paused.
Drawn at 8x and downsampled so the strokes stay clean at 16px.
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
SIZES = [16, 32, 48, 128]
SS = 8  # supersample factor

ACCENT = (14, 110, 100, 255)   # #0E6E64
PAUSED = (138, 147, 155, 255)  # #8A939B
WHITE = (255, 255, 255, 255)


def shield_path(s):
    """Shield outline on a 24x24 grid, scaled to s."""
    k = s / 24.0
    pts = [
        (12, 2.2), (4.2, 5.5), (4.2, 11.9),
        (4.2, 16.7), (7.6, 20.8), (12, 22.2),
        (16.4, 20.8), (19.8, 16.7), (19.8, 11.9),
        (19.8, 5.5),
    ]
    return [(x * k, y * k) for x, y in pts]


def draw_icon(size, color, paused):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = big / 24.0

    d.polygon(shield_path(big), fill=color)

    if not paused:
        # tick
        w = max(1, int(1.9 * k))
        d.line(
            [(8.7 * k, 12.0 * k), (11.0 * k, 14.3 * k), (15.4 * k, 9.6 * k)],
            fill=WHITE, width=w, joint="curve",
        )
        r = w / 2.0
        for cx, cy in [(8.7, 12.0), (11.0, 14.3), (15.4, 9.6)]:
            d.ellipse(
                [cx * k - r, cy * k - r, cx * k + r, cy * k + r], fill=WHITE
            )
    else:
        # pause bars
        bw = 1.9 * k
        for cx in (9.9, 14.1):
            d.rounded_rectangle(
                [cx * k - bw / 2, 9.3 * k, cx * k + bw / 2, 14.7 * k],
                radius=bw / 2, fill=WHITE,
            )

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in SIZES:
        draw_icon(size, ACCENT, False).save(
            os.path.join(OUT, "icon-%d.png" % size)
        )
        draw_icon(size, PAUSED, True).save(
            os.path.join(OUT, "icon-paused-%d.png" % size)
        )
    print("wrote %d icons to %s" % (len(SIZES) * 2, os.path.normpath(OUT)))


if __name__ == "__main__":
    main()

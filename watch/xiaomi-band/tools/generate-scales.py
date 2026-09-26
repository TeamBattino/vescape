"""Generate capsule scale assets; run with Python + Pillow. No runtime canvas required."""
from pathlib import Path
from math import pi, sin, cos
from PIL import Image, ImageDraw
OUT = Path(__file__).resolve().parents[1] / 'src/common/scales'
OUT.mkdir(parents=True, exist_ok=True)
S = 4
R = 98
HALF_ARC = pi * R / 2
LENGTH = HALF_ARC * 2 + 308
# Parametric left half: bottom -> top; right half mirrors it.
def point(fraction):
    d = fraction * LENGTH
    if d < HALF_ARC:
        angle = pi / 2 + d / R
        return 106 + R * cos(angle), 414 + R * sin(angle)
    if d < HALF_ARC + 308:
        return 8, 414 - (d - HALF_ARC)
    angle = pi + (d - HALF_ARC - 308) / R
    return 106 + R * cos(angle), 106 + R * sin(angle)
for side, color, track in [('speed', '#36aaff', '#102738'), ('duty', '#ffd23f', '#352d10')]:
    for step in range(51):
        image = Image.new('RGBA', (212*S, 520*S)); draw = ImageDraw.Draw(image)
        def stroke(progress, fill):
            points = []
            for i in range(max(2, round(600 * progress))):
                f = .025 + .95 * progress * i / (max(2, round(600 * progress)) - 1)
                x,y = point(f)
                if side == 'duty': x = 212 - x
                points.append((round(x*S), round(y*S)))
            draw.line(points, fill=fill, width=12*S, joint='curve')
            radius=6*S
            for x,y in (points[0], points[-1]):
                draw.ellipse((x-radius,y-radius,x+radius,y+radius),fill=fill)
        stroke(1, track)
        if step: stroke(step / 50, color)
        image.resize((212,520),Image.Resampling.LANCZOS).save(OUT / f'{side}-{step}.png')

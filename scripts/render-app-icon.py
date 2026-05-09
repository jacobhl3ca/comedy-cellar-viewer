#!/usr/bin/env python3
# Renders Tonight NYC app icon assets from a single design spec.
# Black background, white "TN" in Helvetica Bold, optically centered.
#
# Outputs:
#   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png  (1024×1024)
#   public/icon-512.png   (512×512)
#   public/icon-192.png   (192×192)
#   public/favicon.svg    (32×32 SVG)
#
# Centering math: at font-size F (Helvetica Bold), cap-height ≈ 0.72·F.
# Baseline y = image_center + nudge + 0.36·F places the cap-height geo-center
# at image_center + nudge. Nudge = +7.5/1024 of size pushes letters slightly
# below geometric center to optically read as "centered" for uppercase.

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

FONT_PATH = '/System/Library/Fonts/Helvetica.ttc'
FONT_INDEX = 1  # Bold
BG = (0, 0, 0)
FG = (255, 255, 255)
ROOT = Path(__file__).resolve().parent.parent

def render(size: int, font_ratio: float = 620/1024, nudge_ratio: float = 7.5/1024) -> Image.Image:
    F = round(size * font_ratio)
    nudge = size * nudge_ratio
    baseline_y = round(size / 2 + nudge + 0.36 * F)
    img = Image.new('RGB', (size, size), BG)
    font = ImageFont.truetype(FONT_PATH, F, index=FONT_INDEX)
    ImageDraw.Draw(img).text((size // 2, baseline_y), 'TN', fill=FG, font=font, anchor='ms')
    return img

def main():
    targets = [
        (1024, ROOT / 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
        (512,  ROOT / 'public/icon-512.png'),
        (192,  ROOT / 'public/icon-192.png'),
    ]
    for size, out in targets:
        out.parent.mkdir(parents=True, exist_ok=True)
        render(size).save(out)
        print(f'  {size:>4}px → {out.relative_to(ROOT)}')

    favicon = ROOT / 'public/favicon.svg'
    favicon.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n'
        '  <rect width="32" height="32" fill="#000000"/>\n'
        '  <text x="16" y="23" text-anchor="middle" '
        'font-family="Helvetica,-apple-system,BlinkMacSystemFont,sans-serif" '
        'font-size="19" font-weight="700" fill="#ffffff">TN</text>\n'
        '</svg>\n'
    )
    print(f'   svg → {favicon.relative_to(ROOT)}')

if __name__ == '__main__':
    main()

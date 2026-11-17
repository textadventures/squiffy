#!/usr/bin/env bash
# Makes the desktop app's icons from the editor's logo (app/static/squiffy.png), for the stable app
# (this folder) and the beta (beta/: purple, with a "BETA" band). Needs ImageMagick 7 (`magick`)
# and macOS's iconutil. The results are committed, so this only needs running when the logo changes.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SOURCE=../../app/static/squiffy.png
FONT="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The logo's white lettering, on its own (transparent elsewhere), filling a 1024px square
magick "$SOURCE" -crop 988x988+18+18 +repage -resize 1024x1024 \
    -alpha off -fuzz 30% -fill black -opaque "rgb(29,27,97)" \
    -colorspace gray -alpha copy -fill white -colorize 100 "$TMP/letters.png"

# Rounded-square mask, the same as Quest Viva's icon (a smaller corner radius gets a grey frame on macOS too)
magick -size 1024x1024 xc:none -fill white -draw "roundrectangle 0,0 1023,1023 224,224" "$TMP/mask.png"

# Stable: the logo's navy, lettering as it is
magick -size 1024x1024 xc:"rgb(29,27,97)" "$TMP/letters.png" -composite -alpha set \
    "$TMP/mask.png" -compose DstIn -composite "$TMP/stable.png"

# Beta: purple, the lettering smaller and raised, and a yellow BETA band along the bottom
magick -size 1024x1024 xc:"rgb(102,51,170)" \
    \( "$TMP/letters.png" -resize 85% \) -gravity north -geometry +0+40 -composite \
    -gravity south -fill "rgb(255,200,70)" -draw "rectangle 0,800 1024,1024" \
    -font "$FONT" -pointsize 150 -fill "rgb(24,24,32)" -annotate +0+28 "BETA" \
    "$TMP/mask.png" -compose DstIn -composite "$TMP/beta.png"

# Every PNG is written as 8-bit RGBA (PNG32:). ImageMagick keeps the source's 16 bits otherwise,
# and macOS draws an icon with 16-bit images in a grey frame, as it does an old-style icon.
make_set() {
    local src="$1" out="$2"
    mkdir -p "$out/icons"
    for size in 16 24 32 48 64 96 128 256 512 1024; do
        magick "$src" -resize "${size}x${size}" -depth 8 "PNG32:$out/icons/${size}x${size}.png"
    done
    # macOS
    local iconset="$TMP/icon.iconset"
    rm -rf "$iconset" && mkdir "$iconset"
    for size in 16 32 128 256 512; do
        magick "$src" -resize "${size}x${size}" -depth 8 "PNG32:$iconset/icon_${size}x${size}.png"
        magick "$src" -resize "$((size * 2))x$((size * 2))" -depth 8 "PNG32:$iconset/icon_${size}x${size}@2x.png"
    done
    iconutil -c icns "$iconset" -o "$out/icon.icns"
    # Windows
    magick "$src" -depth 8 -define icon:auto-resize=256,128,64,48,32,24,16 "$out/icon.ico"
}

make_set "$TMP/stable.png" .
make_set "$TMP/beta.png" beta
echo "Done"

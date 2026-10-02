#!/usr/bin/env python3
"""Process approved local raster art. Requires Pillow only for this offline step.

Python 3.9+. No network, image generation, reference artwork, or source writes.
Anchors are bitmap-pixel coordinates, not fractions or logical coordinates.
"""
import argparse
import colorsys
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE_HASHES = {
    'obstacles-sheet.png': '894b062c2e497936d6c5b396ea06a3959fc4cca3c936a71d25ca16f7d71df960',
    'skater-sheet.png': '571009c0a2346ce652e97802bb935a48cd7755ef21f016d4424edd729f3ca261',
    'street-sheet.png': '2b820cd0bf93051af80fcc1d2d07397a6ee01b1f5b6377dd1f06c31628fc8fd2',
    'city.png': '8ceb47addb40e82834a904649aa3ba17f077054e6ff84006017c739f3c90b3f6',
}
SKATERS = ['skater_roll', 'skater_push1', 'skater_push2', 'skater_crouch',
           'skater_ollie', 'skater_flip', 'skater_catch', 'skater_manual',
           'skater_grind', 'skater_lean_forward', 'skater_lean_back', 'skater_crash']
BOARDS = ['board_flat', 'board_flip', 'board_edge', 'board_manual']
PROPS = ['asphalt', 'concrete', 'curb', 'cone', 'bench', 'rail', 'ledge',
         'stairs', 'crack', 'streetlamp', 'bin', 'billboard', 'low_bar',
         'ramp', 'checkpoint', 'finish']
PROP_WIDTHS = dict(zip(PROPS, [64, 64, 120, 28, 132, 148, 140, 128, 66,
                              55, 42, 118, 148, 132, 46, 110]))
OBSTACLE_REGIONS = {
    'jersey_barrier': (0, 0, 860, 630),
    'gap_left': (860, 0, 1254, 630),
    'gap_center': (0, 630, 860, 1254),
    'gap_right': (860, 630, 1254, 1254),
}
ALPHA_CUTOFF = 200
CANVAS = (400, 300)
BASELINE = 292
NEAREST = Image.Resampling.NEAREST if hasattr(Image, 'Resampling') else Image.NEAREST


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def grid_box(size, index):
    """Round actual sheet boundaries: 0, 314, 627, 940, 1254."""
    w, h = size
    col, row = index % 4, index // 4
    return tuple(round(v) for v in (col*w/4, row*h/4, (col+1)*w/4, (row+1)*h/4))


def clean_cell(sheet, index):
    box = grid_box(sheet.size, index)
    cell = sheet.crop(box)
    alpha = cell.getchannel('A').point(lambda a: 255 if a >= ALPHA_CUTOFF else 0)
    bounds = alpha.getbbox()
    if not bounds or bounds[0] <= 0 or bounds[1] <= 0 or bounds[2] >= cell.width or bounds[3] >= cell.height:
        raise ValueError('Empty or clipped cell: %s' % index)
    # Clear invisible RGB too, so future compositing cannot expose dirty halos.
    clean = Image.new('RGBA', cell.size)
    clean.paste(cell, (0, 0), alpha)
    clean.putalpha(alpha)
    return clean.crop(bounds), {'cellIndex': index, 'cellBox': list(box),
                                'cleanBoundsInCell': list(bounds)}


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')


def dave_palette(image):
    """Recolor saturated orange helmet and purple cloth, not skin or gray gear.

    Keep every pixel's alpha and location. HSV value retains the source shading.
    The helmet's high saturation separates it from the warmer, paler face/hands.
    """
    result = image.copy()
    pixels = []
    for r, g, b, a in image.getdata():
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        if a and .04 <= h <= .13 and s >= .82 and v >= .25:
            r, g, b = (round(c*255) for c in colorsys.hsv_to_rgb(.475, s*.8, v*.86))
        elif a and .70 <= h <= .85 and s >= .32 and v >= .17:
            r, g, b = (round(c*255) for c in colorsys.hsv_to_rgb(.025, s*.85, min(1, v*1.22)))
        pixels.append((r, g, b, a))
    result.putdata(pixels)
    return result


def prepare_skaters(sheets, emit, characters):
    for index, name in enumerate(SKATERS + BOARDS):
        image, info = clean_cell(sheets['skater-sheet.png'], index)
        info['source'] = 'assets/source/skater-sheet.png'
        if name in SKATERS:
            # Do NOT normalize individual pose heights. Same scale preserves the
            # lowered head in crouch and the limb proportions in every frame.
            air_lift = 30 if name in ('skater_ollie', 'skater_flip', 'skater_catch') else 0
            # Center the lowest shoe(s), not the arms, on the board deck.
            band = image.getchannel('A').crop((0, image.height-8, image.width, image.height)).getbbox()
            foot_x = (band[0] + band[2]) // 2
            if name == 'skater_crash':
                foot_x = image.width // 2
            paste_at = (200-foot_x, BASELINE-air_lift-image.height)
            assert paste_at[0] >= 2 and paste_at[0]+image.width <= CANVAS[0]-2
            assert paste_at[1] >= 2
            canvas = Image.new('RGBA', CANVAS)
            canvas.paste(image, paste_at)
            info.update(pasteAt=list(paste_at), sourceFootX=foot_x, airLiftPixels=air_lift,
                        baseline=BASELINE, uniformSourceScale=1)
            emit(name, canvas, (200, BASELINE), CANVAS[0]*80/CANVAS[1], 80, info,
                 boardSeparate=True, footLift=air_lift*80/CANVAS[1])
            variant = characters['dave']['poses'][name.removeprefix('skater_')]
            derived = dict(info, derivedFrom=name, palette='teal helmet / coral hoodie',
                           derivation='local HSV clothing palette v1; no new generation')
            emit(variant, dave_palette(canvas), (200, BASELINE), CANVAS[0]*80/CANVAS[1], 80,
                 derived, boardSeparate=True, footLift=air_lift*80/CANVAS[1])
        else:
            if name == 'board_edge':
                image = image.transpose(Image.Transpose.ROTATE_270 if hasattr(Image, 'Transpose') else Image.ROTATE_270)
                info['rotationClockwiseDegrees'] = 90
            canvas = Image.new('RGBA', (image.width+4, image.height+4))
            canvas.paste(image, (2, 2))
            # Deck center on flat/edge. Flip uses silhouette center; manual's
            # raised nose should be paired with the corresponding lifted foot.
            deck_y = (image.height/2+2 if name == 'board_flip' else
                      next(y for y in range(canvas.height)
                           if canvas.getpixel((canvas.width//2, y))[3]))
            emit(name, canvas, (canvas.width/2, deck_y), 64,
                 canvas.height*64/canvas.width, info,
                 groundAnchor=[canvas.width/2, canvas.height-2],
                 **({"truckAnchor": [canvas.width/2, 32]} if name == "board_flat" else {}))


def prepare_props(sheets, emit):
    for index, name in enumerate(PROPS):
        image, info = clean_cell(sheets['street-sheet.png'], index)
        info['source'] = 'assets/source/street-sheet.png'
        if name in ('asphalt', 'concrete'):
            # Interior body only: exclude the beveled border and all padding.
            body_box = (74, 76, 250, 252) if name == 'asphalt' else (380, 76, 556, 252)
            image = sheets['street-sheet.png'].crop(body_box)
            assert min(image.getchannel('A').getdata()) >= ALPHA_CUTOFF
            image.putalpha(255)
            info['tileBodyBoxInSource'] = list(body_box)
            emit(name, image, (0, 0), 64, 64, info, tile=True)
            continue
        canvas = Image.new('RGBA', (image.width+4, image.height+4))
        canvas.paste(image, (2, 2))
        extra = {}
        if name == 'rail':
            extra = dict(beamTop=2, beamBottom=21, contactTop=2)
        elif name == 'low_bar':
            extra = dict(beamTop=2, beamBottom=22, clearanceY=22)
        elif name in ('curb', 'ledge', 'bench'):
            extra = dict(contactTop={'curb': 2, 'ledge': 2, 'bench': 62}[name])
        emit(name, canvas, (canvas.width/2, canvas.height-2), PROP_WIDTHS[name],
             canvas.height*PROP_WIDTHS[name]/canvas.width, info, **extra)


def repair_repeat_seam(image):
    """Blend only eight edge columns; opposing columns become byte-identical."""
    pixels = image.load()
    for y in range(image.height):
        left, right = pixels[0, y], pixels[image.width-1, y]
        seam = tuple(round((left[c]+right[c])/2) for c in range(3)) + (255,)
        for i in range(8):
            weight = (8-i)/8
            for x in (i, image.width-1-i):
                old = pixels[x, y]
                pixels[x, y] = tuple(round(old[c]*(1-weight)+seam[c]*weight)
                                    for c in range(3)) + (255,)


def prepare_obstacles(sheet, emit):
    """Crop the approved uneven layout; never split the long barrier at 627.

    Gap parts share a 256-pixel depth. The center omits its intact asphalt
    course and sits recessed below the end lips, not at a walkable elevation.
    Only an eight-column blend at each center edge repairs the repeat seam.
    """
    for name, region in OBSTACLE_REGIONS.items():
        cell = sheet.crop(region)
        alpha = cell.getchannel('A').point(lambda a: 255 if a >= ALPHA_CUTOFF else 0)
        bounds = alpha.getbbox()
        if not bounds or not (0 < bounds[0] < bounds[2] < cell.width and
                              0 < bounds[1] < bounds[3] < cell.height):
            raise ValueError('Clipped obstacle region: ' + name)
        clean = Image.new('RGBA', cell.size)
        clean.paste(cell, (0, 0), alpha)
        clean.putalpha(alpha)
        image = clean.crop(bounds)
        info = dict(source='assets/source/obstacles-sheet.png', regionBox=list(region),
                    cleanBoundsInCell=list(bounds), strategy='region-alpha-bounds')
        if name == 'jersey_barrier':
            canvas = Image.new('RGBA', (image.width+4, image.height+4))
            canvas.paste(image, (2, 2))
            contact = 2 + next(y for y in range(image.height)
                               if image.getpixel((image.width//2, y))[3])
            emit(name, canvas, (canvas.width/2, canvas.height-2), 160,
                 canvas.height*160/canvas.width, info, contactTop=contact)
            continue
        width = round(image.width*256/image.height)
        canvas = Image.new('RGBA', (width+4, 260))
        if name == 'gap_center':
            # The generated center has intact asphalt at its top. Remove that
            # band so only the sunken cutaway, earth, rubble and pipe remain.
            info.update(trimTop=65, recessPixels=48, seamBlendColumns=8,
                        voidBandInCleanCrop=[0, 170, image.width, 218])
            body = image.crop((0, 65, image.width, image.height)).resize((width, 208), NEAREST)
            # Fill the opening with actual dark earth pixels from this same
            # approved crop. Transparent street pixels must not bridge the void.
            void = image.crop((0, 170, image.width, 218)).resize((width, 48), NEAREST)
            image = Image.new('RGBA', (width, 256))
            image.paste(void, (0, 0)); image.paste(body, (0, 48))
            repair_repeat_seam(image)
            canvas.paste(image, (2, 2))
            extra = dict(tileBox=[2, 2, width+2, 258], repeatX=True)
        else:
            image = image.resize((width, 256), NEAREST)
            canvas.paste(image, (2, 2))
            # Bitmap coordinates of the broken asphalt lip, not the rubble's
            # furthest protrusion. These anchors sit on the collision edges.
            lip = round(width*(168/251 if name == 'gap_left' else 110/256)) + 2
            extra = dict(collisionEdgeX=lip, groundLipY=2)
        info['normalizedDepth'] = 256
        emit(name, canvas, (0, 2), canvas.width*58/256, canvas.height*58/256,
             info, **extra)


def preview_assets(assets, previews):
    # QA only. This is not a runtime image or manifest entry.
    preview = Image.new('RGB', (960, ((len(previews)+4)//5)*132), '#666e7d')
    draw = ImageDraw.Draw(preview)
    for i, (name, image, meta) in enumerate(previews):
        x, y = (i % 5)*192, (i // 5)*132
        thumb = image.resize((max(1, round(meta['drawWidth'])), max(1, round(meta['drawHeight']))), NEAREST)
        if thumb.width > 184 or thumb.height > 102:
            scale = min(184/thumb.width, 102/thumb.height)
            thumb = thumb.resize((round(thumb.width*scale), round(thumb.height*scale)), NEAREST)
        preview.paste(thumb, (x+(192-thumb.width)//2, y+22), thumb)
        draw.text((x+5, y+5), name, fill='white')
    qa = assets / 'qa'
    qa.mkdir(exist_ok=True)
    preview.save(qa / 'contact-sheet.png')


def save_canonical_asset(image, canonical, output):
    """Keep approved PNG bytes only after verifying the freshly computed RGBA.

    PNG encoders can produce different bytes for identical pixels. Never let
    that replace approved files, or let a stale file hide a processing change.
    """
    if not canonical.exists():
        image.save(output, optimize=False)
        return
    with Image.open(canonical) as approved:
        if image.mode != 'RGBA' or approved.mode != 'RGBA' or image.size != approved.size:
            raise ValueError('Canonical asset mismatch: %s (generated %s %s; approved %s %s)' %
                             (canonical.name, image.mode, image.size, approved.mode, approved.size))
        if image.tobytes() != approved.tobytes():
            raise ValueError('Canonical asset mismatch: %s (RGBA pixels differ)' % canonical.name)
    if canonical.resolve() != output.resolve():
        output.write_bytes(canonical.read_bytes())


def prepare(source_root=ROOT, output_root=ROOT):
    source_root, output_root = Path(source_root), Path(output_root)
    assets = output_root / 'assets'
    processed = assets / 'processed'
    processed.mkdir(parents=True, exist_ok=True)
    for name, expected in SOURCE_HASHES.items():
        if sha256(source_root / 'assets/source' / name) != expected:
            raise ValueError('Source fingerprint changed: ' + name)
    sheets = {name: Image.open(source_root / 'assets/source' / name).convert('RGBA')
              for name in ('skater-sheet.png', 'street-sheet.png', 'obstacles-sheet.png')}
    entries, crops = {}, {}
    previews = []

    def emit(name, image, anchor, draw_width, draw_height, info, **extra):
        path = processed / (name + '.png')
        save_canonical_asset(image, source_root / 'assets/processed' / path.name, path)
        entries[name] = dict(path='assets/processed/' + name + '.png',
                             width=image.width, height=image.height,
                             anchor=list(anchor), drawWidth=draw_width,
                             drawHeight=draw_height, **extra)
        info['outputAlphaBounds'] = list(image.getchannel('A').getbbox())
        info['sha256'] = sha256(path)
        crops[name] = info
        previews.append((name, image, entries[name]))

    characters = json.loads((source_root / 'assets/characters.json').read_text())
    prepare_skaters(sheets, emit, characters)
    prepare_props(sheets, emit)
    prepare_obstacles(sheets['obstacles-sheet.png'], emit)

    city = Image.open(source_root / 'assets/source/city.png').convert('RGBA').resize((960, 540), NEAREST)
    emit('city', city, (0, 0), 960, 540, {'source': 'assets/source/city.png', 'resize': 'nearest'})
    manifest_path = assets / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest['images'] = entries
    manifest['characters'] = characters
    manifest.setdefault('audio', {})
    manifest.setdefault('provenance', {}).update({
        'art': {'origin': 'Existing user-approved original generated side-on PNGs; no new generation.',
                'sourceSha256': {'assets/source/'+k: v for k, v in SOURCE_HASHES.items()},
                'processing': 'scripts/prepare_assets.py', 'cropMap': 'assets/crop-map.json',
                'alphaCutoff': ALPHA_CUTOFF, 'anchorUnits': 'bitmap pixels',
                'variants': {'dave': 'Local deterministic HSV palette of Jeff; teal helmet, coral hoodie; no generation.'},
                'processorSha256': sha256(Path(__file__)),
                'obstacles': {'source': 'assets/source/obstacles-sheet.png',
                              'generatedOriginal': 'assets/generated/01a0f082-e22d-77fa-b22c-4924da128f02/ig_0a9c42252473d64c016abf1670818487d0a113c6fe32d47de2.png',
                              'layout': 'Four unequal non-overlapping regions; alpha >= 200 bounds; not a 2x2 grid.',
                              'styleReference': 'Original street-sheet; no reference pixels copied.',
                              'gapProcessing': 'Nearest common depth; dark-earth crop fills void above recessed cutaway, no asphalt cap; eight-column repeat seam repair.'},
                'referenceAssetsIncluded': False, 'view': 'side-on belt scroller'},
    })
    save_json(manifest_path, manifest)
    save_json(assets / 'crop-map.json', crops)

    preview_assets(assets, previews)
    print('Prepared %d PNGs; manifest: %s' % (len(entries), manifest_path))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--output-root', type=Path, default=ROOT)
    args = parser.parse_args()
    prepare(args.source_root, args.output_root)

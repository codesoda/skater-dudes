"""Offline artifact contracts. Run: python3 -m unittest discover -s tests -p test_assets_audio.py -v"""
from array import array
from collections import Counter
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
import wave

from PIL import Image

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
IMAGE_KEYS = set('skater_roll skater_push1 skater_push2 skater_crouch skater_ollie skater_flip '
                 'skater_catch skater_manual skater_grind skater_lean_forward skater_lean_back '
                 'skater_crash board_flat board_flip board_edge board_manual asphalt concrete '
                 'curb cone bench rail ledge stairs crack streetlamp bin billboard low_bar ramp '
                 'checkpoint finish city'.split())
ORIGINAL_IMAGE_KEYS = IMAGE_KEYS.copy()
DAVE_KEYS = {key.replace('skater_', 'dave_') for key in IMAGE_KEYS if key.startswith('skater_')}
OBSTACLE_KEYS = set('jersey_barrier gap_left gap_center gap_right'.split())
IMAGE_KEYS |= DAVE_KEYS | OBSTACLE_KEYS
AUDIO_KEYS = set('music rolling grind crack ollie land crash push bank'.split())
SOURCE_HASHES = {
    'obstacles-sheet.png': '894b062c2e497936d6c5b396ea06a3959fc4cca3c936a71d25ca16f7d71df960',
    'skater-sheet.png': '571009c0a2346ce652e97802bb935a48cd7755ef21f016d4424edd729f3ca261',
    'street-sheet.png': '2b820cd0bf93051af80fcc1d2d07397a6ee01b1f5b6377dd1f06c31628fc8fd2',
    'city.png': '8ceb47addb40e82834a904649aa3ba17f077054e6ff84006017c739f3c90b3f6',
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rms(values):
    return math.sqrt(sum(x*x for x in values)/len(values))


class AssetsAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT/'assets/manifest.json').read_text())
        cls.crops = json.loads((ROOT/'assets/crop-map.json').read_text())
        cls.score = json.loads((ROOT/'assets/audio/score.json').read_text())
        cls.images = {}
        for name, entry in cls.manifest['images'].items():
            with Image.open(ROOT/entry['path']) as image:
                cls.images[name] = image.copy()
        cls.audio = {}
        for name, entry in cls.manifest['audio'].items():
            with wave.open(str(ROOT/entry['path']), 'rb') as reader:
                samples = array('h', reader.readframes(reader.getnframes()))
                if sys.byteorder != 'little':
                    samples.byteswap()
                cls.audio[name] = (reader.getparams(), [s/32768 for s in samples])
        cls.prep = load_script('prepare_assets')
        cls.composer = load_script('compose_audio')

    def test_exact_manifest_keys(self):
        self.assertEqual(set(self.manifest), {'images', 'audio', 'provenance', 'characters'})
        self.assertEqual(set(self.manifest['images']), IMAGE_KEYS)
        self.assertEqual(set(self.manifest['audio']), AUDIO_KEYS)
        self.assertEqual(set(self.crops), IMAGE_KEYS)

    def test_original_media_and_gameplay_hashes_are_preserved(self):
        pinned = json.loads((ROOT/'tests/original-hashes.json').read_text())
        self.assertEqual(sum(p.startswith('assets/processed/') for p in pinned), 33)
        self.assertEqual(sum(p.endswith('.wav') for p in pinned), 9)
        for path, expected in pinned.items():
            self.assertEqual(sha(ROOT/path), expected, path)

    def test_preserved_45_images_sources_characters_and_eight_wavs(self):
        pinned = json.loads((ROOT/'tests/preserved-media-hashes.json').read_text())
        self.assertEqual(sum(p.startswith('assets/processed/') for p in pinned), 45)
        self.assertEqual(sum(p.endswith('.wav') for p in pinned), 8)
        for path, expected in pinned.items():
            self.assertEqual(sha(ROOT/path), expected, path)

    def test_obstacle_regions_are_unequal_and_repeat_has_matching_edge_columns(self):
        regions = {'jersey_barrier': [0, 0, 860, 630], 'gap_left': [860, 0, 1254, 630],
                   'gap_center': [0, 630, 860, 1254], 'gap_right': [860, 630, 1254, 1254]}
        for key, region in regions.items():
            self.assertEqual(self.crops[key]['regionBox'], region)
            self.assertEqual(self.crops[key]['strategy'], 'region-alpha-bounds')
        self.assertEqual(self.crops['jersey_barrier']['cleanBoundsInCell'], [66, 233, 820, 514])
        for key in ('gap_left', 'gap_center', 'gap_right'):
            self.assertEqual(self.images[key].height, 260)
            self.assertEqual(self.crops[key]['normalizedDepth'], 256)
        center = self.images['gap_center']
        self.assertEqual(center.crop((2, 2, 3, 258)).tobytes(),
                         center.crop((center.width-3, 2, center.width-2, 258)).tobytes())
        self.assertEqual(center.getpixel((center.width//2, 20))[3], 255)  # Earth, never street bleed-through.
        top = center.crop((2, 2, center.width-2, 50))
        self.assertGreater(len(set(top.getdata())), 100)  # Real textured opening, not flat black.
        self.assertEqual(top.getchannel('A').getextrema(), (255, 255))
        self.assertEqual(self.crops['gap_center']['trimTop'], 65)
        barrier = self.images['jersey_barrier']
        meta = self.manifest['images']['jersey_barrier']
        self.assertEqual(meta['contactTop'], next(y for y in range(barrier.height)
                         if barrier.getpixel((barrier.width//2, y))[3]))

    def test_character_definitions_cover_exactly_both_complete_pose_sets(self):
        characters = json.loads((ROOT/'assets/characters.json').read_text())
        self.assertEqual(self.manifest['characters'], characters)
        self.assertEqual(set(characters), {'jeff', 'dave'})
        for identifier, prefix in [('jeff', 'skater_'), ('dave', 'dave_')]:
            character = characters[identifier]
            self.assertEqual(character['id'], identifier)
            self.assertEqual(character['name'], identifier.title())
            self.assertEqual(character['previewKey'], prefix+'roll')
            self.assertEqual(set(character['poses']), {k.removeprefix('skater_') for k in ORIGINAL_IMAGE_KEYS if k.startswith('skater_')})
            self.assertEqual(set(character['poses'].values()), {prefix+p for p in character['poses']})
        self.assertEqual(len(IMAGE_KEYS), 49)

    def test_dave_clothing_changes_in_all_poses_without_moving_any_pixels(self):
        for name in sorted(DAVE_KEYS):
            original = name.replace('dave_', 'skater_')
            jeff, dave = self.images[original], self.images[name]
            self.assertEqual(jeff.size, dave.size)
            self.assertEqual(jeff.getchannel('A').tobytes(), dave.getchannel('A').tobytes())
            self.assertEqual(dave.tobytes(), self.prep.dave_palette(jeff).tobytes())
            a, b = dict(self.manifest['images'][original]), dict(self.manifest['images'][name])
            a.pop('path'); b.pop('path'); self.assertEqual(a, b)
            changed = [(p, q) for p, q in zip(jeff.getdata(), dave.getdata()) if p != q]
            self.assertGreater(len(changed), 2000, name)
            self.assertGreater(sum(q[1] > q[0]*2 and q[2] > q[0]*2 for _, q in changed), 500, name)
            self.assertGreater(sum(q[0] > q[1]*1.5 and q[0] > q[2]*1.5 for _, q in changed), 500, name)
            # Gray pads/pants, pale skin and sneakers do not match the clothing masks.
            for p, q in zip(jeff.getdata(), dave.getdata()):
                r, g, b, alpha = p
                if not alpha or max(r, g, b)-min(r, g, b) < 10 or (r > g > b and b > r*.4):
                    self.assertEqual(p, q)
            self.assertEqual(self.crops[name]['derivedFrom'], original)
        with Image.open(ROOT/'assets/qa/contact-sheet.png') as preview:
            self.assertEqual(preview.size, (960, math.ceil(len(IMAGE_KEYS)/5)*132))
        self.assertEqual(self.manifest['provenance']['art']['processorSha256'], sha(ROOT/'scripts/prepare_assets.py'))

    def test_runtime_paths_exclude_references_and_sources(self):
        for section, suffix, parent in [('images', '.png', 'assets/processed'), ('audio', '.wav', 'assets/audio')]:
            for name, entry in self.manifest[section].items():
                with self.subTest(name=name):
                    self.assertIsInstance(entry, dict)
                    path = Path(entry['path'])
                    self.assertEqual(path.suffix, suffix)
                    self.assertEqual(str(path.parent), parent)
                    self.assertTrue((ROOT/path).is_file())
                    self.assertFalse((ROOT/path).is_symlink())
                    self.assertNotIn('references', str(path))
                    self.assertNotIn('source', str(path))

    def test_source_hashes_are_pinned_and_unchanged(self):
        recorded = self.manifest['provenance']['art']['sourceSha256']
        for name, expected in SOURCE_HASHES.items():
            self.assertEqual(sha(ROOT/'assets/source'/name), expected)
            self.assertEqual(recorded['assets/source/'+name], expected)
        self.assertEqual(self.prep.SOURCE_HASHES, SOURCE_HASHES)

    def test_actual_source_dimensions(self):
        for name in SOURCE_HASHES:
            with Image.open(ROOT/'assets/source'/name) as im:
                self.assertEqual(im.size, (1672, 941) if name == 'city.png' else (1254, 1254))
                self.assertEqual(im.mode, 'RGB' if name == 'city.png' else 'RGBA')

    def test_png_dimensions_anchors_and_aspect(self):
        for name, image in self.images.items():
            with self.subTest(name=name):
                e = self.manifest['images'][name]
                self.assertEqual(image.mode, 'RGBA')
                self.assertEqual(image.size, (e['width'], e['height']))
                self.assertEqual(len(e['anchor']), 2)
                self.assertTrue(0 <= e['anchor'][0] <= e['width'])
                self.assertTrue(0 <= e['anchor'][1] <= e['height'])
                self.assertGreater(e['drawWidth'], 0)
                self.assertGreater(e['drawHeight'], 0)
                self.assertAlmostEqual(e['drawWidth']/e['drawHeight'], image.width/image.height)
                self.assertEqual(sha(ROOT/e['path']), self.crops[name]['sha256'])

    def test_binary_alpha_removes_fringes(self):
        for name, image in self.images.items():
            with self.subTest(name=name):
                values = set(image.getchannel('A').getdata())
                self.assertTrue(values <= {0, 255})
                self.assertIn(255, values)
                if name not in ('city', 'asphalt', 'concrete'):
                    self.assertIn(0, values)
                    self.assertTrue(all(r == g == b == 0 for r, g, b, a in image.getdata() if a == 0))

    def test_all_sprites_have_transparent_padding_not_clipped(self):
        for name, image in self.images.items():
            if name in ('city', 'asphalt', 'concrete'):
                continue
            with self.subTest(name=name):
                left, top, right, bottom = image.getchannel('A').getbbox()
                self.assertGreaterEqual(left, 2)
                self.assertGreaterEqual(top, 2)
                self.assertLessEqual(right, image.width-2)
                self.assertLessEqual(bottom, image.height-2)

    def test_grid_boundaries_use_real_rounded_dimensions(self):
        boundaries = [0, 314, 627, 940, 1254]
        for name, crop in self.crops.items():
            if name == 'city' or name in OBSTACLE_KEYS:
                continue
            c, r = crop['cellIndex'] % 4, crop['cellIndex']//4
            self.assertEqual(crop['cellBox'], [boundaries[c], boundaries[r], boundaries[c+1], boundaries[r+1]])
            self.assertEqual(list(self.prep.grid_box((1254, 1254), crop['cellIndex'])), crop['cellBox'])

    def test_clean_crop_stays_inside_cell_without_adjacent_art(self):
        for name, crop in self.crops.items():
            if name == 'city':
                continue
            with Image.open(ROOT/crop['source']) as sheet:
                cell = sheet.crop(crop['regionBox'] if name in OBSTACLE_KEYS else crop['cellBox'])
            alpha = cell.getchannel('A').point(lambda a: 255 if a >= 200 else 0)
            self.assertEqual(list(alpha.getbbox()), crop['cleanBoundsInCell'])
            l, t, r, b = alpha.getbbox()
            self.assertGreater(l, 0)
            self.assertGreater(t, 0)
            self.assertLess(r, cell.width)
            self.assertLess(b, cell.height)

    def test_shared_character_scale_canvas_and_ground_baseline(self):
        for name in sorted(k for k in IMAGE_KEYS if k.startswith(('skater_', 'dave_'))):
            e, crop = self.manifest['images'][name], self.crops[name]
            self.assertEqual(self.images[name].size, (400, 300))
            self.assertEqual(e['drawHeight'], 80)
            self.assertEqual(e['anchor'], [200, 292])
            self.assertTrue(e['boardSeparate'])
            self.assertEqual(crop['uniformSourceScale'], 1)
            self.assertEqual(self.images[name].getchannel('A').getbbox()[3], 292-crop['airLiftPixels'])
            self.assertEqual(e['footLift'], crop['airLiftPixels']*80/300)

    def test_crouch_lowers_head_without_resizing_body(self):
        roll = self.images['skater_roll'].getchannel('A').getbbox()
        crouch = self.images['skater_crouch'].getchannel('A').getbbox()
        self.assertGreater(crouch[1]-roll[1], 65)
        self.assertEqual(crouch[3], roll[3])
        # An exact unscaled paste is stronger than testing height alone.
        for name in ('skater_roll', 'skater_crouch', 'skater_push1', 'skater_manual', 'skater_grind'):
            crop = self.crops[name]
            with Image.open(ROOT/crop['source']) as source:
                expected, _ = self.prep.clean_cell(source, crop['cellIndex'])
            x, y = crop['pasteAt']
            actual = self.images[name].crop((x, y, x+expected.width, y+expected.height))
            self.assertEqual(actual.tobytes(), expected.tobytes())

    def test_air_tucks_leave_board_separation(self):
        for name in ('skater_ollie', 'skater_flip', 'skater_catch'):
            self.assertEqual(self.crops[name]['airLiftPixels'], 30)
            self.assertEqual(self.images[name].getchannel('A').getbbox()[3], 262)
            self.assertEqual(self.manifest['images'][name]['footLift'], 8)

    def test_board_width_and_vertical_source_normalization(self):
        for name in ('board_flat', 'board_flip', 'board_edge', 'board_manual'):
            self.assertEqual(self.manifest['images'][name]['drawWidth'], 64)
            self.assertGreater(self.images[name].width, self.images[name].height)
        crop = self.crops['board_edge']
        self.assertEqual(crop['rotationClockwiseDegrees'], 90)
        with Image.open(ROOT/crop['source']) as source:
            clean, _ = self.prep.clean_cell(source, crop['cellIndex'])
        self.assertGreater(clean.height, clean.width*3)
        rotated = clean.transpose(Image.Transpose.ROTATE_270 if hasattr(Image, 'Transpose') else Image.ROTATE_270)
        actual = self.images['board_edge'].crop((2, 2, 2+rotated.width, 2+rotated.height))
        self.assertEqual(actual.tobytes(), rotated.tobytes())

    def test_board_contact_anchor_is_top_of_deck(self):
        for name in ('board_flat', 'board_edge', 'board_manual'):
            image, entry = self.images[name], self.manifest['images'][name]
            x = image.width//2
            y = next(y for y in range(image.height) if image.getpixel((x, y))[3])
            self.assertEqual(entry['anchor'][1], y)
            self.assertEqual(entry['groundAnchor'][1], image.getchannel('A').getbbox()[3])

    def test_tiles_are_square_opaque_body_crops_without_gaps(self):
        for name in ('asphalt', 'concrete'):
            image = self.images[name]
            self.assertEqual(image.size, (176, 176))
            self.assertEqual(image.getchannel('A').getextrema(), (255, 255))
            crop = self.crops[name]
            with Image.open(ROOT/crop['source']) as source:
                expected = source.crop(crop['tileBodyBoxInSource']).convert('RGB')
            self.assertEqual(image.convert('RGB').tobytes(), expected.tobytes())

    def test_rail_and_overhead_contact_offsets_match_pixels(self):
        for name in ('rail', 'low_bar'):
            image, entry = self.images[name], self.manifest['images'][name]
            ys = [y for y in range(image.height) if image.getpixel((image.width//2, y))[3]]
            self.assertEqual(entry['beamTop'], min(ys))
            self.assertEqual(entry['beamBottom'], max(ys)+1)
            self.assertLess(entry['beamBottom']-entry['beamTop'], image.height/3)
        rail = self.manifest['images']['rail']
        self.assertEqual(rail['contactTop'], 2)
        self.assertEqual(self.manifest['images']['low_bar']['clearanceY'], 22)

    def test_city_is_nearest_neighbor_original_raster(self):
        with Image.open(ROOT/'assets/source/city.png') as source:
            expected = source.convert('RGBA').resize((960, 540), self.prep.NEAREST)
        self.assertEqual(self.images['city'].tobytes(), expected.tobytes())

    def test_wav_headers_and_hashes(self):
        for name, (params, samples) in self.audio.items():
            self.assertEqual(params.nchannels, 1)
            self.assertEqual(params.sampwidth, 2)
            self.assertEqual(params.framerate, 22050)
            self.assertEqual(params.comptype, 'NONE')
            entry = self.manifest['audio'][name]
            self.assertEqual(sha(ROOT/entry['path']), entry['sha256'])
            self.assertAlmostEqual(len(samples)/22050, entry['duration'])

    def test_audio_durations_and_loop_bounds(self):
        for name, entry in self.manifest['audio'].items():
            loop = name in ('music', 'rolling', 'grind')
            self.assertIs(entry['loop'], loop)
            self.assertEqual(entry['loopStart'], 0)
            self.assertEqual(entry['loopEnd'], entry['duration'] if loop else 0)
            self.assertTrue(0 < entry['gain'] <= 1)
            if name == 'music':
                self.assertEqual(self.audio[name][0].nframes, 235200)
                self.assertAlmostEqual(entry['duration'], 4*4*60/90, delta=1/22050)
                self.assertEqual(entry['gain'], .30)
            elif loop:
                self.assertTrue(1 <= entry['duration'] <= 2)
            else:
                self.assertAlmostEqual(entry['duration'], self.score['effectSeconds'][name], delta=1/22050)

    def test_loop_seams_and_boundary_energy(self):
        for name in ('music', 'rolling', 'grind'):
            values = self.audio[name][1]
            steps = [values[i]-values[i-1] for i in range(1, len(values))]
            seam = abs(values[0]-values[-1])
            if name == 'rolling':
                ordered = sorted(map(abs, steps))
                self.assertLess(seam, ordered[int(.99*len(ordered))], name)
                width = 441  # 20 ms, including an equal-sized wrap-centered window.
                energies = [rms(values[i:i+width]) for i in range(0, len(values)-width+1, width)]
                wrap = rms(values[-221:]+values[:220])
                self.assertTrue(min(energies) <= wrap <= max(energies))
                for energy in energies + [wrap]:
                    self.assertTrue(.7*rms(values) < energy < 1.3*rms(values))
            else:
                self.assertLess(seam, .03, name)
                self.assertLess(seam, max(.008, rms(steps)*2), name)
            # No artificial silence/fade gap on either side of the boundary.
            self.assertGreater(rms(values[:2205]), .001, name)
            self.assertGreater(rms(values[-2205:]), .001, name)
            self.assertLess(abs(sum(values)/len(values)), .00002, name)

    def test_audio_peaks_headroom_and_signal_coverage(self):
        for name, (_, values) in self.audio.items():
            peak = max(map(abs, values))
            self.assertAlmostEqual(peak, self.score['outputPeaks'][name], delta=.00005)
            self.assertLess(peak, .7)
            self.assertGreater(rms(values), .025)
            # Continuous beds stay filled; percussive one-shots deliberately
            # decay into quiet release tails (especially the double crack).
            minimum_coverage = .98 if name in ('music', 'rolling', 'grind') else .6
            self.assertGreater(sum(abs(x) > .0001 for x in values)/len(values), minimum_coverage, name)
        music_peak = .48*self.manifest['audio']['music']['gain']
        ground_peak = max(.18*self.manifest['audio']['rolling']['gain'], .27*self.manifest['audio']['grind']['gain'])
        effect_peak = max(self.score['outputPeaks'][k]*self.manifest['audio'][k]['gain'] for k in AUDIO_KEYS-{'music', 'rolling', 'grind'})
        self.assertLess(music_peak+ground_peak+effect_peak, .75)

    def test_one_shots_have_silent_release_endpoints(self):
        for name in AUDIO_KEYS-{'music', 'rolling', 'grind'}:
            values = self.audio[name][1]
            self.assertEqual(values[0], 0)
            self.assertEqual(values[-1], 0)
            self.assertLess(rms(values[-220:]), .005, name)

    def test_crack_has_two_separate_short_contacts(self):
        values = self.audio['crack'][1]
        window = lambda a, b: rms(values[round(a*22050):round(b*22050)])
        self.assertGreater(window(.009, .02), window(.036, .046)*3)
        self.assertGreater(window(.055, .069), window(.036, .046)*2)
        self.assertLess(window(.13, .18), window(.055, .069)*.04)

    def test_score_has_editable_original_arrangement_and_instrument_coverage(self):
        score = self.score
        self.assertEqual(score['title'], 'Sidewalk Pocket')
        self.assertEqual((score['bpm'], score['bars'], score['beatsPerBar']), (90, 4, 4))
        self.assertEqual(self.audio['music'][0].nframes, 235200)  # 16 beats at 90 BPM.
        self.assertEqual(self.audio['rolling'][0].nframes, 35280)  # 1.6 seconds.
        self.assertEqual(set(score['instrumentLevels']), {'kick', 'snare', 'hat', 'bass'})
        self.assertFalse({'riffPatterns', 'arrangement', 'bassRoots', 'fillBars'} & set(score))
        self.assertEqual(score['kickBeats'], [0, 2.5])
        self.assertEqual(score['snareBeats'], [1, 3])
        self.assertEqual(score['hatBeats'], [i/2 for i in range(8)])
        self.assertEqual([e[0] for e in score['bassRhythm']], [0, 2.5])
        events = json.loads((ROOT/'assets/audio/events.json').read_text())
        self.assertEqual(Counter(e['instrument'] for e in events), dict(kick=8, snare=8, hat=32, bass=8))
        self.assertEqual({e['note'] for e in events if e['instrument'] == 'bass'}, {score['bassRoot']})
        expected = []
        for bar in range(4):
            for kind, positions in [('bass', [0, 2.5]), ('kick', [0, 2.5]), ('snare', [1, 3]), ('hat', score['hatBeats'])]:
                for pos in positions:
                    time = (bar*4+pos)*60/90 + (score['swingSeconds'] if pos % 1 == .5 else 0)
                    expected.append((kind, round(time, 6)))
        self.assertEqual([(e['instrument'], e['time']) for e in events], expected)
        self.assertEqual(score['swingSeconds'], .022)
        self.assertEqual(score['bassRoot'], 40)  # E2, no changing roots.
        self.assertEqual(len(events), 56)
        self.assertEqual(len(self.composer.drum('hat', 22050, self.composer.rng_for(731942, 'hat'))), round(.075*22050))
        for unsupported in ('guitar', 'rim', 'open_hat', 'lead'):
            with self.assertRaises(KeyError):
                self.composer.drum(unsupported, 22050, self.composer.rng_for(731942, unsupported))

        self.assertEqual(self.manifest['provenance']['audio']['scoreSha256'], sha(ROOT/'assets/audio/score.json'))

    def test_seed_changes_timbre_not_structure(self):
        changed = dict(self.score, seed=self.score['seed']+1)
        a = self.composer.effect('ollie', self.score)
        b = self.composer.effect('ollie', changed)
        self.assertEqual(len(a), len(b))
        self.assertNotEqual(a, b)

    def test_full_offline_rebuild_is_reproducible_and_preserves_sources(self):
        before = {name: sha(ROOT/'assets/source'/name) for name in SOURCE_HASHES}
        with tempfile.TemporaryDirectory(prefix='shredder-assets-') as tmp:
            root = Path(tmp)
            self.prep.prepare(ROOT, root)
            self.composer.compose(ROOT/'assets/audio/score.json', root)
            rebuilt = json.loads((root/'assets/manifest.json').read_text())
            self.assertEqual(rebuilt, self.manifest)
            self.assertEqual((root/'assets/crop-map.json').read_bytes(), (ROOT/'assets/crop-map.json').read_bytes())
            for section in ('images', 'audio'):
                for name, entry in self.manifest[section].items():
                    self.assertEqual(sha(root/entry['path']), sha(ROOT/entry['path']), name)
            self.assertEqual((root/'assets/audio/events.json').read_bytes(), (ROOT/'assets/audio/events.json').read_bytes())
            # Reversing the scripts' order must preserve the other manifest section.
            self.prep.prepare(ROOT, root)
            self.assertEqual(json.loads((root/'assets/manifest.json').read_text()), self.manifest)
        after = {name: sha(ROOT/'assets/source'/name) for name in SOURCE_HASHES}
        self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()

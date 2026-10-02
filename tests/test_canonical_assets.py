"""Approved PNG bytes survive encoder differences, never raster differences."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from test_assets_audio import ROOT, load_script


class CanonicalAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prep = load_script('prepare_assets')

    def test_different_compression_copies_exact_canonical_bytes_without_encoding(self):
        image = Image.new('RGBA', (32, 32), (17, 39, 83, 255))
        image.putpixel((0, 0), (7, 8, 9, 0))
        with tempfile.TemporaryDirectory() as tmp:
            canonical, output = Path(tmp)/'approved.png', Path(tmp)/'output.png'
            image.save(canonical, compress_level=0)
            image.save(output, compress_level=9)
            self.assertNotEqual(canonical.read_bytes(), output.read_bytes())
            with Image.open(output) as encoded:
                self.assertEqual(encoded.tobytes(), image.tobytes())
            with patch.object(Image.Image, 'save', side_effect=AssertionError('Unexpected encoding')):
                self.prep.save_canonical_asset(image, canonical, output)
            self.assertEqual(output.read_bytes(), canonical.read_bytes())

    def test_same_path_keeps_bytes_without_writes_or_encoding(self):
        image = Image.new('RGBA', (4, 4), (12, 34, 56, 255))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'approved.png'
            image.save(path, compress_level=0)
            before, modified = path.read_bytes(), path.stat().st_mtime_ns
            with patch.object(Image.Image, 'save', side_effect=AssertionError('Unexpected encoding')), \
                    patch.object(Path, 'write_bytes', side_effect=AssertionError('Unexpected write')):
                self.prep.save_canonical_asset(image, path, path)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(path.stat().st_mtime_ns, modified)

    def test_raster_mismatches_reject_before_copy_or_overwrite(self):
        image = Image.new('RGBA', (4, 4), (12, 34, 56, 255))
        image.putpixel((0, 0), (7, 8, 9, 0))
        variants = {'size': image.resize((5, 4)), 'mode': image.convert('RGB')}
        for name, pixel in [('rgb', (99, 34, 56, 255)), ('alpha', (12, 34, 56, 254)),
                            ('invisible_rgb', (99, 8, 9, 0))]:
            variants[name] = image.copy()
            variants[name].putpixel((0, 0) if name == 'invisible_rgb' else (1, 1), pixel)
        with tempfile.TemporaryDirectory() as tmp:
            canonical, output = Path(tmp)/'approved.png', Path(tmp)/'output.png'
            for name, approved in variants.items():
                with self.subTest(mismatch=name):
                    approved.save(canonical)
                    before = canonical.read_bytes()
                    output.write_bytes(b'untouched output')
                    with patch.object(Image.Image, 'save', side_effect=AssertionError('Unexpected encoding')):
                        for target in (output, canonical):
                            with self.assertRaisesRegex(ValueError, 'Canonical asset mismatch: approved.png'):
                                self.prep.save_canonical_asset(image, canonical, target)
                    self.assertEqual(output.read_bytes(), b'untouched output')
                    self.assertEqual(canonical.read_bytes(), before)

    def test_generated_non_rgba_is_rejected_without_conversion(self):
        image = Image.new('RGBA', (4, 4), (12, 34, 56, 255))
        with tempfile.TemporaryDirectory() as tmp:
            canonical, output = Path(tmp)/'approved.png', Path(tmp)/'output.png'
            image.save(canonical)
            with self.assertRaisesRegex(ValueError, 'Canonical asset mismatch: approved.png'):
                self.prep.save_canonical_asset(image.convert('RGB'), canonical, output)
            self.assertFalse(output.exists())

    def test_missing_canonical_saves_new_asset_as_before(self):
        image = Image.new('RGBA', (4, 4), (12, 34, 56, 255))
        with tempfile.TemporaryDirectory() as tmp:
            canonical, output, expected = (Path(tmp)/name for name in ('new.png', 'output.png', 'expected.png'))
            image.save(expected, optimize=False)
            self.prep.save_canonical_asset(image, canonical, output)
            self.assertFalse(canonical.exists())
            self.assertEqual(output.read_bytes(), expected.read_bytes())
            with Image.open(output) as generated:
                self.assertEqual(generated.mode, image.mode)
                self.assertEqual(generated.size, image.size)
                self.assertEqual(generated.tobytes(), image.tobytes())
            self.prep.save_canonical_asset(image, canonical, canonical)
            self.assertEqual(canonical.read_bytes(), expected.read_bytes())

    def test_full_prepare_in_place_and_separate_output_never_encodes_runtime_assets(self):
        expected_manifest = json.loads((ROOT/'assets/manifest.json').read_text())
        expected_crops = (ROOT/'assets/crop-map.json').read_bytes()
        expected_bytes = {path.name: path.read_bytes() for path in (ROOT/'assets/processed').glob('*.png')}
        self.assertEqual(len(expected_bytes), 49)
        original_save = Image.Image.save

        def save_qa_only(image, path, *args, **kwargs):
            self.assertEqual(Path(path).parts[-2:], ('qa', 'contact-sheet.png'))
            return original_save(image, path, *args, **kwargs)

        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)/'source'
            for folder in ('source', 'processed'):
                shutil.copytree(ROOT/'assets'/folder, source/'assets'/folder)
            for name in ('characters.json', 'manifest.json', 'crop-map.json'):
                shutil.copyfile(ROOT/'assets'/name, source/'assets'/name)
            separate = Path(tmp)/'output'
            (separate/'assets').mkdir(parents=True)
            shutil.copyfile(ROOT/'assets/manifest.json', separate/'assets/manifest.json')
            for output in (source, separate):
                with self.subTest(in_place=output == source), \
                        patch.object(Image.Image, 'save', autospec=True, side_effect=save_qa_only) as save:
                    self.assertEqual(self.prep.prepare(source, output), expected_manifest)
                    self.assertEqual(save.call_count, 1)  # Ignored QA still regenerates on clean CI.
                    self.assertEqual((output/'assets/crop-map.json').read_bytes(), expected_crops)
                    for name, content in expected_bytes.items():
                        self.assertEqual((output/'assets/processed'/name).read_bytes(), content, name)
                    self.assertTrue((output/'assets/qa/contact-sheet.png').is_file())


if __name__ == '__main__':
    unittest.main()

"""Structural tests for the actual standalone export, including every asset."""
import base64
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build", ROOT / "scripts/build.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.data = json.loads(re.search(r"window.SHREDDER_DATA = (.*?);</script>", cls.html)[1])
        cls.manifest = json.loads((ROOT / "assets/manifest.json").read_text())

    def test_byte_identical_dist_and_rebuild(self):
        self.assertEqual((ROOT / "index.html").read_bytes(), (ROOT / "dist/index.html").read_bytes())
        self.assertEqual(self.html, BUILD.assemble())

    def test_all_embedded_assets_preserve_bytes_and_metadata(self):
        for section, count, mime in (("images", 49, "image/png"), ("audio", 9, "audio/wav")):
            self.assertEqual(len(self.data[section]), count)
            for key, original in self.manifest[section].items():
                with self.subTest(key=key):
                    exported = dict(self.data[section][key])
                    src = exported.pop("src")
                    expected = dict(original)
                    path = expected.pop("path")
                    self.assertEqual(exported, expected)
                    self.assertTrue(src.startswith("data:" + mime + ";base64,"))
                    self.assertEqual(base64.b64decode(src.split(",", 1)[1], validate=True), (ROOT / path).read_bytes())

    def test_course_settings_provenance(self):
        for name in ("course", "settings"):
            self.assertEqual(self.data[name], json.loads((ROOT / (name + ".json")).read_text()))
        self.assertEqual(self.data["provenance"], self.manifest["provenance"])
        self.assertFalse(self.data["provenance"]["art"]["referenceAssetsIncluded"])

    def test_classic_inline_no_external_runtime_or_research(self):
        self.assertNotRegex(self.html, r"\{\{[A-Z_]+\}\}")
        self.assertNotRegex(self.html, r"<(?:script|link|img)[^>]+(?:src|href)=[\"'](?:https?:|//|\./)")
        self.assertNotRegex(self.html, r"\b(?:fetch|import)\s*\(")
        self.assertNotIn('type="module"', self.html)
        self.assertNotIn("references/", self.html)
        self.assertNotIn("paperboy-arcade", self.html)
        positions = [self.html.index("window.SHREDDER_DATA = ")]
        for name in BUILD.SCRIPTS:
            positions.append(self.html.index((ROOT / "web" / (name + ".js")).read_text().strip()))
        self.assertEqual(positions, sorted(positions))

    def test_characters_and_user_facing_name_are_embedded(self):
        self.assertEqual(self.data['characters'], self.manifest['characters'])
        self.assertIn('<title>Skater Dudes</title>', self.html)
        self.assertIn('Dedicated to Oscar, the raddest skater dude I know', self.html)
        for character in self.data['characters'].values():
            self.assertEqual(len(character['poses']), 12)
            self.assertTrue(set(character['poses'].values()) <= self.data['images'].keys())

    def test_hold_release_controls_and_no_stored_charge_are_embedded(self):
        self.assertEqual(self.data['settings']['tapThreshold'], .30)
        self.assertEqual(self.data['settings']['fullChargeTime'], .6)
        for obsolete in ('storedChargeTime', 'popReady', 'this.armed', 'space.stored',
                         'TWO-PRESS POP', 'POP READY', 'HOLD → RELEASE → TAP'):
            self.assertNotIn(obsolete, self.html)
        for instruction in ('THE HOLD-RELEASE POP', 'HOLD 900 ms  →  RELEASE TO POP',
                            'Full pop takes 900 ms; release to jump.'):
            self.assertIn(instruction, self.html)

    def test_stale_33_image_manifest_upgrades_and_missing_dave_pose_repairs(self):
        with tempfile.TemporaryDirectory(prefix='skater-dudes-upgrade-') as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT/'assets', root/'assets')
            shutil.copytree(ROOT/'scripts', root/'scripts')
            manifest = json.loads((root/'assets/manifest.json').read_text())
            manifest.pop('characters')
            for key in list(manifest['images']):
                if key.startswith('dave_') or key in {'jersey_barrier', 'gap_left', 'gap_center', 'gap_right'}:
                    (root/manifest['images'].pop(key)['path']).unlink()
            self.assertEqual(len(manifest['images']), 33)
            (root/'assets/manifest.json').write_text(json.dumps(manifest))
            upgraded = BUILD.prepare(root)
            self.assertEqual(upgraded, self.manifest)
            old45 = json.loads(json.dumps(upgraded))
            for key in ('jersey_barrier', 'gap_left', 'gap_center', 'gap_right'):
                old45['images'].pop(key)
            (root/'assets/manifest.json').write_text(json.dumps(old45))
            self.assertEqual(BUILD.prepare(root), self.manifest)
            (root/upgraded['images']['dave_flip']['path']).unlink()
            self.assertEqual(BUILD.prepare(root), self.manifest)
            for section in ('images', 'audio'):
                for entry in self.manifest[section].values():
                    self.assertEqual((root/entry['path']).read_bytes(), (ROOT/entry['path']).read_bytes())

    def test_invalid_character_schema_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='skater-dudes-schema-') as tmp:
            root = Path(tmp); (root/'assets').mkdir()
            characters = json.loads((ROOT/'assets/characters.json').read_text())
            characters['dave']['poses'].pop('flip')
            (root/'assets/characters.json').write_text(json.dumps(characters))
            with self.assertRaisesRegex(ValueError, 'Invalid character definition'):
                BUILD.prepare(root)

    def test_production_path_validation(self):
        for bad in ("references/paperboy/example.png", "assets/processed/../../references/example.png"):
            with self.assertRaises(ValueError):
                BUILD.embedded(ROOT, {"bad": {"path": bad}}, "image/png")


if __name__ == "__main__":
    unittest.main()

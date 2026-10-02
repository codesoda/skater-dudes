"""Portable regressions for the original hip-hop loop and cyclic pavement noise."""
import cmath
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_assets_audio import load_script, rms, sha

ROOT = Path(__file__).resolve().parents[1]
RATE = 22050


def spectrum(values):
    """Welch periodogram: 2048-point Hann FFTs, 50% overlap (~10.8 Hz bins).
    Average window powers, then report fractions, centroid and midband flatness.
    Fractions remove level differences; flatness distinguishes hiss from tones.
    """
    n = 2048
    power = [0.0]*(n//2+1)
    window = [.5-.5*math.cos(2*math.pi*i/(n-1)) for i in range(n)]
    for start in range(0, len(values)-n+1, n//2):
        bins = [complex(values[start+i]*window[i]) for i in range(n)]
        j = 0
        for i in range(1, n):
            bit = n >> 1
            while j & bit:
                j ^= bit
                bit >>= 1
            j ^= bit
            if i < j:
                bins[i], bins[j] = bins[j], bins[i]
        size = 2
        while size <= n:
            step = cmath.exp(-2j*math.pi/size)
            for base in range(0, n, size):
                phase = 1
                for offset in range(size//2):
                    a = base+offset
                    b = a+size//2
                    u, v = bins[a], phase*bins[b]
                    bins[a], bins[b] = u+v, u-v
                    phase *= step
            size *= 2
        for i in range(len(power)):
            power[i] += abs(bins[i])**2 * (1 if i in (0, n//2) else 2)
    total = sum(power)
    band = lambda lo, hi: [p for i, p in enumerate(power) if lo <= i*RATE/n < hi]
    middle = band(1000, 4000)
    return {
        'below140Fraction': sum(band(0, 140))/total,
        'below250Fraction': sum(band(0, 250))/total,
        '500to5000Fraction': sum(band(500, 5000))/total,
        'above7000Fraction': sum(band(7000, RATE))/total,
        'centroidHz': sum(i*RATE/n*p for i, p in enumerate(power))/total,
        '1000to4000Flatness': math.exp(sum(math.log(max(p, 1e-30)) for p in middle)/len(middle))/(sum(middle)/len(middle)),
    }


class AudioDSPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.composer = load_script('compose_audio')
        cls.score = json.loads((ROOT/'assets/audio/score.json').read_text())
        cls.manifest = json.loads((ROOT/'assets/manifest.json').read_text())

    def test_rolling_is_bright_broadband_noise_not_low_tones(self):
        from array import array
        import sys
        import wave
        with wave.open(str(ROOT/'assets/audio/rolling.wav'), 'rb') as reader:
            samples = array('h', reader.readframes(reader.getnframes()))
        if sys.byteorder != 'little':
            samples.byteswap()
        metrics = spectrum([value/32768 for value in samples])
        self.assertLess(metrics['below140Fraction'], .01)
        self.assertLess(metrics['below250Fraction'], .05)
        self.assertGreater(metrics['500to5000Fraction'], .7)
        self.assertTrue(1800 < metrics['centroidHz'] < 3000)
        self.assertLess(metrics['above7000Fraction'], .05)
        self.assertGreater(metrics['1000to4000Flatness'], .5)

    def test_filter_solves_periodic_state_and_is_rotation_invariant(self):
        signal = [.8, -.4, .2, -.9, .5, .1, -.3]
        for cutoff in (320, 4200):
            result = self.composer.circular_lowpass(signal, cutoff, RATE)
            pole = math.exp(-2*math.pi*cutoff/RATE)
            self.assertAlmostEqual(result[0], pole*result[-1]+(1-pole)*signal[0], places=14)
            rotated = self.composer.circular_lowpass(signal[3:]+signal[:3], cutoff, RATE)
            for a, b in zip(rotated, result[3:]+result[:3]):
                self.assertAlmostEqual(a, b, places=14)

    def test_rolling_uses_seeded_highpass_then_lowpass(self):
        score = self.score
        self.assertEqual((score['seed'], score['rollingHighpassHz'], score['rollingLowpassHz']), (731942, 320, 4200))
        rng = self.composer.rng_for(score['seed'], 'rolling')
        noise = [rng.uniform(-1, 1) for _ in range(35280)]
        low = self.composer.circular_lowpass(noise, 320, RATE)
        expected = self.composer.circular_lowpass([a-b for a, b in zip(noise, low)], 4200, RATE)
        self.assertEqual(self.composer.rolling(score), expected)
        changed = self.composer.rolling(dict(score, seed=score['seed']+1))
        self.assertEqual(len(changed), len(expected))
        self.assertNotEqual(changed, expected)

    def test_music_release_tails_really_wrap(self):
        normal, _ = self.composer.music(self.score)
        original_add = self.composer.add_voice
        def without_wrap(buffer, voice, start, level=1, wrap=False):
            self.assertTrue(wrap)
            original_add(buffer, voice, start, level, wrap=False)
        with patch.object(self.composer, 'add_voice', side_effect=without_wrap):
            cut, _ = self.composer.music(self.score)
        self.assertGreater(rms([a-b for a, b in zip(normal[:2205], cut[:2205])]), .001)

    def test_music_gain_and_existing_bus_headroom(self):
        score = self.score
        self.assertEqual(score['runtimeGains']['music'], .30)
        self.assertEqual(score['runtimeGains']['rolling'], .25)
        music, _ = self.composer.music(score)
        rolling = self.composer.rolling(score)
        # Normalize like the renderer; compare mix energy, not perceived loudness.
        from array import array
        import sys
        def normalized_rms(signal, peak):
            samples = array('h', self.composer.finalize(signal, peak, True))
            if sys.byteorder != 'little':
                samples.byteswap()
            return rms([value/32768 for value in samples])
        self.assertGreater(normalized_rms(music, .48)*.30, normalized_rms(rolling, .18)*.25)
        peaks = {k: v*score['runtimeGains'][k] for k, v in score['outputPeaks'].items()}
        loops = {'music', 'grind'}
        maximum = .9*(sum(peaks[k] for k in loops)+4*.25*max(v for k, v in peaks.items() if k not in loops))
        self.assertLess(maximum, .75)
        self.assertIs(self.manifest['provenance']['audio']['speakerAudition'], False)

    def test_compose_preserves_all_non_audio_manifest_fields(self):
        sentinel = dict(self.manifest, unrelated={'keep': ['future metadata']})
        with tempfile.TemporaryDirectory(prefix='shredder-audio-') as tmp:
            root = Path(tmp)
            (root/'assets').mkdir()
            (root/'assets/manifest.json').write_text(json.dumps(sentinel))
            rebuilt = self.composer.compose(ROOT/'assets/audio/score.json', root)
            self.assertEqual(rebuilt, sentinel)
            for entry in self.manifest['audio'].values():
                self.assertEqual(sha(root/entry['path']), entry['sha256'])
            for name in ('score.json', 'events.json'):
                self.assertEqual(sha(root/'assets/audio'/name), sha(ROOT/'assets/audio'/name))

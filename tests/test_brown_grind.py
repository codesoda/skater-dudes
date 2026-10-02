"""Portable standard-library DSP contracts adapted from the completed audio stage."""
from array import array
import json
import math
from pathlib import Path
import sys
import unittest
import wave
from test_assets_audio import load_script, rms
ROOT = Path(__file__).resolve().parents[1]
COMPOSER = load_script('compose_audio')


def samples():
    with wave.open(str(ROOT/'assets/audio/grind.wav'), 'rb') as reader:
        pcm = array('h', reader.readframes(reader.getnframes()))
    if sys.byteorder != 'little':
        pcm.byteswap()
    return [v/32767 for v in pcm]


def band_psd(values, low, high):
    """64 evenly spaced exact loop DFT bins, via Goertzel; no FFT dependency.

    Mean bin power estimates spectral density; multiply by band width to
    compare band energy. Exact bins need no window for this periodic signal.
    """
    n = len(values)
    first = math.ceil(low*n/22050)
    last = math.ceil(high*n/22050)-1
    bins = sorted({round(first+(last-first)*i/63) for i in range(64)})
    powers = []
    for k in bins:
        coefficient = 2*math.cos(2*math.pi*k/n)
        previous = older = 0.0
        for value in values:
            current = value+coefficient*previous-older
            older, previous = previous, current
        powers.append(max(0, previous*previous+older*older-coefficient*previous*older)/(n*n))
    return sum(powers)/len(powers), powers


class BrownGrindTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT/'tests/artifacts/speed-obstacles-audio').mkdir(parents=True, exist_ok=True)

    def test_pcm_seam_dc_boundary_and_headroom(self):
        with wave.open(str(ROOT/'assets/audio/grind.wav'), 'rb') as reader:
            self.assertEqual((reader.getnchannels(), reader.getsampwidth(), reader.getframerate(),
                              reader.getnframes(), reader.getcomptype()), (1, 2, 22050, 35280, 'NONE'))
        values = samples()
        peak = max(map(abs, values))
        mean = sum(values)/len(values)
        steps = [b-a for a, b in zip(values, values[1:])]
        seam = abs(values[0]-values[-1])
        step_rms = rms(steps)
        boundary_rms = [rms(values[:441]), rms(values[-441:])]
        self.assertAlmostEqual(peak, .27, delta=1/32767)
        self.assertLess(abs(mean), 1/32767)
        self.assertLess(seam, max(map(abs, steps)))
        self.assertLess(seam, 5*step_rms)
        for level in boundary_rms:
            self.assertGreater(level, .15*rms(values))
        self.assertGreater(min(abs(values[0]), abs(values[-1])), 1/32767)
        # Current master/SFX buses, music + grind + four loudest possible cues.
        mix_bound = .9*(.48*.30+.27*.30+4*.66*.68*.25)
        self.assertLess(mix_bound, .7)
        self.metrics = dict(peak=peak, mean=mean, rms=rms(values), seam_step=seam,
                            interior_step_rms=step_rms, seam_to_step_rms=seam/step_rms,
                            interior_max_step=max(map(abs, steps)), boundary_20ms_rms=boundary_rms,
                            first_sample=values[0], last_sample=values[-1], mix_peak_bound=mix_bound)
        (ROOT/'tests/artifacts/speed-obstacles-audio/waveform-measurements.json').write_text(json.dumps(self.metrics, indent=2)+'\n')

    def test_brown_spectrum_and_broadband_energy(self):
        score = json.loads((ROOT/'assets/audio/score.json').read_text())
        values = COMPOSER.brown_grind(score)
        bands = [(20, 160), (80, 160), (160, 320), (320, 640), (2000, 8000)]
        density = {}
        for low, high in bands:
            average, powers = band_psd(values, low, high)
            density[(low, high)] = average
            # Many occupied bins, not a small set of periodic tones.
            self.assertGreater(sum(p > average*.1 for p in powers), 32)
        slope = math.log(density[(320, 640)]/density[(80, 160)])/math.log(4)
        self.assertGreater(slope, -2.7)
        self.assertLess(slope, -1.3)
        self.assertGreater(density[(80, 160)], density[(160, 320)])
        self.assertGreater(density[(160, 320)], density[(320, 640)])
        energy_ratio = density[(20, 160)]*140/(density[(2000, 8000)]*6000)
        self.assertGreater(energy_ratio, 30)
        (ROOT/'tests/artifacts/speed-obstacles-audio/spectrum-measurements.json').write_text(json.dumps(dict(
            method='64 equally spaced exact DFT bins per band; band energy is an estimate',
            mean_bin_power={str(k): v for k, v in density.items()},
            brown_power_slope_80_to_640_hz=slope,
            energy_ratio_20_160_over_2000_8000_hz=energy_ratio), indent=2)+'\n')

    def test_steel_mix_retains_warm_base_with_audible_scrape(self):
        score = json.loads((ROOT/'assets/audio/score.json').read_text())
        base = COMPOSER.brown_grind(score)
        mix = COMPOSER.grind(score)
        self.assertEqual(mix, COMPOSER.grind(score))
        low, _ = band_psd(mix, 20, 160)
        steel, _ = band_psd(mix, 600, 2500)
        original, _ = band_psd(base, 600, 2500)
        self.assertGreater(steel, original * 3)
        self.assertGreater(low * 140, steel * 1900)
        self.assertGreater(steel * 1900, low * 140 * .025)
        (ROOT/'tests/artifacts/elevated-lines-grinds').mkdir(parents=True, exist_ok=True)
        (ROOT/'tests/artifacts/elevated-lines-grinds/audio.json').write_text(json.dumps(dict(
            lowEnergy=low*140, steelEnergy=steel*1900, steelGainOverBrown=steel/original,
            speakerAudition=False), indent=2)+'\n')

    def test_periodic_filter_state(self):
        # Circular filtering must commute with rotation, including the seam.
        signal = [math.sin(i*1.73)+.3*math.cos(i*.21) for i in range(257)]
        shift = 51
        for cutoff in (10, 12, 600, 1800, 2500):
            original = COMPOSER.circular_lowpass(signal, cutoff, 22050)
            rotated = COMPOSER.circular_lowpass(signal[shift:]+signal[:shift], cutoff, 22050)
            for actual, expected in zip(rotated, original[shift:]+original[:shift]):
                self.assertAlmostEqual(actual, expected, places=12)

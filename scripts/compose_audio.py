#!/usr/bin/env python3
"""Offline deterministic original score + SFX. Python 3.9+, standard library only.

No runtime synthesis. Render mono 22050 Hz signed 16-bit PCM WAVs once.
Loop voices wrap release tails. Rolling and brown-noise grind use cyclic filtered noise.
"""
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import random
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
TAU = 2 * math.pi
AUDIO_KEYS = ('music', 'rolling', 'grind', 'crack', 'ollie', 'land', 'crash', 'push', 'bank')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rng_for(seed, name):
    return random.Random(int(digest(('%s:%s' % (seed, name)).encode())[:16], 16))


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def envelope(t, duration, attack=0.003, decay=7):
    return min(1, t/attack) * math.exp(-decay*t) * min(1, max(0, duration-t)/0.025)


def bass(note, duration, rate):
    freq = hz(note)
    out = []
    for i in range(round(duration*rate)):
        t = i/rate
        # Fundamental stays round. Small harmonics translate on small speakers.
        tone = math.sin(TAU*freq*t) + .19*math.sin(TAU*freq*2*t) + .06*math.sin(TAU*freq*3*t)
        out.append(tone * envelope(t, duration, attack=.007, decay=1.6))
    return out


def drum(kind, rate, rng):
    duration = {'kick': .36, 'snare': .22, 'hat': .075}[kind]
    out = []
    low = previous = 0.0
    for i in range(round(duration*rate)):
        t = i/rate
        noise = rng.uniform(-1, 1)
        low += .25 * (noise-low)
        high = noise-previous
        previous = noise
        if kind == 'kick':
            # Integrate a falling frequency rather than multiply frequency by t.
            phase = TAU*(48*t + 92*.018*(1-math.exp(-t/.018)))
            value = math.sin(phase)*math.exp(-t*13) + .05*high*math.exp(-t*180)
        elif kind == 'snare':
            value = .8*(noise-low)*math.exp(-t*23) + .48*math.sin(TAU*178*t)*math.exp(-t*29)
        elif kind == 'hat':
            metal = sum(math.sin(TAU*f*t) for f in (3299, 4517, 5987)) / 3
            value = (.5*high+.35*metal)*math.exp(-t*49)
        out.append(value*min(1, t/.0015)*min(1, (duration-t)/.015))
    return out


def add_voice(buffer, voice, start, level=1, wrap=False):
    n = len(buffer)
    for i, value in enumerate(voice):
        target = start+i
        if wrap:
            target %= n
        elif target >= n:
            break
        if target >= 0:
            buffer[target] += value*level


def music(score):
    rate = score['sampleRate']
    beat = 60/score['bpm']
    duration = score['bars']*score['beatsPerBar']*beat
    output = [0.0] * round(duration*rate)
    events = []
    levels = score['instrumentLevels']
    rng = rng_for(score['seed'], 'music')

    def emit(kind, bar, pos, voice, velocity=1, note=None):
        when = (bar*score['beatsPerBar']+pos)*beat
        # Gentle swung offbeat, without changing the exact loop length.
        if abs(pos % 1 - .5) < .001:
            when += score['swingSeconds']
        gain = levels[kind]*velocity
        add_voice(output, voice, round(when*rate), gain, wrap=True)
        events.append(dict(instrument=kind, time=round(when, 6), gain=round(gain, 6), note=note))

    for bar in range(score['bars']):
        for pos, length, velocity in score['bassRhythm']:
            note = score['bassRoot']
            emit('bass', bar, pos, bass(note, length*beat+.06, rate), velocity, note)
        for pos in score['kickBeats']:
            emit('kick', bar, pos, drum('kick', rate, rng), .92 if pos == 0 else .77)
        for pos in score['snareBeats']:
            emit('snare', bar, pos, drum('snare', rate, rng))
        for index, pos in enumerate(score['hatBeats']):
            emit('hat', bar, pos, drum('hat', rate, rng), .68 if index % 2 else .91)
    return output, events


def circular_lowpass(signal, cutoff, rate):
    """One-pole filter with its periodic steady-state initial value, not silence."""
    pole = math.exp(-TAU*cutoff/rate)
    feed = 1-pole
    state = 0.0
    for value in signal:
        state = pole*state + feed*value
    # After one period: end = pole**n * initial + zero-start end.
    state /= 1-pole**len(signal)
    output = []
    for value in signal:
        state = pole*state + feed*value
        output.append(state)
    return output


def rolling(score):
    """Broadband pavement hiss, with no loop fade or sparse tonal voices."""
    rate = score['sampleRate']
    rng = rng_for(score['seed'], 'rolling')
    noise = [rng.uniform(-1, 1) for _ in range(round(score['loopSeconds']['rolling']*rate))]
    low = circular_lowpass(noise, score['rollingHighpassHz'], rate)
    high = [value-low[i] for i, value in enumerate(noise)]
    return circular_lowpass(high, score['rollingLowpassHz'], rate)


def brown_grind(score):
    """Brown rail rumble: seeded noise, cyclic leaky integration, no loop fade.

    The 12 Hz one-pole integrator gives approximately 1/f^2 power above
    its corner. Remove infrasonic drift gently at 10 Hz and soften treble
    at 1800 Hz. Every filter uses periodic state, including at the seam.
    """
    rate = score['sampleRate']
    rng = rng_for(score['seed'], 'grind')
    noise = [rng.uniform(-1, 1) for _ in range(round(score['loopSeconds']['grind']*rate))]
    brown = circular_lowpass(noise, 12, rate)
    infra = circular_lowpass(brown, 10, rate)
    rumble = [value-infra[i] for i, value in enumerate(brown)]
    return circular_lowpass(rumble, 1800, rate)


def grind(score):
    """Warm brown contact with a restrained, seeded 600..2500 Hz steel scrape."""
    rate = score['sampleRate']
    base = brown_grind(score)
    rng = rng_for(score['seed'], 'steel-scrape')
    noise = [rng.uniform(-1, 1) for _ in base]
    low = circular_lowpass(noise, 600, rate)
    scrape = circular_lowpass([v-low[i] for i, v in enumerate(noise)], 2500, rate)
    # Integer loop harmonics keep the metallic chatter periodic, without a hiss bed.
    scrape = [v*(.65 + .2*math.sin(TAU*37*i/len(base)) +
                 .15*math.sin(TAU*91*i/len(base))) for i, v in enumerate(scrape)]
    rms = lambda signal: math.sqrt(sum(v*v for v in signal)/len(signal))
    level = .34*rms(base)/rms(scrape)
    mixed = [v + level*scrape[i] for i, v in enumerate(base)]
    # Start at a natural quiet crossing. Browser resamplers pad file endpoints;
    # a circular phase shift limits their boundary transient without any fade.
    seam = min(range(len(mixed)), key=lambda i: sum(abs(mixed[(i+j) % len(mixed)]) for j in (-2, -1, 0, 1)))
    return mixed[seam:] + mixed[:seam]


def effect_crack(t, noise, low, high):
    value = 0.0
    # Two distinct wheel contacts, separated by 46 ms.
    for offset, gain in ((.006, 1), (.052, .76)):
        age = t-offset
        if age >= 0:
            value += gain*(.65*math.sin(TAU*1380*age)+.3*noise)*math.exp(-age*88)*min(1, age/.001)
    return value


def effect_ollie(t, noise, low, high):
    value = 0.0
    value = (.62*math.sin(TAU*490*t)+.28*math.sin(TAU*1170*t)+.5*high)*math.exp(-t*42)
    if t > .035:
        value += .22*(noise-low)*math.exp(-(t-.035)*36)
    return value


def effect_land(t, noise, low, high):
    value = 0.0
    value = (.6*math.sin(TAU*113*t)+.37*math.sin(TAU*627*t)+.36*high)*math.exp(-t*31)
    if t > .021:
        value += .23*noise*math.exp(-(t-.021)*58)
    return value


def effect_crash(t, noise, low, high):
    value = 0.0
    value = (.7*low+.24*noise)*math.exp(-t*4)*(0.7+.3*math.sin(TAU*23*t)**2)
    for offset in (0, .066, .149, .271, .43):
        age = t-offset
        if age >= 0:
            value += .35*(math.sin(TAU*381*age)+.4*math.sin(TAU*917*age))*math.exp(-age*55)
    return value


def effect_push(t, noise, low, high):
    value = 0.0
    value = (.7*low+.12*math.sin(TAU*156*t))*math.exp(-t*18)
    return value


def effect_bank(t, noise, low, high):
    value = 0.0
    for offset, note, level in ((0, 76, .65), (.085, 83, .48), (.17, 88, .37)):
        age = t-offset
        if age >= 0:
            value += level*(math.sin(TAU*hz(note)*age)+.16*math.sin(TAU*hz(note)*2*age))*math.exp(-age*7)*min(1, age/.004)
    return value


EFFECTS = {
    'crack': effect_crack,
    'ollie': effect_ollie,
    'land': effect_land,
    'crash': effect_crash,
    'push': effect_push,
    'bank': effect_bank,
}


def effect(kind, score):
    rate = score['sampleRate']
    duration = score['effectSeconds'][kind]
    rng = rng_for(score['seed'], kind)
    output = [0.0]*round(rate*duration)
    low = prev = 0.0
    render = EFFECTS[kind]
    for i, _ in enumerate(output):
        t = i/rate
        noise = rng.uniform(-1, 1)
        low += .18*(noise-low)
        high = noise-prev
        prev = noise
        value = render(t, noise, low, high)
        output[i] = value*min(1, t/.002)*min(1, (duration-t)/.05)
    # One-shot endpoints are explicitly silent, including the quantized sample.
    output[0] = output[-1] = 0.0
    return output


def finalize(signal, peak, loop):
    """DC removal, modest smoothing, deterministic peak normalization."""
    mean = sum(signal)/len(signal)
    signal = [v-mean for v in signal]
    if loop:
        # Circular FIR: wrap is treated identically to any interior sample.
        signal = [(signal[(i-1) % len(signal)]+2*v+signal[(i+1) % len(signal)])/4
                  for i, v in enumerate(signal)]
    else:
        # Retain silent endpoints after DC removal without a hard gate.
        fade = min(128, len(signal)//4)
        for i in range(fade):
            signal[i] *= i/fade
            signal[-1-i] *= i/fade
    scale = peak/max(abs(v) for v in signal)
    pcm = array('h', (round(v*scale*32767) for v in signal))
    if sys.byteorder != 'little':
        pcm.byteswap()
    return pcm.tobytes()


def compose(score_path=ROOT/'assets/audio/score.json', output_root=ROOT):
    score_path, output_root = Path(score_path), Path(output_root)
    score = json.loads(score_path.read_text())
    rate = score['sampleRate']
    assert rate == 22050 and score['bars'] > 0
    assets = output_root/'assets'
    out = assets/'audio'
    out.mkdir(parents=True, exist_ok=True)
    entries = {}
    events = []
    for name in AUDIO_KEYS:
        loop = name in ('music', 'rolling', 'grind')
        if name == 'music':
            signal, events = music(score)
        elif name == 'rolling':
            signal = rolling(score)
        elif loop:
            signal = grind(score)
        else:
            signal = effect(name, score)
        data = finalize(signal, score['outputPeaks'][name], loop)
        path = out/(name+'.wav')
        with wave.open(str(path), 'wb') as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(rate)
            writer.writeframes(data)
        duration = len(data)/2/rate
        entries[name] = dict(path='assets/audio/'+name+'.wav', loop=loop,
                             gain=score['runtimeGains'][name], loopStart=0.0,
                             loopEnd=duration if loop else 0.0,
                             duration=duration, sha256=digest(path.read_bytes()))
    (out/'score.json').write_bytes(score_path.read_bytes())
    (out/'events.json').write_text(json.dumps(events, indent=2, sort_keys=True)+'\n')
    manifest_path = assets/'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.setdefault('images', {})
    manifest['audio'] = entries
    manifest.setdefault('provenance', {})['audio'] = {
        'origin': 'Original score and procedural synthesis; no recordings or external media.',
        'composer': 'scripts/compose_audio.py', 'score': 'assets/audio/score.json',
        'scoreSha256': digest(score_path.read_bytes()), 'events': 'assets/audio/events.json',
        'title': score['title'], 'bpm': score['bpm'], 'bars': score['bars'],
        'seed': score['seed'], 'sampleRate': rate, 'format': 'mono signed 16-bit PCM WAV',
        'speakerAudition': False,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True)+'\n')
    print('Composed %d WAVs; music %.6fs (%d bars, %d BPM)' %
          (len(entries), entries['music']['duration'], score['bars'], score['bpm']))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--score', type=Path, default=ROOT/'assets/audio/score.json')
    parser.add_argument('--output-root', type=Path, default=ROOT)
    args = parser.parse_args()
    compose(args.score, args.output_root)

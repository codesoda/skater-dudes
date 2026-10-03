'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { lightJumpPhase } = require('./route-light-jump.js');
const { routeTarget } = require('./route-target.js');
const { shouldLoadCharge } = require('./route-charged-jump.js');
const settings = require('../settings.json');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'artifacts');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function observe(page) {
  await page.evaluate(() => {
    const { game, renderer, audio } = window.SHREDDER;
    const qa = window.qa = { keys: [], appliedKeys: [], frames: [], events: [], starts: [], poses: [], meters: [] };
    const applyKey = game.key.bind(game);
    game.key = (key, down) => {
      qa.appliedKeys.push({ key, down, time: game.time, speed: game.currentSpeed,
        x: game.worldX, z: game.jumpZ, mode: game.mode, surface: game.surface,
        charge: game.charge, spaceAt: game.space?.at });
      return applyKey(key, down);
    };
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, e => {
      qa.keys.push({ type, code: e.code, trusted: e.isTrusted, repeat: e.repeat, at: performance.now() });
    });
    const emit = game.emit.bind(game);
    game.emit = (type, detail) => { qa.events.push({ type, x: game.worldX, z: game.jumpZ, surface: game.surface, time: game.time }); return emit(type, detail); };
    const start = audio.start.bind(audio);
    audio.start = (...args) => { const item = start(...args); if (item) qa.starts.push({ key: item.key, loop: item.loop, mode: game.mode, time: game.time }); return item; };
    const meters = renderer.meters.bind(renderer), rect = renderer.ctx.fillRect.bind(renderer.ctx);
    renderer.meters = (...args) => {
      qa.meters = [];
      renderer.ctx.fillRect = (...rectArgs) => { qa.meters.push(rectArgs); return rect(...rectArgs); };
      try { meters(...args); } finally { renderer.ctx.fillRect = rect; }
    };
    const sprite = renderer.sprite.bind(renderer);
    renderer.sprite = (key, ...args) => {
      // Keep body/board evidence, not street props that evict flip frames at 120 Hz.
      if (/^(skater_|dave_|board_)/.test(key)) qa.poses.push({ key, mode: game.mode, at: game.time });
      if (/^(skater_|dave_)/.test(key)) {
        const body = renderer.data.images[key];
        qa.bodyTop = renderer.ctx.getTransform().f + args[1] - body.anchor[1] * body.drawHeight / body.height;
      }
      return sprite(key, ...args);
    };
    function sample(at) {
      qa.frames.push({ at, time: game.time, x: game.worldX, z: game.jumpZ, mode: game.mode,
        speed: game.currentSpeed, loops: [...audio.loops.keys()], gauge: game.chargeVisible, balance: game.balanceActive, meters: qa.meters });
      if (qa.frames.length > 12000) qa.frames.shift();
      if (qa.poses.length > 1000) qa.poses.splice(0, 500);
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}
async function state(page) {
  return page.evaluate(() => {
    const g = window.SHREDDER.game;
    const support = g.surface && g.objects.flatMap(o => g.solidParts(o)).find(o => o.id === g.surface);
    return { supportEnd: support ? support.x + support.width + g.cfg.boardHalfWidth : null,
      speed: g.currentSpeed, time: g.time, x: g.worldX, z: g.jumpZ, lane: g.laneY, velocity: g.velocityZ, mode: g.mode,
      surface: g.surface, status: g.status, charge: g.charge, gauge: g.chargeVisible, flip: g.flip,
      balance: g.balance, balanceActive: g.balanceActive, bails: g.bails, score: g.score,
      combo: g.combo, bestCombo: g.bestCombo, checkpoint: g.checkpoint, message: g.message, character: g.characterId };
  });
}
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png') }); }
async function routeEvidence(page, name, run) {
  const captures = [];
  // Start actual runtime screenshots here, but never wait for their roundtrips
  // between input decisions. Attach rejection handlers now and check after play.
  const capture = label => captures.push(shot(page, label).then(() => null, error => error));
  try {
    await run(capture);
    for (const error of await Promise.all(captures)) if (error) throw error;
  } catch (error) {
    const evidence = { error: error.stack };
    try {
      evidence.state = await state(page);
      evidence.history = await page.evaluate(() => ({
        frames: window.qa.frames.slice(-600), events: window.qa.events.slice(-256),
        keys: window.qa.keys.slice(-256), appliedKeys: window.qa.appliedKeys.slice(-256)
      }));
    } catch (observationError) { evidence.observationError = observationError.message; }
    const directory = path.join(OUT, 'ci-browser');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(evidence, null, 2));
    // A failed hold must not turn the next fixture's trusted down into a repeat.
    for (const code of ['Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) await page.keyboard.up(code);
    throw error;
  } finally {
    await Promise.all(captures);
  }
}
async function tap(page, key = 'Space', ms = 45) { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); }
async function restart(page) { await tap(page, 'KeyR', 5); await wait(40); }
async function until(page, predicate, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const s = await state(page); if (predicate(s)) return s; await wait(15); }
  throw new Error('Timed out waiting for state: ' + JSON.stringify(await state(page)));
}
function leftMeter(rects) {
  assert.ok(rects.some(([x, y, w, h]) => x === 34 && y === 235 && w === 22 && h === 124));
  assert.ok(rects.filter(([, , w, h]) => w === 22 && h > 20).every(([x]) => x < 250));
}
function topMeter(rects) {
  assert.ok(rects.some(([x, y, w, h]) => x === 330 && y === 80 && w === 300 && h === 16));
  assert.ok(rects.some(([x, y, w, h]) => Math.abs(x + w / 2 - 480) < .01 && y === 80 && w === 75 && h === 16));
}

async function nearSkaterMeter(page) {
  const { rects, bodyTop, center } = await page.evaluate(() => ({
    rects: window.qa.meters, bodyTop: window.qa.bodyTop, center: window.SHREDDER.game.cfg.playerScreenX
  }));
  const panel = rects.find(([, , w, h]) => w === 180 && h === 56);
  assert.ok(panel); assert.equal(panel[0] + 90, center);
  // Canvas stores transforms at float precision; tolerate less than 1/1000 px.
  assert.ok(Math.abs(panel[1] + 64 - bodyTop) < .001, JSON.stringify({ panel, bodyTop }));
  assert.ok(rects.some(([x, y, w, h]) => x === center - 72 && y === panel[1] + 24 && w === 144 && h === 10));
  assert.ok(rects.some(([x, y, w, h]) => x + w / 2 === center && y === panel[1] + 24 && w === 36 && h === 10));
  assert.ok(!rects.some(([, , w, h]) => w === 350 && h === 93));
}

test('offline Chrome: trusted controls, rendering, audio, responsiveness and complete real-time route', { timeout: 180000 }, async t => {
  fs.mkdirSync(path.join(OUT, 'speed-obstacles-audio'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'elevated-lines-grinds'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'balance-position'), { recursive: true });
  const requested = process.env.SHREDDER_BROWSER;
  const channel = requested === 'chromium-headless-shell' ? undefined :
    requested || (fs.existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined);
  const browser = await chromium.launch({ headless: true, channel });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, offline: true });
  const errors = [], network = [];
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  });
  t.after(async () => { await browser.close(); });
  const page = await context.newPage();
  await page.goto(URL); await page.getByRole('button', { name: 'Practice first', exact: true }).waitFor();
  await observe(page);

  await t.test('title loads 49 embedded PNGs offline without autoplay', async () => {
    assert.deepEqual(await page.evaluate(() => [Object.keys(window.SHREDDER.renderer.images).length, window.SHREDDER.audio.ctx]), [49, null]);
    await shot(page, 'title');
    await page.getByRole('button', { name: 'Practice first', exact: true }).click();
    assert.equal(await page.evaluate(() => window.SHREDDER.game.practice), true);
    await shot(page, 'beltstreet');
  });
  await t.test('fresh trusted short Space tap jumps only on release, never draws a charge bar', async () => {
    await restart(page);
    const begin = await page.evaluate(() => window.qa.frames.length);
    await page.keyboard.down('Space'); await wait(65);
    assert.equal((await state(page)).mode, 'rolling');
    await page.keyboard.up('Space'); await wait(80);
    const s = await state(page); assert.equal(s.mode, 'air'); assert.ok(s.z > 0 && s.z < 56); assert.equal(s.gauge, false);
    const frames = await page.evaluate(i => window.qa.frames.slice(i), begin);
    assert.ok(frames.length >= 4); assert.ok(frames.every(f => !f.gauge && f.meters.length === 0));
    const keys = await page.evaluate(() => window.qa.keys.filter(k => k.code === 'Space').slice(-2));
    assert.ok(keys.every(k => k.trusted)); assert.ok(keys[1].at - keys[0].at < 120);
    await shot(page, 'smallollie');
    await until(page, s => s.mode === 'rolling');
  });
  await t.test('450 ms reveals the delayed left meter; full charge waits for release and jumps once', async () => {
    await restart(page);
    const before = await page.evaluate(() => window.qa.events.filter(e => e.type === 'ollie').length);
    await page.keyboard.down('Space'); await wait(200);
    assert.equal((await state(page)).gauge, false);
    assert.equal(await page.evaluate(() => window.SHREDDER.game.crouching), false);
    await wait(255);
    let s = await state(page); assert.ok(s.gauge); assert.equal(s.z, 0); assert.ok(s.charge >= .2 && s.charge < .5);
    leftMeter(await page.evaluate(() => window.qa.meters)); await shot(page, 'delayedchargeleft');
    await wait(650); s = await state(page);
    assert.equal(s.mode, 'rolling'); assert.equal(s.z, 0); assert.equal(s.charge, 1);
    assert.equal(await page.evaluate(() => window.qa.events.filter(e => e.type === 'ollie').length), before);
    await shot(page, 'fullchargeheld'); await page.keyboard.up('Space');
    s = await until(page, s => s.mode === 'air'); assert.equal(s.gauge, false); assert.equal(s.charge, 0);
    assert.equal(await page.evaluate(() => window.qa.events.filter(e => e.type === 'ollie').length), before + 1);
    await wait(300); s = await state(page); assert.ok(s.z > 140);
    await shot(page, 'bigpop'); await until(page, s => s.mode === 'rolling');
  });
  await t.test('help, pause, blur, visibility loss and restart cancel held charge without a pop', async () => {
    for (const action of ['KeyI', 'KeyP', 'blur', 'visibility', 'KeyR']) {
      await restart(page);
      const before = await page.evaluate(() => window.qa.events.filter(e => e.type === 'ollie').length);
      await page.keyboard.down('Space'); await wait(450); assert.equal((await state(page)).gauge, true);
      if (action === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else if (action === 'visibility') await page.evaluate(() => {
        // Explicit visibility-loss fixture; never changes gameplay state.
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;
      });
      else await tap(page, action, 5);
      await page.keyboard.up('Space'); await wait(40);
      let s = await state(page); assert.equal(s.gauge, false); assert.equal(s.charge, 0); assert.equal(s.z, 0);
      if (action !== 'KeyR') {
        assert.equal(s.status, 'paused'); await tap(page, action === 'KeyI' ? 'KeyI' : 'KeyP', 5);
      }
      await wait(80); s = await state(page); assert.equal(s.mode, 'rolling'); assert.equal(s.gauge, false);
      assert.equal(await page.evaluate(() => window.qa.events.filter(e => e.type === 'ollie').length), before);
    }
  });
  await t.test('autorepeated airborne Space cannot produce a second jump at landing', async () => {
    await restart(page); const before = await page.evaluate(() => window.qa.events.filter(e => e.type === 'ollie').length);
    await tap(page); await page.keyboard.down('Space'); await wait(150); await page.keyboard.down('Space');
    await wait(500); await page.keyboard.down('Space'); await wait(80);
    assert.equal((await state(page)).z, 0); await page.keyboard.up('Space'); await wait(50);
    assert.equal(await page.evaluate(() => window.qa.events.filter(e => e.type === 'ollie').length), before + 1);
    assert.ok(await page.evaluate(() => window.qa.keys.some(k => k.code === 'Space' && k.repeat && k.trusted)));
  });
  await t.test('Down-Up air flip draws top-center balance, separate rotating board and catch, then banks', async () => {
    await restart(page); await tap(page); await tap(page, 'ArrowDown', 10); await tap(page, 'ArrowUp', 10); await wait(40);
    const s = await state(page); assert.ok(s.flip); assert.equal(s.balanceActive, true); assert.equal(s.lane, 0);
    topMeter(await page.evaluate(() => window.qa.meters)); await shot(page, 'fliptopbalance');
    await until(page, s => s.mode === 'rolling'); await wait(480); assert.ok((await state(page)).score >= 180);
    const poses = await page.evaluate(() => window.qa.poses.map(p => p.key));
    for (const pose of ['board_flip', 'board_edge', 'skater_flip', 'skater_catch']) assert.ok(poses.includes(pose), pose);
  });
  await t.test('bad flip balance fails on landing and recovers; manual balance responds and banks', async () => {
    await restart(page); await tap(page); await tap(page, 'ArrowDown', 5); await tap(page, 'ArrowUp', 5); await page.keyboard.down('ArrowRight');
    await until(page, s => s.mode === 'crash'); await page.keyboard.up('ArrowRight');
    assert.match((await state(page)).message, /safe zone/); await shot(page, 'crash');
    await until(page, s => s.mode === 'rolling'); assert.equal((await state(page)).bails, 1);
    await page.keyboard.down('ArrowUp'); await wait(160); await nearSkaterMeter(page);
    await shot(page, 'balance-position/trusted-manual-desktop');
    const before = (await state(page)).balance; await page.keyboard.down('ArrowLeft'); await wait(100); await page.keyboard.up('ArrowLeft');
    assert.ok((await state(page)).balance < before); await shot(page, 'manual');
    await page.keyboard.up('ArrowUp'); await wait(500); assert.ok((await state(page)).score >= 60);
  });
  await t.test('nine independently decoded WAVs retain source identity, loop boundaries and bounded peaks', async () => {
    await page.waitForFunction(() => window.SHREDDER.audio.decoded);
    const audio = await page.evaluate(() => {
      const a = window.SHREDDER.audio;
      const metadata = Object.fromEntries(Object.entries(a.data).map(([key, asset]) => {
        const { src, ...entry } = asset;
        return [key, { ...entry, embedded: src.startsWith('data:audio/wav;base64,') }];
      }));
      return { failures: a.decodeFailures, bus: a.sfx.gain.value, metadata,
        provenance: window.SHREDDER_DATA.provenance.audio,
        buffers: Object.entries(a.buffers).map(([key, b]) => {
          const samples = b.getChannelData(0); let peak = 0, energy = 0;
          for (const value of samples) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
          // Compare noise changes over one source-frame interval. Upsampling
          // interpolates interior steps but does not interpolate across the join.
          const sourceFrame = Math.max(1, Math.ceil(b.sampleRate / 22050));
          const steps = key === 'rolling' ? Array.from(samples.subarray(sourceFrame), (value, i) => Math.abs(value - samples[i])).sort((a, b) => a - b) : [];
          return { key, sampleRate: b.sampleRate, sourceFrame, stepP99: steps[Math.floor(.99 * steps.length)], duration: b.duration, channels: b.numberOfChannels, peak, rms: Math.sqrt(energy / samples.length), seam: Math.abs(samples[0] - samples[samples.length - 1]) };
        }),
        loops: [...a.loops].map(([key, n]) => ({ key, identity: n.source.buffer === a.buffers[key], loop: n.source.loop, end: n.source.loopEnd })) };
    });
    assert.equal(audio.failures, 0); assert.equal(audio.buffers.length, 9); assert.equal(audio.bus, .25);
    for (const b of audio.buffers) { assert.equal(b.channels, 1); assert.ok(b.peak <= .660001 && b.rms > .001, b.key); }
    for (const loop of audio.loops) { assert.equal(loop.identity, true); assert.equal(loop.loop, true); assert.ok(loop.end > 0); }
    const manifest = require('../assets/manifest.json');
    assert.deepEqual(audio.buffers.map(b => b.key).sort(), Object.keys(manifest.audio).sort());
    for (const [key, entry] of Object.entries(manifest.audio)) {
      const { path, ...expected } = entry;
      assert.deepEqual(audio.metadata[key], { ...expected, embedded: true });
    }
    assert.deepEqual(audio.loops.map(l => l.key), ['music']);
    assert.equal(audio.provenance.title, 'Sidewalk Pocket');
    assert.equal(audio.provenance.bpm, 90); assert.equal(audio.provenance.bars, 4);
    assert.equal(audio.metadata.music.gain, .30);
    assert.equal(audio.metadata.rolling.duration, 1.6);
    assert.ok(audio.loops.some(l => l.key === 'music' && Math.abs(l.end - 4 * 4 * 60 / 90) < .000001));
    for (const key of ['music', 'grind']) assert.ok(audio.buffers.find(b => b.key === key).seam < .04);
    const rolling = audio.buffers.find(b => b.key === 'rolling');
    assert.ok(rolling.seam < rolling.stepP99, JSON.stringify(rolling));
    fs.writeFileSync(path.join(OUT, 'decoded-audio.json'), JSON.stringify(audio, null, 2));
  });
  await t.test('four-voice SFX bus stays bounded during an explicitly labeled cue-burst fixture', async () => {
    const result = await page.evaluate(() => {
      const a = window.SHREDDER.audio;
      for (let i = 0; i < 24; i++) a.cues.push({ key: 'crash', volume: 1, at: a.now() });
      a.flush();
      const sfx = [...a.nodes].filter(n => !n.loop);
      // Only music and grind can run; the legacy rolling buffer is never started.
      const assets = window.SHREDDER_DATA.audio;
      const maxEffect = Math.max(...Object.values(assets).filter(v => !v.loop).map(v => v.gain));
      return { count: sfx.length, bound: a.master.gain.value * .66 * (assets.music.gain + assets.grind.gain + 4 * maxEffect * a.sfx.gain.value) };
    });
    assert.equal(result.count, 4); assert.ok(result.bound < .94);
  });
  await t.test('music source stays stable; mute, pause and focus-loss handling stop and resume audio safely', async () => {
    await page.evaluate(() => { window.qa.music = window.SHREDDER.audio.loops.get('music'); }); await wait(120);
    assert.equal(await page.evaluate(() => window.qa.music === window.SHREDDER.audio.loops.get('music')), true);
    await tap(page, 'KeyM', 5); await wait(150);
    assert.equal(await page.evaluate(() => window.SHREDDER.audio.nodes.size), 0);
    await tap(page, 'KeyM', 5); await page.waitForFunction(() => window.SHREDDER.audio.loops.has('music'));
    await tap(page, 'KeyP', 5); await wait(120);
    assert.equal((await state(page)).status, 'paused'); assert.equal(await page.evaluate(() => window.SHREDDER.audio.ctx.state), 'suspended');
    await tap(page, 'KeyP', 5); await page.waitForFunction(() => window.SHREDDER.audio.loops.has('music'));
    // CDP focus emulation sends a browser focus-loss event, not a gameplay fixture.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
    // Headless Chrome may keep pages visible; window.blur is tested separately if so.
    await wait(100);
    const syntheticBlur = (await state(page)).status !== 'paused';
    if (syntheticBlur) await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    fs.writeFileSync(path.join(OUT, 'focus-evidence.json'), JSON.stringify({ syntheticBlurFallback: syntheticBlur }));
    assert.equal((await state(page)).status, 'paused'); await wait(120);
    assert.equal(await page.evaluate(() => window.SHREDDER.audio.nodes.size), 0);
    await other.close(); await page.bringToFront();
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await cdp.detach(); await tap(page, 'KeyP', 5);
  });
  await t.test('normal-clock rAF sample runs a 60 Hz fixed simulation', async () => {
    await restart(page); const index = await page.evaluate(() => window.qa.frames.length); await wait(2100);
    const frames = await page.evaluate(i => window.qa.frames.slice(i), index);
    const wall = (frames.at(-1).at - frames[0].at) / 1000, sim = frames.at(-1).time - frames[0].time;
    const intervals = frames.slice(1).map((f, i) => f.at - frames[i].at).sort((a, b) => a - b);
    const perf = { wallSeconds: wall, simulationSeconds: sim, frames: frames.length, medianFrameMs: intervals[Math.floor(intervals.length / 2)], p95FrameMs: intervals[Math.floor(intervals.length * .95)], fixedHz: 60 };
    fs.writeFileSync(path.join(OUT, 'performance.json'), JSON.stringify(perf, null, 2));
    assert.ok(wall >= 1.9); assert.ok(Math.abs(sim - wall) < .1); assert.ok(perf.medianFrameMs < 25, JSON.stringify(perf));
  });
  await t.test('full route: trusted browser keys, all hazards, rail and ledge catches, no teleports, proper finish', { timeout: 105000 }, async () => routeEvidence(page, 'full-route', async capture => {
    await tap(page, 'KeyP', 5); await page.getByRole('button', { name: 'Ride the route', exact: true }).click();
    const objects = await page.evaluate(() => window.SHREDDER.game.objects);
    const startEvent = await page.evaluate(() => window.qa.events.length);
    const startKey = await page.evaluate(() => window.qa.keys.length);
    const startAppliedKey = await page.evaluate(() => window.qa.appliedKeys.length);
    const wallStart = Date.now(), crossed = new Set(), held = new Set();
    let target = '', phase = '', flipDone = false, railShot = false;
    const speedSamples = [], lightJumps = [], screenshots = new Set(), elevatedShots = new Set(), ridden = new Set();
    async function key(code, down) {
      if (held.has(code) === down) return;
      if (down) { await page.keyboard.down(code); held.add(code); }
      else { await page.keyboard.up(code); held.delete(code); }
    }
    let s;
    while (Date.now() - wallStart < 100000) {
      s = await state(page); if (s.status === 'finished') break;
      assert.notEqual(s.mode, 'crash', `Bail at ${s.x}: ${s.message}`);
      const o = routeTarget(objects, s, target);
      if (o && o.id !== target) { target = o.id; phase = ''; flipDone = false; }
      const distance = o ? o.x - s.x : Infinity;
      // Trusted speed segment on the opening flat, then release and coast.
      await key('ArrowRight', s.x >= 100 && s.x < 850);
      if (s.time < 12) speedSamples.push({ x: s.x, time: s.time, speed: s.speed, mode: s.mode });
      await key('ArrowDown', o?.type === 'low_bar' && distance < 150);
      if (o && o.type !== 'low_bar' && ['rolling', 'manual'].includes(s.mode)) {
        if (!phase && shouldLoadCharge(o, s, settings)) { await key('Space', true); phase = 'loading'; }
        if (phase === 'loading' && distance <= (o.popDistance || 110) + 12) {
          assert.equal(s.charge, 1); await key('Space', false); phase = 'jumped';
        }
        if (!o.charged) {
          const next = lightJumpPhase(phase, distance, s.speed);
          if (next !== phase) {
            assert.equal(s.charge, 0); assert.equal(s.gauge, false);
            await key('Space', next === 'light-ready');
            lightJumps.push({ id: o.id, phase: next, distance, time: s.time, speed: s.speed });
            phase = next;
          }
        }
      }
      if (s.mode === 'air' && phase === 'jumped' && !flipDone && !['rail', 'ledge'].includes(o?.type)) {
        await tap(page, 'ArrowDown', 2); await tap(page, 'ArrowUp', 2); flipDone = true;
      }
      await key('ArrowUp', s.mode === 'air' && (o?.type === 'rail' || o?.type === 'ledge' && o.intent !== 'ride'));
      await key('ArrowLeft', s.balanceActive && s.balance > .04);
      for (const obj of objects) if (s.x > obj.x + obj.width + 22) crossed.add(obj.id);
      if (s.mode === 'grind' && !railShot) {
        assert.equal(await page.evaluate(() => window.SHREDDER.audio.loops.has('grind')), true);
        await nearSkaterMeter(page);
        capture('railgrind'); capture('balance-position/trusted-grind-desktop'); railShot = true;
      }
      if (s.mode === 'rolling' && s.surface) ridden.add(s.surface);
      const elevated = s.mode === 'rolling' && s.surface === 'transfer-ledge' && s.x > 17600 ? 'rideledge' :
        s.mode === 'rolling' && s.surface === 'climb-3' && s.x > 12300 ? 'fourtier' :
        s.surface?.startsWith('climb-down:') ? 'stairs' : s.mode === 'grind' && s.surface === 'transfer-rail' ? 'lockedrail' : null;
      if (elevated && !elevatedShots.has(elevated)) {
        capture('elevated-lines-grinds/' + elevated); elevatedShots.add(elevated);
      }
      const art = o?.type;
      if (!screenshots.has(art) && ((['jersey_barrier', 'gap'].includes(art) && distance > 200 && distance < 320) ||
          (art === 'low_bar' && s.x > o.x + 30 && s.x < o.x + o.width - 20))) {
        capture('speed-obstacles-audio/' + art); screenshots.add(art);
      }
      await wait(12);
    }
    for (const code of held) await page.keyboard.up(code);
    if (s.status !== 'finished') {
      const frames = await page.evaluate(() => window.qa.frames);
      fs.writeFileSync(path.join(OUT, 'elevated-lines-grinds/route-timeout.json'), JSON.stringify({ state: s, wallMs: Date.now() - wallStart, frames }, null, 2));
    }
    assert.equal(s.status, 'finished', JSON.stringify(s)); assert.equal(s.bails, 0); assert.equal(crossed.size, objects.length);
    assert.ok(s.score > 1000); assert.equal(railShot, true);
    assert.equal(elevatedShots.size, 4);
    for (const id of ['climb-1', 'climb-2', 'climb-3', 'climb-4', 'transfer-ledge']) assert.ok(ridden.has(id), id);
    assert.equal([...ridden].filter(id => id.startsWith('climb-down:')).length, 11);
    const spaceKeys = await page.evaluate(i => window.qa.keys.slice(i).filter(k => k.code === 'Space'), startKey);
    const jumps = objects.filter(o => !['crack', 'low_bar'].includes(o.type) && o.direction !== 'down');
    assert.equal(spaceKeys.length, jumps.length * 2);
    const lightHolds = [];
    for (const [i, o] of jumps.entries()) {
      const [down, up] = spaceKeys.slice(i * 2, i * 2 + 2);
      assert.ok(down.trusted && up.trusted && !down.repeat && !up.repeat);
      assert.equal(down.type, 'keydown'); assert.equal(up.type, 'keyup');
      if (!o.charged) {
        const heldMs = up.at - down.at;
        assert.ok(heldMs > 0 && heldMs < 300, `${o.id}: light hold ${heldMs} ms`);
        lightHolds.push({ id: o.id, heldMs });
      }
    }
    fs.mkdirSync(path.join(OUT, 'browser-retry'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'browser-retry/light-jumps.json'), JSON.stringify({ lightJumps, lightHolds }, null, 2));
    const events = await page.evaluate(i => window.qa.events.slice(i), startEvent);
    assert.ok(events.filter(e => e.type === 'grind').length >= 3);
    const climbPops = events.filter(e => e.type === 'ollie' && e.x > 9500 && e.x < 13660);
    assert.deepEqual(climbPops.map(e => e.z), [0, 60, 120, 180]);
    assert.ok(events.some(e => e.type === 'grind' && e.surface === 'transfer-rail'));
    assert.ok(!events.some(e => e.type === 'grind' && e.surface === 'transfer-ledge'));
    fs.writeFileSync(path.join(OUT, 'elevated-lines-grinds/trusted-route.json'), JSON.stringify({
      bails: s.bails, status: s.status, climbPops, ridden: [...ridden], screenshots: [...elevatedShots],
      controller: 'Trusted keyboard, read-only support-aware feedback, normal clock, no state writes'
    }, null, 2));
    assert.ok(events.filter(e => e.type === 'flip').length >= 8);
    assert.ok(events.some(e => e.type === 'crack')); assert.ok(events.some(e => e.type === 'finish'));
    assert.ok(Date.now() - wallStart >= 85000); assert.ok(s.time < 90 && s.time > 85);
    assert.deepEqual([...screenshots].sort(), ['gap', 'jersey_barrier', 'low_bar']);
    assert.ok(speedSamples.some(p => p.speed > 280 && p.speed < 392 && p.x < 500));
    assert.ok(speedSamples.some(p => Math.abs(p.speed - 392) < 1e-8));
    assert.ok(speedSamples.some(p => p.x > 850 && p.speed > 280 && p.speed < 392));
    // Observe when the queued keyup reaches the simulation, not the earlier poll.
    const release = await page.evaluate(i => window.qa.appliedKeys.slice(i).find(k => k.key === 'Right' && !k.down), startAppliedKey);
    assert.ok(release); assert.ok(Math.abs(release.speed - 392) < 1e-8);
    const coast = speedSamples.filter(p => p.time >= release.time);
    const atBase = coast.find(p => p.speed === 280);
    assert.ok(atBase, 'normal coast reaches base within the observed window');
    const returnToBaseSeconds = atBase.time - release.time;
    assert.ok(returnToBaseSeconds >= 6 && returnToBaseSeconds <= 10);
    assert.ok(returnToBaseSeconds >= 8 - 1e-7, 'no premature return to base');
    assert.ok(coast.some(p => p.time - release.time >= 8 && p.speed === 280));
    for (const [i, p] of coast.entries()) {
      assert.notEqual(p.mode, 'grind', 'opening coast is an all-normal-coast measurement');
      const expected = Math.max(280, release.speed - 14 * (p.time - release.time));
      assert.ok(Math.abs(p.speed - expected) < 1e-7, `smooth coast: ${p.speed} != ${expected}`);
      if (i) assert.ok(p.speed <= coast[i - 1].speed);
    }
    fs.writeFileSync(path.join(OUT, 'speed-obstacles-audio/trusted-speed.json'), JSON.stringify({ release, returnToBaseSeconds, samples: speedSamples }, null, 2));
    const audioStarts = await page.evaluate(() => window.qa.starts);
    assert.ok(audioStarts.every(a => a.key !== 'rolling'));
    assert.ok(audioStarts.filter(a => a.key === 'grind').every(a => a.mode === 'grind'));
    const routeFrames = await page.evaluate(() => window.qa.frames);
    assert.ok(routeFrames.filter(f => f.mode === 'air' || f.mode === 'rolling').every(f => !f.loops.includes('grind')));
    await shot(page, 'finish');
    fs.writeFileSync(path.join(OUT, 'route.json'), JSON.stringify({ ...s, meaningfulHazards: objects.filter(o => o.type !== 'crack').length, duckBars: objects.filter(o => o.type === 'low_bar').length, boostedOpening: true, wallSeconds: (Date.now() - wallStart) / 1000, crossed: crossed.size, events, controller: 'Playwright trusted keyboard; read-only state feedback; normal clock; no teleport or game-state mutation' }, null, 2));
  }));
  await t.test('real decoded concrete bitmap tiles the full shelf without stretching', async () => {
    const evidence = await page.evaluate(() => {
      // Explicit offscreen renderer fixture, not a route or player-state fixture.
      const live = window.SHREDDER.renderer, canvas = document.createElement('canvas');
      canvas.width = 1600; canvas.height = 300;
      const r = new window.ShredderRenderer.Renderer(canvas, live.data); r.images = live.images;
      r.ctx.imageSmoothingEnabled = false;
      const draws = [], draw = r.ctx.drawImage.bind(r.ctx);
      r.ctx.drawImage = (image, ...args) => {
        draws.push({ decoded: image instanceof HTMLImageElement && image.complete && image.naturalWidth === 273, args });
        draw(image, ...args);
      };
      r.concreteBlock({ width: 1600, height: 60 }, 0, 100);
      const pixels = r.ctx.getImageData(0, 40, 1600, 60).data, colors = new Set(); let opaque = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i+3]) opaque++;
        colors.add([pixels[i], pixels[i+1], pixels[i+2]].join(','));
      }
      return { draws, opaque, colors: colors.size, pixels: pixels.length / 4 };
    });
    assert.ok(evidence.draws.length > 20); assert.ok(evidence.draws.every(d => d.decoded));
    for (const { args } of evidence.draws) {
      assert.ok(Math.abs(args[6] / args[2] - .7) < 1e-8);
      assert.ok(Math.abs(args[7] / args[3] - .7) < 1e-8);
    }
    assert.ok(evidence.colors > 20); assert.ok(evidence.opaque > evidence.pixels * .95);
    fs.writeFileSync(path.join(OUT, 'elevated-lines-grinds/bitmap-tiling.json'), JSON.stringify(evidence, null, 2));
  });
  await t.test('first real collision retries from zero despite the decorative checkpoint', async () => {
    await restart(page);
    const crash = await until(page, s => s.mode === 'crash', 8500);
    assert.equal(crash.checkpoint, 1400); assert.equal(crash.bails, 1); assert.equal(crash.combo, 0);
    const recovered = await until(page, s => s.mode === 'rolling');
    assert.ok(recovered.x >= 0 && recovered.x < 30); assert.equal(recovered.z, 0);
    await tap(page, 'KeyP', 5);
  });
  await t.test('Dave clears the curb, hits the next cone and retries just past the curb with preparation time', async () => routeEvidence(page, 'dave-curb-retry', async () => {
    await page.getByRole('button', { name: 'Choose dude', exact: true }).click();
    await page.getByRole('radio', { name: 'Dave', exact: true }).check();
    await page.getByRole('button', { name: 'Ride the street', exact: false }).click();
    const startEvent = await page.evaluate(() => window.qa.events.length);
    const startKey = await page.evaluate(() => window.qa.keys.length);
    const curb = await page.evaluate(() => window.SHREDDER.game.objects.find(o => o.id === 'hazard-0'));
    let phase = '';
    for (const next of ['light-ready', 'jumped']) {
      const s = await until(page, s => ['rolling', 'manual'].includes(s.mode) &&
        lightJumpPhase(phase, curb.x - s.x, s.speed) === next, 8000);
      assert.equal(s.bails, 0); assert.equal(s.charge, 0); assert.equal(s.gauge, false);
      if (next === 'light-ready') await page.keyboard.down('Space');
      else await page.keyboard.up('Space');
      phase = next;
    }
    const spaceKeys = await page.evaluate(i => window.qa.keys.slice(i).filter(k => k.code === 'Space'), startKey);
    assert.equal(spaceKeys.length, 2);
    const [down, up] = spaceKeys;
    assert.equal(down.type, 'keydown'); assert.equal(up.type, 'keyup');
    assert.ok(down.trusted && up.trusted && !down.repeat && !up.repeat);
    assert.ok(up.at - down.at > 0 && up.at - down.at < settings.tapThreshold * 1000,
      `Dave curb light hold: ${up.at - down.at} ms`);
    await until(page, s => s.x > 2200, 2500);
    const banked = await state(page); assert.equal(banked.bails, 0); assert.ok(banked.score > 0);
    await until(page, s => s.x >= 2580, 2500); await page.keyboard.down('ArrowUp');
    await until(page, s => s.mode === 'manual');
    const crash = await until(page, s => s.mode === 'crash'); await page.keyboard.up('ArrowUp');
    assert.equal(crash.combo, 0); assert.equal(crash.score, banked.score); assert.equal(crash.character, 'dave');
    const recovered = await until(page, s => s.mode === 'rolling');
    const events = await page.evaluate(i => window.qa.events.slice(i), startEvent);
    const retry = events.find(e => e.type === 'recover');
    assert.equal(retry.x, 1900 + 28 + 22 + 8); assert.ok(retry.x < crash.x);
    assert.equal(recovered.z, 0); assert.equal(recovered.character, 'dave');
    assert.equal(recovered.bestCombo, banked.bestCombo);
    assert.equal(await page.evaluate(() => window.SHREDDER.game.hazards.some(o => window.SHREDDER.game.overlapping(o))), false);
    const approachSeconds = (2700 - 22 - retry.x) / 280; assert.ok(approachSeconds >= 1.4);
    const nextCrash = await until(page, s => s.mode === 'crash', 4000);
    const collisions = (await page.evaluate(i => window.qa.events.slice(i), startEvent)).filter(e => e.type === 'crash');
    assert.equal(collisions.length, 2); assert.ok(collisions[1].time - retry.time >= 1.4);
    assert.equal(nextCrash.bails, 2); assert.ok(Math.abs(nextCrash.x - crash.x) < 10);
    fs.mkdirSync(path.join(OUT, 'playtest-tuning'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'playtest-tuning/retry.json'), JSON.stringify({
      character: 'dave', cleared: 'hazard-0', failed: 'hazard-1', retryX: retry.x, approachSeconds,
      lightHoldMs: up.at - down.at, spaceKeys,
      measuredSecondsToNextCollision: collisions[1].time - retry.time, bankedScore: banked.score,
      controller: 'Trusted keyboard from route start; real curb ollie and cone collisions; no position fixtures'
    }, null, 2));
    await tap(page, 'KeyP', 5);
  }));
  await t.test('responsive title and accessible practice at mobile, tablet and desktop sizes', async () => {
    for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
      const responsive = await context.newPage(); await responsive.setViewportSize({ width, height }); await responsive.goto(URL);
      const practice = responsive.getByRole('button', { name: 'Practice first', exact: true }); await practice.waitFor();
      assert.ok(await responsive.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const title = await responsive.getByRole('heading', { name: 'SKATER DUDES', exact: true }).boundingBox();
      assert.ok(title.y >= 0 && title.x >= 0);
      if (width === 390) await shot(responsive, 'mobile');
      await practice.click(); assert.equal((await state(responsive)).status, 'playing');
      const box = await responsive.locator('#game').boundingBox(); assert.ok(Math.abs(box.width / box.height - 16 / 9) < .02);
      await responsive.close();
    }
  });
  await t.test('compact balance stays bounded on phone and desktop in labeled render-only fixtures', async () => {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const fixturePage = await context.newPage(); await fixturePage.setViewportSize({ width, height });
      await fixturePage.goto(URL); await fixturePage.getByRole('button', { name: 'Practice first', exact: true }).click();
      for (const characterId of ['jeff', 'dave']) for (const mode of ['manual', 'grind']) {
        const geometry = await fixturePage.evaluate(({ characterId, mode }) => {
          const { game, renderer } = window.SHREDDER;
          // Clone for rendering only. Never change live physics, input or route state.
          const jumpZ = mode === 'grind' ? 120 : 0, laneY = 12;
          const fixture = Object.assign(Object.create(Object.getPrototypeOf(game)), game, {
            mode, jumpZ, laneY, balance: .3, unsafeTime: .1, flip: null,
            time: 1, grindAt: .8, worldX: 0, previous: { worldX: 0, jumpZ, laneY }
          });
          Object.defineProperty(fixture, 'characterId', { value: characterId });
          Object.defineProperty(fixture, 'objects', { value: mode === 'grind' ?
            [{ type: 'rail', x: -80, width: 700, height: jumpZ, laneY }] : [] });
          const original = window.fixtureRender || (window.fixtureRender = renderer.render.bind(renderer));
          renderer.render = () => {
            original(fixture);
            renderer.text(`RENDER FIXTURE · ${characterId.toUpperCase()} ${mode.toUpperCase()}`, 480, 500, 12, '#ffbf66', 'center');
          };
          const rects = [], fill = renderer.ctx.fillRect.bind(renderer.ctx);
          renderer.ctx.fillRect = (...args) => { rects.push(args); fill(...args); };
          try { renderer.render(); } finally { renderer.ctx.fillRect = fill; }
          const panel = rects.find(([, , w, h]) => w === 180 && h === 56);
          const canvas = renderer.canvas.getBoundingClientRect();
          return { panel, left: canvas.left, top: canvas.top, scale: canvas.width / 960, width: innerWidth, height: innerHeight };
        }, { characterId, mode });
        const { panel, left, top, scale } = geometry; assert.ok(panel);
        assert.ok(left + panel[0] * scale >= 0 && left + (panel[0] + panel[2]) * scale <= width);
        assert.ok(top + panel[1] * scale >= 0 && top + (panel[1] + panel[3]) * scale <= height);
        await shot(fixturePage, `balance-position/fixture-${width}-${characterId}-${mode}`);
      }
      await fixturePage.close();
    }
  });
  await t.test('missing AudioContext, rejected decode and blocked resume retain playable input', async () => {
    for (const mode of ['absent', 'decode', 'resume']) {
      const fallback = await context.newPage();
      await fallback.addInitScript(mode => {
        if (mode === 'absent') { window.AudioContext = undefined; window.webkitAudioContext = undefined; }
        else if (mode === 'decode') window.AudioContext.prototype.decodeAudioData = () => Promise.reject(new Error('Test decode failure'));
        else window.AudioContext.prototype.resume = () => Promise.reject(new Error('Test autoplay block'));
      }, mode);
      await fallback.goto(URL); await fallback.getByRole('button', { name: 'Practice first', exact: true }).click();
      await tap(fallback); await until(fallback, s => s.mode === 'air');
      await fallback.waitForFunction(() => document.getElementById('audio-status').textContent.length > 0);
      await fallback.close();
    }
  });
  await t.test('essential image failure shows a safe retry; repairing the source unlocks play', async () => {
    const broken = await context.newPage();
    await broken.addInitScript(() => {
      window.breakArt = true;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) {
        descriptor.set.call(this, window.breakArt && value === window.SHREDDER_DATA?.images.skater_roll.src ? 'data:image/png;base64,broken' : value);
      } });
    });
    await broken.goto(URL); await broken.getByRole('button', { name: 'Retry artwork', exact: true }).waitFor();
    await tap(broken, 'Enter', 5); assert.equal((await state(broken)).status, 'menu');
    await broken.evaluate(() => { window.breakArt = false; });
    await broken.getByRole('button', { name: 'Retry artwork', exact: true }).click();
    await broken.getByRole('button', { name: 'Practice first', exact: true }).click();
    await tap(broken); await until(broken, s => s.mode === 'air'); await broken.close();
  });
  await t.test('no runtime errors or network attempts; gameplay keys are trusted', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    const keys = await page.evaluate(() => window.qa.keys); assert.ok(keys.length > 100); assert.ok(keys.every(k => k.trusted));
    fs.writeFileSync(path.join(OUT, 'keyboard-timings.json'), JSON.stringify(keys, null, 2));
  });
});

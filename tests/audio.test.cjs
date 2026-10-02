'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Game } = require('../web/core.js');
const settings = require('../settings.json');
const manifest = require('../assets/manifest.json');
function setup() {
  const root = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/audio.js'), 'utf8'), { window: root, performance });
  const audio = new root.ShredderAudio.Audio(manifest.audio), starts = [], stops = [];
  // Isolated source reconciliation fixture; browser tests cover Web Audio lifecycle.
  audio.start = (key, loop) => { starts.push(key); return { key, loop }; };
  audio.stop = item => { stops.push(item.key); audio.nodes.delete(item); return Promise.resolve(); };
  audio.ctx = { state: 'running', suspend: async () => { audio.ctx.state = 'suspended'; } };
  audio.setActive(true);
  const game = new Game(settings, { length: 10000, checkpoints: [0], objects: [] }); game.restart();
  const update = () => audio.update(game, game.drainEvents());
  return { game, audio, starts, stops, update };
}
test('flat rolling keeps one music loop at .30; legacy rolling never starts', () => {
  const { audio, update, starts } = setup();
  for (let n = 0; n < 100; n++) update();
  assert.deepEqual(starts, ['music']); assert.deepEqual([...audio.loops.keys()], ['music']);
  assert.equal(audio.data.music.gain, .30); assert.equal(Object.keys(audio.data).length, 9);
  assert.equal(audio.data.rolling.gain, .25);
});
test('only actual grind contact starts grind; drop/air/landing/crash stop it without duplicating music', () => {
  for (const exit of ['drop', 'pop', 'land', 'crash']) {
    const { game, audio, starts, stops, update } = setup(); update();
    // Descending collision enters real rail mode, not just holding Up near it.
    game.course.objects = [{ id: 'rail', type: 'rail', x: 20, width: 240, height: 60 }];
    game.mode = 'air'; game.jumpZ = 75; game.velocityZ = -180; game.key('Up', true); update();
    assert.deepEqual(starts, ['music']);
    for (let n = 0; n < 6; n++) game.step(1 / 60);
    assert.equal(game.mode, 'grind'); update(); update();
    assert.deepEqual(starts, ['music', 'grind']); const music = audio.loops.get('music');
    if (exit === 'drop') game.key('Down', true);
    if (exit === 'pop') game.key('Space', true);
    if (exit === 'land') game.land(0, null, -100);
    if (exit === 'crash') game.bail('fixture');
    update(); assert.deepEqual(stops, ['grind']); assert.equal(audio.loops.get('music'), music);
    assert.equal(starts.includes('rolling'), false);
    if (exit === 'land') assert.ok(audio.cues.some(cue => cue.key === 'land'));
  }
});
test('pause/mute clear contact; resuming only restarts grind when current game mode is grind', async () => {
  for (const operation of ['pause', 'mute']) {
    const { game, audio, starts, update } = setup(); game.mode = 'grind'; update();
    if (operation === 'pause') { game.pause(); audio.setActive(false); }
    else audio.setMuted(true);
    await audio.suspending; assert.equal(audio.loops.size, 0); assert.equal(audio.contact, null);
    // Explicit lifecycle fixture: browser covers suspend/resume transactions.
    game.mode = 'rolling'; game.resume(); audio.ctx.state = 'running';
    if (operation === 'pause') audio.setActive(true);
    else { audio.unlock = async () => {}; audio.setMuted(false); }
    update(); assert.deepEqual([...audio.loops.keys()], ['music']);
    assert.equal(starts.filter(k => k === 'grind').length, 1); assert.equal(starts.includes('rolling'), false);
  }
});

test('each catch queues one quiet clack, never a per-frame one-shot flood', () => {
  const { game, audio, update } = setup();
  game.course.objects = [{ id: 'steel', type: 'rail', x: 0, width: 900, height: 60 }];
  game.mode = 'air'; game.jumpZ = 65; game.velocityZ = -100; game.key('Up', true);
  for (let i = 0; i < 6; i++) { game.step(1 / 60); update(); }
  assert.equal(game.mode, 'grind');
  const clacks = audio.cues.filter(c => c.key === 'land');
  assert.equal(clacks.length, 1); assert.equal(clacks[0].volume, .28);
  for (let i = 0; i < 50; i++) update();
  assert.equal(audio.cues.filter(c => c.key === 'land').length, 1);
});

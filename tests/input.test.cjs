'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Input } = require('../web/input.js');
const { Game, Runner } = require('../web/core.js');
const settings = require('../settings.json');
function setup() {
  const game = new Game(settings, { length: 100000, checkpoints: [0], objects: [], practiceObjects: [] });
  game.restart(); const commands = []; let gestures = 0;
  const input = new Input(game, command => commands.push(command), () => gestures++);
  return { game, input, commands, gestures: () => gestures };
}
function time(game, seconds) { for (let n = 0; n < Math.round(seconds * 60); n++) game.step(1 / 60); }
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(f => f !== fn)); }
  send(type, values = {}) {
    let prevented = false;
    const event = { preventDefault() { prevented = true; }, ...values };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return prevented;
  }
}
test('fast down/up between frames survives the input queue as a release ollie', () => {
  const { game, input } = setup(); input.feed('Space', true); input.feed('Space', false);
  assert.equal(game.mode, 'rolling'); input.flush(); assert.equal(game.mode, 'air'); assert.equal(game.velocityZ, 420);
});
test('autorepeat cannot refresh charge, create a gesture, or repeat shortcuts', () => {
  const { game, input, commands, gestures } = setup();
  input.feed('Space', true); input.flush(); time(game, .2);
  const press = game.space.at;
  input.feed('Space', true, true); input.feed('Space', true); input.flush(); assert.equal(game.space.at, press);
  input.feed('KeyP', true); input.feed('KeyP', true, true); input.feed('KeyP', true);
  assert.deepEqual(commands, ['pause']); assert.equal(gestures(), 2);
});
test('fresh Down Up gesture uses ordered queued events and wins over rail catch', () => {
  const { game, input } = setup(); input.feed('Space', true); input.feed('Space', false); input.flush();
  input.feed('ArrowDown', true); input.feed('ArrowDown', false); input.feed('ArrowUp', true); input.flush();
  assert.ok(game.flip); assert.equal(game.mode, 'air');
  assert.equal(game.keys.Up, true); assert.equal(game.downAt, -Infinity);
});
test('holding Down autorepeat beyond the gesture window cannot create a flip', () => {
  const { game, input } = setup(); input.feed('ArrowDown', true); input.flush(); time(game, .5);
  input.feed('Space', true); input.feed('Space', false); input.flush();
  input.feed('ArrowDown', true, true); input.feed('ArrowUp', true); input.flush(); assert.equal(game.flip, null);
});
test('input clear drops queued actions and requires release before a fresh press', () => {
  const { game, input } = setup(); input.feed('Space', true); input.clear(); input.flush(); assert.equal(game.space, null);
  input.feed('Space', true); input.flush(); assert.equal(game.space, null);
  input.feed('Space', false); input.feed('Space', true); input.flush(); assert.ok(game.space);
});
test('pause with held Space cannot leak a jump or crouch on resume', () => {
  const { game, input } = setup(); input.feed('Space', true); input.flush(); time(game, .3);
  game.pause(); input.clear(); game.resume(); input.feed('Space', true, true); input.flush();
  assert.equal(game.space, null); assert.equal(game.charge, 0); assert.equal(game.chargeVisible, false);
  input.feed('Space', false); input.flush(); assert.equal(game.mode, 'rolling');
  input.feed('Space', true); input.flush(); assert.equal(game.crouching, false);
  time(game, .3); assert.equal(game.crouching, true);
});
test('blur and visibility loss clear both queue and core charge, then pause', () => {
  const { game, input } = setup(), target = new Target(); target.document = new Target();
  const detach = input.attach(target, () => game.pause());
  target.send('keydown', { code: 'Space' }); input.flush(); time(game, .3);
  target.send('blur'); assert.equal(game.status, 'paused'); assert.equal(game.space, null);
  target.send('keyup', { code: 'Space' }); game.resume();
  target.send('keydown', { code: 'Space' }); input.flush(); assert.ok(game.space);
  target.document.hidden = true; target.document.send('visibilitychange'); assert.equal(game.status, 'paused');
  assert.equal(game.space, null); assert.equal(game.chargeVisible, false);
  target.send('keyup', { code: 'Space' }); game.resume(); input.flush();
  assert.equal(game.mode, 'rolling'); assert.equal(game.velocityZ, 0);
  assert.equal(game.drainEvents().filter(e => e.type === 'ollie').length, 0); detach();
  assert.equal(target.listeners.get('keydown').length, 0);
});
test('arrow/space prevent scrolling; unrelated keys and native button Space are untouched', () => {
  const { input, game } = setup(), target = new Target(); input.attach(target, () => {});
  assert.equal(target.send('keydown', { code: 'ArrowUp' }), true);
  assert.equal(target.send('keydown', { code: 'KeyQ' }), false);
  assert.equal(target.send('keydown', { code: 'Space', target: { tagName: 'BUTTON' } }), false);
  input.flush(); assert.equal(game.space, null);
});
test('unsupported F does nothing and Up/Down never move laneY', () => {
  const { game, input } = setup(); assert.equal(input.feed('KeyF', true), false);
  input.feed('ArrowUp', true); input.feed('ArrowDown', true); input.flush(); time(game, .1);
  assert.equal(game.laneY, 0); assert.equal(game.jumpZ, 0); assert.equal(game.flip, null);
});
test('input-driven hold releases one full pop with no extra press, even after autorepeat', () => {
  const { game, input } = setup(); input.feed('Space', true); input.flush(); time(game, .6);
  input.feed('Space', true, true); input.flush(); time(game, .3);
  assert.equal(game.mode, 'rolling'); assert.equal(game.charge, 1);
  assert.equal(game.drainEvents().filter(e => e.type === 'ollie').length, 0);
  input.feed('Space', false); input.flush(); assert.equal(game.velocityZ, 760);
  assert.equal(game.space, null); assert.equal(game.chargeVisible, false);
  assert.deepEqual(game.drainEvents().map(e => e.type), ['ollie']);
  input.feed('Space', false); input.flush(); assert.deepEqual(game.drainEvents(), []);
});
test('fixed runner flushes queued intent once; catchup preserves separate cues', () => {
  const { game, input } = setup(), runner = new Runner(game);
  input.feed('Space', true); input.feed('Space', false); runner.advance(.1, () => input.flush());
  const events = game.drainEvents(); assert.equal(events.filter(e => e.type === 'ollie').length, 1);
  time(game, .4); runner.advance(.1, () => input.flush());
  assert.equal(game.drainEvents().filter(e => e.type === 'land').length, 1);
});
test('gameplay keydown in menus or crashes never queues a later action', () => {
  const { game, input } = setup(); game.status = 'menu'; input.feed('Space', true); assert.equal(input.queue.length, 0);
  input.feed('Space', false); input.flush(); game.restart(); input.clear();
  game.bail('fixture'); input.feed('Space', true); assert.equal(input.queue.length, 0);
});

test('native radio, checkbox and button keys retain defaults on both edges without queued input', () => {
  const { input, game, commands, gestures } = setup(), target = new Target();
  game.chooseDude(); input.attach(target, () => {});
  for (const tagName of ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'A']) {
    for (const code of ['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyR']) {
      for (const type of ['keydown', 'keyup']) {
        assert.equal(target.send(type, { code, target: { tagName } }), false);
      }
    }
  }
  assert.equal(input.held.size, 0); assert.deepEqual(input.queue, []);
  assert.deepEqual(commands, []); assert.equal(gestures(), 0); assert.equal(game.status, 'menu');
});

test('release on a native control clears an earlier gameplay press without swallowing native input', () => {
  const { input, game } = setup(), target = new Target(); input.attach(target, () => {});
  target.send('keydown', { code: 'Space' }); input.flush();
  game.pause(); input.clear();
  assert.equal(target.send('keyup', { code: 'Space', target: { tagName: 'INPUT' } }), false);
  assert.equal(input.blocked.size, 0); assert.equal(input.held.size, 0);
  game.resume(); target.send('keydown', { code: 'Space' }); input.flush(); assert.ok(game.space);
});

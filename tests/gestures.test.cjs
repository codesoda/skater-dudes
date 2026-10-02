'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Input } = require('../web/input.js');
const { Gestures } = require('../web/gestures.js');
const { Game } = require('../web/core.js');
const settings = require('../settings.json');
function setup() {
  const game = new Game(settings, { length: 100000, checkpoints: [0], objects: [], practiceObjects: [] });
  game.restart(); const input = new Input(game); let ms = 0;
  const gestures = new Gestures(game, input, () => {}, () => ms);
  function frames(count) {
    for (let i = 0; i < count; i++) { gestures.update(); input.flush(); game.step(1 / 60); ms += 1000 / 60; }
  }
  return { game, input, gestures, frames };
}
function ollies(game) { return game.events.filter(e => e.type === 'ollie').length; }
for (const [name, frames, charge] of [['short tap', 6, 0], ['intent boundary', 18, 0], ['full hold', 54, 1], ['extended hold', 120, 1]]) {
  test(`touch ${name} uses the real 60 Hz hold clock and pops only on release`, () => {
    const s = setup(); s.gestures.start(100, 100); s.frames(frames);
    assert.equal(s.game.mode, 'rolling'); assert.equal(ollies(s.game), 0);
    assert.equal(s.game.charge, charge); assert.equal(s.game.chargeVisible, frames >= 18);
    if (frames < 18) s.gestures.tap();
    s.gestures.end(100, 100); s.frames(1);
    assert.equal(s.game.mode, 'air'); assert.equal(s.game.popCharge, charge); assert.equal(ollies(s.game), 1);
  });
}
test('12 CSS pixel jitter tolerates charge; crossing the threshold abandons it without a jump', () => {
  const s = setup(); s.gestures.start(100, 100); s.frames(30);
  s.gestures.pan(106, 106); s.frames(24); assert.equal(s.game.charge, 1);
  s.gestures.pan(100, 113); s.frames(1);
  assert.equal(s.game.space, null); assert.equal(s.game.crouching, true); assert.equal(s.game.keys.Down, true);
  s.gestures.end(100, 113); s.frames(1);
  assert.equal(s.game.crouching, false); assert.equal(s.game.mode, 'rolling'); assert.equal(ollies(s.game), 0);
});
test('slow cumulative drift is a pan even when the library tap tolerance accepts each small step', () => {
  const s = setup(); s.gestures.start(100, 100);
  for (let i = 1; i <= 8; i++) { s.gestures.pan(100, 100 + i * 3); s.frames(1); }
  s.gestures.tap(); s.gestures.end(100, 124); s.frames(1);
  assert.equal(ollies(s.game), 0); assert.equal(s.game.space, null);
});
test('hold-to-pan before the first flush cancels queued Space, not the other controls', () => {
  const s = setup(); s.input.feed('ArrowLeft', true); s.gestures.start(100, 100);
  s.gestures.pan(100, 130); s.frames(1);
  assert.equal(s.game.space, null); assert.equal(s.game.keys.Left, true); assert.equal(s.game.keys.Down, true);
  assert.equal(ollies(s.game), 0);
});
test('touch boost reaches the existing 392 cap then coasts for eight seconds without an end pulse', () => {
  const s = setup(); s.gestures.start(100, 100); s.gestures.pan(140, 100); s.frames(60);
  assert.equal(s.game.currentSpeed, 392); s.gestures.swipe(0); s.gestures.end(140, 100); s.frames(240);
  assert.ok(Math.abs(s.game.currentSpeed - 336) < .01); assert.equal(s.game.keys.Right, false);
  s.frames(240); assert.ok(Math.abs(s.game.currentSpeed - 280) < .01); assert.equal(ollies(s.game), 0);
});
test('one-finger manual stays held during left/right balance and ends on release', () => {
  const s = setup(); s.gestures.start(100, 100); s.gestures.pan(100, 75); s.frames(1);
  assert.equal(s.game.mode, 'manual'); s.gestures.pan(140, 75); s.frames(2);
  assert.equal(s.game.keys.Right, true); assert.equal(s.game.keys.Up, true); assert.equal(s.game.boosting, false);
  s.gestures.pan(60, 75); s.frames(2); assert.equal(s.game.keys.Left, true); assert.equal(s.game.keys.Right, false);
  s.gestures.pan(100, 100); s.frames(1); assert.equal(s.game.keys.Left, false); assert.equal(s.game.mode, 'manual');
  s.gestures.end(100, 100); s.frames(1); assert.equal(s.game.mode, 'rolling'); assert.equal(s.game.keys.Up, false);
});
for (const mode of ['manual', 'grind', 'flip']) {
  test(`isolated ${mode} fixture balances without a Space edge or later boost`, () => {
    const s = setup();
    if (mode === 'flip') { s.game.pop(1); s.game.flip = { at: 0, done: false }; }
    else s.game.mode = mode;
    s.gestures.start(100, 100); s.gestures.pan(140, 100); s.frames(2);
    assert.equal(s.game.keys.Right, true); assert.equal(s.game.boosting, false); assert.equal(s.game.space, null);
    s.game.mode = 'rolling'; s.game.flip = null; s.game.jumpZ = 0; s.frames(1);
    assert.equal(s.game.keys.Right, false); assert.equal(s.game.boosting, false);
    s.gestures.pan(160, 100); s.frames(1); assert.equal(s.game.keys.Right, false);
    s.gestures.end(160, 100); s.frames(1); assert.equal(ollies(s.game), mode === 'flip' ? 1 : 0);
  });
}
test('Down-Up reversal within 400 ms flips mid-stroke even below its starting point', () => {
  const s = setup(); s.game.pop(1); s.gestures.start(100, 100); s.gestures.pan(100, 145); s.frames(5);
  s.gestures.pan(100, 125); s.frames(1);
  assert.ok(s.game.flip); assert.equal(s.game.downAt, -Infinity); assert.equal(s.gestures.contact.direction, 'flip');
  s.gestures.pan(100, 120); s.frames(1); assert.equal(s.game.keys.Down, false); assert.equal(s.game.keys.Up, true);
  s.gestures.swipe(90); s.gestures.end(100, 120); s.frames(1);
  assert.equal(s.game.events.filter(e => e.type === 'flip').length, 1); assert.equal(s.game.keys.Up, false);
});
test('expired Down-Up becomes catch intent, never a late flip, and catch expires while still held', () => {
  const s = setup(); s.game.pop(1); s.gestures.start(100, 100); s.gestures.pan(100, 140); s.frames(26);
  s.gestures.pan(100, 70); s.frames(1); assert.equal(s.game.flip, null); assert.equal(s.game.keys.Up, true);
  s.frames(23); assert.equal(s.game.keys.Up, false);
  s.gestures.end(100, 70); s.frames(1); assert.equal(s.game.keys.Up, false);
});
test('a recognized upward air swipe carries one bounded catch window across release', () => {
  const s = setup(); s.game.pop(1); s.gestures.start(100, 100); s.gestures.pan(100, 70); s.frames(2);
  s.gestures.swipe(90); s.gestures.end(100, 70); s.frames(1); assert.equal(s.game.keys.Up, true);
  s.frames(23); assert.equal(s.game.keys.Up, false); assert.equal(s.game.flip, null);
});
test('airborne stationary hold cannot queue an ollie at landing', () => {
  const s = setup(); s.game.pop(0); s.gestures.start(100, 100); s.frames(80);
  assert.equal(s.game.mode, 'rolling'); assert.equal(s.game.space, null);
  s.gestures.end(100, 100); s.frames(1); assert.equal(ollies(s.game), 1);
});
for (const keyboardFirst of [true, false]) {
  test(`mixed Space owners preserve keyboard hold when touch cancels, keyboardFirst=${keyboardFirst}`, () => {
    const s = setup();
    if (keyboardFirst) s.input.feed('Space', true);
    s.gestures.start(100, 100); s.frames(5);
    if (!keyboardFirst) s.input.feed('Space', true);
    s.gestures.pan(100, 130); s.frames(1);
    assert.ok(s.game.space); assert.equal(s.game.keys.Space, true); assert.equal(ollies(s.game), 0);
    s.gestures.end(100, 130); s.frames(1); assert.ok(s.game.space);
    s.input.feed('Space', false); s.frames(1); assert.equal(ollies(s.game), 1);
  });
}
test('keyboard release cannot end a touch hold or touch balance key', () => {
  const s = setup(); s.input.feed('Space', true); s.gestures.start(100, 100); s.frames(1);
  s.input.feed('Space', false); s.frames(1); assert.ok(s.game.space); assert.equal(ollies(s.game), 0);
  s.gestures.pan(140, 100); s.input.feed('ArrowRight', true); s.frames(1);
  s.gestures.end(140, 100); s.frames(1); assert.equal(s.game.keys.Right, true);
  s.input.feed('ArrowRight', false); s.frames(1); assert.equal(s.game.keys.Right, false);
});
for (const action of ['cancel', 'pause', 'menu', 'restart', 'bail', 'recover']) {
  test(`${action} abandons charge and all touch pulses; old contact cannot rearm`, () => {
    const s = setup(); s.gestures.start(100, 100); s.frames(40);
    if (action === 'cancel') s.gestures.cancel();
    else {
      if (action === 'pause') s.game.pause();
      if (action === 'menu') s.game.chooseDude();
      if (action === 'restart') s.game.restart();
      if (action === 'bail') s.game.bail('fixture');
      if (action === 'recover') s.game.recover();
      s.input.clear();
    }
    s.gestures.pan(100, 130); s.gestures.end(100, 100); s.input.flush();
    assert.equal(s.game.space, null); assert.equal(ollies(s.game), 0); assert.equal(s.gestures.contact, null);
    assert.equal(s.gestures.catchUntil, null);
    assert.ok(Object.values(s.game.keys).every(value => !value));
  });
}
test('keyboard-started trick latches a stationary touch boost as balance, never boosts after trick exit', () => {
  const s = setup(); s.gestures.start(100, 100); s.gestures.pan(140, 100); s.frames(1);
  s.input.feed('ArrowUp', true); s.frames(3); assert.equal(s.game.mode, 'manual');
  s.input.feed('ArrowUp', false); s.frames(3); assert.equal(s.game.mode, 'rolling');
  assert.equal(s.game.keys.Right, false); assert.equal(s.game.boosting, false);
});
test('cancel also clears a released swipe pulse without clearing physical Up', () => {
  const s = setup(); s.game.pop(1); s.gestures.start(100, 100); s.gestures.pan(100, 70);
  s.gestures.swipe(90); s.gestures.end(100, 70); s.input.feed('ArrowUp', true); s.frames(1);
  s.gestures.cancel(); s.frames(1); assert.equal(s.gestures.catchUntil, null); assert.equal(s.game.keys.Up, true);
  s.input.feed('ArrowUp', false); s.frames(1); assert.equal(s.game.keys.Up, false);
});
test('clear still blocks physical keyboard until release, not a fresh touch', () => {
  const s = setup(); s.input.feed('Space', true); s.frames(1); s.input.clear();
  s.input.feed('Space', true); s.frames(1); assert.equal(s.game.space, null);
  s.gestures.start(100, 100); s.frames(1); assert.ok(s.game.space);
  s.gestures.cancel(); s.frames(1); assert.equal(s.game.space, null);
  s.input.feed('Space', false); s.input.feed('Space', true); s.frames(1); assert.ok(s.game.space);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../web/core.js');
const { Input } = require('../web/input.js');
const { Gestures } = require('../web/gestures.js');
const settings = require('../settings.json');
function setup() {
  const game = new Game(settings, { length: 100000, checkpoints: [0], objects: [] }); game.restart();
  const input = new Input(game); let ms = 0;
  const gestures = new Gestures(game, input, () => {}, () => ms);
  const frames = n => { for (let i = 0; i < n; i++) { gestures.update(); input.flush(); game.step(1 / 60); ms += 1000 / 60; } };
  const jump = () => { game.key('Space', true); frames(54); game.key('Space', false); frames(1); };
  const tre = () => { game.key('Left', true); game.key('Left', false); game.key('Right', true); game.key('Right', false); };
  return { game, input, gestures, frames, jump, tre };
}
test('fresh airborne Left Right starts typed 550 ms tre, finishes, balances and banks 360', () => {
  const s = setup(); s.jump(); s.tre(); const g = s.game;
  assert.equal(g.flip.kind, 'tre'); assert.equal(g.flip.duration, .55); const at = g.flip.at;
  s.frames(32); assert.equal(g.flip.done, false); s.frames(1); assert.equal(g.flip.done, true);
  s.tre(); assert.equal(g.flip.at, at); assert.equal(g.events.filter(e => e.type === 'flip').length, 1);
  while (g.mode === 'air') { g.key('Left', g.balance > .04); s.frames(1); }
  g.key('Left', false); assert.equal(g.bails, 0); s.frames(30); assert.equal(g.score, 360);
});
test('400 ms boundary is inclusive, held repeats cannot refresh, and expired left cannot flip', () => {
  for (const count of [24, 25]) {
    const s = setup(); s.jump(); s.game.key('Left', true); s.frames(count); s.game.key('Left', true); s.game.key('Right', true);
    assert.equal(s.game.flip?.kind || null, count === 24 ? 'tre' : null);
  }
});
test('ground Left, rail/manual correction, and falling off support never arm a tre', () => {
  const s = setup(); s.game.key('Left', true); s.jump(); s.game.key('Right', true); assert.equal(s.game.flip, null);
  for (const mode of ['manual', 'grind', 'air']) {
    const f = setup(); f.game.mode = mode; f.tre(); assert.equal(f.game.flip, null, mode);
  }
  const g = setup(); g.game.key('Right', true); g.frames(30); assert.ok(g.game.currentSpeed > 280); assert.equal(g.game.flip, null);
});
test('Down Up keeps ground-start compatibility and priority over a competing Left Right candidate', () => {
  const s = setup(); s.jump(); s.game.key('Left', true); s.game.key('Down', true); s.game.key('Right', true);
  assert.equal(s.game.flip, null); s.game.key('Up', true); assert.equal(s.game.flip.kind, 'kick');
  assert.equal(s.game.flip.duration, settings.flipDuration); assert.equal(s.game.leftAt, -Infinity);
});
for (const operation of ['pause', 'clearInput', 'chooseDude', 'restart', 'bail', 'recover']) {
  test(operation + ' clears the pending tre sequence', () => {
    const s = setup(); s.jump(); s.game.key('Left', true); s.game[operation](); s.game.resume();
    assert.equal(s.game.leftAt, -Infinity); s.game.key('Right', true); assert.equal(s.game.flip, null);
  });
}
test('landing consumes pending Left; holding Right across the next ollie cannot queue a trick', () => {
  const s = setup(); s.jump(); s.frames(51); s.game.key('Left', true); s.frames(8);
  assert.equal(s.game.leftAt, -Infinity); s.game.key('Right', true); s.jump(); s.game.key('Right', true); assert.equal(s.game.flip, null);
});
test('late and unsafe tre landings report TRE FLIP, without midair failure', () => {
  for (const late of [true, false]) {
    const s = setup(); s.jump(); if (late) s.frames(32); s.tre(); if (!late) s.game.key('Right', true);
    s.frames(5); assert.equal(s.game.mode, 'air');
    while (s.game.mode === 'air') s.frames(1);
    assert.equal(s.game.mode, 'crash'); assert.match(s.game.message, late ? /^TRE FLIP.*start earlier/ : /^TRE FLIP.*safe zone/);
  }
});
test('legacy untyped flip records retain kick duration and score', () => {
  const s = setup(); s.jump(); s.game.flip = { at: s.game.time, done: false }; s.frames(20); assert.equal(s.game.flip.done, true);
  while (s.game.mode === 'air') { s.game.key('Left', s.game.balance > .04); s.frames(1); }
  s.game.key('Left', false); s.frames(30); assert.equal(s.game.score, 180);
});
test('mobile left stroke reverses before origin, starts through keys, latches balance and never boosts on landing', () => {
  const s = setup(); s.jump(); s.gestures.start(100, 100); s.gestures.pan(55, 100); s.frames(5);
  assert.equal(s.game.flip, null); assert.equal(s.game.keys.Left, true);
  s.gestures.pan(75, 100); s.frames(1); assert.equal(s.game.flip.kind, 'tre'); assert.equal(s.gestures.contact.balance, true);
  s.gestures.pan(55, 100); s.frames(1); assert.equal(s.game.keys.Right, false);
  while (s.game.mode === 'air') { s.gestures.pan(s.game.balance > .04 ? 30 : 55, 100); s.frames(1); }
  assert.equal(s.game.bails, 0); s.gestures.pan(130, 100); s.frames(5); assert.equal(s.game.boosting, false);
  assert.equal(s.game.events.filter(e => e.type === 'flip').length, 1); s.gestures.end(130, 100);
});
test('mobile expired, neutral, ended and canceled candidates cannot become tre', () => {
  for (const operation of ['expired', 'neutral', 'end', 'cancel']) {
    const s = setup(); s.jump(); s.gestures.start(100, 100); s.gestures.pan(55, 100); s.frames(1);
    if (operation === 'expired') s.frames(25);
    if (operation === 'neutral') { s.gestures.pan(100, 105); s.frames(1); }
    if (operation === 'end') { s.gestures.end(55, 100); s.gestures.start(55, 100); }
    if (operation === 'cancel') { s.gestures.cancel(); s.gestures.start(55, 100); }
    s.gestures.pan(120, 100); s.frames(1); assert.equal(s.game.flip, null, operation);
  }
});

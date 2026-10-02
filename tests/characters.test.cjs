'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../web/core.js');
const settings = require('../settings.json');
const course = require('../course.json');

test('Jeff is the default; only Jeff and Dave can be selected, and only in the menu', () => {
  const game = new Game(settings, course);
  assert.equal(game.characterId, 'jeff');
  for (const invalid of ['Jeff', 'oscar', '', null, undefined, '__proto__', 'toString']) {
    assert.equal(game.selectCharacter(invalid), false);
    assert.equal(game.characterId, 'jeff');
  }
  assert.equal(game.selectCharacter('dave'), true);
  assert.equal(game.characterId, 'dave');
  assert.throws(() => { game.characterId = 'jeff'; }, TypeError);
  game.restart();
  for (const mode of ['rolling', 'air', 'grind', 'manual', 'crash']) {
    game.mode = mode;
    assert.equal(game.selectCharacter('jeff'), false);
    assert.equal(game.characterId, 'dave');
  }
  game.pause(); assert.equal(game.selectCharacter('jeff'), false);
  game.status = 'finished'; assert.equal(game.selectCharacter('jeff'), false);
});

test('Dave survives restart, practice switch, pause, safe retry bail, recovery and finish', () => {
  const game = new Game(settings, course); game.selectCharacter('dave');
  game.restart(); game.pause(); game.resume();
  game.checkpoint = 1400; game.score = 400; game.bail('Character retention fixture'); game.recover();
  assert.equal(game.characterId, 'dave'); assert.equal(game.worldX, 0); assert.equal(game.score, 400);
  game.restart(true, true, true); assert.equal(game.practice, true); assert.equal(game.characterId, 'dave');
  game.restart(true, false); game.worldX = course.length; game.step(1 / 60);
  assert.equal(game.status, 'finished'); assert.equal(game.characterId, 'dave');
  game.restart(); assert.equal(game.characterId, 'dave');
});

test('Choose dude clears held input/charge/events, keeps score until a new run, and allows a new choice', () => {
  const game = new Game(settings, course); game.selectCharacter('dave'); game.restart();
  game.score = 123; game.combo = 40; game.key('Space', true); game.emit('push');
  game.chooseDude();
  assert.equal(game.status, 'menu'); assert.equal(game.characterId, 'dave');
  assert.equal(game.score, 123); assert.equal(game.combo, 40);
  assert.deepEqual(game.keys, {}); assert.equal(game.space, null); assert.equal(game.charge, 0); assert.equal(game.chargeVisible, false);
  assert.deepEqual(game.drainEvents(), []);
  assert.equal(game.selectCharacter('jeff'), true);
  game.restart(true, true);
  assert.equal(game.characterId, 'jeff'); assert.equal(game.score, 0); assert.equal(game.combo, 0);
});

test('both dudes produce byte-identical simulation snapshots for the same control sequence', () => {
  const a = new Game(settings, course), b = new Game(settings, course);
  b.selectCharacter('dave'); a.restart(true, true); b.restart(true, true);
  for (let frame = 0; frame < 600; frame++) {
    for (const game of [a, b]) {
      if (frame % 100 === 0) game.key('Space', true);
      if (frame % 100 === 40) game.key('Space', false);
      if (frame % 100 === 50) game.key('Down', true);
      if (frame % 100 === 51) game.key('Down', false);
      if (frame % 100 === 52) game.key('Up', true);
      if (frame % 100 === 53) game.key('Up', false);
      game.step(1 / 60);
    }
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  }
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, Runner } = require('../web/core.js');
const settings = require('../settings.json');
const course = require('../course.json');
const { routeTarget } = require('./route-target.js');
const { lightJumpPhase } = require('./route-light-jump.js');
const block = (id, x, width, height, type = 'ledge') => ({ id, x, width, height, type });
function fixture(objects) {
  const g = new Game(settings, { length: 30000, checkpoints: [0], objects }); g.restart(); return g;
}
function frames(g, n) { for (let i = 0; i < n; i++) g.step(1 / 60); }

test('nested union lands on highest crossed top independently of object order', () => {
  const objects = [block('base', 0, 1600, 60), block('middle', 0, 1200, 120), block('top', 0, 900, 180)];
  for (const order of [objects, [...objects].reverse(), [objects[1], objects[2], objects[0]]]) {
    const g = fixture(order); g.worldX = 100; g.mode = 'air'; g.jumpZ = 190; g.velocityZ = -900;
    g.step(.1); assert.equal(g.surface, 'top'); assert.equal(g.jumpZ, 180); assert.equal(g.mode, 'rolling');
    frames(g, 100); assert.equal(g.bails, 0); assert.equal(g.surface, 'top');
  }
});
test('long ledge supports board edges, fresh charged pops and held-airborne Space never auto-pops', () => {
  const g = fixture([block('shelf', 0, 1600, 60)]);
  g.worldX = 50; g.jumpZ = 60; g.surface = 'shelf';
  frames(g, 60); assert.equal(g.jumpZ, 60); assert.equal(g.mode, 'rolling');
  g.key('Space', true); frames(g, 54); assert.equal(g.charge, 1);
  g.key('Space', false); assert.equal(g.jumpZ, 60); assert.equal(g.velocityZ, 760);
  g.key('Space', true); frames(g, 65); assert.equal(g.surface, 'shelf'); assert.equal(g.mode, 'rolling');
  g.key('Space', false); assert.equal(g.mode, 'rolling');
  g.worldX = 1617; g.step(1 / 60); assert.equal(g.surface, 'shelf');
  g.step(1 / 60); assert.equal(g.mode, 'air'); assert.equal(g.bails, 0);
});
test('rails never land as rolling; deliberate descending Up catch checks height and overlap', () => {
  for (const up of [false, true]) {
    const g = fixture([block('steel', 0, 1000, 60, 'rail')]);
    g.worldX = 50; g.mode = 'air'; g.jumpZ = 65; g.velocityZ = -100; g.key('Up', up); frames(g, 4);
    assert.equal(g.mode, up ? 'grind' : 'crash');
    if (!up) assert.match(g.message, /HOLD UP/);
    else { assert.equal(g.jumpZ, 60); assert.equal(g.pushPhase, 0); assert.equal(g.drainEvents().filter(e => e.type === 'grind').length, 1); }
  }
  for (const [x, z, vz] of [[-100, 65, -100], [50, 100, 100]]) {
    const g = fixture([block('steel', 0, 1000, 60, 'rail')]);
    g.worldX = x; g.mode = 'air'; g.jumpZ = z; g.velocityZ = vz; g.key('Up', true); frames(g, 2);
    assert.equal(g.mode, 'air');
  }
  const g = fixture([block('steel', 600, 1000, 60, 'rail')]); g.key('Up', true); frames(g, 10);
  assert.equal(g.mode, 'manual'); assert.notEqual(g.mode, 'grind');
});
test('long locked grind needs correction; Down drops and Space pops with no pushing', () => {
  for (const correct of [false, true]) {
    const g = fixture([block('steel', 0, 1600, 60, 'rail')]);
    g.worldX = 50; g.mode = 'air'; g.jumpZ = 65; g.velocityZ = -100; g.key('Up', true); frames(g, 4);
    for (let i = 0; i < 180 && g.mode !== 'crash'; i++) { g.key('Left', correct && g.balance > .04); frames(g, 1); }
    assert.equal(g.mode, correct ? 'grind' : 'crash'); assert.equal(g.pushPhase, 0);
    if (correct) { g.key('Down', true); assert.equal(g.mode, 'air'); frames(g, 10); assert.equal(g.bails, 0); }
  }
  const g = fixture([block('steel', 0, 1600, 60, 'rail')]); g.jumpZ = 60; g.surface = 'steel'; g.mode = 'grind';
  g.key('Space', true); assert.equal(g.mode, 'air'); assert.ok(g.velocityZ > 420); assert.equal(g.surface, null);
});
test('descending stairs expose 11 exact treads and naturally land on every lower step', () => {
  const stairs = course.objects.find(o => o.id === 'climb-down');
  const g = fixture([block('top', stairs.x - 1000, 1000, 240), stairs]);
  assert.deepEqual(g.solidParts(stairs).map(o => o.height), [220, 200, 180, 160, 140, 120, 100, 80, 60, 40, 20]);
  g.worldX = stairs.x - 100; g.surface = 'top'; g.jumpZ = 240;
  const landed = new Set(); let air = 0;
  while (g.worldX < stairs.x + stairs.width + 180) {
    frames(g, 1); if (g.surface?.startsWith('climb-down:')) landed.add(g.jumpZ);
    if (g.mode === 'air') air++;
    assert.equal(g.bails, 0);
  }
  assert.equal(landed.size, 11); assert.ok(air > 50); assert.equal(g.jumpZ, 0); assert.equal(g.surface, null);
});
function route(hz, boost = false) {
  const g = new Game(settings, course); g.restart(); const runner = new Runner(g);
  let target = '', phase = ''; const evidence = { loads: [], pops: [], supports: [], grinds: [], events: [] };
  const supports = new Set();
  function control() {
    const o = routeTarget(g.objects, { x: g.worldX, mode: g.mode, surface: g.surface }, target);
    if (o && o.id !== target) { target = o.id; phase = ''; }
    const d = o ? o.x - g.worldX : Infinity;
    g.key('Right', boost && g.worldX > 100 && d > 700 && g.grounded && !g.surface && !g.balanceActive);
    g.key('Down', o?.type === 'low_bar' && d < 150);
    if (o && o.type !== 'low_bar' && g.grounded) {
      if (o.charged && !phase && d <= g.holdDistance(o)) {
        evidence.loads.push([o.id, g.surface, g.jumpZ]); g.key('Space', true); phase = 'loading';
      }
      if (phase === 'loading' && d <= (o.popDistance || 110) + 2) {
        assert.equal(g.charge, 1, o.id); evidence.pops.push([o.id, g.jumpZ]); g.key('Space', false); phase = 'jumped';
      }
      if (!o.charged) { const next = lightJumpPhase(phase, d); if (next !== phase) { g.key('Space', next === 'light-ready'); phase = next; } }
    }
    g.key('Up', g.mode === 'air' && (o?.type === 'rail' || o?.type === 'ledge' && o.intent !== 'ride'));
    g.key('Left', g.balanceActive && g.balance > .04);
  }
  for (let frame = 0; frame < hz * 100 && g.status !== 'finished'; frame++) {
    runner.advance(1 / hz, () => {
      control();
      for (const e of g.drainEvents()) {
        evidence.events.push([e.type, e.at]);
        if (e.type === 'grind') evidence.grinds.push(g.surface);
      }
      if (g.grounded && g.surface) supports.add(g.surface);
    });
    assert.equal(g.bails, 0, `${g.worldX}: ${g.message}`);
  }
  assert.equal(g.status, 'finished'); evidence.supports = [...supports];
  return { g, evidence };
}
test('input-only whole route rides four tiers with four fresh charged ollies and ledge-to-rail catch', () => {
  for (const boost of [false, true]) {
    const { evidence } = route(60, boost);
    assert.deepEqual(evidence.pops.filter(([id]) => id.startsWith('climb-')), [['climb-1', 0], ['climb-2', 60], ['climb-3', 120], ['climb-4', 180]]);
    for (const id of ['climb-1', 'climb-2', 'climb-3', 'climb-4', 'transfer-ledge']) assert.ok(evidence.supports.includes(id), id);
    assert.ok(evidence.grinds.includes('transfer-rail'));
    assert.ok(!evidence.grinds.includes('transfer-ledge'));
    assert.equal(evidence.pops.find(([id]) => id === 'transfer-rail')[1], 60);
  }
});
test('elevated route physics and input events are deterministic at 30/60/120 render Hz', () => {
  const expected = route(60).evidence;
  for (const hz of [30, 120]) assert.deepEqual(route(hz).evidence, expected);
});
test('failed upper tier retries before whole complex, never inside nested solids; bank and choice survive', () => {
  const g = new Game(settings, course); g.selectCharacter('dave'); g.restart();
  // Explicit clearance fixture: last safe duck section, then failure on tier 3.
  g.clearedHazards = [{ id: 'hazard-8', x: 9390 }]; g.worldX = 11810; g.jumpZ = 120;
  g.surface = 'climb-2'; g.score = 400; g.bestCombo = 200; g.key('Space', true); g.key('Down', true);
  g.bail('tier'); g.recover(); assert.equal(g.worldX, 9390); assert.equal(g.jumpZ, 0);
  assert.ok(!g.hazards.some(o => g.overlapping(o))); assert.ok((9980 - 22 - g.worldX) / 280 >= 1.4);
  assert.equal(g.score, 400); assert.equal(g.bestCombo, 200); assert.equal(g.characterId, 'dave'); assert.deepEqual(g.keys, {});
});

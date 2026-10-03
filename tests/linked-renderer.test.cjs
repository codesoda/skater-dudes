'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { Game } = require('../web/core.js');
const settings = require('../settings.json');
const manifest = require('../assets/manifest.json');
function fixture() {
  const calls = [], window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/renderer.js'), 'utf8'), { window });
  const ctx = Object.fromEntries(['drawImage', 'fillRect', 'fillText', 'beginPath', 'ellipse', 'fill', 'save', 'restore', 'translate', 'rotate', 'scale', 'transform'].map(key => [key, (...args) => calls.push([key, ...args])]));
  const r = new window.ShredderRenderer.Renderer({ getContext: () => ctx }, manifest);
  r.images = Object.fromEntries(Object.keys(manifest.images).map(key => [key, { key }]));
  const g = new Game(settings, { length: 10000, checkpoints: [0], objects: [] }); g.restart();
  return { r, g, calls };
}
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
test('tre independently yaws and rolls the single board through top, underside and edge phases', () => {
  const phases = new Set();
  for (const p of [0, .125, .175, .25, .375, .5, .625, .75, .875, 1]) {
    const { r, g, calls } = fixture(); g.mode = 'air'; g.flip = { kind: 'tre', duration: .55, at: 0 }; g.time = p * .55;
    r.skater(g, 250, 200, 450);
    const draws = calls.filter(c => c[0] === 'drawImage'); assert.equal(draws.length, 2); phases.add(draws[0][1].key);
    assert.equal(draws[1][1].key, p < .78 ? 'skater_flip' : 'skater_catch');
    const transform = calls.find(c => c[0] === 'transform'); assert.ok(transform);
    close(transform[1], Math.cos(p * 2 * Math.PI)); close(transform[2], .35 * Math.sin(p * 2 * Math.PI));
    close(transform[3], Math.sin(p * 2 * Math.PI) ** 2);
    assert.ok(!calls.some(c => c[0] === 'rotate'), 'never rotate the whole skater');
    assert.ok(calls.slice(calls.indexOf(transform), calls.indexOf(draws[1])).some(c => c[0] === 'restore'), 'board transform restored before body');
    calls.length = 0; r.meters(g);
    assert.equal(calls.find(c => c[0] === 'fillText')[1], p < 1 ? 'TRE FLIP · ROTATING' : 'TRE FLIP · CATCH READY');
    close(calls.filter(c => c[0] === 'fillRect').at(-1)[3], p * 300);
  }
  assert.deepEqual([...phases].sort(), ['board_edge', 'board_flat', 'board_flip']);
});
test('both dudes manual on two planted soles, tilted deck, rear wheel contact and transformed compact meter', () => {
  for (const id of ['jeff', 'dave']) for (const balance of [-.24, 0, .24]) {
    const { r, g, calls } = fixture(); g.chooseDude(); g.selectCharacter(id); g.restart(); g.mode = 'manual'; g.balance = balance;
    r.skater(g, 250, 436, r.groundY(g)); const stance = r.manualStance(g);
    const draws = calls.filter(c => c[0] === 'drawImage');
    assert.deepEqual(draws.map(c => c[1].key), ['board_manual', manifest.characters[id].poses[balance > .12 ? 'lean_forward' : 'lean_back']]);
    assert.deepEqual(calls.find(c => c[0] === 'transform'), ['transform', 1, -.26, 0, 1, 0, .5]);
    const deck = manifest.images.board_manual, body = manifest.images.skater_lean_back;
    const anchor = calls.find(c => c[0] === 'translate')[2];
    close(anchor + (deck.groundAnchor[1] - deck.anchor[1]) * deck.drawHeight / deck.height, r.groundY(g));
    // Pixel-measured sole centers in the unchanged lean poses; sample both feet.
    for (const [px, py] of [[160, 289], [240, 291]]) {
      const x = (px - body.anchor[0]) * body.drawWidth / body.width;
      const sole = (py - body.anchor[1]) * body.drawHeight / body.height + stance.slope * x + stance.offset;
      close(sole, -.26 * x, .4);
    }
    calls.length = 0; r.meters(g);
    const panel = calls.find(c => c[0] === 'fillRect'); assert.deepEqual(panel.slice(3), [180, 56]);
    close(panel[2] + 64, anchor - body.anchor[1] * body.drawHeight / body.height + stance.offset + stance.slope * body.drawWidth / 2);
  }
});
test('rail artwork legs end on the supporting ledge and beam stays at its physical absolute top', () => {
  const { r, g, calls } = fixture(); r.obstacle({ type: 'rail', x: 100, width: 300, height: 220, baseHeight: 180 }, g, 0);
  const draw = calls.find(c => c[0] === 'drawImage'), a = manifest.images.rail;
  close(draw[3] + a.contactTop * draw[5] / a.height, r.groundY(g) - 220);
  close(draw[3] + a.anchor[1] * draw[5] / a.height, r.groundY(g) - 180);
});

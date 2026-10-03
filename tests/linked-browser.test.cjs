'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { linkedRouteController } = require('./linked-route-helpers.js');
const OUT = path.join(__dirname, 'artifacts/linked-levels');
const URL = pathToFileURL(path.join(__dirname, '../index.html')).href;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function state(page) {
  return page.evaluate(() => {
    const g = window.SHREDDER.game;
    return { courseId: g.courseId, characterId: g.characterId, status: g.status, mode: g.mode, worldX: g.worldX,
      time: g.time, jumpZ: g.jumpZ, surface: g.surface, grounded: g.grounded, currentSpeed: g.currentSpeed,
      balanceActive: g.balanceActive, balance: g.balance, bails: g.bails, flip: g.flip, score: g.score,
      charge: g.charge, message: g.message, practice: g.practice };
  });
}
async function observe(page) {
  await page.evaluate(() => {
    const { game: g } = window.SHREDDER;
    const qa = window.linkedQA = { states: [], native: [], events: [], supports: [], grinds: [] };
    const keep = (list, item, max) => { list.push(item); if (list.length > max) list.shift(); };
    for (const type of ['keydown', 'keyup', 'touchstart', 'touchmove', 'touchend']) window.addEventListener(type, e =>
      keep(qa.native, { type, trusted: e.isTrusted, code: e.code }, 400), true);
    const emit = g.emit.bind(g);
    g.emit = (type, detail) => {
      keep(qa.events, { type, at: g.time, x: g.worldX, z: g.jumpZ, speed: g.currentSpeed, detail }, 300);
      if (type === 'grind' && !qa.grinds.includes(g.surface)) qa.grinds.push(g.surface);
      return emit(type, detail);
    };
    function frame() {
      keep(qa.states, { x: g.worldX, time: g.time, mode: g.mode, z: g.jumpZ, speed: g.currentSpeed, bails: g.bails, message: g.message }, 900);
      if (g.grounded && g.surface && !qa.supports.includes(g.surface)) qa.supports.push(g.surface);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); }
async function menu(page) {
  await page.keyboard.press('KeyP'); await page.getByRole('button', { name: 'Choose dude', exact: true }).click();
}
async function fixtureSheet(page) {
  const src = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const r = new window.ShredderRenderer.Renderer(canvas, window.SHREDDER_DATA); r.images = window.SHREDDER.renderer.images;
    const c = r.ctx; c.scale(2, 2); c.imageSmoothingEnabled = false; c.fillStyle = '#222337'; c.fillRect(0, 0, 960, 540);
    r.text('ISOLATED MANUAL POSE FIXTURES · NOT GAMEPLAY', 20, 28, 18);
    for (const [row, characterId] of ['jeff', 'dave'].entries()) for (const [col, balance] of [-.24, 0, .24].entries()) {
      const x = 150 + col * 310, feet = 205 + row * 250;
      const g = { cfg: window.SHREDDER.game.cfg, characterId, mode: 'manual', balanceActive: true, balance, time: 0 };
      r.text(`${characterId.toUpperCase()} · BALANCE ${balance}`, x, feet - 135, 14, '#fff', 'center');
      c.save(); c.translate(x, feet); c.scale(1.5, 1.5); r.skater(g, 0, 0, 13.675); c.restore();
      r.text('LEAN POSE + INDEPENDENT TILTED DECK', x, feet + 43, 10, '#80edd0', 'center');
    }
    return canvas.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'manual-closeups-FIXTURES.png'), Buffer.from(src.split(',')[1], 'base64'));
}

test('linked levels: native chooser, tre, two-foot manual fixtures and two entire trusted keyboard routes', { timeout: 220000 }, async t => {
  fs.mkdirSync(OUT, { recursive: true }); const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage(), errors = [], network = [], results = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
  await page.goto(URL); await page.getByRole('group', { name: 'Choose your level' }).waitFor(); await observe(page);
  try {
    const level = page.getByRole('radio', { name: 'Level 1: THE NIGHT SHIFT', exact: true });
    await level.focus(); await page.keyboard.press('ArrowRight');
    const linked = page.getByRole('radio', { name: 'Level 2: Linked Lines', exact: true });
    assert.equal(await linked.isChecked(), true); assert.equal(await linked.evaluate(n => n === document.activeElement), true);
    await page.keyboard.press('Space'); await page.keyboard.press('Enter');
    assert.equal((await state(page)).status, 'menu'); assert.equal((await state(page)).courseId, 'linked-lines');
    await page.getByRole('radio', { name: 'Dave', exact: true }).check(); assert.equal((await state(page)).courseId, 'linked-lines');
    await shot(page, 'native-level-menu'); await page.getByRole('button', { name: 'Practice first', exact: true }).click();
    await page.keyboard.press('KeyR'); assert.equal((await state(page)).courseId, 'linked-lines');
    await page.keyboard.down('Space'); await wait(1000); await page.keyboard.up('Space'); await wait(25);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.SHREDDER.game.flip?.kind === 'tre'); await shot(page, 'actual-keyboard-tre');
    await page.waitForFunction(() => window.SHREDDER.game.score >= 360); assert.equal((await state(page)).bails, 0);
    await page.keyboard.down('ArrowUp'); await page.waitForFunction(() => window.SHREDDER.game.mode === 'manual');
    await shot(page, 'actual-dave-manual'); await page.keyboard.up('ArrowUp');
    await fixtureSheet(page); await menu(page);
    for (const [id, title, dude] of [['linked-lines', 'Linked Lines', 'jeff'], ['gap-attack', 'Gap Attack', 'dave']]) {
      await page.locator(`input[name="course"][value="${id}"]`).check();
      await page.getByRole('radio', { name: dude === 'jeff' ? 'Jeff' : 'Dave', exact: true }).check();
      await page.getByRole('button', { name: 'Ride the street', exact: false }).click();
      await page.evaluate(() => { window.linkedQA.supports = []; window.linkedQA.grinds = []; });
      assert.match(await page.locator('.stats').innerText(), new RegExp(title));
      assert.match(await page.locator('.stats').innerText(), new RegExp(id === 'linked-lines' ? '1.90 km' : '2.20 km'));
      const objects = await page.evaluate(() => window.SHREDDER.game.objects), plan = linkedRouteController(), held = {};
      const start = Date.now(); let captured = false;
      while (Date.now() - start < 90000) {
        const g = await state(page); if (g.status === 'finished') break;
        assert.equal(g.bails, 0, JSON.stringify(g));
        const { keys } = plan({ ...g, objects });
        for (const [key, value] of Object.entries(keys)) if (!!held[key] !== !!value) {
          await page.keyboard[value ? 'down' : 'up'](key === 'Space' ? key : 'Arrow' + key); held[key] = !!value;
        }
        if (!captured && g.mode === 'grind' && g.jumpZ > 180) { await shot(page, id + '-actual-high-rail'); captured = true; }
        await wait(10);
      }
      for (const [key, value] of Object.entries(held)) if (value) await page.keyboard.up(key === 'Space' ? key : 'Arrow' + key);
      const g = await state(page); assert.equal(g.status, 'finished'); assert.equal(g.bails, 0); assert.equal(g.characterId, dude);
      const evidence = await page.evaluate(() => ({ supports: window.linkedQA.supports, grinds: window.linkedQA.grinds }));
      for (const o of objects.filter(o => o.type === 'rail')) assert.ok(evidence.grinds.includes(o.id), o.id);
      for (const height of [60, 120, 180, 240]) assert.ok(objects.some(o => o.height === height && evidence.supports.includes(o.id)));
      assert.match(await page.locator('.overlay').innerText(), new RegExp(title)); await shot(page, id + '-actual-results');
      results.push({ id, dude, ...g, wallSeconds: (Date.now() - start) / 1000, ...evidence });
      await page.getByRole('button', { name: 'Choose dude', exact: true }).click(); assert.equal((await state(page)).courseId, id);
    }
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    assert.ok(await page.evaluate(() => window.linkedQA.native.every(e => e.trusted)));
  } finally {
    fs.writeFileSync(path.join(OUT, 'trusted-keyboard-routes.json'), JSON.stringify({ results, errors, network, history: await page.evaluate(() => window.linkedQA) }, null, 2));
  }
});

test('phone: native level selection and trusted ZingTouch mid-contact tre on the real clock', { timeout: 15000 }, async t => {
  fs.mkdirSync(OUT, { recursive: true }); const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); await page.goto(URL); await page.getByRole('group', { name: 'Choose your level' }).waitFor(); await observe(page);
  await page.getByRole('radio', { name: 'Level 3: Gap Attack', exact: true }).tap();
  assert.equal((await state(page)).courseId, 'gap-attack'); assert.equal((await state(page)).status, 'menu');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('radio', { name: 'Dave', exact: true }).tap(); await page.getByRole('button', { name: 'Practice first', exact: true }).tap();
  const box = await page.locator('#game').boundingBox(), p = { x: box.x + box.width * .55, y: box.y + box.height * .5 };
  const cdp = await context.newCDPSession(page);
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1, radiusX: 3, radiusY: 3, force: 1 }] : [] });
  try {
    await touch('touchStart', p); await wait(1050); await touch('touchEnd'); await wait(25);
    await touch('touchStart', p); await touch('touchMove', { x: p.x - 18, y: p.y }); await wait(25);
    await touch('touchMove', { x: p.x - 45, y: p.y }); await wait(25);
    await touch('touchMove', { x: p.x - 26, y: p.y });
    await page.waitForFunction(() => window.SHREDDER.game.flip?.kind === 'tre');
    await touch('touchEnd'); await shot(page, 'actual-phone-tre');
    await page.waitForFunction(() => window.SHREDDER.game.score >= 360); assert.equal((await state(page)).bails, 0);
    assert.equal((await state(page)).characterId, 'dave'); assert.equal((await state(page)).courseId, 'gap-attack');
    assert.ok(await page.evaluate(() => window.linkedQA.native.filter(e => e.type.startsWith('touch')).every(e => e.trusted)));
  } finally {
    fs.writeFileSync(path.join(OUT, 'trusted-phone-tre.json'), JSON.stringify(await page.evaluate(() => window.linkedQA), null, 2));
  }
});

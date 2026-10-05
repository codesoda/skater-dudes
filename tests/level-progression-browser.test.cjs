'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Explicit short-course integration fixtures. Normal rAF and natural Game.step
// finishes test native controls, not production route traversal or phone skill.
const bundle = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const marker = 'const game = new window.ShredderCore.Game(data.settings, data.course, data.courses);';
assert.ok(bundle.includes(marker));
const fixture = bundle.replace(marker, `data.courses = data.courses.map(entry => ({ ...entry,
  course: { ...entry.course, length: 560, objects: [] } }));
  ${marker}`);
async function snapshot(page) {
  return page.evaluate(() => {
    const { game: g, input, runner, audio } = window.SHREDDER;
    return { level: g.levelNumber, status: g.status, character: g.characterId, space: g.space,
      keys: g.keys, score: g.score, combo: g.combo, bails: g.bails, speed: g.currentSpeed,
      queue: input.queue.length, held: input.held.size, accumulator: runner.accumulator,
      loops: audio.loops.size, time: g.time, jumpZ: g.jumpZ };
  });
}
for (const phone of [false, true]) test(`${phone ? 'phone touch' : 'desktop keyboard'}: short-course FIXTURE native replay and next, no menu unlock`, { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ offline: true, viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 1000 }, isMobile: phone, hasTouch: phone });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setContent(fixture); await page.getByRole('group', { name: 'Choose your dude' }).waitFor();
  const press = async name => {
    const button = page.getByRole('button', { name, exact: true });
    if (phone) await button.tap(); else { await button.focus(); await page.keyboard.press('Enter'); }
  };
  const finished = () => page.getByRole('heading', { name: 'LINE FINISHED.', exact: true }).waitFor();
  assert.equal((await snapshot(page)).loops, 0);
  await page.getByRole('radio', { name: 'Dave', exact: true }).check();
  await press('Ride the street  ↗');
  await page.keyboard.down('Space'); await finished();
  await press('Play Level 1 again'); await page.keyboard.up('Space');
  let s = await snapshot(page);
  assert.equal(s.level, 1); assert.equal(s.space, null); assert.equal(s.jumpZ, 0); assert.equal(s.held, 0);
  assert.equal(s.score, 0); assert.equal(s.combo, 0); assert.equal(s.bails, 0); assert.equal(s.speed, 280);
  await finished(); await press('Go to Level 2');
  // A stale command/double activation must not skip the newly started level.
  await page.evaluate(() => { window.SHREDDER.command('next-level'); window.SHREDDER.command('course:gap-attack'); });
  s = await snapshot(page); assert.equal(s.level, 2); assert.equal(s.character, 'dave'); assert.equal(s.queue, 0);
  await pressToolbar(page, 'Controls / I', phone);
  assert.equal((await snapshot(page)).level, 2); assert.equal(await page.getByRole('button', { name: /Go to Level/ }).count(), 0);
  await press('Choose dude');
  assert.equal((await snapshot(page)).loops, 0); assert.equal((await snapshot(page)).level, 2);
  assert.match(await page.locator('.current-level').innerText(), /Level 2: Linked Lines/);
  assert.equal(await page.getByRole('radio').count(), 2);
  await press('Practice first'); await page.keyboard.press('KeyR');
  await pressToolbar(page, 'Pause / P', phone); await press('Ride the route');
  assert.equal((await snapshot(page)).level, 2); await finished();
  await press('Play Level 2 again'); assert.equal((await snapshot(page)).level, 2); await finished();
  await press('Go to Level 3'); assert.equal((await snapshot(page)).character, 'dave'); await finished();
  assert.match(await page.locator('.overlay').innerText(), /Campaign completed\./);
  assert.equal(await page.getByRole('button', { name: /Go to Level/ }).count(), 0);
  await press('Play Level 3 again'); assert.equal((await snapshot(page)).level, 3);
  assert.equal((await snapshot(page)).score, 0); assert.deepEqual(errors, []);
});
async function pressToolbar(page, name, phone) {
  const button = page.getByRole('button', { name, exact: true });
  if (phone) await button.tap(); else await button.click();
}

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReport } = require('../scripts/scan.cjs');
const engines = ['format', 'lint', 'code-quality', 'ai-slop', 'security'];
function report() {
  return { cliVersion: '0.16.1', schemaVersion: '1', scoreable: true, score: 100,
    coverage: { scoreable: true, supportedFiles: 15 }, diagnostics: [], summary: { errors: 0 },
    engines: Object.fromEntries(engines.map(engine => [engine, { skipped: false }])) };
}
test('quality gate accepts only complete pinned scoreable reports at 95 or above', () => {
  assert.doesNotThrow(() => validateReport(report(), 95, 0));
  for (const mutate of [r => { r.score = 94; }, r => { r.score = NaN; }, r => { r.scoreable = false; },
    r => { r.coverage.scoreable = false; }, r => { r.coverage.supportedFiles = 0; },
    r => { r.cliVersion = 'other'; }, r => { r.schemaVersion = 'other'; },
    r => { r.summary.errors = 1; }, r => { delete r.diagnostics; }]) {
    const broken = report(); mutate(broken); assert.throws(() => validateReport(broken, 95, 0));
  }
  for (const engine of engines) { const broken = report(); broken.engines[engine].skipped = true; assert.throws(() => validateReport(broken, 95, 0)); }
  assert.throws(() => validateReport(report(), 94, 0)); assert.throws(() => validateReport(report(), 95, 1));
});
test('recognized scanner config keeps authored JS/Python/tests in scope; dependencies are exact', async () => {
  const root = path.resolve(__dirname, '..');
  const { loadConfig } = await import('aislop'); const config = loadConfig(root);
  assert.equal(config.ci.failBelow, 95);
  const yaml = fs.readFileSync(path.join(root, '.aislop/config.yml'), 'utf8');
  assert.ok(!/disable|rules:|\.test\.cjs|web\/\*|scripts\/\*|tests\/\*\*/.test(yaml));
  const pkg = require('../package.json'); assert.equal(pkg.name, 'skater-dudes');
  const lock = require('../package-lock.json');
  assert.equal(lock.name, pkg.name); assert.equal(lock.packages[''].name, pkg.name);
  assert.deepEqual(pkg.devDependencies, { playwright: '1.62.1', aislop: '0.16.1' });
  for (const file of fs.readdirSync(__dirname)) if (file.endsWith('.cjs')) assert.ok(file.endsWith('.test.cjs'), file);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const provenance = require('../vendor/zingtouch/provenance.json');
test('vendored ZingTouch is the exact official locked npm distribution and MIT license', () => {
  const pkg = require('../package.json'), lock = require('../package-lock.json');
  assert.deepEqual(pkg.dependencies, { zingtouch: '1.0.6' });
  assert.equal(lock.packages[''].dependencies.zingtouch, provenance.version);
  const entry = lock.packages['node_modules/zingtouch'];
  assert.equal(entry.version, '1.0.6'); assert.equal(entry.integrity, provenance.integrity);
  assert.equal(entry.resolved, provenance.registry);
  const installed = require('../node_modules/zingtouch/package.json');
  assert.equal(installed.version, '1.0.6'); assert.equal(installed.license, 'MIT');
  assert.equal(Object.keys(installed.dependencies || {}).length, 0);
  for (const [name, sha256] of Object.entries(provenance.files)) {
    const bytes = fs.readFileSync(path.join(root, 'vendor/zingtouch', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256);
    assert.deepEqual(bytes, fs.readFileSync(path.join(root, 'node_modules/zingtouch', name === 'LICENSE' ? name : 'dist/' + name)));
  }
});
test('standalone artifact embeds the verbatim vendor bundle and its full license before the adapter', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const bundle = fs.readFileSync(path.join(root, 'vendor/zingtouch/zingtouch.min.js'), 'utf8');
  const license = fs.readFileSync(path.join(root, 'vendor/zingtouch/LICENSE'), 'utf8');
  assert.ok(html.includes(bundle)); assert.ok(html.includes(license));
  assert.ok(html.indexOf(bundle) < html.indexOf('const SLOP = 12'));
  assert.ok(html.indexOf(license) < html.indexOf(bundle));
});

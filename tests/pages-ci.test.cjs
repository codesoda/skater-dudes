'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
const [checks, deploy] = workflow.split('\n  deploy:\n');

test('Pages checks install locked tools and prepare ignored QA before the full suite', () => {
  const commands = [...checks.matchAll(/^        run: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(commands, ['npm ci', 'python3 -m pip install -r assets/requirements-build.txt',
    'npx --no-install playwright install chromium --with-deps', 'python3 scripts/prepare_assets.py',
    'npm test', 'npm run scan']);
  assert.match(checks, /SHREDDER_BROWSER: chromium-headless-shell/);
  assert.match(checks, /node-version: '24'/);
  assert.match(checks, /python-version: '3\.12'/);
  const requirements = fs.readFileSync(path.join(root, 'assets/requirements-build.txt'), 'utf8');
  assert.deepEqual(requirements.split('\n').filter(line => line && !line.startsWith('#')), ['Pillow==11.3.0']);
  assert.match(require('../package.json').scripts.test, /^npm run build && .*tests\/\*\.test\.cjs$/);
});

test('Pages actions are SHA pinned and failures keep quality evidence without bypasses', () => {
  const actions = [...workflow.matchAll(/uses: (\S+)/g)].map(match => match[1]);
  assert.equal(actions.length, 8);
  for (const action of actions) assert.match(action, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true/);
  assert.match(checks, /if: \$\{\{ !cancelled\(\) && steps\.install\.outcome == 'success' \}\}\n        run: npm run scan/);
  assert.match(checks, /if: \$\{\{ !cancelled\(\) && steps\.scan\.outcome != 'skipped' \}\}\n        uses: actions\/upload-artifact@/);
  assert.match(checks, /path: tests\/artifacts\/quality\//);
  assert.match(checks, /if-no-files-found: error/);
});

test('Pages retains bounded browser failure history without changing test or deploy gates', () => {
  assert.match(checks, /name: Save browser failure history\n        if: \$\{\{ failure\(\) \}\}\n        uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(checks, /name: ci-browser-failure\n          path: tests\/artifacts\/ci-browser\/\n          if-no-files-found: warn\n          retention-days: 14/);
});

test('Pages deploys only checked main artifacts with isolated write permissions', () => {
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]\n  pull_request:\n    branches: \[main\]\n  workflow_dispatch:/);
  assert.match(checks, /permissions:\n  contents: read/);
  assert.doesNotMatch(checks, /pages: write|id-token: write/);
  const mainOnly = /if: \$\{\{ success\(\) && github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request' \}\}/;
  assert.match(checks, mainOnly);
  assert.match(checks, /uses: actions\/upload-pages-artifact@[a-f0-9]{40}[^\n]*\n        with:\n          path: dist/);
  assert.match(deploy, /needs: checks/);
  assert.match(deploy, mainOnly);
  assert.match(deploy, /permissions:\n      pages: write\n      id-token: write/);
  assert.match(deploy, /group: github-pages\n      cancel-in-progress: false/);
  assert.match(deploy, /environment:\n      name: github-pages/);
});

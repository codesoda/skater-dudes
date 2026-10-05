'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAudit } = require('../scripts/scan.cjs');
const trackedPolicy = require('../security/audit-waivers.json');
const trackedLock = require('../package-lock.json');
const NOW = Date.parse('2026-10-05T06:02:52Z');

// npm audit --json, 2026-10-05: the complete three-entry scanner finding.
function fixture() {
  const fixAvailable = { name: 'aislop', version: '0.6.0', isSemVerMajor: true };
  return { status: 1, signal: null, report: {
    auditReportVersion: 2,
    vulnerabilities: {
      aislop: { name: 'aislop', severity: 'high', isDirect: true, via: ['micromatch'], effects: [],
        range: '>=0.6.1', nodes: ['node_modules/aislop'], fixAvailable: { ...fixAvailable } },
      braces: { name: 'braces', severity: 'high', isDirect: false, via: [{ source: 1240992,
        name: 'braces', dependency: 'braces',
        title: 'braces vulnerable to stack-exhaustion denial of service through deeply nested patterns',
        url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm', severity: 'high', cwe: ['CWE-674'],
        cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' }, range: '<=3.0.3' }],
      effects: ['micromatch'], range: '*', nodes: ['node_modules/braces'], fixAvailable: { ...fixAvailable } },
      micromatch: { name: 'micromatch', severity: 'high', isDirect: false, via: ['braces'], effects: ['aislop'],
        range: '>=0.2.0', nodes: ['node_modules/micromatch'], fixAvailable: { ...fixAvailable } }
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 3, critical: 0, total: 3 },
      dependencies: { prod: 2, dev: 257, optional: 72, peer: 0, peerOptional: 0, total: 258 } }
  } };
}

function validate(audit = fixture(), policy = structuredClone(trackedPolicy), lock = trackedLock, now = NOW) {
  return validateAudit(audit, policy, lock, now);
}

test('only the authorized current scanner advisory is waived without mutating its raw report', () => {
  const audit = fixture();
  const before = JSON.stringify(audit);
  const policy = structuredClone(trackedPolicy);
  const policyBefore = JSON.stringify(policy);
  const lockBefore = JSON.stringify(trackedLock);
  const result = validate(audit, policy);
  assert.equal(result.applied, true);
  assert.equal(result.advisory, 'GHSA-vfj7-8cjw-p6xm');
  assert.equal(result.policy, 'security/audit-waivers.json');
  assert.deepEqual(result.reportCounts, audit.report.metadata.vulnerabilities);
  assert.equal(result.expiresAt, '2026-10-19T06:02:52Z');
  assert.equal(JSON.stringify(audit), before);
  assert.equal(JSON.stringify(policy), policyBefore);
  assert.equal(JSON.stringify(trackedLock), lockBefore);
});

const policyFailures = {
  expired: p => { p.waivers[0].expiresAt = '2026-10-05T06:02:52Z'; },
  future: p => { p.waivers[0].issuedAt = '2026-10-06T06:02:52Z'; },
  'malformed expiry': p => { p.waivers[0].expiresAt = 'tomorrow'; },
  'malformed issue date': p => { p.waivers[0].issuedAt = null; },
  'invalid calendar date': p => { p.waivers[0].expiresAt = '2026-02-30T06:02:52Z'; },
  'missing timezone': p => { p.waivers[0].expiresAt = '2026-10-19T06:02:52'; },
  'overlong duration': p => { p.waivers[0].expiresAt = '2026-10-20T06:02:52Z'; },
  'reversed interval': p => { p.waivers[0].expiresAt = '2026-10-04T06:02:52Z'; },
  unapproved: p => { p.waivers[0].authorization = 'automatic'; },
  'id mismatch': p => { p.waivers[0].id = 'GHSA-other'; },
  wildcard: p => { p.waivers[0].id = '*'; },
  'URL mismatch': p => { p.waivers[0].url += '/'; },
  'missing reason': p => { delete p.waivers[0].reason; },
  'missing waiver': p => { p.waivers = []; },
  'extra waiver': p => { p.waivers.push({ ...p.waivers[0] }); },
  'unknown schema': p => { p.schemaVersion = 2; }
};
for (const [name, mutate] of Object.entries(policyFailures)) {
  test(`audit rejects waiver: ${name}`, () => {
    const policy = structuredClone(trackedPolicy); mutate(policy);
    assert.throws(() => validate(fixture(), policy), /Dependency audit rejected/);
  });
}

const reportFailures = {
  'exit status 2': a => { a.status = 2; },
  'vulnerable exit status 0': a => { a.status = 0; },
  'null exit status': a => { a.status = null; },
  signal: a => { a.signal = 'SIGTERM'; },
  'process error': a => { a.error = new Error('spawn failed'); },
  'report error': a => { a.report.error = { code: 'EFAIL' }; },
  'null report error': a => { a.report.error = null; },
  'missing metadata': a => { delete a.report.metadata; },
  'missing dependency counts': a => { delete a.report.metadata.dependencies; },
  'missing vulnerabilities': a => { delete a.report.vulnerabilities; },
  'array vulnerabilities': a => { a.report.vulnerabilities = []; },
  'wrong report version': a => { a.report.auditReportVersion = 1; },
  'missing count': a => { delete a.report.metadata.vulnerabilities.low; },
  'inconsistent counts': a => { a.report.metadata.vulnerabilities.total = 2; },
  'negative count': a => { a.report.metadata.vulnerabilities.low = -1; },
  'fractional count': a => { a.report.metadata.vulnerabilities.high = 2.5; },
  'nonfinite count': a => { a.report.metadata.vulnerabilities.high = Infinity; },
  'string count': a => { a.report.metadata.vulnerabilities.high = '3'; },
  'unknown count': a => { a.report.metadata.vulnerabilities.other = 0; },
  'new package chain': a => { a.report.vulnerabilities.micromatch.via = ['unknown']; },
  'extra chain': a => { a.report.vulnerabilities.aislop.via.push('braces'); },
  'extra effect': a => { a.report.vulnerabilities.braces.effects.push('other'); },
  'extra path': a => { a.report.vulnerabilities.braces.nodes.push('node_modules/other/node_modules/braces'); },
  'changed path': a => { a.report.vulnerabilities.braces.nodes = ['node_modules/other']; },
  'package name': a => { a.report.vulnerabilities.braces.name = 'other'; },
  'null package': a => { a.report.vulnerabilities.braces = null; },
  'changed directness': a => { a.report.vulnerabilities.braces.isDirect = true; },
  'changed range': a => { a.report.vulnerabilities.micromatch.range = '*'; },
  'unknown CVE': a => { a.report.vulnerabilities.braces.via[0].url = 'https://nvd.nist.gov/vuln/detail/CVE-2026-0001'; },
  'unknown advisory': a => { a.report.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/GHSA-other'; },
  'additional advisory': a => { a.report.vulnerabilities.braces.via.push({ ...a.report.vulnerabilities.braces.via[0] }); },
  'transitive advisory object': a => { a.report.vulnerabilities.aislop.via = [{ ...a.report.vulnerabilities.braces.via[0] }]; },
  'root string': a => { a.report.vulnerabilities.braces.via = ['braces']; },
  'root dependency': a => { a.report.vulnerabilities.braces.via[0].dependency = 'other'; },
  'root name': a => { a.report.vulnerabilities.braces.via[0].name = 'other'; },
  'root range': a => { a.report.vulnerabilities.braces.via[0].range = '*'; },
  'root severity': a => { a.report.vulnerabilities.braces.via[0].severity = 'low'; },
  'record severity': a => { a.report.vulnerabilities.braces.severity = 'low'; },
  'consistent changed severity': a => {
    a.report.vulnerabilities.braces.severity = 'low';
    a.report.metadata.vulnerabilities.low = 1; a.report.metadata.vulnerabilities.high = 2;
  }
};
for (const [name, mutate] of Object.entries(reportFailures)) {
  test(`audit rejects report: ${name}`, () => {
    const audit = fixture(); mutate(audit);
    assert.throws(() => validate(audit), /Dependency audit rejected/);
  });
}
for (const severity of ['high', 'low']) {
  test(`an unrelated new ${severity} finding is never waived`, () => {
    const audit = fixture();
    audit.report.vulnerabilities.other = { ...audit.report.vulnerabilities.braces, name: 'other', severity };
    audit.report.metadata.vulnerabilities[severity] += 1; audit.report.metadata.vulnerabilities.total += 1;
    assert.throws(() => validate(audit), /Dependency audit rejected/);
  });
}
for (const name of ['aislop', 'micromatch', 'braces']) {
  test(`waiver requires exact locked dev-only ${name}`, () => {
    const lock = structuredClone(trackedLock); lock.packages[`node_modules/${name}`].version = '99.0.0';
    assert.throws(() => validate(fixture(), trackedPolicy, lock), /Dependency audit rejected/);
    lock.packages[`node_modules/${name}`].version = trackedLock.packages[`node_modules/${name}`].version;
    lock.packages[`node_modules/${name}`].dev = false;
    assert.throws(() => validate(fixture(), trackedPolicy, lock), /Dependency audit rejected/);
  });
}

test('waiver clock has inclusive issue time and exclusive expiry; invalid clocks fail closed', () => {
  const expires = Date.parse(trackedPolicy.waivers[0].expiresAt);
  assert.equal(validate(fixture(), trackedPolicy, trackedLock, expires - 1).applied, true);
  for (const now of [NOW - 1, expires, expires + 1, NaN, Infinity]) {
    assert.throws(() => validate(fixture(), trackedPolicy, trackedLock, now), /Dependency audit rejected/);
  }
});

test('complete clean audit needs no exception, even with an unused expired waiver', () => {
  const audit = fixture(); audit.status = 0; audit.report.vulnerabilities = {};
  for (const key of Object.keys(audit.report.metadata.vulnerabilities)) audit.report.metadata.vulnerabilities[key] = 0;
  const result = validate(audit, trackedPolicy, trackedLock, Date.parse('2026-10-20T00:00:00Z'));
  assert.equal(result.applied, false); assert.equal(result.advisory, null); assert.equal(result.reportCounts.total, 0);
  assert.equal(validate(audit, null, null).applied, false);
  audit.status = 1; assert.throws(() => validate(audit), /Dependency audit rejected/);
});

/* Fail-closed quality gate around the pinned scanner's native CI command. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const ENGINES = ['format', 'lint', 'code-quality', 'ai-slop', 'security'];

function validateReport(report, threshold, status) {
  if (!Number.isFinite(threshold) || threshold < 95 || threshold > 100) {
    throw new Error('AISLOP ci.failBelow must be between 95 and 100.');
  }
  if (status !== 0 || report.cliVersion !== '0.16.1' || report.schemaVersion !== '1') {
    throw new Error('The pinned AISLOP CI command did not complete successfully.');
  }
  if (report.scoreable !== true || report.coverage?.scoreable !== true ||
      !(report.coverage.supportedFiles > 0) || !Number.isFinite(report.score) || report.score < threshold) {
    throw new Error(`AISLOP requires a scoreable result of at least ${threshold}/100.`);
  }
  for (const engine of ENGINES) {
    if (report.engines?.[engine]?.skipped !== false) throw new Error(`AISLOP engine unavailable: ${engine}`);
  }
  if (!Array.isArray(report.diagnostics) || report.summary?.errors !== 0) {
    throw new Error('AISLOP report is incomplete or contains errors.');
  }
}

const ADVISORY = 'GHSA-vfj7-8cjw-p6xm';
const ADVISORY_URL = `https://github.com/advisories/${ADVISORY}`;
const WAIVER_PATH = 'security/audit-waivers.json';
const PACKAGES = { aislop: '0.16.1', micromatch: '4.0.8', braces: '3.0.3' };
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

function requireAudit(condition, message) {
  if (!condition) throw new Error(`Dependency audit rejected: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameList(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function validateAuditCounts(report) {
  requireAudit(isRecord(report) && report.auditReportVersion === 2 &&
    !Object.hasOwn(report, 'error') && isRecord(report.vulnerabilities), 'incomplete report');
  const counts = report.metadata?.vulnerabilities;
  const keys = [...SEVERITIES, 'total'];
  requireAudit(isRecord(counts) && sameList(Object.keys(counts).sort(), [...keys].sort()) &&
    keys.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0), 'invalid vulnerability counts');
  const entries = Object.values(report.vulnerabilities);
  requireAudit(counts.total === entries.length && entries.every(isRecord) &&
    SEVERITIES.every(severity => counts[severity] === entries.filter(entry => entry.severity === severity).length) &&
    SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0) === counts.total, 'inconsistent vulnerability counts');
  const dependencies = report.metadata?.dependencies;
  requireAudit(isRecord(dependencies) && ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total']
    .every(key => Number.isSafeInteger(dependencies[key]) && dependencies[key] >= 0), 'missing dependency counts');
  return { ...counts };
}

function waiverTimestamp(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  requireAudit(Number.isFinite(timestamp) && new Date(timestamp).toISOString().replace('.000Z', 'Z') === value,
    'waiver dates must be valid canonical UTC ISO timestamps');
  return timestamp;
}

function validateWaiver(policy, now) {
  requireAudit(policy?.schemaVersion === 1 && Array.isArray(policy.waivers) && policy.waivers.length === 1,
    'missing or ambiguous waiver policy');
  const waiver = policy.waivers[0];
  requireAudit(waiver?.id === ADVISORY && waiver.url === ADVISORY_URL &&
    waiver.authorization === 'user deployment override' && typeof waiver.reason === 'string' && waiver.reason.trim().length > 0,
    'unapproved advisory waiver');
  const issuedAt = waiverTimestamp(waiver.issuedAt);
  const expiresAt = waiverTimestamp(waiver.expiresAt);
  requireAudit(Number.isFinite(now) && now >= issuedAt && now < expiresAt && expiresAt > issuedAt &&
    expiresAt - issuedAt <= 14 * 24 * 60 * 60 * 1000, 'waiver is inactive or exceeds 14 days');
  return waiver;
}

function validateKnownChain(report, lock) {
  requireAudit(sameList(Object.keys(report.vulnerabilities).sort(), Object.keys(PACKAGES).sort()), 'unexpected vulnerable package');
  const chains = {
    aislop: { via: ['micromatch'], effects: [], range: '>=0.6.1', direct: true },
    micromatch: { via: ['braces'], effects: ['aislop'], range: '>=0.2.0', direct: false },
    braces: { effects: ['micromatch'], range: '*', direct: false }
  };
  for (const [name, version] of Object.entries(PACKAGES)) {
    const record = report.vulnerabilities[name];
    const expected = chains[name];
    const node = `node_modules/${name}`;
    requireAudit(record.name === name && record.severity === 'high' && record.isDirect === expected.direct &&
      record.range === expected.range && sameList(record.nodes, [node]) && sameList(record.effects, expected.effects),
      `unexpected ${name} finding`);
    requireAudit(lock?.packages?.[node]?.version === version && lock.packages[node].dev === true,
      `unexpected ${name} version or dependency scope`);
    if (expected.via) requireAudit(sameList(record.via, expected.via), `unexpected ${name} advisory chain`);
  }
  const via = report.vulnerabilities.braces.via;
  requireAudit(Array.isArray(via) && via.length === 1 && isRecord(via[0]), 'unexpected root advisories');
  const root = via[0];
  requireAudit(root.url === ADVISORY_URL && root.name === 'braces' && root.dependency === 'braces' &&
    root.severity === 'high' && root.range === '<=3.0.3', 'unexpected root advisory');
}

function validateAudit(audit, policy, lock, now = Date.now()) {
  requireAudit(isRecord(audit) && !audit.error && !audit.signal && [0, 1].includes(audit.status), 'audit command failed');
  const counts = validateAuditCounts(audit.report);
  if (counts.total === 0) {
    requireAudit(audit.status === 0, 'clean audit exited unsuccessfully');
    return { applied: false, policy: WAIVER_PATH, advisory: null, reportCounts: counts, expiresAt: null };
  }
  requireAudit(audit.status === 1 && counts.total === 3 && counts.high === 3, 'unexpected audit result');
  validateKnownChain(audit.report, lock);
  const waiver = validateWaiver(policy, now);
  return { applied: true, policy: WAIVER_PATH, advisory: waiver.id, url: waiver.url,
    authorization: waiver.authorization, reason: waiver.reason, issuedAt: waiver.issuedAt,
    expiresAt: waiver.expiresAt, reportCounts: counts };
}

function runReport(command, args, name, output) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 120000,
    maxBuffer: 16 * 1024 * 1024, env: { ...process.env, AISLOP_NO_HISTORY: '1' } });
  fs.writeFileSync(path.join(output, name + '.json'), result.stdout || '');
  fs.writeFileSync(path.join(output, name + '.stderr.txt'), result.stderr || String(result.error || ''));
  if (result.error) throw result.error;
  return { report: JSON.parse(result.stdout), status: result.status, signal: result.signal };
}

async function main() {
  const output = path.join(ROOT, 'tests/artifacts/quality');
  fs.mkdirSync(output, { recursive: true });
  fs.rmSync(path.join(output, 'audit-waiver.json'), { force: true });
  const { loadConfig } = await import('aislop');
  const config = loadConfig(ROOT);
  const cli = path.join(path.dirname(require.resolve('aislop')), 'cli.js');
  const scan = runReport(process.execPath, [cli, 'ci'], 'aislop', output);
  validateReport(scan.report, config.ci.failBelow, scan.status);
  // The scanner can hide rejected audit sub-tasks. Require a complete audit too.
  const audit = runReport('npm', ['audit', '--json'], 'npm-audit', output);
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, WAIVER_PATH), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const decision = validateAudit(audit, policy, lock);
  fs.writeFileSync(path.join(output, 'audit-waiver.json'), JSON.stringify(decision, null, 2) + '\n');
  const auditStatus = decision.applied
    ? `known advisory waived ${decision.advisory}; expires ${decision.expiresAt}` : 'audit clean';
  console.log(`AISLOP ${scan.report.score}/100 (minimum ${config.ci.failBelow}); all five engines completed; ${auditStatus}.`);
}

module.exports = { validateReport, validateAudit };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

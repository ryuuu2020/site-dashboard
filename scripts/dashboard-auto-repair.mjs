#!/usr/bin/env node

import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPORT_JSON = process.env.REPORT_JSON || 'reports/health/latest.json';
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_SCOPE = process.env.VERCEL_SCOPE || 'sonic6640-6280';
const VERCEL_REDEPLOY_TARGET = process.env.VERCEL_REDEPLOY_TARGET || 'site-dashboard-theta.vercel.app';

function canAutoRepair(issue) {
  return issue.autoFix === 'redeploy-dashboard';
}

async function main() {
  const report = JSON.parse(await fs.readFile(REPORT_JSON, 'utf8'));
  const repairableIssues = (report.issues || []).filter(canAutoRepair);

  const payload = {
    generatedAt: new Date().toISOString(),
    reportStatus: report.status,
    repairableIssueCount: repairableIssues.length,
    triggered: false,
    skippedReason: null,
    deployResponse: null,
  };

  if (repairableIssues.length === 0) {
    payload.skippedReason = 'no-repairable-issues';
  } else if (!VERCEL_TOKEN) {
    payload.skippedReason = 'missing-vercel-token';
  } else {
    const result = await execFileAsync(
      'npx',
      [
        'vercel',
        'redeploy',
        VERCEL_REDEPLOY_TARGET,
        '--scope',
        VERCEL_SCOPE,
        '--token',
        VERCEL_TOKEN,
        '--no-wait',
      ],
      { maxBuffer: 1024 * 1024 }
    );
    payload.triggered = true;
    payload.deployResponse = {
      ok: true,
      status: 200,
      body: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    };
    if (!payload.deployResponse.body) {
      payload.deployResponse.body = 'redeploy triggered';
    }
    if (!payload.triggered) {
      payload.skippedReason = 'redeploy-failed';
      console.error(JSON.stringify(payload, null, 2));
      process.exit(1);
    }
  }

  await fs.writeFile('reports/health/repair-latest.json', JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

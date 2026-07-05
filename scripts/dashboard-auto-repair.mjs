#!/usr/bin/env node

import fs from 'node:fs/promises';

const REPORT_JSON = process.env.REPORT_JSON || 'reports/health/latest.json';
const DEPLOY_HOOK_URL = process.env.VERCEL_DEPLOY_HOOK_URL || '';

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
  } else if (!DEPLOY_HOOK_URL) {
    payload.skippedReason = 'missing-vercel-deploy-hook';
  } else {
    const response = await fetch(DEPLOY_HOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'dashboard-auto-repair',
        issues: repairableIssues.map((issue) => issue.code),
      }),
    });
    payload.triggered = response.ok;
    payload.deployResponse = {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
    if (!response.ok) {
      payload.skippedReason = `deploy-hook-http-${response.status}`;
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

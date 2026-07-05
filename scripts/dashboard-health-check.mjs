#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = (process.env.DASHBOARD_BASE_URL || 'https://site-dashboard-theta.vercel.app').replace(/\/+$/, '');
const REPORT_DIR = path.resolve(process.cwd(), process.env.REPORT_DIR || 'reports/health');
const ACTIVITY_MAX_AGE_HOURS = Number(process.env.ACTIVITY_MAX_AGE_HOURS || 72);
const ANALYTICS_MAX_AGE_HOURS = Number(process.env.ANALYTICS_MAX_AGE_HOURS || 36);
const BEIJING_LOCALE = 'zh-CN';
const BEIJING_TIMEZONE = 'Asia/Shanghai';

function nowIso() {
  return new Date().toISOString();
}

function formatBeijing(isoString) {
  if (!isoString) {
    return '未知';
  }
  const value = new Date(isoString);
  if (Number.isNaN(value.getTime())) {
    return String(isoString);
  }
  return value.toLocaleString(BEIJING_LOCALE, { timeZone: BEIJING_TIMEZONE, hour12: false });
}

function hoursBetween(isoString, reference = new Date()) {
  const value = new Date(isoString);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return Number(((reference.getTime() - value.getTime()) / 36e5).toFixed(2));
}

async function fetchJson(endpoint) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const url = `${BASE_URL}${endpoint}?ts=${Date.now()}`;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'dashboard-health-check' },
      });
      if (!response.ok) {
        throw new Error(`${endpoint} -> HTTP ${response.status}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    }
  }
  throw lastError;
}

function buildIssue({ severity, code, summary, details, autoFix, sites = [] }) {
  return { severity, code, summary, details, autoFix, sites };
}

function pickLatestActivityTimestamp(entries) {
  const timestamps = (entries || [])
    .map((entry) => entry?.timestamp)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return timestamps[0]?.toISOString() || null;
}

function summarizeRepairPlan(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = issue.autoFix;
    const current = groups.get(key) || [];
    current.push(issue.summary);
    groups.set(key, current);
  }
  return Array.from(groups.entries()).map(([autoFix, summaries]) => ({
    autoFix,
    count: summaries.length,
    summaries,
  }));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# Dashboard Health Report');
  lines.push('');
  lines.push(`- 时间: ${formatBeijing(report.generatedAt)}（北京时间）`);
  lines.push(`- 目标: ${report.baseUrl}`);
  lines.push(`- 站点数: ${report.siteCount}`);
  lines.push(`- 扫描状态: ${report.scan.summary}`);
  lines.push(`- 扫描来源: ${report.scan.source}`);
  lines.push(`- 扫描耗时: ${report.scan.durationMs}ms`);
  lines.push(`- 巡检结果: ${report.status.toUpperCase()}`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push(`- 在线异常: ${report.scan.offlineSites.length ? report.scan.offlineSites.join('、') : '无'}`);
  lines.push(`- ads.txt 异常: ${report.scan.missingAdsTxtSites.length ? report.scan.missingAdsTxtSites.join('、') : '无'}`);
  lines.push(`- 头图缺失: ${report.scan.missingHeroSites.length ? report.scan.missingHeroSites.join('、') : '无'}`);
  lines.push(`- 最近动态最新时间: ${report.activity.latestEntryAt ? `${formatBeijing(report.activity.latestEntryAt)}（距今 ${report.activity.latestEntryAgeHours}h）` : '无有效时间戳'}`);
  lines.push(`- Analytics 快照时间: ${report.analytics.generatedAt ? `${formatBeijing(report.analytics.generatedAt)}（距今 ${report.analytics.ageHours}h）` : '无'}`);
  lines.push('');
  lines.push('## Issues');
  lines.push('');
  if (report.issues.length === 0) {
    lines.push('- 无异常');
  } else {
    for (const issue of report.issues) {
      lines.push(`- [${issue.severity}] ${issue.summary}`);
      lines.push(`  说明: ${issue.details}`);
      lines.push(`  处理: ${issue.autoFix}`);
    }
  }
  lines.push('');
  lines.push('## Repair Queue');
  lines.push('');
  for (const item of report.repairPlan) {
    lines.push(`- ${item.autoFix}: ${item.count} 项`);
  }
  return lines.join('\n') + '\n';
}

async function writeReport(report) {
  const latestJsonPath = path.join(REPORT_DIR, 'latest.json');
  const latestMdPath = path.join(REPORT_DIR, 'latest.md');
  const stamp = report.generatedAt.replace(/[:]/g, '-');
  const historyJsonPath = path.join(REPORT_DIR, `${stamp}.json`);
  const historyMdPath = path.join(REPORT_DIR, `${stamp}.md`);
  const markdown = buildMarkdown(report);

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(latestJsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(latestMdPath, markdown, 'utf8');
  await fs.writeFile(historyJsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(historyMdPath, markdown, 'utf8');

  console.log(markdown);
  console.log(`JSON report: ${latestJsonPath}`);
  console.log(`Markdown report: ${latestMdPath}`);

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `report_json=${latestJsonPath}\nreport_md=${latestMdPath}\n`, 'utf8');
  }
}

async function main() {
  const generatedAt = nowIso();
  let sitesPayload;
  let scanPayload;
  let activityPayload;
  let analyticsPayload;

  try {
    [sitesPayload, scanPayload, activityPayload, analyticsPayload] = await Promise.all([
      fetchJson('/api/sites'),
      fetchJson('/api/site-status'),
      fetchJson('/api/activity'),
      fetchJson('/api/analytics'),
    ]);
  } catch (error) {
    const report = {
      generatedAt,
      baseUrl: BASE_URL,
      status: 'failed',
      siteCount: 0,
      scan: {
        source: 'unavailable',
        durationMs: 0,
        summary: '0/0/0 在线/头图/广告',
        offlineSites: [],
        missingHeroSites: [],
        missingAdsTxtSites: [],
      },
      activity: {
        source: 'unavailable',
        entries: 0,
        latestEntryAt: null,
        latestEntryAgeHours: null,
      },
      analytics: {
        source: 'unavailable',
        generatedAt: null,
        ageHours: null,
        siteStatsCount: 0,
      },
      issues: [
        buildIssue({
          severity: 'error',
          code: 'dashboard_fetch_failed',
          summary: '生产接口巡检失败',
          details: error?.message || String(error),
          autoFix: 'redeploy-dashboard',
        }),
      ],
      repairPlan: [{ autoFix: 'redeploy-dashboard', count: 1, summaries: ['生产接口巡检失败'] }],
    };
    await writeReport(report);
    process.exit(1);
  }

  const sites = Array.isArray(sitesPayload?.sites) ? sitesPayload.sites : [];
  const scanResults = Array.isArray(scanPayload?.results) ? scanPayload.results : [];
  const activityEntries = Array.isArray(activityPayload?.entries) ? activityPayload.entries : [];
  const analyticsSites = Array.isArray(analyticsPayload?.siteStats) ? analyticsPayload.siteStats : [];

  const issues = [];

  if (sites.length === 0) {
    issues.push(
      buildIssue({
        severity: 'error',
        code: 'sites_empty',
        summary: '站点清单为空',
        details: '生产接口 /api/sites 没有返回任何站点。',
        autoFix: 'redeploy-dashboard',
      })
    );
  }

  if (scanResults.length !== sites.length) {
    issues.push(
      buildIssue({
        severity: 'error',
        code: 'scan_count_mismatch',
        summary: `扫描结果数量异常：${scanResults.length}/${sites.length}`,
        details: '生产接口 /api/site-status 返回数量与站点清单不一致。',
        autoFix: 'redeploy-dashboard',
      })
    );
  }

  const offlineSites = [];
  const missingHeroSites = [];
  const missingAdsTxtSites = [];

  for (let index = 0; index < Math.min(sites.length, scanResults.length); index += 1) {
    const site = sites[index];
    const result = scanResults[index] || {};
    if (!result.online) {
      offlineSites.push(site.name);
    }
    if (!result.hero) {
      missingHeroSites.push(site.name);
    }
    if (!result.adstxt) {
      missingAdsTxtSites.push(site.name);
    }
  }

  if (offlineSites.length > 0) {
    issues.push(
      buildIssue({
        severity: 'error',
        code: 'sites_offline',
        summary: `${offlineSites.length} 个站点离线`,
        details: offlineSites.join('、'),
        autoFix: 'manual-site-repair',
        sites: offlineSites,
      })
    );
  }

  if (missingAdsTxtSites.length > 0) {
    issues.push(
      buildIssue({
        severity: 'error',
        code: 'ads_txt_missing',
        summary: `${missingAdsTxtSites.length} 个站点缺少 ads.txt`,
        details: missingAdsTxtSites.join('、'),
        autoFix: 'manual-site-repair',
        sites: missingAdsTxtSites,
      })
    );
  }

  if (missingHeroSites.length > 0) {
    issues.push(
      buildIssue({
        severity: 'warn',
        code: 'hero_missing',
        summary: `${missingHeroSites.length} 个站点没有首页头图`,
        details: missingHeroSites.join('、'),
        autoFix: 'manual-site-repair',
        sites: missingHeroSites,
      })
    );
  }

  const latestEntryAt = pickLatestActivityTimestamp(activityEntries);
  const latestEntryAgeHours = latestEntryAt ? hoursBetween(latestEntryAt) : null;
  if (!latestEntryAt) {
    issues.push(
      buildIssue({
        severity: 'warn',
        code: 'activity_timestamp_missing',
        summary: '最近动态没有可用时间戳',
        details: '接口 /api/activity 返回的 entries 不带有效 timestamp。',
        autoFix: 'inspect-data-pipeline',
      })
    );
  } else if (latestEntryAgeHours !== null && latestEntryAgeHours > ACTIVITY_MAX_AGE_HOURS) {
    issues.push(
      buildIssue({
        severity: 'warn',
        code: 'activity_stale',
        summary: `最近动态已 ${latestEntryAgeHours} 小时未更新`,
        details: `最近一次动态时间为 ${formatBeijing(latestEntryAt)}。`,
        autoFix: 'inspect-data-pipeline',
      })
    );
  }

  const analyticsAgeHours = analyticsPayload?.generatedAt ? hoursBetween(analyticsPayload.generatedAt) : null;
  if (analyticsSites.length !== sites.length) {
    issues.push(
      buildIssue({
        severity: 'warn',
        code: 'analytics_count_mismatch',
        summary: `Analytics 站点数异常：${analyticsSites.length}/${sites.length}`,
        details: '接口 /api/analytics 的 siteStats 数量和站点清单不一致。',
        autoFix: 'inspect-data-pipeline',
      })
    );
  }
  if (!analyticsPayload?.generatedAt) {
    issues.push(
      buildIssue({
        severity: 'warn',
        code: 'analytics_missing_timestamp',
        summary: 'Analytics 快照没有 generatedAt',
        details: '接口 /api/analytics 缺少生成时间，无法判断数据是否陈旧。',
        autoFix: 'inspect-data-pipeline',
      })
    );
  } else if (analyticsAgeHours !== null && analyticsAgeHours > ANALYTICS_MAX_AGE_HOURS) {
    issues.push(
      buildIssue({
        severity: 'warn',
        code: 'analytics_stale',
        summary: `Analytics 快照已 ${analyticsAgeHours} 小时未刷新`,
        details: `当前快照时间为 ${formatBeijing(analyticsPayload.generatedAt)}。`,
        autoFix: 'inspect-data-pipeline',
      })
    );
  }

  const scanSummary = `${scanResults.filter((item) => item.online).length}/${scanResults.filter((item) => item.hero).length}/${scanResults.filter((item) => item.adstxt).length}`;
  const report = {
    generatedAt,
    baseUrl: BASE_URL,
    status: issues.some((issue) => issue.severity === 'error') ? 'failed' : issues.length > 0 ? 'warning' : 'healthy',
    siteCount: sites.length,
    scan: {
      source: scanPayload?.source || 'unknown',
      durationMs: Number(scanPayload?.durationMs) || 0,
      summary: `${scanSummary} 在线/头图/广告`,
      offlineSites,
      missingHeroSites,
      missingAdsTxtSites,
    },
    activity: {
      source: activityPayload?.source || 'unknown',
      entries: activityEntries.length,
      latestEntryAt,
      latestEntryAgeHours,
    },
    analytics: {
      source: analyticsPayload?.source || 'unknown',
      generatedAt: analyticsPayload?.generatedAt || null,
      ageHours: analyticsAgeHours,
      siteStatsCount: analyticsSites.length,
    },
    issues,
    repairPlan: summarizeRepairPlan(issues),
  };

  await writeReport(report);

  process.exit(report.status === 'healthy' ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});

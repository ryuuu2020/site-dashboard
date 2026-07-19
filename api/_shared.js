const fs = require('fs');
const path = require('path');

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_USER = 'ryuuu2020';
const ROOT_DIR = path.resolve(__dirname, '..');
const BUNDLED_JSON = {
  'sites.json': require('../sites.json'),
  'activity.json': require('../activity.json'),
  'analytics.json': require('../analytics.json'),
};

// IMPORTANT: literal require + literal fs path so Vercel's nft file tracer
// bundles analytics-history.json into the serverless function. A dynamic
// require/readFileSync with a computed path is NOT traced and the file
// silently goes missing on Vercel (this was the empty-history bug).
let BUNDLED_HISTORY = null;
try {
  BUNDLED_HISTORY = require('../analytics-history.json');
} catch (_) {
  BUNDLED_HISTORY = null;
}

const MANUAL_SITE_METADATA = {
  'solarpunk-guide': { rank: 1, name: 'Solarpunk', url: 'https://solarpunk.gguidehub.com', steam: 1805110, style: 'C-生存日志', styleTag: 'style-c' },
  'dispatch-guide': { rank: 2, name: 'Dispatch', url: 'https://dispatch.gguidehub.com', steam: 2592160, style: 'A-战术指挥', styleTag: 'style-a' },
  'menace-guide': { rank: 3, name: 'MENACE', url: 'https://menace.gguidehub.com', steam: 2432860, style: 'A-战术指挥', styleTag: 'style-a' },
  'olden-era-guide': { rank: 4, name: 'Olden Era', url: 'https://oldenera.gguidehub.com', steam: 3105440, style: 'B-暗黑史诗', styleTag: 'style-b' },
  'going-medieval-guide': { rank: 5, name: 'Going Medieval', url: 'https://goingmedieval.gguidehub.com', steam: 1029780, style: '3-古卷羊皮纸', styleTag: 'style-3' },
  'tabletop-tavern-guide': { rank: 6, name: 'Tabletop Tavern', url: 'https://tabletoptavern.gguidehub.com', steam: 3337380, style: 'A-战术指挥', styleTag: 'style-a' },
  'demon-lord-guide': { rank: 7, name: 'Demon Lord', url: 'https://demonlord.gguidehub.com', steam: 3720420, style: 'B-暗黑史诗', styleTag: 'style-b' },
  'town-to-city-guide': { rank: 8, name: 'Town to City', url: 'https://towntocity.gguidehub.com', steam: 3115220, style: '6-城市蓝图', styleTag: 'style-6' },
  'witchspire-guide': { rank: 9, name: 'Witchspire', url: 'https://witchspire.gguidehub.com', steam: 2679100, style: 'B-暗黑史诗', styleTag: 'style-b' },
  'vampire-crawlers-guide': { rank: 10, name: 'Vampire Crawlers', url: 'https://vampirecrawlers.gguidehub.com', steam: 3265700, style: 'A-战术指挥', styleTag: 'style-a' },
  'cairn-guide': { rank: 11, name: 'Cairn', url: 'https://cairn.gguidehub.com', steam: 1588550, style: 'C-生存日志', styleTag: 'style-c' },
  'mewgenics-guide': { rank: 12, name: 'Mewgenics', url: 'https://mewgenics.gguidehub.com', steam: 686060, style: 'A-战术指挥', styleTag: 'style-a' },
  'die-in-the-dungeon-guide': { rank: 13, name: 'Die in the Dungeon', url: 'https://dieinthedungeon.gguidehub.com', steam: 2026820, style: 'A-战术指挥', styleTag: 'style-a' },
  'nova-roma-guide': { rank: 14, name: 'Nova Roma', url: 'https://novaroma.gguidehub.com', steam: 2426530, style: '6-城市蓝图', styleTag: 'style-6' },
  'space-haven-guide': { rank: 15, name: 'Space Haven', url: 'https://spacehaven.gguidehub.com', steam: 979110, style: 'C-生存日志', styleTag: 'style-c' },
  'realm-of-ink-guide': { rank: 16, name: 'Realm of Ink', url: 'https://realmofink.gguidehub.com', steam: 2597080, style: 'B-暗黑史诗', styleTag: 'style-b' },
  'shapez-2-guide': { rank: 17, name: 'shapez 2', url: 'https://shapez2.gguidehub.com', steam: 2162800, style: '5-工业电路', styleTag: 'style-c' },
  'alabaster-dawn-guide': { rank: 18, name: 'Alabaster Dawn', url: 'https://alabasterdawn.gguidehub.com', steam: 3110760, style: 'A-战术指挥', styleTag: 'style-a' },
  'terra-invicta-guide': { rank: 19, name: 'Terra Invicta', url: 'https://terrainvicta.gguidehub.com', steam: 1176470, style: 'A-战术指挥', styleTag: 'style-a' },
  'humanitz-guide': { rank: 20, name: 'HumanitZ', url: 'https://humanitz.gguidehub.com', steam: 1766060, style: 'C-生存日志', styleTag: 'style-c' },
  'adira-nusantara-guide': { rank: 21, name: 'Adira Nusantara', url: 'https://adiranusantara.gguidehub.com', steam: 3522550, style: 'C-生存日志', styleTag: 'style-c' },
};

function readJson(fileName, fallback) {
  const filePath = path.join(ROOT_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return BUNDLED_JSON[fileName]
      ? JSON.parse(JSON.stringify(BUNDLED_JSON[fileName]))
      : fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readManifest() {
  return readJson('sites.json', { generated: null, sites: [] });
}

function readActivitySnapshot() {
  return readJson('activity.json', { generated: null, source: 'fallback', entries: [] });
}

function readAnalyticsSnapshot() {
  return readJson('analytics.json', {
    generatedAt: null,
    source: 'fallback',
    fallbackError: null,
    period: null,
    trafficDays: [],
    siteStats: [],
    topPagesByHost: {},
  });
}

function readAnalyticsHistory() {
  // Static literal path relative to this file — traced by @vercel/nft.
  const filePath = path.join(__dirname, '..', 'analytics-history.json');
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_) {
    // fall through to bundled copy
  }
  return BUNDLED_HISTORY
    ? JSON.parse(JSON.stringify(BUNDLED_HISTORY))
    : { days: [] };
}

function isGuideRepo(repoName) {
  return repoName.endsWith('-guide') || repoName.endsWith('-wiki');
}

function humanizeRepoName(repoName) {
  const raw = repoName.replace(/-(guide|wiki)$/, '').replace(/-/g, ' ').trim();
  return raw
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeHomepage(homepage) {
  if (!homepage) {
    return '';
  }
  return homepage.replace(/\/+$/, '');
}

function getManualMetadata(repoName) {
  return MANUAL_SITE_METADATA[repoName] || {};
}

function formatBeijingShort(isoString) {
  if (!isoString) {
    return '';
  }
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(isoString)).map((part) => [part.type, part.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function repoActivityTimestamp(repo) {
  return repo?.pushed_at || repo?.updated_at || null;
}

function classifyActivity(subject) {
  const lowered = (subject || '').toLowerCase();
  if (/(fix|bug|repair|hotfix|lint)/.test(lowered)) {
    return 'fix';
  }
  if (/(launch|release|deploy|上线)/.test(lowered)) {
    return 'launch';
  }
  if (/(feat|add|update|expand|content|publish|build)/.test(lowered)) {
    return 'update';
  }
  return 'push';
}

function isGenericUpdateMessage(message) {
  const normalized = (message || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return !normalized || ['update', 'updates', 'content update', 'content updates', '内容更新'].includes(normalized);
}

function fallbackUpdateMessage(metadata = {}, repoName = '') {
  const existingUpdate = (metadata?.update || '').trim();
  if (existingUpdate) {
    return existingUpdate.slice(0, 120);
  }
  const siteName = (metadata?.name || humanizeRepoName(repoName || '')).trim();
  return siteName ? `${siteName} 内容更新` : '内容更新';
}

function summarizeCommitMessage(message, metadata = {}, repoName = '') {
  const summary = message ? message.split('\n')[0].trim().slice(0, 120) : '';
  if (!isGenericUpdateMessage(summary)) {
    return summary;
  }
  return fallbackUpdateMessage(metadata, repoName);
}

function summarizeRepoUpdate(repo, metadata = {}) {
  const description = (repo?.description || '').trim();
  if (description) {
    return description.slice(0, 120);
  }
  return fallbackUpdateMessage(metadata, repo?.name || '');
}

async function githubFetch(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'site-dashboard',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`GitHub API ${resp.status}: ${url}`);
  }
  return resp.json();
}

async function fetchGithubRepos() {
  return githubFetch(`${GITHUB_API_BASE}/users/${GITHUB_USER}/repos?per_page=100&sort=updated`);
}

async function fetchGithubEvents() {
  return githubFetch(`${GITHUB_API_BASE}/users/${GITHUB_USER}/events/public?per_page=100`);
}

function buildRepoUpdatesFromEvents(events, repoMetadata = new Map()) {
  const updates = new Map();
  for (const event of events || []) {
    const repoFullName = event?.repo?.name || '';
    const repoName = repoFullName.split('/').pop();
    if (!isGuideRepo(repoName) || updates.has(repoName)) {
      continue;
    }

    if (event.type === 'PushEvent') {
      const commits = Array.isArray(event.payload?.commits) ? event.payload.commits : [];
      const firstCommit = commits[0];
      const metadata = repoMetadata.get(repoName) || {};
      updates.set(repoName, {
        pushedAt: event.created_at,
        push: formatBeijingShort(event.created_at),
        update: summarizeCommitMessage(firstCommit?.message, metadata, repoName),
        dot: classifyActivity(firstCommit?.message),
      });
      continue;
    }

    if (event.type === 'CreateEvent') {
      const description = event.payload?.ref_type === 'repository' ? '仓库创建' : `创建 ${event.payload?.ref_type || '分支'}`;
      updates.set(repoName, {
        pushedAt: event.created_at,
        push: formatBeijingShort(event.created_at),
        update: description,
        dot: 'launch',
      });
    }
  }
  return updates;
}

function buildActivityEntries(events, repoMetadata) {
  const entries = [];
  for (const event of events || []) {
    const repoName = (event?.repo?.name || '').split('/').pop();
    if (!isGuideRepo(repoName)) {
      continue;
    }
    const metadata = repoMetadata.get(repoName) || {};

    if (event.type === 'PushEvent') {
      const commits = Array.isArray(event.payload?.commits) ? event.payload.commits : [];
      if (commits.length === 0) {
        continue;
      }
      for (const commit of commits.slice(0, 5)) {
        const message = summarizeCommitMessage(commit?.message, metadata, repoName);
        entries.push({
          time: formatBeijingShort(event.created_at),
          timestamp: event.created_at,
          dot: classifyActivity(message),
          msg: message,
          site: metadata.name || humanizeRepoName(repoName),
        });
      }
      continue;
    }

    if (event.type === 'CreateEvent') {
      entries.push({
        time: formatBeijingShort(event.created_at),
        timestamp: event.created_at,
        dot: 'launch',
        msg: event.payload?.ref_type === 'repository' ? '仓库创建' : `创建 ${event.payload?.ref_type || '分支'}`,
        site: metadata.name || humanizeRepoName(repoName),
      });
    }
  }

  const seen = new Set();
  return entries
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .filter((entry) => {
      const key = `${entry.site}:${entry.msg}:${entry.timestamp}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function buildRepoUpdatesFromRepos(repos, repoMetadata = new Map()) {
  const updates = new Map();
  for (const repo of repos || []) {
    const repoName = repo?.name || '';
    if (!isGuideRepo(repoName) || repo?.private || updates.has(repoName)) {
      continue;
    }

    const timestamp = repoActivityTimestamp(repo);
    if (!timestamp) {
      continue;
    }

    const metadata = repoMetadata.get(repoName) || {};
    updates.set(repoName, {
      pushedAt: timestamp,
      push: formatBeijingShort(timestamp),
      update: summarizeRepoUpdate(repo, metadata),
      dot: 'update',
    });
  }
  return updates;
}

function buildActivityEntriesFromRepos(repos, repoMetadata) {
  const entries = [];
  for (const repo of repos || []) {
    const repoName = repo?.name || '';
    if (!isGuideRepo(repoName) || repo?.private) {
      continue;
    }

    const timestamp = repoActivityTimestamp(repo);
    if (!timestamp) {
      continue;
    }

    const metadata = repoMetadata.get(repoName) || {};
    entries.push({
      time: formatBeijingShort(timestamp),
      timestamp,
      dot: 'update',
      msg: summarizeRepoUpdate(repo, metadata),
      site: metadata.name || humanizeRepoName(repoName),
    });
  }

  return entries
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 20);
}

module.exports = {
  MANUAL_SITE_METADATA,
  buildActivityEntries,
  buildActivityEntriesFromRepos,
  buildRepoUpdatesFromEvents,
  buildRepoUpdatesFromRepos,
  fetchGithubEvents,
  fetchGithubRepos,
  formatBeijingShort,
  getManualMetadata,
  humanizeRepoName,
  isGuideRepo,
  normalizeHomepage,
  readActivitySnapshot,
  readAnalyticsHistory,
  readAnalyticsSnapshot,
  readManifest,
};

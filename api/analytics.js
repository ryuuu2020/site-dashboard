const crypto = require('node:crypto');
const { readManifest, readAnalyticsSnapshot } = require('./_shared');

const DEFAULT_PROPERTY_ID = '542906144';
const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GA4_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';

// Legacy *.vercel.app hosts that still send traffic to the same GA4 property.
const LEGACY_HOST_MAP = {
  'solarpunk-game-wiki.vercel.app': 'Solarpunk',
  'solarpunk-guide-ecru.vercel.app': 'Solarpunk',
  'dispatch-guide-sigma.vercel.app': 'Dispatch',
  'dispatch-guide-six.vercel.app': 'Dispatch',
  'menace-guide.vercel.app': 'MENACE',
  'olden-era-guide-tau.vercel.app': 'Olden Era',
  'going-medieval-guide.vercel.app': 'Going Medieval',
  'tabletop-tavern-guide.vercel.app': 'Tabletop Tavern',
  'demon-lord-guide.vercel.app': 'Demon Lord',
  'town-to-city-guide.vercel.app': 'Town to City',
  'witchspire-guide.vercel.app': 'Witchspire',
  'vampire-crawlers-guide.vercel.app': 'Vampire Crawlers',
  'cairn-guide.vercel.app': 'Cairn',
  'mewgenics-guide.vercel.app': 'Mewgenics',
  'die-in-the-dungeon-guide.vercel.app': 'Die in the Dungeon',
  'nova-roma-guide.vercel.app': 'Nova Roma',
  'space-haven-guide.vercel.app': 'Space Haven',
  'realm-of-ink-guide.vercel.app': 'Realm of Ink',
  'shapez-2-guide.vercel.app': 'shapez 2',
  'alabaster-dawn-guide.vercel.app': 'Alabaster Dawn',
  'terra-invicta-guide.vercel.app': 'Terra Invicta',
  'humanitz-guide.vercel.app': 'HumanitZ',
};

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function loadServiceAccount() {
  if (process.env.GA4_SERVICE_ACCOUNT_JSON) {
    let parsed;
    try {
      parsed = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON);
    } catch (error) {
      throw new Error(`GA4_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('GA4_SERVICE_ACCOUNT_JSON missing client_email/private_key');
    }
    return parsed;
  }
  const clientEmail = process.env.GA4_CLIENT_EMAIL;
  const privateKey = process.env.GA4_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    return {
      client_email: clientEmail,
      // Vercel env vars often store the key with literal \n escapes.
      private_key: privateKey.replace(/\\n/g, '\n'),
      token_uri: TOKEN_URI,
    };
  }
  throw new Error('missing GA4 credentials (GA4_SERVICE_ACCOUNT_JSON or GA4_CLIENT_EMAIL+GA4_PRIVATE_KEY)');
}

function buildAssertion(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: ANALYTICS_SCOPE,
    aud: serviceAccount.token_uri || TOKEN_URI,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), serviceAccount.private_key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function requestAccessToken(serviceAccount) {
  const assertion = buildAssertion(serviceAccount);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const resp = await fetch(serviceAccount.token_uri || TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok || !payload.access_token) {
    throw new Error(`token exchange failed (${resp.status}): ${payload.error_description || payload.error || 'no access_token'}`);
  }
  return payload.access_token;
}

async function runReport(propertyId, token, dimensions, metrics, startDate, endDate, limit) {
  const resp = await fetch(`${GA4_API_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      dateRanges: [{ startDate, endDate }],
      limit,
    }),
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`runReport failed (${resp.status}): ${payload.error?.message || 'unknown error'}`);
  }
  return payload.rows || [];
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function compactDate(date) {
  return isoDate(date).replace(/-/g, '');
}

function shortLabel(date) {
  return isoDate(date).slice(5);
}

async function buildLivePayload() {
  const manifest = readManifest();
  const sites = manifest.sites || [];
  const hostToName = { ...LEGACY_HOST_MAP };
  const nameToHost = {};
  for (const site of sites) {
    const host = (site.url || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!host || !site.name) {
      continue;
    }
    hostToName[host] = site.name;
    nameToHost[site.name] = host;
  }

  const today = new Date();
  const endDate = new Date(today.getTime() - 86400000);
  const startDate = new Date(endDate.getTime() - 6 * 86400000);
  const startStr = isoDate(startDate);
  const endStr = isoDate(endDate);
  const days = Array.from({ length: 7 }, (_, i) => new Date(startDate.getTime() + i * 86400000));
  const dayIndex = new Map(days.map((day, i) => [compactDate(day), i]));

  const siteStatsByName = new Map(
    sites
      .filter((site) => site.name)
      .map((site) => [
        site.name,
        {
          name: site.name,
          host: nameToHost[site.name] || '',
          viewsByDay: [0, 0, 0, 0, 0, 0, 0],
          totalViews: 0,
          sessions: 0,
          users: 0,
          avgSessionDuration: 0,
          pagesPerSession: 0,
        },
      ])
  );
  const topPagesByHost = new Map();

  const serviceAccount = loadServiceAccount();
  const propertyId = process.env.GA4_PROPERTY_ID || DEFAULT_PROPERTY_ID;
  const token = await requestAccessToken(serviceAccount);

  const [summaryRows, dailyRows, pageRows] = await Promise.all([
    runReport(
      propertyId,
      token,
      ['hostName'],
      ['screenPageViews', 'sessions', 'activeUsers', 'averageSessionDuration', 'screenPageViewsPerSession'],
      startStr,
      endStr,
      2000
    ),
    runReport(propertyId, token, ['hostName', 'date'], ['screenPageViews'], startStr, endStr, 20000),
    runReport(
      propertyId,
      token,
      ['hostName', 'pagePath'],
      ['screenPageViews', 'averageSessionDuration'],
      startStr,
      endStr,
      20000
    ),
  ]);

  const dim = (row, i) => row.dimensionValues?.[i]?.value || '';
  const num = (row, i) => Number(row.metricValues?.[i]?.value || 0);

  for (const row of summaryRows) {
    const name = hostToName[dim(row, 0)];
    if (!name || !siteStatsByName.has(name)) {
      continue;
    }
    const stat = siteStatsByName.get(name);
    stat.totalViews += num(row, 0);
    stat.sessions += num(row, 1);
    stat.users += num(row, 2);
    stat.avgSessionDuration = Math.max(stat.avgSessionDuration, Math.round(num(row, 3)));
    stat.pagesPerSession = Math.max(stat.pagesPerSession, Math.round(num(row, 4) * 100) / 100);
  }

  for (const row of dailyRows) {
    const name = hostToName[dim(row, 0)];
    const day = dayIndex.get(dim(row, 1));
    if (!name || !siteStatsByName.has(name) || day === undefined) {
      continue;
    }
    siteStatsByName.get(name).viewsByDay[day] += num(row, 0);
  }

  for (const row of pageRows) {
    const name = hostToName[dim(row, 0)];
    const path = dim(row, 1) || '/';
    if (!name || path === '/ads.txt') {
      continue;
    }
    const canonicalHost = nameToHost[name];
    if (!canonicalHost) {
      continue;
    }
    if (!topPagesByHost.has(canonicalHost)) {
      topPagesByHost.set(canonicalHost, new Map());
    }
    const pages = topPagesByHost.get(canonicalHost);
    const entry = pages.get(path) || { path, views: 0, eng: 0 };
    entry.views += num(row, 0);
    entry.eng = Math.max(entry.eng, Math.round(num(row, 1)));
    pages.set(path, entry);
  }

  const topPagesPayload = {};
  for (const [host, pages] of topPagesByHost) {
    topPagesPayload[host] = [...pages.values()].sort((a, b) => b.views - a.views).slice(0, 8);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'ga4-live',
    fallbackError: null,
    period: { start: startStr, end: endStr, label: `${startStr} ~ ${endStr}` },
    trafficDays: days.map(shortLabel),
    siteStats: [...siteStatsByName.values()],
    topPagesByHost: topPagesPayload,
  };
}

function snapshotPayload(error) {
  const snapshot = readAnalyticsSnapshot();
  return {
    generatedAt: snapshot.generatedAt || null,
    period: snapshot.period || null,
    source: snapshot.source || 'snapshot',
    fallbackError: error ? `live query failed: ${error}` : snapshot.fallbackError || null,
    trafficDays: snapshot.trafficDays || [],
    siteStats: snapshot.siteStats || [],
    topPagesByHost: snapshot.topPagesByHost || {},
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  let payload;
  try {
    payload = await buildLivePayload();
  } catch (error) {
    console.error('GA4 live query failed, falling back to snapshot:', error);
    payload = snapshotPayload(error?.message || String(error));
  }

  res.statusCode = 200;
  res.end(JSON.stringify(payload, null, 2));
};

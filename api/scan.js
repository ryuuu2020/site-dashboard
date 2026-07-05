const { readManifest } = require('./_shared');

const ADSENSE_PUB = 'pub-8925824244664340';

async function fetchWithTimeout(url, options = {}, timeout = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'site-dashboard-scan',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function siteHost(url) {
  return (url || '').replace(/\/+$/, '');
}

function normalizeAssetUrl(baseUrl, rawValue) {
  if (!rawValue) {
    return null;
  }
  const cleaned = rawValue.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned || cleaned.startsWith('data:')) {
    return null;
  }
  try {
    return new URL(cleaned, `${baseUrl}/`).href;
  } catch (_) {
    return null;
  }
}

function pushHeroMatches(candidates, baseUrl, rawValue) {
  if (!rawValue) {
    return;
  }
  const parts = rawValue
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((part) => /hero\.(png|jpe?g|webp)/i.test(part));
  for (const part of parts) {
    const normalized = normalizeAssetUrl(baseUrl, part);
    if (normalized) {
      candidates.push(normalized);
    }
  }
}

function heroCandidates(url, html) {
  const candidates = [];
  const patterns = [
    /<(?:img|source)[^>]+(?:src|srcset|data-src|data-srcset)=["']([^"']*hero\.(?:png|jpe?g|webp)[^"']*)["']/gi,
    /<(?:div|section|header|picture|figure)[^>]+(?:style|data-bg|data-background|data-image)=["'][^"']*url\(([^)"']*hero\.(?:png|jpe?g|webp)[^)"']*)\)[^"']*["']/gi,
    /background-image\s*:\s*url\(([^)"']*hero\.(?:png|jpe?g|webp)[^)"']*)\)/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      pushHeroMatches(candidates, url, match[1]);
      match = pattern.exec(html);
    }
  }

  return [...new Set(candidates)];
}

async function isReachable(url) {
  try {
    const response = await fetchWithTimeout(url, {}, 6000);
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function hasAdsTxt(url) {
  try {
    const response = await fetchWithTimeout(`${url}/ads.txt`, {}, 6000);
    if (!response.ok) {
      return false;
    }
    const text = await response.text();
    return text.includes(ADSENSE_PUB);
  } catch (_) {
    return false;
  }
}

async function hasHeroReference(url) {
  try {
    const homepage = await fetchWithTimeout(url, {}, 6000);
    if (!homepage.ok) {
      return false;
    }
    const contentType = (homepage.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) {
      return false;
    }
    const html = await homepage.text();
    const candidates = heroCandidates(url, html);
    if (candidates.length === 0) {
      return false;
    }

    for (const candidate of candidates) {
      try {
        let response = await fetchWithTimeout(candidate, { method: 'HEAD' }, 4000);
        let type = (response.headers.get('content-type') || '').toLowerCase();
        if ((!response.ok || !type.startsWith('image/')) && response.status !== 405) {
          response = await fetchWithTimeout(candidate, {}, 4000);
          type = (response.headers.get('content-type') || '').toLowerCase();
        }
        if (response.ok && type.startsWith('image/')) {
          return true;
        }
      } catch (_) {
        continue;
      }
    }

    return false;
  } catch (_) {
    return false;
  }
}

async function scanSite(site) {
  const url = siteHost(site.url);
  if (!url) {
    return { online: false, hero: false, adstxt: false };
  }

  const online = await isReachable(url);
  if (!online) {
    return { online: false, hero: false, adstxt: false };
  }

  const [hero, adstxt] = await Promise.all([
    hasHeroReference(url),
    hasAdsTxt(url),
  ]);

  return { online, hero, adstxt };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const manifest = readManifest();
  const startedAt = Date.now();
  const sites = manifest.sites || [];
  const results = await Promise.all(sites.map((site) => scanSite(site)));

  res.statusCode = 200;
  res.end(
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        source: 'server-scan',
        durationMs: Date.now() - startedAt,
        results,
      },
      null,
      2
    )
  );
};

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

// Pragmatic hero detection: hero/banner/cover/header images in <img>/<source>,
// CSS background-image (inline styles or <style> blocks), or og:image / twitter:image meta.
const HERO_NAME_RE = /(?:hero|banner|cover|header)[\w-]*\.(?:png|jpe?g|webp|avif)/i;

function heroCandidates(url, html) {
  const candidates = [];
  const push = (raw) => {
    if (!raw) {
      return;
    }
    const first = String(raw).split(',')[0].trim().split(/\s+/)[0];
    const normalized = normalizeAssetUrl(url, first);
    if (normalized) {
      candidates.push(normalized);
    }
  };

  const patterns = [
    /<(?:img|source)[^>]+(?:src|srcset|data-src|data-srcset)=["']([^"']+)["']/gi,
    /<(?:div|section|header|picture|figure|a|span)[^>]+(?:style|data-bg|data-background|data-image)=["'][^"']*url\(([^)"']+)\)[^"']*["']/gi,
    /background(?:-image)?\s*:\s*url\(([^)"']+)\)/gi,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      if (HERO_NAME_RE.test(match[1])) {
        push(match[1]);
      }
      match = pattern.exec(html);
    }
  }

  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
  ];
  for (const pattern of metaPatterns) {
    let match = pattern.exec(html);
    while (match) {
      push(match[1]);
      match = pattern.exec(html);
    }
  }

  return [...new Set(candidates)];
}

function detectAdsense(html) {
  return /googlesyndication\.com|adsbygoogle|ca-pub-\d{10,}/i.test(html);
}

function detectGa4(html) {
  return /googletagmanager\.com\/gtag\/js|gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-[A-Z0-9]+|['"]G-[A-Z0-9]{6,}['"]/i.test(html);
}

// GSC cannot be verified from HTML alone; only a verification meta proves ownership.
// Returns true (verified), or null (unknown / not detectable).
function detectGsc(html) {
  return /<meta[^>]+name=["']google-site-verification["']/i.test(html) ? true : null;
}

async function checkAdsTxt(url) {
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

async function checkHeroImages(url, html) {
  const candidates = heroCandidates(url, html);
  if (candidates.length === 0) {
    return false;
  }
  for (const candidate of candidates.slice(0, 4)) {
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
}

async function scanSite(site) {
  const url = siteHost(site.url);
  const base = {
    key: site.dir || url.replace(/^https?:\/\//, ''),
    dir: site.dir || '',
    host: url.replace(/^https?:\/\//, ''),
    online: false,
    hero: false,
    adstxt: false,
    adsense: false,
    ga4: false,
    gsc: null,
    error: null,
  };
  if (!url) {
    base.error = 'missing-url';
    return base;
  }

  let homepage;
  try {
    homepage = await fetchWithTimeout(url, {}, 8000);
  } catch (error) {
    base.error = `unreachable: ${error?.name === 'AbortError' ? 'timeout' : error?.message || 'fetch failed'}`;
    return base;
  }

  base.online = homepage.ok;
  if (!homepage.ok) {
    base.error = `http-${homepage.status}`;
    return base;
  }

  const contentType = (homepage.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    base.error = 'non-html-response';
    return base;
  }

  let html = '';
  try {
    html = await homepage.text();
  } catch (_) {
    base.error = 'body-read-failed';
    return base;
  }

  base.adsense = detectAdsense(html);
  base.ga4 = detectGa4(html);
  base.gsc = detectGsc(html);

  const [hero, adstxt] = await Promise.all([
    checkHeroImages(url, html),
    checkAdsTxt(url),
  ]);
  base.hero = hero;
  base.adstxt = adstxt;
  return base;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const manifest = readManifest();
  const startedAt = Date.now();
  const sites = manifest.sites || [];

  // Per-site isolation: one site's failure never kills the whole scan.
  const settled = await Promise.allSettled(sites.map((site) => scanSite(site)));
  const results = settled.map((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    const site = sites[index] || {};
    const url = siteHost(site.url);
    return {
      key: site.dir || url.replace(/^https?:\/\//, ''),
      dir: site.dir || '',
      host: url.replace(/^https?:\/\//, ''),
      online: false,
      hero: false,
      adstxt: false,
      adsense: false,
      ga4: false,
      gsc: null,
      error: `scan-exception: ${outcome.reason?.message || 'unknown'}`,
    };
  });

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

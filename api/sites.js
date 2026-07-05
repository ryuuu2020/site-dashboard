const DEFAULT_FEATS = { adsense: 1, adstxt: 1, afdian: 1, ga4: 1, gsc: 1 };
const {
  MANUAL_SITE_METADATA,
  buildRepoUpdatesFromEvents,
  buildRepoUpdatesFromRepos,
  fetchGithubEvents,
  fetchGithubRepos,
  getManualMetadata,
  humanizeRepoName,
  isGuideRepo,
  normalizeHomepage,
  readManifest,
} = require('./_shared');

async function fetchSitemapCount(url) {
  if (!url) {
    return 0;
  }
  try {
    const resp = await fetch(`${url}/sitemap.xml`, { redirect: 'follow' });
    if (!resp.ok) {
      return 0;
    }
    const xml = await resp.text();
    const matches = xml.match(/<loc>/g);
    return matches ? matches.length : 0;
  } catch (_) {
    return 0;
  }
}

function mergeRepoIntoSite(repo, existingSite) {
  const manual = getManualMetadata(repo.name);
  const merged = {
    ...existingSite,
    ...manual,
    dir: existingSite.dir || repo.name,
    name: existingSite.name || manual.name || humanizeRepoName(repo.name),
    url: manual.url || existingSite.url || normalizeHomepage(repo.homepage) || `https://${repo.name}.vercel.app`,
    steam: existingSite.steam || manual.steam || 0,
    pages: existingSite.pages || 0,
    style: existingSite.style || manual.style || '未知',
    styleTag: existingSite.styleTag || manual.styleTag || 'style-a',
    feats: { ...DEFAULT_FEATS, ...(existingSite.feats || {}) },
    push: existingSite.push || '',
    update: existingSite.update || '',
    eng: existingSite.eng || 0,
    pps: existingSite.pps || 0,
    launch: existingSite.launch || '?',
    draft: Boolean(existingSite.draft),
  };
  return merged;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

  const manifest = readManifest();
  const sitesByDir = new Map((manifest.sites || []).map((site) => [site.dir, { ...site }]));

  try {
    const repos = await fetchGithubRepos();
    let repoUpdates = buildRepoUpdatesFromRepos(repos, sitesByDir);
    try {
      const eventUpdates = buildRepoUpdatesFromEvents(await fetchGithubEvents(), sitesByDir);
      repoUpdates = new Map([...repoUpdates, ...eventUpdates]);
    } catch (error) {
      console.error('Failed to fetch GitHub events for site updates:', error);
    }

    for (const repo of repos) {
      if (!isGuideRepo(repo.name) || repo.private) {
        continue;
      }
      const current = sitesByDir.get(repo.name) || {};
      const merged = mergeRepoIntoSite(repo, current);
      const repoUpdate = repoUpdates.get(repo.name);
      if (repoUpdate) {
        merged.push = repoUpdate.push || merged.push;
        merged.update = repoUpdate.update || merged.update;
      }
      sitesByDir.set(repo.name, merged);
    }
  } catch (error) {
    console.error('Failed to refresh site list from GitHub:', error);
  }

  const sites = Array.from(sitesByDir.values());
  const missingPageSites = sites.filter((site) => !site.pages && site.url);
  const pageCounts = await Promise.all(
    missingPageSites.map(async (site) => [site.dir, await fetchSitemapCount(site.url)])
  );
  const pageCountMap = new Map(pageCounts);

  sites.forEach((site) => {
    if (!site.pages && pageCountMap.has(site.dir)) {
      site.pages = pageCountMap.get(site.dir) || 0;
    }
  });

  sites.sort((a, b) => {
    const rankA = MANUAL_SITE_METADATA[a.dir]?.rank ?? 999;
    const rankB = MANUAL_SITE_METADATA[b.dir]?.rank ?? 999;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.dir.localeCompare(b.dir);
  });

  sites.forEach((site, index) => {
    site.id = index + 1;
  });

  res.statusCode = 200;
  res.end(
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        source: 'api',
        sites,
      },
      null,
      2
    )
  );
};

const {
  MANUAL_SITE_METADATA,
  buildActivityEntries,
  buildActivityEntriesFromRepos,
  fetchGithubRepos,
  fetchGithubEvents,
  getManualMetadata,
  isGuideRepo,
  readActivitySnapshot,
} = require('./_shared');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

  const snapshot = readActivitySnapshot();
  const repoMetadata = new Map(
    Object.keys(MANUAL_SITE_METADATA).map((repoName) => [repoName, getManualMetadata(repoName)])
  );

  try {
    const events = await fetchGithubEvents();
    const entries = buildActivityEntries(
      events.filter((event) => isGuideRepo((event?.repo?.name || '').split('/').pop())),
      repoMetadata
    ).slice(0, 20);

    if (entries.length > 0) {
      res.statusCode = 200;
      res.end(
        JSON.stringify(
          {
            generated: new Date().toISOString(),
            source: 'github-events',
            entries,
          },
          null,
          2
        )
      );
      return;
    }
  } catch (error) {
    console.error('Failed to refresh activity from GitHub:', error);
  }

  try {
    const repos = await fetchGithubRepos();
    const entries = buildActivityEntriesFromRepos(repos, repoMetadata);
    if (entries.length > 0) {
      res.statusCode = 200;
      res.end(
        JSON.stringify(
          {
            generated: new Date().toISOString(),
            source: 'github-repos',
            entries,
          },
          null,
          2
        )
      );
      return;
    }
  } catch (error) {
    console.error('Failed to refresh activity from GitHub repos:', error);
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        source: snapshot.source || 'snapshot',
        entries: snapshot.entries || [],
      },
      null,
      2
    )
  );
};

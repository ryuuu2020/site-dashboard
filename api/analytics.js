const { readAnalyticsSnapshot } = require('./_shared');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

  const snapshot = readAnalyticsSnapshot();
  res.statusCode = 200;
  res.end(
    JSON.stringify(
      {
        generatedAt: snapshot.generatedAt || null,
        period: snapshot.period || null,
        source: snapshot.source || 'snapshot',
        fallbackError: snapshot.fallbackError || null,
        trafficDays: snapshot.trafficDays || [],
        siteStats: snapshot.siteStats || [],
        topPagesByHost: snapshot.topPagesByHost || {},
      },
      null,
      2
    )
  );
};

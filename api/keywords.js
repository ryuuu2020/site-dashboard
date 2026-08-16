const { readKeywordRadar } = require('./_shared');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  const payload = readKeywordRadar();
  res.statusCode = 200;
  res.end(JSON.stringify(payload, null, 2));
};

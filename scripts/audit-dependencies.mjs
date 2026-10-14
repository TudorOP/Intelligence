import fs from 'node:fs';
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const output = process.argv[2] || '.test-data/dependency-audit.json';
const reports = {};
for (const production of [false, true]) {
  const packages = {};
  for (const [location, p] of Object.entries(lock.packages)) {
    if (!location || !p.version || (production && p.dev)) continue;
    const name = p.name || location.split('node_modules/').at(-1);
    (packages[name] ||= new Set()).add(p.version);
  }
  const body = Object.fromEntries(Object.entries(packages).map(([n, v]) => [n, [...v]]));
  const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('Advisory registry returned ' + response.status);
  reports[production ? 'production' : 'all'] = await response.json();
}
fs.mkdirSync(new URL('../.test-data/', import.meta.url), { recursive: true });
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      method: 'npm bulk advisory endpoint; direct advisory data, not npm meta-vulnerability counts',
      reports,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(reports, null, 2));

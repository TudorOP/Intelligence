export const searchProviders = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    description:
      'Uses the DuckDuckGo engine on your SearXNG instance; this is not a direct DuckDuckGo connection.',
    credential: false,
    setupUrl: 'https://docs.searxng.org/dev/engines/online/duckduckgo.html',
  },
  {
    id: 'ecosia',
    name: 'Ecosia',
    description:
      'Uses the Ecosia engine on your SearXNG instance; a custom engine may be needed. This is not a direct Ecosia connection.',
    credential: false,
    setupUrl: 'https://docs.searxng.org/user/configured_engines.html',
  },
  {
    id: 'searxng',
    name: 'SearXNG',
    description: 'Use your own search instance.',
    credential: false,
    setupUrl: 'https://docs.searxng.org/dev/search_api.html',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    description: 'Search Brave’s independent index.',
    credential: true,
    setupUrl: 'https://api-dashboard.search.brave.com/documentation/quickstart',
  },
];
export const searchProviderIds = searchProviders.map((provider) => provider.id);
export const freshnessValues = ['any', 'day', 'week', 'month', 'year'];
const snippets = (value) =>
  String(value ?? '')
    .slice(0, 8000)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3500);
const result = (item) => ({
  title: snippets(item.title).slice(0, 500),
  url: String(item.url ?? '').slice(0, 4096),
  snippet: snippets(item.description ?? item.content),
  ...(typeof (item.img_src ?? item.thumbnail?.original ?? item.thumbnail?.src ?? item.thumbnail) ===
    'string' &&
  /^https:\/\//.test(
    item.img_src ?? item.thumbnail?.original ?? item.thumbnail?.src ?? item.thumbnail,
  )
    ? {
        image: String(
          item.img_src ?? item.thumbnail?.original ?? item.thumbnail?.src ?? item.thumbnail,
        ).slice(0, 4096),
      }
    : {}),
  ...((item.page_age ?? item.publishedDate)
    ? { published: item.page_age ?? item.publishedDate }
    : {}),
});
async function readJson(response) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `Search provider returned HTTP ${response.status}${response.status === 401 ? '; update the API key' : response.status === 403 ? '; check the provider plan or enable SearXNG JSON results' : response.status === 429 ? '; the provider rate or usage limit was reached' : ''}`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Search provider returned an empty response');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Search response exceeds 2 MB');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export const searchAdapters = {
  async searxng({ settings, query, count, freshness, fetch, signal, engine }) {
    if (!settings.searxngEndpoint)
      throw new Error('Set the SearXNG address in Settings → Search providers');
    const url = new URL(
      settings.searxngEndpoint.replace(/\/$/, '') +
        (settings.searxngEndpoint.endsWith('/search') ? '' : '/search'),
    );
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    if (engine) {
      const configUrl = new URL(url.href);
      configUrl.pathname = configUrl.pathname.replace(/\/search$/, '/config');
      configUrl.search = '';
      const config = await readJson(
        await fetch(configUrl, {
          headers: { Accept: 'application/json' },
          signal,
          redirect: 'error',
        }),
      );
      if (
        !Array.isArray(config.engines) ||
        !config.engines.some((e) => e.name === engine && !e.disabled)
      )
        throw Error(
          'Enable the selected engine on your SearXNG instance; Ecosia may require adding a custom engine',
        );
    }
    if (engine) url.searchParams.set('engines', engine);
    const appliedFreshness = freshness === 'week' ? 'month' : freshness;
    if (appliedFreshness !== 'any') url.searchParams.set('time_range', appliedFreshness);
    const value = await readJson(
      await fetch(url, { headers: { Accept: 'application/json' }, signal, redirect: 'error' }),
    );
    if (
      engine &&
      (value.unresponsive_engines ?? []).some((e) => (Array.isArray(e) ? e[0] : e) === engine)
    )
      throw Error('The selected engine is unavailable on your SearXNG instance');
    if (
      engine &&
      (value.results ?? []).some((r) => Array.isArray(r.engines) && !r.engines.includes(engine))
    )
      throw Error('SearXNG did not honor the selected engine; enable it on your instance');
    return {
      appliedFreshness,
      results: (Array.isArray(value.results) ? value.results : [])
        .slice(0, count)
        .map(result)
        .filter((r) => /^https?:\/\//i.test(r.url ?? '')),
      answers: (value.answers ?? []).slice(0, 3).map(snippets),
    };
  },
  async brave({ query, count, freshness, fetch, signal, key }) {
    if (!key) throw new Error('Save a Brave API key in Settings → Search providers');
    if (query.length > 600 || query.split(/\s+/).length > 75)
      throw new Error(
        'Brave queries support up to 600 characters and 75 words; shorten this query',
      );
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    url.searchParams.set('extra_snippets', 'true');
    const ranges = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };
    if (ranges[freshness]) url.searchParams.set('freshness', ranges[freshness]);
    const value = await readJson(
      await fetch(url, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
        signal,
        redirect: 'error',
      }),
    );
    return {
      results: (value.web?.results ?? []).slice(0, count).map((item) => ({
        ...result(item),
        extraSnippets: (item.extra_snippets ?? []).slice(0, 3).map(snippets),
      })),
      answers: [],
    };
  },
};
for (const engine of ['duckduckgo', 'ecosia'])
  searchAdapters[engine] = (options) => searchAdapters.searxng({ ...options, engine });

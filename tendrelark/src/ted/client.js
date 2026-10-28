// Thin client for the public TED search API (anonymous, no key needed).
//   POST https://api.ted.europa.eu/v3/notices/search
// The request and response shapes below follow TED's published API documentation. They have not
// been exercised against the live service from the build environment, so `npm run ted:probe`
// exists to confirm them from a machine that can reach TED.

export class TedApiError extends Error {
  constructor(message, { status = null, body = '' } = {}) {
    super(message);
    this.name = 'TedApiError';
    this.status = status;
    this.body = body;
  }
}

/** Fields we are confident every TED notice search accepts. */
export const CORE_FIELDS = ['publication-number', 'notice-title', 'buyer-name', 'buyer-country', 'publication-date', 'links'];

/** Richer fields. If TED rejects one, ingestion falls back to CORE_FIELDS and says so in the run log. */
export const EXTENDED_FIELDS = [...CORE_FIELDS, 'notice-type', 'deadline-receipt-tender-date-lot', 'classification-cpv'];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createTedClient(config, { fetchImpl = globalThis.fetch, sleep = defaultSleep } = {}) {
  const { apiUrl, retryBaseMs } = config.ted;
  const maxAttempts = 4;

  async function search({ query, fields, page = 1, limit = 100, scope = 'ALL' }) {
    const payload = JSON.stringify({ query, fields, page, limit, scope, paginationMode: 'PAGE_NUMBER' });
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let res;
      try {
        res = await fetchImpl(apiUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': 'TendrelarkIngest/1.0 (+https://www.tendrelark.eu/sources)',
          },
          body: payload,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        lastError = new TedApiError(`Network error talking to TED: ${err.cause?.code || err.message}`);
        if (attempt < maxAttempts) await sleep(retryBaseMs * 2 ** (attempt - 1));
        continue;
      }

      const text = await res.text();
      if (res.ok) {
        try {
          return JSON.parse(text);
        } catch {
          throw new TedApiError('TED returned a response that is not valid JSON.', { status: res.status, body: text.slice(0, 500) });
        }
      }

      const error = new TedApiError(`TED API answered HTTP ${res.status}`, { status: res.status, body: text.slice(0, 1000) });
      // 4xx other than 429 means our request is wrong. Retrying would not help.
      if (res.status !== 429 && res.status < 500) throw error;
      lastError = error;
      if (attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : retryBaseMs * 2 ** (attempt - 1);
        await sleep(wait);
      }
    }
    throw lastError;
  }

  return { search };
}

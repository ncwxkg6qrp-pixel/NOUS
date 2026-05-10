// Netlify Function: aviationstack proxy
// Keeps the AviationStack API key server-side via AVIATIONSTACK_KEY env var.
// Client sends: /.netlify/functions/aviationstack?flight_iata=LH1234&limit=1
// This function forwards the request and injects access_key before it leaves the server.

const FLIGHT_IATA_RE = /^[A-Za-z0-9]{2,8}$/;
const FLIGHT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

exports.handler = async (event) => {
  const apiKey = process.env.AVIATIONSTACK_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured' }),
    };
  }

  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Soft origin check: if a browser supplies Origin/Referer, require it to match
  // the Netlify-deployed host. Non-browser callers without these headers are
  // permitted (so legitimate tooling/SSR keeps working).
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin;
  const referer = headers.referer || headers.Referer;
  const expectedHost = headers.host || headers.Host || '';
  const matchesHost = (value) => {
    if (!value || !expectedHost) return false;
    try {
      const u = new URL(value);
      return u.host === expectedHost;
    } catch (_) {
      return false;
    }
  };
  if (origin && !matchesHost(origin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden origin' }) };
  }
  if (!origin && referer && !matchesHost(referer)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden referer' }) };
  }

  // Allowlist of query params the client may pass through
  const ALLOWED_PARAMS = new Set(['flight_iata', 'flight_date', 'limit']);
  const incoming = event.queryStringParameters || {};
  const params = new URLSearchParams({ access_key: apiKey });

  for (const [key, rawValue] of Object.entries(incoming)) {
    if (!ALLOWED_PARAMS.has(key)) continue;
    const value = String(rawValue || '');
    if (key === 'flight_iata') {
      if (!FLIGHT_IATA_RE.test(value)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid flight_iata' }) };
      }
    } else if (key === 'flight_date') {
      if (!FLIGHT_DATE_RE.test(value)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid flight_date' }) };
      }
    } else if (key === 'limit') {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid limit' }) };
      }
      params.set(key, String(n));
      continue;
    }
    params.set(key, value);
  }

  if (!params.get('flight_iata')) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'flight_iata is required' }),
    };
  }

  const url = `https://api.aviationstack.com/v1/flights?${params.toString()}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    return {
      statusCode: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'AviationStack nicht erreichbar' }),
    };
  }
};

// Netlify Function: aviationstack proxy
// Keeps the AviationStack API key server-side via AVIATIONSTACK_KEY env var.
// Client sends: /.netlify/functions/aviationstack?flight_iata=LH1234&limit=1
// This function forwards the request and injects access_key before it leaves the server.

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

  // Allowlist of query params the client may pass through
  const ALLOWED_PARAMS = new Set(['flight_iata', 'flight_date', 'limit']);
  const incoming = event.queryStringParameters || {};
  const params = new URLSearchParams({ access_key: apiKey });

  for (const [key, value] of Object.entries(incoming)) {
    if (ALLOWED_PARAMS.has(key)) {
      params.set(key, value);
    }
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'AviationStack nicht erreichbar' }),
    };
  }
};

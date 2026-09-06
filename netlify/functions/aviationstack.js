// Netlify Function: aviationstack proxy
// Hält den AviationStack-Schlüssel serverseitig.
// Aufruf: /.netlify/functions/aviationstack?flight_iata=LH1234&limit=1
//
// Umgebungsvariable: AVIATIONSTACK_API_KEY (AVIATIONSTACK_KEY wird ebenfalls
// akzeptiert — beide Namen standen bisher in Code und Kommentar, was die
// Abfrage stillschweigend lahmlegte, wenn der andere gesetzt war).
//
// HTTPS: Der Gratistarif von AviationStack lässt keine verschlüsselten
// Aufrufe zu und antwortet mit 403 `https_access_restricted`. Nur für diesen
// einen Fall fällt die Function auf HTTP zurück. Das betrifft ausschließlich
// die Verbindung zwischen Netlify und AviationStack; der Browser spricht
// weiterhin verschlüsselt mit dieser Function. Der AviationStack-Schlüssel
// reist dabei allerdings unverschlüsselt — vertretbar für einen Schlüssel,
// der nur öffentliche Flugdaten abruft, aber eine bewusste Abwägung.

const FLIGHT_IATA_RE = /^[A-Za-z0-9]{2,8}$/;
const FLIGHT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fehler von AviationStack stehen im Feld `error` und kommen teils mit
// Status 200. Sie werden vereinheitlicht weitergereicht, damit die App den
// Grund anzeigen kann, statt jeden Fehlschlag als „Flug nicht gefunden" zu
// verkleiden.
const upstreamError = (data) => {
  const e = data && data.error;
  if (!e) return null;
  if (typeof e === 'string') return { code: '', message: e };
  return { code: e.code || e.type || '', message: e.message || e.info || 'Unbekannter Fehler' };
};

exports.handler = async (event) => {
  const apiKey = process.env.AVIATIONSTACK_API_KEY || process.env.AVIATIONSTACK_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { code: 'not_configured', message: 'AVIATIONSTACK_API_KEY ist in Netlify nicht gesetzt' } }),
    };
  }

  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: { code: '', message: 'Nur GET' } }) };
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
    return { statusCode: 403, body: JSON.stringify({ error: { code: '', message: 'Aufruf von fremder Herkunft' } }) };
  }
  if (!origin && referer && !matchesHost(referer)) {
    return { statusCode: 403, body: JSON.stringify({ error: { code: '', message: 'Aufruf von fremder Herkunft' } }) };
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
        return { statusCode: 400, body: JSON.stringify({ error: { code: '', message: 'Ungültige Flugnummer' } }) };
      }
    } else if (key === 'flight_date') {
      if (!FLIGHT_DATE_RE.test(value)) {
        return { statusCode: 400, body: JSON.stringify({ error: { code: '', message: 'Ungültiges Datum' } }) };
      }
    } else if (key === 'limit') {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        return { statusCode: 400, body: JSON.stringify({ error: { code: '', message: 'Ungültiger Wert für limit' } }) };
      }
      params.set(key, String(n));
      continue;
    }
    params.set(key, value);
  }

  if (!params.get('flight_iata')) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: '', message: 'Flugnummer fehlt' } }),
    };
  }

  const path = `api.aviationstack.com/v1/flights?${params.toString()}`;
  const respond = (statusCode, data) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(data),
  });

  const call = async (scheme) => {
    const resp = await fetch(`${scheme}://${path}`);
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }
    return { status: resp.status, data };
  };

  try {
    let result = await call('https');
    let err = upstreamError(result.data);
    // Einziger Grund für den Rückfall auf HTTP: der Tarif erlaubt kein HTTPS.
    if (err && err.code === 'https_access_restricted') {
      result = await call('http');
      err = upstreamError(result.data);
    }
    if (err) return respond(result.status >= 400 ? result.status : 400, { error: err });
    if (!result.data) return respond(502, { error: { code: '', message: 'Unlesbare Antwort von AviationStack' } });
    return respond(result.status, result.data);
  } catch (err) {
    return respond(502, { error: { code: '', message: 'AviationStack nicht erreichbar' } });
  }
};

// Netlify Function: Splitwise-Zugang für Nous
//
// Sicherheitsmodell (bewusst enger als der AviationStack-Proxy):
//  1. Der Splitwise-Schlüssel bleibt serverseitig. Er ist bei Splitwise NICHT
//     eingrenzbar — wer ihn hat, kann das ganze Konto lesen und verändern.
//     Deshalb ist dieser Endpunkt kein generischer Proxy: er kennt eine feste
//     Liste erlaubter Aktionen und baut jede Splitwise-Anfrage selbst.
//  2. Der Aufrufer muss angemeldet sein. Geprüft wird das Supabase-Zugangstoken
//     gegen Supabase selbst; zusätzlich muss die E-Mail in ALLOWED_EMAILS
//     stehen. Fehlt die Variable, wird abgelehnt (fail closed) — eine
//     Origin-Prüfung allein wäre mit curl in Sekunden zu fälschen.
//  3. Die Gruppen-ID kommt aus der Umgebung, nie vom Client. Sonst wäre der
//     Endpunkt eine Fernsteuerung für sämtliche Splitwise-Gruppen des Kontos.
//  4. Beträge, Beschreibungen und Token stehen in keinem Log.
//
// Erforderliche Umgebungsvariablen (nur im Produktionskontext setzen, nicht in
// Deploy Previews — sonst kann jeder Branch den Schlüssel auslesen):
//   SPLITWISE_API_KEY    persönlicher API-Schlüssel von secure.splitwise.com/apps
//   ALLOWED_EMAILS       kommaseparierte Liste der beiden zugelassenen Konten
//   SPLITWISE_GROUP_ID   ID der gemeinsamen Gruppe (erst für 'expenses' nötig)
// Optional (Vorgabe = die ohnehin öffentlichen Werte aus app.js):
//   SUPABASE_URL, SUPABASE_ANON_KEY

const SPLITWISE_API = 'https://secure.splitwise.com/api/v3.0';
const DEFAULT_SUPABASE_URL = 'https://uojnjhpvwmgslerallxj.supabase.co';
const DEFAULT_SUPABASE_ANON = 'sb_publishable_sTY9Fhw42eOQ-jSAD_pKNg_a8QhW6Vs';
const TIMEOUT_MS = 10000;

const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

async function fetchJson(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, Object.assign({ signal: ctrl.signal }, options));
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }
    return { status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Splitwise antwortet auch bei fachlichen Fehlern mit 200 und füllt nur
// `errors`. Wer allein den Statuscode prüft, meldet Erfolg, obwohl nichts
// angekommen ist.
function splitwiseError(status, data) {
  if (status < 200 || status >= 300) return `Splitwise antwortete mit Status ${status}`;
  const errors = data && data.errors;
  if (!errors) return null;
  if (Array.isArray(errors) && errors.length) return errors.join('; ');
  if (typeof errors === 'object' && Object.keys(errors).length) {
    return Object.entries(errors)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('; ');
  }
  return null;
}

// Nur die Felder zurückgeben, die Nous braucht — nicht die rohe Antwort.
const slimMember = (m) => ({
  id: m && m.id,
  first_name: (m && m.first_name) || '',
  last_name: (m && m.last_name) || '',
});

async function verifyCaller(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { error: 'Nicht angemeldet' };

  const allowed = String(process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) return { error: 'Zugang nicht konfiguriert' };

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON;
  let result;
  try {
    result = await fetchJson(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
  } catch (_) {
    return { error: 'Anmeldung konnte nicht geprüft werden' };
  }
  if (result.status !== 200 || !result.data || !result.data.email) {
    return { error: 'Nicht angemeldet' };
  }
  const email = String(result.data.email).toLowerCase();
  if (!allowed.includes(email)) return { error: 'Kein Zugriff für dieses Konto' };
  return { email };
}

async function splitwiseGet(path, params) {
  const key = process.env.SPLITWISE_API_KEY;
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return fetchJson(`${SPLITWISE_API}/${path}${query}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
}

// ── Aktionen ───────────────────────────────────────────────────────────
// Bewusst eine geschlossene Liste. Neue Aktionen kommen nur hier dazu.

async function actionWhoami() {
  const me = await splitwiseGet('get_current_user');
  const meErr = splitwiseError(me.status, me.data);
  if (meErr) return json(502, { error: meErr });

  const groups = await splitwiseGet('get_groups');
  const grpErr = splitwiseError(groups.status, groups.data);
  if (grpErr) return json(502, { error: grpErr });

  const user = (me.data && me.data.user) || {};
  const list = (groups.data && groups.data.groups) || [];
  return json(200, {
    user: slimMember(user),
    groups: list.map((g) => ({
      id: g && g.id,
      name: (g && g.name) || '',
      members: ((g && g.members) || []).map(slimMember),
    })),
    configuredGroupId: process.env.SPLITWISE_GROUP_ID || null,
  });
}

async function actionExpenses(body) {
  const groupId = process.env.SPLITWISE_GROUP_ID;
  if (!groupId) return json(500, { error: 'SPLITWISE_GROUP_ID ist nicht gesetzt' });

  const params = { group_id: String(groupId), limit: '200' };
  const since = body && body.updated_after;
  if (since != null && since !== '') {
    if (typeof since !== 'string' || !ISO_DATE_TIME_RE.test(since)) {
      return json(400, { error: 'updated_after ist kein gültiger Zeitstempel' });
    }
    params.updated_after = since;
  }

  const resp = await splitwiseGet('get_expenses', params);
  const err = splitwiseError(resp.status, resp.data);
  if (err) return json(502, { error: err });

  const expenses = ((resp.data && resp.data.expenses) || []).map((e) => ({
    id: e && e.id,
    description: (e && e.description) || '',
    details: (e && e.details) || '',
    cost: (e && e.cost) || '0',
    currency_code: (e && e.currency_code) || '',
    date: (e && e.date) || '',
    created_at: (e && e.created_at) || '',
    updated_at: (e && e.updated_at) || '',
    deleted_at: (e && e.deleted_at) || null,
    payment: !!(e && e.payment),
    users: ((e && e.users) || []).map((u) => ({
      user_id: (u && u.user_id) || (u && u.user && u.user.id) || null,
      paid_share: (u && u.paid_share) || '0',
      owed_share: (u && u.owed_share) || '0',
    })),
  }));
  return json(200, { expenses });
}

const ACTIONS = {
  whoami: actionWhoami,
  expenses: actionExpenses,
};

exports.handler = async (event) => {
  // POST mit JSON-Körper: so stehen keine Parameter in Zugriffs-Logs oder im
  // Verlauf des Browsers.
  if ((event.httpMethod || '') !== 'POST') {
    return json(405, { error: 'Nur POST' });
  }
  if (!process.env.SPLITWISE_API_KEY) {
    return json(500, { error: 'Splitwise ist nicht konfiguriert' });
  }

  const caller = await verifyCaller(event);
  if (caller.error) return json(401, { error: caller.error });

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body) || {};
    } catch (_) {
      return json(400, { error: 'Ungültiger Anfragekörper' });
    }
  }

  const action = ACTIONS[body.action];
  if (!action) return json(400, { error: 'Unbekannte Aktion' });

  try {
    return await action(body);
  } catch (err) {
    // Absichtlich ohne Details: der Fehlertext könnte Kontodaten enthalten.
    console.error('[splitwise] Aktion fehlgeschlagen:', body.action);
    return json(502, { error: 'Splitwise nicht erreichbar' });
  }
};

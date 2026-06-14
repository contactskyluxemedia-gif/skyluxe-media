const MAX_LENGTHS = {
  prenom: 80,
  nom: 120,
  email: 160,
  telephone: 40,
  service: 120,
  description: 1600,
  budget: 80
};

const REQUIRED_FIELDS = ['prenom', 'nom', 'email', 'service', 'description', 'budget'];
const MAX_BODY_SIZE = 6000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitStore = global.__skyluxeContactRateLimit || new Map();
global.__skyluxeContactRateLimit = rateLimitStore;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readRawBody(req) {
  if (!req || typeof req.on !== 'function') return '';

  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_SIZE) {
        reject(new Error('body_too_large'));
      }
    });

    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  if (typeof req.body === 'object' && req.body) return req.body;

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  const rawBody = await readRawBody(req);
  if (rawBody) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return {};
    }
  }

  return {};
}

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function isTooLong(body, field) {
  return String(body[field] || '').trim().length > MAX_LENGTHS[field];
}

function getClientIp(req) {
  const headers = req.headers || {};
  const forwardedFor = String(headers['x-forwarded-for'] || '');
  return forwardedFor.split(',')[0].trim() || String(headers['x-real-ip'] || 'unknown');
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (entry.resetAt <= now) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  entry.count += 1;
  rateLimitStore.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

function isValidEmail(value) {
  const normalized = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function isValidPhone(value) {
  const normalized = String(value || '').trim();
  return !normalized || /^\+?[0-9 .()/-]{8,24}$/.test(normalized);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').trim();
}

function buildLeadPayload(fields, req) {
  return {
    prenom: fields.prenom,
    nom: fields.nom,
    email: fields.email,
    telephone: fields.telephone,
    service: fields.service,
    budget: fields.budget,
    description: fields.description,
    source: 'site-skyluxe-media',
    page: 'landing',
    submitted_at: new Date().toISOString(),
    ip: getClientIp(req)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { message: 'Methode non autorisee.' });
  }

  const headers = req.headers || {};
  if (Number(headers['content-length'] || 0) > MAX_BODY_SIZE) {
    return sendJson(res, 413, { message: 'Votre demande est trop longue.' });
  }

  if (isRateLimited(getClientIp(req))) {
    return sendJson(res, 429, { message: 'Trop de demandes envoyees. Reessayez dans quelques minutes.' });
  }

  let body = {};
  try {
    body = await parseBody(req);
  } catch {
    return sendJson(res, 413, { message: 'Votre demande est trop longue.' });
  }

  if (clean(body.site_web, 200)) {
    return sendJson(res, 200, { message: 'Demande envoyee. On revient vers vous sous 48h.' });
  }

  const fields = {
    prenom: clean(body.prenom, MAX_LENGTHS.prenom),
    nom: clean(body.nom, MAX_LENGTHS.nom),
    email: normalizeEmail(body.email).slice(0, MAX_LENGTHS.email),
    telephone: normalizePhone(body.telephone).slice(0, MAX_LENGTHS.telephone),
    service: clean(body.service, MAX_LENGTHS.service),
    description: clean(body.description, MAX_LENGTHS.description),
    budget: clean(body.budget, MAX_LENGTHS.budget)
  };

  const missingField = REQUIRED_FIELDS.find((field) => !fields[field]);
  if (missingField) {
    return sendJson(res, 400, { message: 'Tous les champs obligatoires doivent etre remplis.' });
  }

  if (!isValidEmail(fields.email)) {
    return sendJson(res, 400, { message: 'Ajoutez un email valide.' });
  }

  if (!isValidPhone(fields.telephone)) {
    return sendJson(res, 400, { message: 'Ajoutez un numero de telephone valide ou laissez le champ vide.' });
  }

  const oversizedField = REQUIRED_FIELDS.find((field) => isTooLong(body, field));
  if (oversizedField) {
    return sendJson(res, 400, { message: 'Votre demande est trop longue. Raccourcissez-la legerement.' });
  }

  const makeWebhookUrl = String(process.env.MAKE_WEBHOOK_URL || '').trim();
  if (!makeWebhookUrl) {
    return sendJson(res, 503, { message: 'Formulaire non configure. Ajoutez MAKE_WEBHOOK_URL dans Vercel.' });
  }

  try {
    const makeResponse = await fetch(makeWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLeadPayload(fields, req))
    });

    if (!makeResponse.ok) {
      return sendJson(res, 502, { message: 'Impossible d envoyer la demande vers l automatisation pour le moment.' });
    }
  } catch {
    return sendJson(res, 502, { message: 'Impossible d envoyer la demande vers l automatisation pour le moment.' });
  }

  return sendJson(res, 200, { message: 'Demande envoyee. On revient vers vous sous 48h.' });
};

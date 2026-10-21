const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS},
  });
}

function validBackend(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && /^[a-z0-9-]+\.trycloudflare\.com$/i.test(u.hostname);
  } catch { return false; }
}

const configStore = env => env.CONFIG || env.BOT_CONFIG || env.CONFIG_KV;
const adminAuthorized = (request, env) =>
  !!env.ADMIN_TOKEN && request.headers.get('Authorization') === `Bearer ${env.ADMIN_TOKEN}`;

async function readConfig(env) {
  const kv = configStore(env);
  if (!kv) return {backend: null};
  try {
    const old = JSON.parse(await kv.get('app-config') || '{}');
    return {backend: validBackend(old.backend) ? old.backend : null};
  } catch { return {backend: null}; }
}

async function updateConfig(request, env) {
  if (!adminAuthorized(request, env)) return json({ok: false, error: 'Невалиден администраторски достъп'}, 401);
  const kv = configStore(env);
  if (!kv) return json({ok: false, error: 'Липсва KV binding CONFIG'}, 503);
  let input;
  try { input = await request.json(); } catch { return json({ok: false, error: 'Невалиден JSON'}, 400); }
  if (!input || typeof input !== 'object' || !Object.hasOwn(input, 'backend')) {
    return json({ok: false, error: 'Изисква се поле backend'}, 400);
  }
  const backend = input.backend === null ? null : input.backend;
  if (backend !== null && !validBackend(backend)) return json({ok: false, error: 'Невалиден backend URL'}, 400);
  const value = {backend, updatedAt: new Date().toISOString()};
  await kv.put('app-config', JSON.stringify(value));
  return json({ok: true, backendReady: !!backend});
}

function clientTokenConfigured(env) {
  return typeof env.CLIENT_TOKEN === 'string' && env.CLIENT_TOKEN.length >= 32;
}

// Compare UTF-8 bytes without early exit; not a substitute for rate limiting.
function sameToken(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function clientAuthorized(request, env) {
  if (!clientTokenConfigured(env)) return false;
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return false;
  const given = h.slice(7).trim();
  return given.length <= 1024 && sameToken(given, env.CLIENT_TOKEN);
}

async function proxy(request, env, url, config) {
  if (!clientTokenConfigured(env)) return json({ok: false, error: 'CLIENT_TOKEN не е настроен в Cloudflare'}, 503);
  if (!clientAuthorized(request, env)) return json({ok: false, error: 'Невалиден личен ключ', code: 'UNAUTHORIZED'}, 401);
  if (!env.ADMIN_TOKEN) return json({ok: false, error: 'ADMIN_TOKEN липсва'}, 503);
  if (!config.backend) return json({ok: false, error: 'Backend-ът не е свързан'}, 503);

  const target = new URL(config.backend);
  target.pathname = url.pathname.replace(/^\/api/, '') || '/';
  target.search = url.search;
  // Do not forward the personal token, client IP, device IDs or version tracking.
  const headers = new Headers();
  headers.set('X-Bot-Token', env.ADMIN_TOKEN);
  for (const name of ['Content-Type', 'Accept']) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  try {
    const response = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });
    const outgoing = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS)) outgoing.set(key, value);
    outgoing.set('Cache-Control', 'no-store');
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers: outgoing});
  } catch {
    return json({ok: false, error: 'Backend-ът не е достъпен'}, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: CORS});
    const url = new URL(request.url);
    if (url.pathname === '/config') {
      if (request.method === 'PUT') return updateConfig(request, env);
      if (request.method === 'GET') {
        const c = await readConfig(env);
        return json({ok: true, backendReady: !!c.backend});
      }
      return json({ok: false, error: 'Method not allowed'}, 405);
    }
    if (url.pathname === '/health') {
      const c = await readConfig(env);
      return json({ok: true, worker: true, backendReady: !!c.backend, clientAuthConfigured: clientTokenConfigured(env)});
    }
    if (url.pathname.startsWith('/api/')) {
      const config = await readConfig(env);
      return proxy(request, env, url, config);
    }
    return json({ok: false, error: 'Not found'}, 404);
  },
};
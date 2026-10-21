const WORKER = 'https://bot-config.erp-admin.workers.dev';
const CLIENT_TOKEN_KEY = 'bc-client-token';
const STATE_KEYS = {STORE_STATE: 'bc-store-status-state', CHECK_STATE: 'bc-report-check-state'};

function bucket(raw) {
  if (raw && raw.months && typeof raw.months === 'object') {
    return {months: {...raw.months}, selectedMonth: String(raw.selectedMonth || '')};
  }
  if (raw && raw.month && typeof raw === 'object') {
    return {months: {[String(raw.month)]: raw}, selectedMonth: String(raw.month)};
  }
  return {months: {}, selectedMonth: ''};
}

async function stateMessage(key, message) {
  const st = chrome.storage.session;
  const current = await st.get(key);
  const result = bucket(current[key]);
  if (message.action === 'selected') return result.selectedMonth || null;
  if (message.action === 'get') {
    const month = String(message.month || result.selectedMonth || '');
    return month ? result.months[month] || null : null;
  }
  if (message.action === 'select') {
    const month = String(message.month || '');
    if (month) result.selectedMonth = month;
    await st.set({[key]: result});
    return result.selectedMonth || null;
  }
  if (message.action === 'set') {
    const data = message.data;
    const month = String(message.month || data?.month || result.selectedMonth || '');
    if (!month) throw Error('Липсва месец за запазване');
    result.months[month] = data;
    result.selectedMonth = month;
    await st.set({[key]: result});
    return true;
  }
  if (message.action === 'clear') {
    if (message.month) {
      const month = String(message.month);
      delete result.months[month];
      if (result.selectedMonth === month) result.selectedMonth = '';
      await st.set({[key]: result});
    } else {
      await st.remove(key);
    }
    return true;
  }
  throw Error('Невалидна state операция');
}

async function api(path, method = 'GET', body) {
  path = String(path || '');
  method = String(method || 'GET').toUpperCase();
  if (!path.startsWith('/') || path.startsWith('//') || !['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
    return {ok: false, error: 'Невалидна API заявка'};
  }
  const saved = await chrome.storage.local.get(CLIENT_TOKEN_KEY);
  const clientToken = String(saved[CLIENT_TOKEN_KEY] || '').trim();
  if (!clientToken) {
    return {ok: false, code: 'TOKEN_MISSING', error: 'Въведи личния ключ от иконата на разширението в Chrome.'};
  }
  const response = await fetch(WORKER + '/api' + path, {
    method,
    headers: {'Authorization': 'Bearer ' + clientToken, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  return {ok: response.ok, data, error: response.ok ? undefined : (data?.error || `HTTP ${response.status}`), code: data?.code};
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message || !['API', 'STORE_STATE', 'CHECK_STATE'].includes(message.type)) return;
  (async () => {
    try {
      if (message.type === 'STORE_STATE' || message.type === 'CHECK_STATE') {
        reply({ok: true, data: await stateMessage(STATE_KEYS[message.type], message)});
      } else {
        reply(await api(message.path, message.method || 'GET', message.body));
      }
    } catch (error) {
      reply({ok: false, error: error?.message || 'Сървърът не е достъпен'});
    }
  })();
  return true;
});
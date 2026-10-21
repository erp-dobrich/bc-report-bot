const STORAGE_KEY = 'bc-client-token';
const token = document.getElementById('token');
const message = document.getElementById('msg');
const save = document.getElementById('save');
const test = document.getElementById('test');

function show(text, ok = true) {
  message.textContent = text;
  message.style.color = ok ? '#126a50' : '#b03542';
}

chrome.storage.local.get(STORAGE_KEY).then(value => {
  token.value = String(value[STORAGE_KEY] || '');
}).catch(error => show(error.message, false));

save.addEventListener('click', async () => {
  const value = token.value.trim();
  if (value.length < 32) return show('Ключът трябва да е поне 32 символа.', false);
  try {
    await chrome.storage.local.set({[STORAGE_KEY]: value});
    show('Ключът е запазен. Натисни „Провери връзката“.');
  } catch (error) { show(error.message, false); }
});

test.addEventListener('click', () => {
  show('Проверявам връзката...');
  chrome.runtime.sendMessage({type: 'API', path: '/health'}, result => {
    if (chrome.runtime.lastError) return show(chrome.runtime.lastError.message, false);
    if (!result?.ok) return show(result?.error || 'Няма връзка с backend-а.', false);
    if (result.data?.ok) return show('Връзката с backend-а работи.');
    return show('Неочакван отговор от backend-а.', false);
  });
});
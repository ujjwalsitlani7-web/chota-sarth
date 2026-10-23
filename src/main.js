// Chota Sarth: an always-on personal assistant for the Mac.
// Main process: owns the windows, the global shortcut, screen capture, storage and
// every call to Claude. The renderer pages never see the API key.
const {
  app, BrowserWindow, ipcMain, globalShortcut, screen, desktopCapturer,
  clipboard, safeStorage, systemPreferences, Tray, Menu, nativeImage, shell, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const assistant = require('./assistant.js');
const voice = require('./voice.js');

const isMac = process.platform === 'darwin';
const FAKE_AI = process.env.SARTH_FAKE_AI === '1'; // for testing without an API key
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODELS = { smart: 'claude-sonnet-5-5', quick: 'claude-haiku-5-5' };

let orbWin = null;
let panelWin = null;
let tray = null;

// ---------------- storage (one JSON file in the app's private folder) ----------------
const dataFile = () => path.join(app.getPath('userData'), 'chota-sarth.json');
const defaultData = () => ({ v: 1, profile: { name: '', about: '' }, memory: [], talk: [], project: null, drafts: [], runs: [], questions: [], chat: [], orb: null, apiKeyEnc: null, elevenKeyEnc: null, voice: { engine: 'mac', macVoice: '', elevenVoiceId: '', elevenVoiceName: '', speak: true } });
let data = null;
function loadData() {
  try { data = Object.assign(defaultData(), JSON.parse(fs.readFileSync(dataFile(), 'utf8'))); }
  catch { data = defaultData(); }
}
let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(dataFile()), { recursive: true }); fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2)); }
    catch (e) { console.error('save failed', e); }
  }, 150);
}
function publicData() { const { apiKeyEnc, elevenKeyEnc, ...rest } = data; return { ...rest, hasKey: !!apiKeyEnc || FAKE_AI, hasEleven: !!elevenKeyEnc || FAKE_AI }; }

// The API key is encrypted with the macOS keychain-backed safeStorage before it touches disk.
function setKey(key) {
  const k = (key || '').trim();
  if (!k) { data.apiKeyEnc = null; saveData(); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this Mac.');
  data.apiKeyEnc = safeStorage.encryptString(k).toString('base64'); saveData();
}
function getKey() {
  if (!data.apiKeyEnc) return null;
  try { return safeStorage.decryptString(Buffer.from(data.apiKeyEnc, 'base64')); } catch { return null; }
}
// ElevenLabs key, stored the same encrypted way.
function setElevenKey(key) {
  const k = (key || '').trim();
  if (!k) { data.elevenKeyEnc = null; saveData(); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this Mac.');
  data.elevenKeyEnc = safeStorage.encryptString(k).toString('base64'); saveData();
}
function getElevenKey() {
  if (!data.elevenKeyEnc) return null;
  try { return safeStorage.decryptString(Buffer.from(data.elevenKeyEnc, 'base64')); } catch { return null; }
}

// ---------------- Claude ----------------
function parseJSON(text) {
  const t = String(text || '').replace(/```json|```/g, '').trim();
  const start = t.search(/[{[]/);
  if (start < 0) throw new Error('Claude did not return JSON');
  return JSON.parse(t.slice(start, Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')) + 1));
}
async function claude({ system, prompt, image, model = 'smart', maxTokens = 1500, json = false }) {
  if (FAKE_AI) return fakeAI({ prompt, image, json });
  const key = getKey();
  if (!key) throw Object.assign(new Error('Add your Anthropic API key in Setup first.'), { code: 'no_key' });
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
  content.push({ type: 'text', text: prompt + (json ? '\n\nRespond with JSON only, no other text.' : '') });
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELS[model] || MODELS.smart, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || ('HTTP ' + res.status);
    throw Object.assign(new Error(res.status === 401 ? 'Anthropic rejected the API key. Check it in Setup.' : msg), { code: 'api_' + res.status });
  }
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return json ? parseJSON(text) : text;
}
// Full Messages API call with tools, used by the personal assistant.
async function claudeRaw({ system, messages, tools }) {
  if (FAKE_AI) return fakeAgent(messages);
  const key = getKey();
  if (!key) throw Object.assign(new Error('Add your Anthropic API key in Setup first.'), { code: 'no_key' });
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELS.smart, max_tokens: 1500, system, messages, tools }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || ('HTTP ' + res.status);
    throw Object.assign(new Error(res.status === 401 ? 'Anthropic rejected the API key. Check it in Setup.' : msg), { code: 'api_' + res.status });
  }
  return body;
}
function fakeAgent(messages) {
  // Test stand-in: picks a tool from simple keywords, then replies once the tool has run.
  const last = messages[messages.length - 1];
  if (Array.isArray(last.content) && last.content[0] && last.content[0].type === 'tool_result') {
    const r = last.content[0].content; const txt = Array.isArray(r) ? 'I can see your screen: a spreadsheet of parts.' : String(r);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: /said no/.test(txt) ? 'Okay, I won’t. Want me to change anything?' : 'Done. ' + txt }] };
  }
  const q = String(last.content).toLowerCase();
  const use = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't' + Date.now(), name, input }] });
  if (q.includes('remind')) return use('create_reminder', { title: 'Call Gurmeet about payment', due: new Date(Date.now() + 86400000).toISOString().slice(0, 11) + '10:00' });
  if (q.includes('whatsapp')) return use('draft_whatsapp', { text: 'Namaste ji, a gentle reminder about the pending payment of ₹63,991. Thank you!' });
  if (q.includes('my day') || q.includes('today')) return use('get_today', {});
  if (q.includes('remember')) return use('remember', { kind: 'person', text: 'Gurmeet Singh (Khanna) usually pays on the 10th' });
  if (q.includes('screen')) return use('look_at_screen', {});
  if (q.includes('find')) return use('search_files', { query: 'GST invoice' });
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Happy to help. Ask me to remind you, plan your day, write a message, find a file or explain your screen.' }] };
}
function fakeAI({ prompt, image, json }) {
  // Deterministic stand-in so the whole app can be tried without a key (SARTH_FAKE_AI=1).
  if (!json) return 'Here is a thought: answer the exact question buyers type, in plain words, and say who it is for.';
  if (prompt.includes('exactly 8 questions')) return { questions: ['Best invoicing tool for freelancers', 'Alternatives to Zoho Invoice', 'How to chase late payments', 'Invoice app with automatic reminders', 'Free invoicing for designers', 'FreshBooks vs other tools', 'How to get clients to pay on time', 'Simple GST invoice maker'] };
  if (prompt.includes('helpful AI assistant would')) { const hit = prompt.includes('chase late'); return { answer: hit ? 'Invoicely sends reminders for you.' : 'Zoho Invoice and FreshBooks are common picks.', products_named: hit ? ['Invoicely'] : ['Zoho Invoice', 'FreshBooks'] }; }
  if (image) return { screen: 'A Reddit thread in r/freelance about clients paying late', kind: 'social_thread', people: [{ who: 'u/designsbyria', said: 'Client is 60 days late, what do I even say?', intent: 'ready to buy', reply: 'Been there. A short, friendly nudge with the invoice attached usually works. If it keeps happening, an app that sends reminders for you saves the awkwardness.' }], tips: [] };
  if (prompt.includes('three posts')) return { posts: [{ platform: 'LinkedIn', text: 'LinkedIn draft' }, { platform: 'X', text: 'X draft' }, { platform: 'Reddit', text: 'Reddit draft' }] };
  return {};
}
function productBlock() {
  const p = data.project; if (!p) return 'The founder has not described their product yet.';
  return `Product: ${p.name}\nWhat it does: ${p.desc}\nWho buys it: ${p.buyer}` + (p.comp && p.comp.length ? `\nCompetitors: ${p.comp.join(', ')}` : '') + (p.voice ? `\nThe founder writes like this:\n"""${p.voice.slice(0, 1200)}"""` : '');
}
const SYSTEM = 'You are Chota Sarth, a calm, practical assistant. Here you are helping the person get their product found. You never post, send or buy anything yourself: you only draft, and the founder approves. Be specific and brief. Write in plain words.';

// ---------------- windows ----------------
const ORB = 64;
function createOrb() {
  const area = screen.getPrimaryDisplay().workArea;
  const pos = data.orb || { x: area.x + area.width - ORB - 24, y: area.y + Math.round(area.height * 0.6) };
  orbWin = new BrowserWindow({
    width: ORB, height: ORB, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  orbWin.setAlwaysOnTop(true, 'floating');
  orbWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  orbWin.loadFile(path.join(__dirname, 'orb.html'));
  orbWin.once('ready-to-show', () => orbWin.showInactive());
}
function createPanel() {
  panelWin = new BrowserWindow({
    width: 420, height: 640, frame: false, transparent: false, resizable: true, minWidth: 360, minHeight: 480,
    alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#0C1320', roundedCorners: true,
    titleBarStyle: isMac ? 'hidden' : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  panelWin.setAlwaysOnTop(true, 'floating');
  panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWin.loadFile(path.join(__dirname, 'panel.html'));
  panelWin.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); panelWin.hide(); } });
}
function placePanelNearOrb() {
  const ob = orbWin.getBounds(); const pb = panelWin.getBounds();
  const area = screen.getDisplayMatching(ob).workArea;
  let x = ob.x - pb.width - 12; if (x < area.x) x = ob.x + ob.width + 12;
  let y = Math.min(Math.max(area.y + 8, ob.y + ob.height - pb.height), area.y + area.height - pb.height - 8);
  panelWin.setPosition(Math.round(x), Math.round(y));
}
function togglePanel(force) {
  if (!panelWin) return;
  const show = typeof force === 'boolean' ? force : !panelWin.isVisible();
  if (show) { placePanelNearOrb(); panelWin.show(); panelWin.focus(); panelWin.webContents.send('panel:shown'); }
  else panelWin.hide();
}
function createTray() {
  // Menu-bar icon drawn in code (a ring), so the app needs no image files.
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXElEQVR4nK1TRw4AIAgT4v+/jFdSyzDYm3QAJqw1hCScdbSsiMbUo4/mS6MR0Q3ZhdCPSxtoQuL/4Nt8QGUO61FAG98C6H4Evi7VBBhCQ7udQx9OkN0G1YyPaYwDW+QPGXJ0ylUAAAAASUVORK5CYII=' });
  img.addRepresentation({ scaleFactor: 2, dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAxElEQVR4nO2XQQ6AIAwEwfj/L+MJg0hbtm4lJvZq3ZkgJZjS4sqOdwozE2m2wK7smSYUDDG2YLiZoQkw4GaWJMCEq5kjgQi4mN0LRMKHDGsThlc7Iow5RzJySv4VkGYbPlmrAGz+4Hmt0gqw4GgfJIAu71T/8in4BT4lgB5UU/1VAJpdUp/7JLTCoZVqBRj3w1n4ydoBqBemVv8JPNd0tC6M0R6IlLhlS5swQmKYqU0BU0LMssaQIaFmfOLXDBV5Y5J4dQAALxw6iVjOuQAAAABJRU5ErkJggg==' });
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Chota Sarth');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Chota Sarth  (⌥ Space)', click: () => togglePanel(true) },
    { label: 'Show the orb', type: 'checkbox', checked: true, click: (i) => (i.checked ? orbWin.showInactive() : orbWin.hide()) },
    { type: 'separator' },
    { label: 'Quit Chota Sarth', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => togglePanel());
}

// ---------------- screen reading ----------------
async function captureScreen() {
  if (isMac) {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied' || status === 'restricted') {
      throw Object.assign(new Error('Chota Sarth needs Screen Recording permission. Open System Settings › Privacy & Security › Screen Recording, turn Chota Sarth on, then reopen it.'), { code: 'screen_denied' });
    }
  }
  const wasVisible = panelWin.isVisible();
  panelWin.hide(); orbWin.hide();                       // keep Chota Sarth itself out of the picture
  await new Promise((r) => setTimeout(r, 250));
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: Math.round(1600 * display.size.height / display.size.width) } });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw Object.assign(new Error('Could not read the screen. Check Screen Recording permission in System Settings.'), { code: 'screen_empty' });
    return src.thumbnail.toJPEG(78).toString('base64');
  } finally {
    orbWin.showInactive(); if (wasVisible) { panelWin.show(); }
  }
}

// ---------------- IPC: everything the panel can ask for ----------------
function wrap(fn) { return async (e, ...args) => { try { return { ok: true, value: await fn(...args) } } catch (err) { return { ok: false, error: err.message, code: err.code || null }; } }; }
ipcMain.handle('data:get', wrap(() => publicData()));
ipcMain.handle('project:set', wrap((p) => { data.project = p; data.questions = []; saveData(); return publicData(); }));
ipcMain.handle('key:set', wrap((k) => { setKey(k); return publicData(); }));
ipcMain.handle('drafts:set', wrap((drafts) => { data.drafts = drafts; saveData(); return true; }));
ipcMain.handle('clipboard:write', wrap((t) => { clipboard.writeText(String(t || '')); return true; }));
ipcMain.handle('panel:hide', wrap(() => togglePanel(false)));
ipcMain.handle('login:get', wrap(() => app.getLoginItemSettings().openAtLogin));
ipcMain.handle('login:set', wrap((on) => { app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true }); return app.getLoginItemSettings().openAtLogin; }));
ipcMain.handle('open:privacy', wrap(() => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')));

// ---------- personal assistant ----------
const pendingApprovals = new Map();
function approve(name, text) {
  return new Promise((resolve) => {
    const id = 'a' + Date.now() + Math.random().toString(36).slice(2, 6);
    pendingApprovals.set(id, resolve);
    if (!panelWin.isVisible()) togglePanel(true);
    panelWin.webContents.send('approve:request', { id, name, text });
    setTimeout(() => { if (pendingApprovals.has(id)) { pendingApprovals.delete(id); resolve(false); } }, 5 * 60 * 1000);
  });
}
ipcMain.handle('approve:answer', wrap((id, ok) => { const r = pendingApprovals.get(id); if (r) { pendingApprovals.delete(id); r(!!ok); } return true; }));
function memoryText() { return data.memory.slice(-80).map((m) => `${m.id}: ${m.kind}: ${m.text}`).join('\n'); }
ipcMain.handle('assistant:chat', wrap(async (question) => {
  const history = data.talk.slice(-12);
  const out = await assistant.chat(question, history, {
    claudeRaw, approve, fake: FAKE_AI, profile: data.profile || {}, memoryText: memoryText(),
    remember: (kind, text) => { const m = { id: 'm' + Date.now().toString(36), kind, text, at: Date.now() }; data.memory.push(m); saveData(); return 'Saved as ' + m.id; },
    forget: (id) => { const n = data.memory.length; data.memory = data.memory.filter((m) => m.id !== id); saveData(); return n !== data.memory.length ? 'Forgotten.' : 'No memory with that id.'; },
    captureScreen,
  });
  data.talk.push({ role: 'user', text: question, at: Date.now() }, { role: 'assistant', text: out.text, at: Date.now(), actions: out.actions });
  data.talk = data.talk.slice(-60); saveData();
  return out;
}));
ipcMain.handle('memory:delete', wrap((id) => { data.memory = data.memory.filter((m) => m.id !== id); saveData(); return publicData(); }));
ipcMain.handle('profile:set', wrap((p) => { data.profile = { name: String(p.name || '').trim(), about: String(p.about || '').trim() }; saveData(); return publicData(); }));
ipcMain.handle('talk:clear', wrap(() => { data.talk = []; saveData(); return publicData(); }));

// ---------- voice ----------
function orbState(state) { if (orbWin) orbWin.webContents.send('orb:state', state); }
ipcMain.handle('voice:transcribe', wrap(async (bytes, mime) => {
  orbState('thinking');
  if (FAKE_AI) return 'What is on my day today?';
  const key = getElevenKey();
  if (!key) throw Object.assign(new Error('To talk to me, add your ElevenLabs key in Setup › Voice. (Or press Fn twice to dictate.)'), { code: 'no_eleven' });
  return await voice.elevenTranscribe(key, Buffer.from(bytes), mime);
}));
ipcMain.handle('voice:speak', wrap(async (text) => {
  const v = data.voice || {};
  const clean = String(text || '').replace(/[*_#`]/g, '').slice(0, 1500);
  if (!clean) return { played: 'none' };
  if (FAKE_AI) return { played: 'fake' };
  if (v.engine === 'eleven' && v.elevenVoiceId) {
    const key = getElevenKey();
    if (!key) throw new Error('Add your ElevenLabs key in Setup › Voice to use that voice.');
    return { played: 'eleven', mp3: await voice.elevenSpeak(key, v.elevenVoiceId, clean) };
  }
  orbState('speaking');
  const r = await voice.sayMac(clean, v.macVoice);
  orbState('idle');
  return r;
}));
ipcMain.handle('voice:stop', wrap(() => { voice.stopSpeaking(); orbState('idle'); return true; }));
ipcMain.handle('voice:voices', wrap(async () => {
  const mac = await voice.macVoices();
  let eleven = [], elevenError = null;
  const key = getElevenKey();
  if (key) { try { eleven = await voice.elevenVoices(key); } catch (e) { elevenError = e.message; } }
  return { mac, eleven, elevenError };
}));
ipcMain.handle('voice:set', wrap((v) => { data.voice = Object.assign({}, data.voice, v); saveData(); return publicData(); }));
ipcMain.handle('eleven:setKey', wrap((k) => { setElevenKey(k); return publicData(); }));
ipcMain.handle('mic:ask', wrap(async () => {
  if (!isMac) return true;
  if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
  return await systemPreferences.askForMediaAccess('microphone');
}));
ipcMain.on('orb:state', (e, state) => orbState(state));

ipcMain.handle('ask', wrap(async (question) => {
  data.chat.push({ role: 'user', text: question, at: Date.now() });
  const history = data.chat.slice(-10).map((m) => (m.role === 'user' ? 'Founder: ' : 'Chota Sarth: ') + m.text).join('\n');
  const reply = await claude({ system: SYSTEM + '\n\n' + productBlock(), prompt: `Conversation so far:\n${history}\n\nReply to the founder's last message in under 120 words.`, model: 'smart', maxTokens: 600 });
  data.chat.push({ role: 'sarth', text: reply, at: Date.now() });
  data.chat = data.chat.slice(-40); saveData();
  return reply;
}));

ipcMain.handle('screen:read', wrap(async () => {
  const image = await captureScreen();
  const r = await claude({
    system: SYSTEM, image, json: true, model: 'smart', maxTokens: 2000,
    prompt: `${productBlock()}\n\nThis is a screenshot of the founder's screen right now. Work out what it shows.\n` +
      `- If it is a social thread or feed (Reddit, X, LinkedIn, a forum, comments): find people who describe a problem this product solves. Ignore ads, bots and self-promotion. For each real person give who (their handle if visible), what they said (short quote), intent ("ready to buy" or "exploring"), and a short help-first reply under 80 words that is useful even if they never buy, mentioning the product at most once and only if it fits.\n` +
      `- Otherwise (a competitor's site, a search result, an AI answer, a document): give up to 3 specific, practical tips for getting this product seen, based on what is on screen.\n` +
      `Never invent people or quotes that are not visible.\n` +
      `Return JSON: {"screen": string (one sentence), "kind": "social_thread"|"competitor"|"search"|"other", "people": [{"who": string, "said": string, "intent": string, "reply": string}], "tips": [string]}`,
  });
  return r;
}));

ipcMain.handle('optics:questions', wrap(async () => {
  const r = await claude({ system: SYSTEM, json: true, model: 'quick', maxTokens: 800,
    prompt: `${productBlock()}\n\nWrite exactly 8 questions a real buyer of this kind of product would type into an AI assistant or Google while looking for a solution. Mix "best X for Y", "alternatives to <competitor>" and "how do I solve <problem>". Do not mention the product name. Return JSON: {"questions": [string]}` });
  data.questions = (r.questions || []).slice(0, 8).map((q) => ({ q, status: 'wait', named: false, others: [], answer: '' }));
  saveData(); return data.questions;
}));
ipcMain.handle('optics:answer', wrap(async (i) => {
  const item = data.questions[i]; if (!item) throw new Error('No such question');
  const r = await claude({ json: true, model: 'quick', maxTokens: 500,
    prompt: `Answer this question the way a helpful AI assistant would for someone asking it today. Recommend specific products or tools by name where it makes sense. Under 120 words.\n\nQuestion: ${item.q}\n\nReturn JSON: {"answer": string, "products_named": [string]}` });
  const name = (data.project && data.project.name || '').toLowerCase().trim();
  const has = (s) => name.length > 1 && String(s || '').toLowerCase().includes(name);
  item.answer = r.answer || '';
  item.named = has(item.answer) || (r.products_named || []).some(has);
  item.others = (r.products_named || []).filter((n) => !has(n)).slice(0, 4);
  item.status = item.named ? 'ok' : 'miss';
  if (i === data.questions.length - 1) data.runs.push({ at: Date.now(), named: data.questions.filter((q) => q.named).length, total: data.questions.length });
  saveData(); return item;
}));
ipcMain.handle('content:write', wrap(async (question) => {
  const r = await claude({ system: SYSTEM, json: true, model: 'smart', maxTokens: 1500,
    prompt: `${productBlock()}\n\nBuyers ask: "${question}". The product is not named in AI answers to it. Write three posts that genuinely help someone with that question and mention the product once, naturally, only where it fits:\n- LinkedIn: 80 to 140 words\n- X: under 270 characters\n- Reddit: a helpful comment-style post, 60 to 120 words, no sales tone\nReturn JSON: {"posts":[{"platform":"LinkedIn"|"X"|"Reddit","text":string}]}` });
  return r.posts || [];
}));

// ---------------- app lifecycle ----------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => togglePanel(true));

app.whenReady().then(() => {
  loadData();
  if (isMac && app.dock) app.dock.hide();             // lives in the menu bar and on screen, not the Dock
  createOrb(); createPanel(); createTray();
  const ok = globalShortcut.register('Alt+Space', () => togglePanel());
  if (!ok) globalShortcut.register('CommandOrControl+Shift+Space', () => togglePanel());
  // Siri-style: Control + Option + Space starts (or stops) listening from anywhere.
  globalShortcut.register('Control+Alt+Space', () => { if (!panelWin.isVisible()) togglePanel(true); panelWin.webContents.send('voice:toggle'); });
  // Let our own pages use the microphone (nothing else is ever loaded in these windows).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media'));
  if (!getKey() && !FAKE_AI) setTimeout(() => togglePanel(true), 600);   // first run: open setup
});

// Orb: drag to move, click to open the panel.
ipcMain.on('orb:drag', (e, { dx, dy }) => { const [x, y] = orbWin.getPosition(); orbWin.setPosition(x + dx, y + dy); });
ipcMain.on('orb:dragEnd', () => { const [x, y] = orbWin.getPosition(); data.orb = { x, y }; saveData(); });
ipcMain.on('orb:click', () => togglePanel());
// Press and hold the orb to talk; let go to stop.
ipcMain.on('orb:holdStart', () => { if (!panelWin.isVisible()) togglePanel(true); panelWin.webContents.send('voice:start'); });
ipcMain.on('orb:holdEnd', () => panelWin.webContents.send('voice:stop'));

app.on('will-quit', () => { globalShortcut.unregisterAll(); voice.stopSpeaking(); });
app.on('window-all-closed', (e) => e.preventDefault());

// Test hook: lets an automated check capture the windows without a person present.
if (process.env.SARTH_SHOTS) {
  app.whenReady().then(() => setTimeout(async () => {
    const dir = process.env.SARTH_SHOTS;
    togglePanel(true);
    await new Promise((r) => setTimeout(r, 1200));
    for (const [name, js] of JSON.parse(process.env.SARTH_STEPS || '[]')) {
      if (js) await panelWin.webContents.executeJavaScript(js).catch((e) => console.error('step failed', name, e.message));
      await new Promise((r) => setTimeout(r, 1400));
      const img = await panelWin.webContents.capturePage(); fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
    }
    const o = await orbWin.webContents.capturePage(); fs.writeFileSync(path.join(dir, 'orb.png'), o.toPNG());
    app.isQuitting = true; app.quit();
  }, 1500));
}

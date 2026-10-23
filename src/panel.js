// Chota Sarth panel: Chat (personal assistant), Today, Memory, Grow, Setup.
(function () {
  'use strict';
  const F = window.findable;
  const $ = (id) => document.getElementById(id);
  let D = { profile: {}, memory: [], talk: [], project: null, drafts: [], runs: [], questions: [], chat: [], hasKey: false, hasEleven: false, voice: {} };
  let speak = localStorage.getItem('sarth.speak') === '1';

  function el(tag, props, kids) {
    const e = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) { if (k === 'text') e.textContent = props[k]; else if (k === 'cls') e.className = props[k]; else e.setAttribute(k, props[k]); }
    (kids || []).forEach((c) => c && e.appendChild(c)); return e;
  }
  function toast(t) { const x = $('toast'); x.textContent = t; x.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => x.classList.remove('show'), 1800); }
  function showErr(box, msg) { $(box).innerHTML = ''; if (msg) $(box).appendChild(el('div', { cls: 'err', text: msg })); }
  async function call(p) { const r = await p; if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; } return r.value; }
  // ---------- speaking ----------
  let audioEl = null, lastWasVoice = false;
  function stopAudio() { if (audioEl) { try { audioEl.pause(); } catch (_) {} audioEl = null; } }
  async function say(text, force) {
    if (!text || (!speak && !force && !lastWasVoice)) return;
    try {
      const r = await call(F.speak(text));
      if (r.played === 'eleven' && r.mp3) {
        stopAudio(); audioEl = new Audio('data:audio/mpeg;base64,' + r.mp3);
        F.setOrbState('speaking'); audioEl.onended = () => F.setOrbState('idle');
        await audioEl.play().catch(() => F.setOrbState('idle'));
      } else if (r.played === 'none' && window.speechSynthesis) {
        speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
    } catch (e) { F.setOrbState('idle'); toast(e.message); }
  }
  function saveDrafts() { F.setDrafts(D.drafts); renderBadge(); }
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ---------- tabs ----------
  let view = 'chat';
  function go(v) {
    view = v;
    document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v)));
    document.querySelectorAll('.v').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
    $('askForm').hidden = v !== 'chat'; $('hint').hidden = v !== 'chat';
    if (v === 'chat') renderTalk();
    if (v === 'today') renderToday();
    if (v === 'memory') renderMemory();
    if (v === 'grow') { renderDrafts(); renderOptics(); fillProduct(); }
    if (v === 'setup') fillSetup();
  }
  function goGrow(id) {
    document.querySelectorAll('.sub button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === id)));
    document.querySelectorAll('.gv').forEach((g) => g.classList.toggle('on', g.id === id));
  }
  document.querySelector('.sub').addEventListener('click', (e) => { const b = e.target.closest('button[data-g]'); if (b) goGrow(b.dataset.g); });
  document.querySelector('nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) go(b.dataset.v); });
  $('close').addEventListener('click', () => F.hide());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') F.hide(); });

  function renderBadge() { const n = D.drafts.filter((d) => d.status === 'pending').length; $('pendN').hidden = !n; $('pendN').textContent = n; }

  // ---------- Chat: the personal assistant ----------
  let busy = false;
  function bubble(role, text) { return el('div', { cls: 'msg ' + (role === 'user' ? 'me' : 'bot'), text }); }
  function actionLine(a) { return el('div', { cls: 'act ' + (a.status === 'done' ? 'done' : a.status === 'failed' ? 'failed' : ''), text: (a.status === 'done' ? '✓ ' : a.status === 'failed' ? '✕ ' : '– ') + a.label + (a.error ? '\n' + a.error : '') + (a.status === 'declined' ? ' (you said no)' : '') }); }
  function renderTalk() {
    const c = $('talk'); c.innerHTML = '';
    if (!D.talk.length) {
      c.appendChild(el('div', { cls: 'msg bot', text: (D.profile && D.profile.name ? 'Hi ' + D.profile.name + '! ' : 'Hi! ') + 'I’m Chota Sarth. I can set reminders, add calendar events, plan your day, write WhatsApp messages and emails, find files, open apps, play music, explain your screen, and remember things for you. Before I change anything, I’ll ask.' }));
    }
    D.talk.slice(-30).forEach((m) => {
      c.appendChild(bubble(m.role, m.text));
      (m.actions || []).filter((a) => a.name !== 'remember' || a.status === 'done').forEach((a) => c.appendChild(actionLine(a)));
    });
    $('starters').hidden = D.talk.length > 0;
    c.lastChild && c.lastChild.scrollIntoView({ block: 'end' });
  }
  async function send(q, opts) {
    if (!q || busy) return; busy = true; showErr('talkErr', '');
    lastWasVoice = !!(opts && opts.voice);
    go('chat');
    D.talk.push({ role: 'user', text: q }); renderTalk();
    const thinking = el('div', { cls: 'msg bot muted', text: 'Thinking…' }); $('talk').appendChild(thinking); thinking.scrollIntoView({ block: 'end' });
    try {
      const out = await call(F.chat(q));
      D.talk.push({ role: 'assistant', text: out.text, actions: out.actions });
      try { D = Object.assign(D, await call(F.getData())); } catch { }
      renderTalk(); F.setOrbState('idle'); say(out.text);
    } catch (err) { thinking.remove(); D.talk.pop(); renderTalk(); F.setOrbState('idle'); showErr('talkErr', err.message); }
    busy = false;
  }
  $('askForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('askInput').value.trim(); $('askInput').value = ''; send(q); });

  // ---------- listening (Siri-style) ----------
  const V = { on: false, rec: null, stream: null, chunks: [], ctx: null, raf: 0, heard: false, quietSince: 0, startAt: 0 };
  async function startListening() {
    if (V.on || busy) return;
    stopAudio(); F.stopSpeaking(); showErr('talkErr', '');
    let ok = false; try { ok = await call(F.askMic()); } catch (_) {}
    if (!ok) { showErr('talkErr', 'I need the microphone. Turn it on in System Settings \u203a Privacy & Security \u203a Microphone, then try again.'); return; }
    go('chat');
    try { V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { showErr('talkErr', 'Could not use the microphone: ' + e.message); return; }
    V.chunks = [];
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    V.rec = new MediaRecorder(V.stream, mime ? { mimeType: mime } : undefined);
    V.rec.ondataavailable = (e) => { if (e.data && e.data.size) V.chunks.push(e.data); };
    V.rec.onstop = finishListening;
    V.rec.start(250);
    V.on = true; V.heard = false; V.startAt = V.quietSince = performance.now();
    // Level meter + stop by itself after a short silence, like Siri.
    V.ctx = new AudioContext(); const an = V.ctx.createAnalyser(); an.fftSize = 1024; V.ctx.createMediaStreamSource(V.stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (!V.on) return;
      an.getByteTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
      const rms = Math.sqrt(sum / buf.length), now = performance.now();
      $('lvl').style.width = Math.min(100, rms * 400) + '%';
      if (rms > 0.04) { V.heard = true; V.quietSince = now; }
      if ((V.heard && now - V.quietSince > 1500) || now - V.startAt > 20000 || (!V.heard && now - V.startAt > 8000)) stopListening();
      else V.raf = requestAnimationFrame(tick);
    };
    tick();
    $('listenBar').hidden = false; $('listenText').textContent = 'Listening\u2026'; $('micBtn').classList.add('on'); F.setOrbState('listening');
  }
  function stopListening() {
    if (!V.on) return; V.on = false; cancelAnimationFrame(V.raf);
    try { V.rec.stop(); } catch (_) {}
    try { V.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { V.ctx.close(); } catch (_) {}
    $('micBtn').classList.remove('on');
  }
  async function finishListening() {
    if (!V.heard) { $('listenBar').hidden = true; F.setOrbState('idle'); toast('I didn\u2019t hear anything'); return; }
    $('listenText').textContent = 'Understanding\u2026'; F.setOrbState('thinking');
    try {
      const blob = new Blob(V.chunks, { type: (V.rec && V.rec.mimeType) || 'audio/webm' });
      const text = await call(F.transcribe(await blob.arrayBuffer(), blob.type));
      $('listenBar').hidden = true;
      if (!text) { F.setOrbState('idle'); toast('I didn\u2019t catch that'); return; }
      F.setOrbState('thinking'); await send(text, { voice: true });
    } catch (e) { $('listenBar').hidden = true; F.setOrbState('idle'); showErr('talkErr', e.message); }
  }
  $('micBtn').addEventListener('click', () => (V.on ? stopListening() : startListening()));
  $('listenDone').addEventListener('click', stopListening);
  F.onVoice((cmd) => { if (cmd === 'start') startListening(); else if (cmd === 'stop') stopListening(); else (V.on ? stopListening() : startListening()); });
  $('starters').addEventListener('click', (e) => { const b = e.target.closest('button[data-q]'); if (b) send(b.dataset.q); });

  // "I'd like to…" cards: nothing that changes something happens without a yes.
  F.onApproval((req) => {
    go('chat');
    const card = el('div', { cls: 'approve' }, [el('b', { text: 'I’d like to:' }), el('div', { cls: 't', text: req.text })]);
    const yes = el('button', { cls: 'btn primary', text: 'Do it' }), no = el('button', { cls: 'btn', text: 'Cancel' });
    const done = (ok) => { yes.disabled = no.disabled = true; card.remove(); F.answerApproval(req.id, ok); };
    yes.onclick = () => done(true); no.onclick = () => done(false);
    card.appendChild(el('div', { cls: 'row' }, [yes, no]));
    const thinking = [...$('talk').children].find((x) => x.textContent === 'Thinking…');
    $('talk').insertBefore(card, thinking || null); card.scrollIntoView({ block: 'end' }); yes.focus();
    say('Can I ' + req.text.split('\n')[0].replace(/^./, (c) => c.toLowerCase()) + '?');
  });

  // ---------- Today ----------
  function renderToday() {
    $('todayTitle').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    const box = $('todayMem'); box.innerHTML = '';
    const keep = D.memory.filter((m) => m.kind === 'promise' || m.kind === 'plan');
    box.appendChild(el('h2', { text: 'Plans and promises' }));
    if (!keep.length) box.appendChild(el('div', { cls: 'muted', text: 'Nothing yet. Tell me in Chat, e.g. “remember I promised to send the price list to Krishna Agro on Friday.”' }));
    keep.slice(-12).reverse().forEach((m) => box.appendChild(el('div', { cls: 'q' }, [el('div', { text: m.text }), el('span', { cls: 'pill ' + (m.kind === 'promise' ? 'warm' : 'wait'), text: m.kind })])));
  }
  $('briefMe').addEventListener('click', () => send('Brief me on my day: check my calendar and reminders for today, and include any plans or promises you remember. Keep it short.'));

  // ---------- Memory ----------
  function renderMemory() {
    const box = $('memList'); box.innerHTML = '';
    if (!D.memory.length) { box.appendChild(el('div', { cls: 'empty', text: 'I don’t remember anything yet.' })); return; }
    D.memory.slice().reverse().forEach((m) => {
      const del = el('button', { 'aria-label': 'Forget this', title: 'Forget', text: '✕' });
      del.onclick = async () => { D = Object.assign(D, await call(F.deleteMemory(m.id))); renderMemory(); };
      box.appendChild(el('div', { cls: 'mem' }, [el('span', { cls: 'k', text: m.kind }), el('div', { text: m.text }), del]));
    });
  }

  // ---------- Screen ----------
  $('readScreen').addEventListener('click', async () => {
    const btn = $('readScreen'); btn.disabled = true; showErr('scErr', ''); $('scResult').innerHTML = '';
    $('scStatus').textContent = 'Looking at your screen…';
    try {
      const r = await call(F.readScreen());
      $('scStatus').textContent = r.screen || '';
      const box = $('scResult');
      const people = (r.people || []).filter((p) => p && p.reply);
      if (people.length) {
        box.appendChild(el('h2', { text: people.length + (people.length > 1 ? ' people here have your problem' : ' person here has your problem') }));
        people.forEach((p) => D.drafts.unshift({ id: uid(), engine: 'outreach', platform: 'Reply', who: p.who, intent: p.intent, ctx: p.said, text: p.reply, status: 'pending', at: Date.now() }));
        saveDrafts();
        box.appendChild(el('p', { cls: 'muted', text: 'Replies are drafted and waiting in Approvals.' }));
        const b = el('button', { cls: 'btn primary', text: 'Review replies' }); b.onclick = () => goGrow('g-approvals'); box.appendChild(b);
        say(people.length + ' people here have your problem. Replies are waiting for you.');
      }
      (r.tips || []).forEach((tip) => box.appendChild(el('div', { cls: 'tip', text: tip })));
      if (!people.length && !(r.tips || []).length) box.appendChild(el('div', { cls: 'empty', text: 'Nothing useful for getting seen on this screen.' }));
    } catch (err) {
      $('scStatus').textContent = ''; showErr('scErr', err.message);
      if (err.code === 'screen_denied') { const b = el('button', { cls: 'btn', text: 'Open Screen Recording settings' }); b.onclick = () => F.openPrivacy(); $('scErr').appendChild(b); }
    }
    btn.disabled = false;
  });

  // ---------- Visibility (optics) ----------
  function renderOptics() {
    const box = $('opResult'); box.innerHTML = '';
    if (!D.questions.length) return;
    const done = D.questions.filter((q) => q.status !== 'wait'); const named = done.filter((q) => q.named).length;
    const big = el('div', { cls: 'big' }); big.append(String(named)); big.appendChild(el('span', { text: '/' + D.questions.length }));
    box.appendChild(el('div', { cls: 'card' }, [big, el('div', { cls: 'muted', text: 'AI answers that name ' + D.project.name })]));
    D.questions.forEach((q, i) => {
      const left = el('div', {}, [el('div', { text: q.q })]);
      if (q.others && q.others.length) left.appendChild(el('div', { cls: 'who', text: 'Named: ' + q.others.join(', ') }));
      const right = el('div', { cls: 'row' }, [el('span', { cls: 'pill ' + (q.status === 'ok' ? 'ok' : q.status === 'miss' ? 'miss' : 'wait'), text: q.status === 'ok' ? 'Named' : q.status === 'miss' ? 'Missing' : 'Checking' })]);
      if (q.status === 'miss') {
        const has = D.drafts.some((d) => d.engine === 'content' && d.ctx === q.q);
        const w = el('button', { cls: 'btn', text: has ? 'Written' : 'Write posts' }); w.disabled = has;
        w.onclick = async () => {
          w.disabled = true; w.textContent = 'Writing…';
          try { const posts = await call(F.writeContent(q.q)); posts.forEach((p) => D.drafts.unshift({ id: uid(), engine: 'content', platform: p.platform, ctx: q.q, text: p.text, status: 'pending', at: Date.now() })); saveDrafts(); w.textContent = 'Written'; toast('Posts are in Approvals'); }
          catch (err) { w.disabled = false; w.textContent = 'Write posts'; showErr('opErr', err.message); }
        };
        right.appendChild(w);
      }
      box.appendChild(el('div', { cls: 'q' }, [left, right]));
    });
  }
  $('runOptics').addEventListener('click', async () => {
    if (!D.project) { goGrow('g-product'); return; }
    const btn = $('runOptics'); btn.disabled = true; showErr('opErr', '');
    try {
      $('opStatus').textContent = 'Writing the questions your buyers ask…';
      D.questions = await call(F.opticsQuestions()); renderOptics();
      for (let i = 0; i < D.questions.length; i++) {
        $('opStatus').textContent = `Asking question ${i + 1} of ${D.questions.length}…`;
        D.questions[i] = await call(F.opticsAnswer(i)); renderOptics();
      }
      const named = D.questions.filter((q) => q.named).length;
      D.runs.push({ at: Date.now(), named, total: D.questions.length });
      $('opStatus').textContent = `Done. Named in ${named} of ${D.questions.length}. Write posts for the ones you’re missing.`;
      say(`You were named in ${named} of ${D.questions.length} answers.`);
    } catch (err) { $('opStatus').textContent = ''; showErr('opErr', err.message); }
    btn.disabled = false;
  });

  // ---------- Approvals ----------
  function renderDrafts() {
    const box = $('drafts'); box.innerHTML = '';
    const list = D.drafts.filter((d) => d.status !== 'skipped');
    if (!list.length) { box.appendChild(el('div', { cls: 'empty', text: 'Nothing yet. Use Screen on a thread, or write posts from Visibility.' })); return; }
    list.forEach((d) => {
      const meta = el('div', { cls: 'meta' }, [el('b', { text: d.engine === 'content' ? d.platform + ' post' : 'Reply' + (d.who ? ' to ' + d.who : '') })]);
      if (d.intent) meta.appendChild(el('span', { cls: 'pill ' + (/ready/.test(d.intent) ? 'warm' : 'wait'), text: /ready/.test(d.intent) ? 'Ready to buy' : 'Exploring' }));
      if (d.status === 'approved') meta.appendChild(el('span', { cls: 'pill ok', text: 'Approved' }));
      const ctx = el('p', { cls: 'ctx', text: (d.engine === 'content' ? 'Answers: ' : 'They said: ') + (d.ctx || '') });
      const ta = el('textarea', { 'aria-label': 'Draft' }); ta.value = d.text; ta.addEventListener('change', () => { d.text = ta.value; saveDrafts(); });
      const row = el('div', { cls: 'row' }); row.style.marginTop = '8px';
      if (d.status === 'pending') {
        const ap = el('button', { cls: 'btn primary', text: 'Approve and copy' });
        ap.onclick = async () => { d.text = ta.value; d.status = 'approved'; saveDrafts(); await F.copy(d.text); toast('Copied. Paste it where you want to post.'); renderDrafts(); };
        const sk = el('button', { cls: 'btn', text: 'Skip' }); sk.onclick = () => { d.status = 'skipped'; saveDrafts(); renderDrafts(); };
        row.append(ap, sk);
      } else {
        const cp = el('button', { cls: 'btn', text: 'Copy again' }); cp.onclick = async () => { await F.copy(ta.value); toast('Copied'); }; row.append(cp);
      }
      box.appendChild(el('div', { cls: 'draft ' + d.status }, [meta, ctx, ta, row]));
    });
  }

  // ---------- Setup ----------
  function fillProduct() {
    const p = D.project || {};
    $('s-name').value = p.name || ''; $('s-desc').value = p.desc || ''; $('s-buyer').value = p.buyer || '';
    $('s-comp').value = (p.comp || []).join(', '); $('s-voice').value = p.voice || '';
  }
  function fillSetup() {
    $('p-name').value = (D.profile && D.profile.name) || ''; $('p-about').value = (D.profile && D.profile.about) || '';
    $('keyStatus').textContent = D.hasKey ? 'A key is saved.' : 'No key saved yet.';
    $('speak').checked = speak;
    F.getLogin().then((r) => { if (r.ok) $('atLogin').checked = !!r.value; });
    $('elevenStatus').textContent = D.hasEleven ? 'ElevenLabs key saved. You can talk to me.' : 'No ElevenLabs key yet: I can speak with Mac voices, but to understand your voice I need this key.';
    $('s-voiceId').value = (D.voice && D.voice.engine === 'eleven' && D.voice.elevenVoiceId) || '';
    loadVoices();
  }
  async function loadVoices() {
    const pick = $('voicePick'); pick.innerHTML = '';
    let list = { mac: [], eleven: [] };
    try { list = await call(F.voices()); } catch (e) { $('elevenStatus').textContent = e.message; }
    if (list.elevenError) $('elevenStatus').textContent = list.elevenError;
    const v = D.voice || {};
    const cur = v.engine === 'eleven' ? 'el:' + (v.elevenVoiceId || '') : 'mac:' + (v.macVoice || '');
    const add = (group, items) => { if (!items.length) return; const g = el('optgroup', { label: group }); items.forEach((o) => { const opt = el('option', { value: o.value, text: o.label }); if (o.value === cur) opt.selected = true; g.appendChild(opt); }); pick.appendChild(g); };
    const def = el('option', { value: 'mac:', text: 'Mac default voice' }); if (cur === 'mac:') def.selected = true; pick.appendChild(def);
    const mac = (list.mac || []).filter((m) => /^en|^hi/.test(m.lang)).sort((a, b) => (b.lang === 'en_IN') - (a.lang === 'en_IN') || (b.lang.startsWith('hi')) - (a.lang.startsWith('hi')));
    add('Mac voices', mac.map((m) => ({ value: 'mac:' + m.id, label: m.name + ' (' + m.lang.replace('_', '-') + ')' })));
    add('ElevenLabs voices', (list.eleven || []).map((e) => ({ value: 'el:' + e.id, label: e.name + (e.category === 'cloned' ? ' (cloned)' : '') })));
    if (v.engine === 'eleven' && v.elevenVoiceId && !(list.eleven || []).some((e) => e.id === v.elevenVoiceId)) add('Custom', [{ value: 'el:' + v.elevenVoiceId, label: (v.elevenVoiceName || 'Custom voice') + ' (' + v.elevenVoiceId.slice(0, 8) + '\u2026)' }]);
  }
  $('voicePick').addEventListener('change', async (e) => {
    const [kind, id] = [e.target.value.slice(0, e.target.value.indexOf(':')), e.target.value.slice(e.target.value.indexOf(':') + 1)];
    const label = e.target.selectedOptions[0] ? e.target.selectedOptions[0].textContent : '';
    D = Object.assign(D, await call(F.setVoice(kind === 'el' ? { engine: 'eleven', elevenVoiceId: id, elevenVoiceName: label } : { engine: 'mac', macVoice: id })));
    toast('Voice changed');
  });
  $('voiceTest').addEventListener('click', () => say('Namaste! I\u2019m Chota Sarth. Ask me anything, or tell me what to do.', true));
  $('elevenForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { D = Object.assign(D, await call(F.setElevenKey($('s-eleven').value))); $('s-eleven').value = ''; $('elevenStatus').textContent = D.hasEleven ? 'ElevenLabs key saved. You can talk to me.' : 'Key removed.'; loadVoices(); }
    catch (err) { $('elevenStatus').textContent = err.message; }
  });
  $('voiceIdForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const id = $('s-voiceId').value.trim(); if (!id) return;
    D = Object.assign(D, await call(F.setVoice({ engine: 'eleven', elevenVoiceId: id, elevenVoiceName: 'Custom voice' }))); toast('Using that voice'); loadVoices();
  });
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault(); D = Object.assign(D, await call(F.setProfile({ name: $('p-name').value, about: $('p-about').value }))); toast('Saved'); if (D.hasKey) go('chat');
  });
  $('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = { name: $('s-name').value.trim(), desc: $('s-desc').value.trim(), buyer: $('s-buyer').value.trim(), comp: $('s-comp').value.split(',').map((s) => s.trim()).filter(Boolean), voice: $('s-voice').value.trim() };
    D = Object.assign(D, await call(F.setProject(p))); toast('Product saved'); goGrow('g-optics');
  });
  $('keyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { D = Object.assign(D, await call(F.setKey($('s-key').value))); $('s-key').value = ''; $('keyStatus').textContent = D.hasKey ? 'Key saved securely. You can start chatting.' : 'Key removed.'; }
    catch (err) { $('keyStatus').textContent = err.message; }
  });
  $('atLogin').addEventListener('change', async (e) => { const r = await F.setLogin(e.target.checked); if (r.ok) { e.target.checked = !!r.value; toast(r.value ? 'Chota Sarth will open when your Mac starts' : 'Won’t open at login'); } });
  $('speak').addEventListener('change', (e) => { speak = e.target.checked; localStorage.setItem('sarth.speak', speak ? '1' : '0'); });

  // ---------- start ----------
  async function refresh() { try { D = await call(F.getData()); } catch { } $('proj').textContent = (D.profile && D.profile.name) || ''; renderBadge(); go(D.hasKey ? view : 'setup'); }
  F.onShown(() => { refresh(); setTimeout(() => { if (view === 'chat') $('askInput').focus(); }, 50); });
  refresh();
})();

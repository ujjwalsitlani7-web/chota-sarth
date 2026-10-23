// Chota Sarth panel: Chat (personal assistant), Today, Memory, Grow, Setup.
(function () {
  'use strict';
  const F = window.findable;
  const $ = (id) => document.getElementById(id);
  let D = { profile: {}, memory: [], talk: [], project: null, drafts: [], runs: [], questions: [], chat: [], hasKey: false };
  let speak = localStorage.getItem('sarth.speak') === '1';

  function el(tag, props, kids) {
    const e = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) { if (k === 'text') e.textContent = props[k]; else if (k === 'cls') e.className = props[k]; else e.setAttribute(k, props[k]); }
    (kids || []).forEach((c) => c && e.appendChild(c)); return e;
  }
  function toast(t) { const x = $('toast'); x.textContent = t; x.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => x.classList.remove('show'), 1800); }
  function showErr(box, msg) { $(box).innerHTML = ''; if (msg) $(box).appendChild(el('div', { cls: 'err', text: msg })); }
  async function call(p) { const r = await p; if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; } return r.value; }
  function say(text) { if (!speak || !window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; speechSynthesis.speak(u); }
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
  async function send(q) {
    if (!q || busy) return; busy = true; showErr('talkErr', '');
    go('chat');
    D.talk.push({ role: 'user', text: q }); renderTalk();
    const thinking = el('div', { cls: 'msg bot muted', text: 'Thinking…' }); $('talk').appendChild(thinking); thinking.scrollIntoView({ block: 'end' });
    try {
      const out = await call(F.chat(q));
      D.talk.push({ role: 'assistant', text: out.text, actions: out.actions });
      try { D = Object.assign(D, await call(F.getData())); } catch { }
      renderTalk(); say(out.text);
    } catch (err) { thinking.remove(); D.talk.pop(); renderTalk(); showErr('talkErr', err.message); }
    busy = false;
  }
  $('askForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('askInput').value.trim(); $('askInput').value = ''; send(q); });
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
  }
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

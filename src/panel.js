// Chota Sarth panel: Ask, Screen, Visibility, Approvals, Setup.
(function () {
  'use strict';
  const F = window.findable;
  const $ = (id) => document.getElementById(id);
  let D = { project: null, drafts: [], runs: [], questions: [], chat: [], hasKey: false };
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
  let view = 'ask';
  function go(v) {
    view = v;
    document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v)));
    document.querySelectorAll('.v').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
    $('askForm').hidden = v !== 'ask';
    if (v === 'approvals') renderDrafts();
    if (v === 'optics') renderOptics();
    if (v === 'ask') renderAsk();
    if (v === 'setup') fillSetup();
  }
  document.querySelector('nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) go(b.dataset.v); });
  $('close').addEventListener('click', () => F.hide());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') F.hide(); });

  function renderBadge() { const n = D.drafts.filter((d) => d.status === 'pending').length; $('pendN').hidden = !n; $('pendN').textContent = n; }

  // ---------- Ask (home) ----------
  function renderAsk() {
    const t = $('today'); t.innerHTML = '';
    if (!D.project) {
      t.appendChild(el('h2', { text: 'Hi, I’m Chota Sarth, your sidekick for getting seen.' }));
      t.appendChild(el('p', { cls: 'muted', text: 'I help your product get found. Tell me what you’re building in Setup, add your API key, and I’ll check where you’re invisible.' }));
      const b = el('button', { cls: 'btn primary', text: 'Go to Setup' }); b.onclick = () => go('setup'); t.appendChild(b); return;
    }
    const last = D.runs[D.runs.length - 1];
    const pend = D.drafts.filter((d) => d.status === 'pending').length;
    t.appendChild(el('h2', { text: 'Your week' }));
    const lines = [
      last ? `Named in ${last.named} of ${last.total} AI answers on your last check.` : 'No visibility check yet. Try the Visibility tab.',
      pend ? `${pend} draft${pend > 1 ? 's' : ''} waiting for your yes.` : 'Nothing waiting for approval.',
      D.hasKey ? 'Open any thread and use Screen to find people asking.' : 'Add your Anthropic API key in Setup to turn me on.',
    ];
    lines.forEach((l) => t.appendChild(el('div', { cls: 'muted', text: l })));
    const c = $('chat'); c.innerHTML = '';
    D.chat.slice(-12).forEach((m) => c.appendChild(el('div', { cls: 'msg ' + (m.role === 'user' ? 'me' : 'bot'), text: m.text })));
  }
  $('askForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const q = $('askInput').value.trim(); if (!q) return;
    $('askInput').value = ''; showErr('askErr', '');
    D.chat.push({ role: 'user', text: q }); renderAsk();
    const thinking = el('div', { cls: 'msg bot muted', text: 'Thinking…' }); $('chat').appendChild(thinking); thinking.scrollIntoView({ block: 'end' });
    try { const a = await call(F.ask(q)); D.chat.push({ role: 'sarth', text: a }); renderAsk(); say(a); $('chat').lastChild && $('chat').lastChild.scrollIntoView({ block: 'end' }); }
    catch (err) { thinking.remove(); D.chat.pop(); showErr('askErr', err.message); }
  });

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
        const b = el('button', { cls: 'btn primary', text: 'Review replies' }); b.onclick = () => go('approvals'); box.appendChild(b);
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
    if (!D.project) { go('setup'); return; }
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
  function fillSetup() {
    const p = D.project || {};
    $('s-name').value = p.name || ''; $('s-desc').value = p.desc || ''; $('s-buyer').value = p.buyer || '';
    $('s-comp').value = (p.comp || []).join(', '); $('s-voice').value = p.voice || '';
    $('keyStatus').textContent = D.hasKey ? 'A key is saved.' : 'No key saved yet.';
    $('speak').checked = speak;
    F.getLogin().then((r) => { if (r.ok) $('atLogin').checked = !!r.value; });
  }
  $('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = { name: $('s-name').value.trim(), desc: $('s-desc').value.trim(), buyer: $('s-buyer').value.trim(), comp: $('s-comp').value.split(',').map((s) => s.trim()).filter(Boolean), voice: $('s-voice').value.trim() };
    D = Object.assign(D, await call(F.setProject(p))); $('proj').textContent = D.project.name; toast('Saved'); go(D.hasKey ? 'optics' : 'setup');
  });
  $('keyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { D = Object.assign(D, await call(F.setKey($('s-key').value))); $('s-key').value = ''; $('keyStatus').textContent = D.hasKey ? 'Key saved securely.' : 'Key removed.'; }
    catch (err) { $('keyStatus').textContent = err.message; }
  });
  $('atLogin').addEventListener('change', async (e) => { const r = await F.setLogin(e.target.checked); if (r.ok) { e.target.checked = !!r.value; toast(r.value ? 'Chota Sarth will open when your Mac starts' : 'Won’t open at login'); } });
  $('speak').addEventListener('change', (e) => { speak = e.target.checked; localStorage.setItem('sarth.speak', speak ? '1' : '0'); });

  // ---------- start ----------
  async function refresh() { try { D = await call(F.getData()); } catch { } $('proj').textContent = D.project ? D.project.name : ''; renderBadge(); go(D.project ? view : 'setup'); }
  F.onShown(() => { refresh(); setTimeout(() => { if (view === 'ask') $('askInput').focus(); }, 50); });
  refresh();
})();

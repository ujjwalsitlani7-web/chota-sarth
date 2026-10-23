// Chota Sarth's personal-assistant brain: a Claude agent with Mac tools.
// Anything that changes something (reminders, calendar, opening drafts, files, music)
// needs the person's yes first; reading (files list, today's agenda, screen) does not
// change anything, so it runs directly.
const { execFile } = require('child_process');
const { shell, clipboard } = require('electron');

const isMac = process.platform === 'darwin';

// ---------- small helpers for running Mac commands ----------
function run(cmd, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').toString().trim().slice(0, 300)));
      else resolve(String(stdout || '').trim());
    });
  });
}
function osa(script) { return run('osascript', ['-e', script]); }
function asStr(s) { return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
// AppleScript date from an ISO-like local time "2026-10-23T10:00"
function asDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) throw new Error('I could not understand that date: ' + iso);
  return `((current date) - (time of (current date))) + (${dayOffset(d)} * days) + ${d.getHours() * 3600 + d.getMinutes() * 60}`;
}
function dayOffset(d) { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0); return Math.round((b - a) / 86400000); }
function needMac() { if (!isMac) throw new Error('This action only works on a Mac.'); }

// ---------- the tools Claude can use ----------
const TOOLS = [
  { name: 'create_reminder', confirm: true, description: 'Create a reminder in the Mac Reminders app.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string', description: 'Local date-time like 2026-10-23T10:00, optional' }, notes: { type: 'string' } }, required: ['title'] } },
  { name: 'create_event', confirm: true, description: 'Add an event to the Mac Calendar app.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string', description: 'Local date-time like 2026-10-24T15:00' }, minutes: { type: 'number', description: 'Length in minutes, default 60' }, notes: { type: 'string' } }, required: ['title', 'start'] } },
  { name: 'get_today', confirm: false, description: "Read today's calendar events and the reminders due today or overdue.",
    input_schema: { type: 'object', properties: {} } },
  { name: 'draft_whatsapp', confirm: true, description: 'Open WhatsApp with a message already written. The person presses send themselves.',
    input_schema: { type: 'object', properties: { phone: { type: 'string', description: 'International number with country code, digits only, optional' }, text: { type: 'string' } }, required: ['text'] } },
  { name: 'draft_email', confirm: true, description: 'Open a new email in the Mail app, already written. The person presses send themselves.',
    input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] } },
  { name: 'search_files', confirm: false, description: 'Search files on this Mac by name or content (Spotlight). Returns up to 15 paths.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'open_file', confirm: true, description: 'Open a file or folder on this Mac with its default app.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'open_app', confirm: true, description: 'Open a Mac app by name, e.g. "WhatsApp", "Notes", "Safari".',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'open_url', confirm: true, description: 'Open a website in the default browser.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'music', confirm: true, description: 'Control music: play, pause, next or previous, in Spotify or Apple Music.',
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'previous'] }, app: { type: 'string', enum: ['Spotify', 'Music'] } }, required: ['action'] } },
  { name: 'copy_to_clipboard', confirm: false, description: 'Copy text to the clipboard so the person can paste it anywhere.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'remember', confirm: false, description: 'Save something about the person to long-term memory: people, plans, promises, preferences or notes. Use when they share something worth keeping.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['person', 'plan', 'promise', 'preference', 'note'] }, text: { type: 'string' } }, required: ['kind', 'text'] } },
  { name: 'forget', confirm: false, description: 'Delete a memory by its id when it is wrong or no longer true.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'look_at_screen', confirm: false, description: "Take one picture of the person's screen to see what they are looking at. Only use when they ask about their screen.",
    input_schema: { type: 'object', properties: {} } },
];

// A plain-words line for the "I'd like to…" card.
function describe(name, a) {
  const when = (s) => { const d = new Date(s); return isNaN(d) ? s : d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
  switch (name) {
    case 'create_reminder': return `Add a reminder: “${a.title}”` + (a.due ? ` for ${when(a.due)}` : '');
    case 'create_event': return `Add to Calendar: “${a.title}” on ${when(a.start)} (${a.minutes || 60} min)`;
    case 'draft_whatsapp': return `Open WhatsApp${a.phone ? ' to +' + String(a.phone).replace(/\D/g, '') : ''} with this message ready (you press send):\n“${a.text}”`;
    case 'draft_email': return `Open Mail with this email ready${a.to ? ' to ' + a.to : ''} (you press send):\nSubject: ${a.subject}\n\n${a.body}`;
    case 'open_file': return `Open ${a.path}`;
    case 'open_app': return `Open the ${a.name} app`;
    case 'open_url': return `Open ${a.url}`;
    case 'music': return `${a.action[0].toUpperCase() + a.action.slice(1)} music${a.app ? ' in ' + a.app : ''}`;
    default: return name;
  }
}

// Run one tool for real. `ctx` gives access to memory and the screen.
async function execute(name, a, ctx) {
  if (ctx.fake && !['remember', 'forget', 'copy_to_clipboard', 'look_at_screen'].includes(name)) {
    if (name === 'get_today') return 'Calendar today: 11:00 Supplier call (Eastern engineers). Reminders: Collect payment from Modi Mogable (overdue).';
    if (name === 'search_files') return '/Users/you/Documents/GST invoice Sept.pdf\n/Users/you/Downloads/GST invoice Aug.pdf';
    return 'Done (test mode, nothing was changed).';
  }
  switch (name) {
    case 'create_reminder': {
      needMac();
      const props = [`name:${asStr(a.title)}`]; if (a.notes) props.push(`body:${asStr(a.notes)}`);
      const due = a.due ? `, due date:(${asDate(a.due)})` : '';
      await osa(`tell application "Reminders" to make new reminder with properties {${props.join(', ')}${due}}`);
      return 'Reminder created.';
    }
    case 'create_event': {
      needMac();
      const mins = Math.max(5, Math.round(a.minutes || 60));
      await osa(`set s to (${asDate(a.start)})\ntell application "Calendar"\nset c to first calendar whose writable is true\nmake new event at end of events of c with properties {summary:${asStr(a.title)}, start date:s, end date:(s + ${mins} * minutes)${a.notes ? ', description:' + asStr(a.notes) : ''}}\nend tell`);
      return 'Event added.';
    }
    case 'get_today': {
      needMac();
      const ev = await osa(`set out to ""\nset t0 to (current date) - (time of (current date))\nset t1 to t0 + 1 * days\ntell application "Calendar"\nrepeat with c in calendars\nrepeat with e in (every event of c whose start date >= t0 and start date < t1)\nset out to out & (time string of (start date of e)) & " " & (summary of e) & linefeed\nend repeat\nend repeat\nend tell\nreturn out`).catch((e) => 'Calendar not readable: ' + e.message);
      const rem = await osa(`set out to ""\nset t1 to (current date) - (time of (current date)) + 1 * days\ntell application "Reminders"\nrepeat with r in (every reminder whose completed is false)\ntry\nset d to due date of r\nif d is not missing value and d < t1 then set out to out & (name of r) & linefeed\nend try\nend repeat\nend tell\nreturn out`).catch((e) => 'Reminders not readable: ' + e.message);
      return `Calendar today:\n${ev || 'nothing'}\nReminders due:\n${rem || 'nothing'}`;
    }
    case 'draft_whatsapp': {
      const phone = String(a.phone || '').replace(/\D/g, '');
      await shell.openExternal(`whatsapp://send?${phone ? 'phone=' + phone + '&' : ''}text=${encodeURIComponent(a.text)}`);
      return 'WhatsApp opened with the message ready. They press send themselves.';
    }
    case 'draft_email': {
      await shell.openExternal(`mailto:${encodeURIComponent(a.to || '')}?subject=${encodeURIComponent(a.subject)}&body=${encodeURIComponent(a.body)}`);
      return 'Mail opened with the email ready. They press send themselves.';
    }
    case 'search_files': {
      needMac();
      const out = await run('mdfind', ['-onlyin', require('os').homedir(), a.query]).catch(() => '');
      const lines = out.split('\n').filter(Boolean).filter((p) => !/\/Library\/|\/\.|node_modules/.test(p)).slice(0, 15);
      return lines.length ? lines.join('\n') : 'No files found.';
    }
    case 'open_file': { const err = await shell.openPath(a.path); if (err) throw new Error(err); return 'Opened.'; }
    case 'open_app': { needMac(); await run('open', ['-a', a.name]); return 'Opened ' + a.name + '.'; }
    case 'open_url': {
      const u = /^https?:\/\//i.test(a.url) ? a.url : 'https://' + a.url;
      await shell.openExternal(u); return 'Opened.';
    }
    case 'music': {
      needMac();
      const appName = a.app || 'Music';
      const cmd = { play: 'play', pause: 'pause', next: 'next track', previous: 'previous track' }[a.action];
      await osa(`tell application ${asStr(appName)} to ${cmd}`);
      return 'Done.';
    }
    case 'copy_to_clipboard': clipboard.writeText(String(a.text || '')); return 'Copied.';
    case 'remember': return ctx.remember(a.kind, a.text);
    case 'forget': return ctx.forget(a.id);
    case 'look_at_screen': return { image: await ctx.captureScreen() };
    default: throw new Error('Unknown tool ' + name);
  }
}

// ---------- the agent loop ----------
// history: [{role:'user'|'assistant', text}], ask(question)
// ctx: { claudeRaw, memoryText, approve(name, description) -> Promise<boolean>, remember, forget, captureScreen, fake, profile }
async function chat(question, history, ctx) {
  const now = new Date();
  const system =
    `You are Chota Sarth, a warm, quick personal assistant living on ${ctx.profile.name ? ctx.profile.name + "'s" : "the person's"} Mac. ` +
    `You help with anything: questions, writing, planning their day, reminders, calendar, messages, email, files, apps and music. ` +
    `Use the tools to actually do things. Anything that changes something is shown to the person for a yes first, so just call the tool. ` +
    `Never claim you sent a message or email: you only open it ready to send. Keep replies short and in plain words; use the person's language (English, Hindi or Hinglish) to match them.\n` +
    `Right now it is ${now.toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })} (local time). When you pass dates to tools, use local time like 2026-10-23T10:00.\n` +
    (ctx.profile.about ? `About them: ${ctx.profile.about}\n` : '') +
    `What you remember (id: kind: text):\n${ctx.memoryText || '(nothing yet)'}`;
  const messages = history.slice(-12).map((m) => ({ role: m.role, content: m.text }));
  messages.push({ role: 'user', content: question });
  const actions = [];
  for (let step = 0; step < 8; step++) {
    const res = await ctx.claudeRaw({ system, messages, tools: TOOLS.map(({ confirm, ...t }) => t) });
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (!uses.length || res.stop_reason !== 'tool_use') {
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { text: text || 'Done.', actions };
    }
    const results = [];
    for (const u of uses) {
      const tool = TOOLS.find((t) => t.name === u.name);
      let content, isError = false;
      try {
        if (tool && tool.confirm) {
          const ok = await ctx.approve(u.name, describe(u.name, u.input || {}));
          if (!ok) { content = 'The person said no. Do not do it; ask if they want something different.'; actions.push({ name: u.name, label: describe(u.name, u.input || {}), status: 'declined' }); results.push({ type: 'tool_result', tool_use_id: u.id, content }); continue; }
        }
        const out = await execute(u.name, u.input || {}, ctx);
        if (out && out.image) content = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: out.image } }, { type: 'text', text: 'This is the screen right now.' }];
        else content = String(out);
        if (tool && tool.confirm) actions.push({ name: u.name, label: describe(u.name, u.input || {}), status: 'done' });
        if (u.name === 'remember') actions.push({ name: 'remember', label: 'Remembered: ' + (u.input || {}).text, status: 'done' });
      } catch (e) {
        isError = true; content = 'Failed: ' + e.message;
        actions.push({ name: u.name, label: describe(u.name, u.input || {}), status: 'failed', error: e.message });
      }
      results.push({ type: 'tool_result', tool_use_id: u.id, content, is_error: isError || undefined });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'I stopped there to be safe. Tell me what to do next.', actions };
}

module.exports = { chat, TOOLS, describe, execute };

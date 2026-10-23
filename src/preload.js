// The only bridge between Chota Sarth's windows and the main process.
// Pages get these functions and nothing else: no Node, no file system, no API key.
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('findable', {
  getData: () => call('data:get'),
  setProject: (p) => call('project:set', p),
  setKey: (k) => call('key:set', k),
  setDrafts: (d) => call('drafts:set', d),
  copy: (t) => call('clipboard:write', t),
  hide: () => call('panel:hide'),
  openPrivacy: () => call('open:privacy'),
  getLogin: () => call('login:get'),
  setLogin: (on) => call('login:set', on),
  ask: (q) => call('ask', q),
  chat: (q) => call('assistant:chat', q),
  answerApproval: (id, ok) => call('approve:answer', id, ok),
  onApproval: (fn) => ipcRenderer.on('approve:request', (e, req) => fn(req)),
  deleteMemory: (id) => call('memory:delete', id),
  setProfile: (p) => call('profile:set', p),
  clearTalk: () => call('talk:clear'),
  readScreen: () => call('screen:read'),
  opticsQuestions: () => call('optics:questions'),
  opticsAnswer: (i) => call('optics:answer', i),
  writeContent: (q) => call('content:write', q),
  onShown: (fn) => ipcRenderer.on('panel:shown', () => fn()),
  orbDrag: (dx, dy) => ipcRenderer.send('orb:drag', { dx, dy }),
  orbDragEnd: () => ipcRenderer.send('orb:dragEnd'),
  orbClick: () => ipcRenderer.send('orb:click'),
});

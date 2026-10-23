// Chota Sarth's voice: listening (speech-to-text) and speaking (text-to-speech).
// Speaking works out of the box with the Mac's own voices (`say`). With an ElevenLabs key it
// can also understand speech (Scribe) and speak with any ElevenLabs voice, including a voice
// cloned from a friend's recordings (with their permission): paste that voice's ID in Setup.
const { execFile, spawn } = require('child_process');

const EL = 'https://api.elevenlabs.io/v1';
const STT_MODEL = 'scribe_v2';
const TTS_MODEL = 'eleven_multilingual_v2';   // English, Hindi and many more

let sayProc = null;
function stopSpeaking() { if (sayProc) { try { sayProc.kill(); } catch (_) {} sayProc = null; } }

function macVoices() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve([]);
    execFile('say', ['-v', '?'], { timeout: 8000 }, (err, out) => {
      if (err) return resolve([]);
      // lines like: "Rishi               en_IN    # Hello! My name is Rishi."
      const list = String(out).split('\n').map((l) => l.match(/^(.+?)\s{2,}([a-z]{2}[_-][A-Z]{2})/)).filter(Boolean)
        .map((m) => ({ id: m[1].trim(), name: m[1].trim(), lang: m[2] }));
      resolve(list);
    });
  });
}
function sayMac(text, voice) {
  stopSpeaking();
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve({ played: 'none' });
    const args = voice ? ['-v', voice, text] : [text];
    sayProc = spawn('say', args);
    sayProc.on('close', () => { sayProc = null; resolve({ played: 'mac' }); });
    sayProc.on('error', () => { sayProc = null; resolve({ played: 'none' }); });
  });
}

async function elevenVoices(key) {
  const res = await fetch(`${EL}/voices`, { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(res.status === 401 ? 'ElevenLabs rejected the key. Check it in Setup.' : 'ElevenLabs voices: HTTP ' + res.status);
  const body = await res.json();
  return (body.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
}
async function elevenSpeak(key, voiceId, text) {
  const res = await fetch(`${EL}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: TTS_MODEL }),
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status; try { const b = await res.json(); msg = (b.detail && (b.detail.message || b.detail)) || msg; } catch (_) {}
    throw new Error('ElevenLabs could not speak: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
  }
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}
async function elevenTranscribe(key, bytes, mime) {
  const form = new FormData();
  form.append('model_id', STT_MODEL);
  form.append('file', new Blob([bytes], { type: mime || 'audio/webm' }), 'speech.webm');
  const res = await fetch(`${EL}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status; try { const b = await res.json(); msg = (b.detail && (b.detail.message || b.detail)) || msg; } catch (_) {}
    throw new Error(res.status === 401 ? 'ElevenLabs rejected the key. Check it in Setup.' : 'Could not understand the recording: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
  }
  const body = await res.json();
  return String(body.text || '').trim();
}

module.exports = { macVoices, sayMac, stopSpeaking, elevenVoices, elevenSpeak, elevenTranscribe };

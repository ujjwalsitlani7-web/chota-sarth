# Chota Sarth for Mac

Your always-on personal assistant on the Mac. A small orb floats over every app.
Click it or press **⌥ Space**, then just ask:

- “Remind me to call Gurmeet tomorrow at 10” → a reminder in the **Reminders** app
- “Put a supplier meeting on Friday at 3” → an event in **Calendar**
- “What’s on my day?” → a short brief from your calendar, reminders and promises
- “WhatsApp Modi Mogable about the payment” → **WhatsApp** opens with the message written; you press send
- “Email Eastern engineers for a quote” → **Mail** opens with the email written; you press send
- “Find my latest GST invoice” → searches your Mac and opens the right file
- “Open Goury Parts”, “Play music”, “Next song”
- “What’s on my screen? Explain it” → it looks once and helps
- “Remember Gurmeet pays on the 10th” → kept in **Memory** and used later

### Talk to it like Siri

- Press **⌃ ⌥ Space** (Control + Option + Space) anywhere, **press and hold the orb**, or tap the **microphone** in the chat box.
- The orb glows red while it listens and stops by itself when you stop talking. It answers out loud.
- **Voices:** it speaks with your Mac’s voices out of the box (pick one in *Setup › Voice*, Indian English voices are listed first).
- **Understanding your voice** uses ElevenLabs speech-to-text: add your ElevenLabs API key in *Setup › Voice*.
- **A custom voice, like a friend’s:** in ElevenLabs go to *Voices › Add voice*, clone it from recordings of your friend, then paste its **Voice ID** in *Setup › Voice › A custom voice*. Only clone someone’s voice with their clear permission.

**It asks before it changes anything.** Reminders, events, opening messages, files and music all show an “I’d like to…” card with **Do it / Cancel**. It never sends a message or email itself.

### Grow (for founders)
The **Grow** tab checks whether AI assistants name your product, finds people on a thread who have your problem, and drafts posts and replies for you to approve:

- **Visibility**: asks an AI assistant the 8 questions your buyers ask and shows whether you are named, and who is named instead.
- **Screen**: press *Read my screen* on a Reddit, X or LinkedIn thread. Chota Sarth finds the people describing your problem and drafts a help-first reply to each. On a competitor's site or a search page it gives tips instead.
- **Posts**: for every question you are missing from, it writes LinkedIn, X and Reddit posts in your voice.
- **Approvals**: edit, approve and copy. Chota Sarth never posts, sends or buys anything for you.

## Run it on your Mac

1. Install **Node.js** (version 20 or newer) from https://nodejs.org.
2. Open **Terminal** and paste:
   ```
   cd ~ && curl -L https://github.com/ujjwalsitlani7-web/chota-sarth/archive/refs/heads/main.zip -o chota-sarth.zip && unzip -oq chota-sarth.zip && cd chota-sarth-main && npm install && npm start
   ```
3. The orb appears on the right of your screen and the Chota Sarth icon appears in the menu bar.
4. In **Setup**, add your name and paste your **Anthropic API key** (create one at https://console.anthropic.com). The key is encrypted with the Mac's secure storage and is only ever sent to Anthropic.

### Permissions the Mac will ask for

The first time Chota Sarth does each kind of thing, macOS asks once:
- **Microphone**: needed to talk to it.
- **Reminders / Calendar**: “wants to control Reminders/Calendar” → click **OK**.
- **Screen Recording**: needed for “what’s on my screen”.

While you run it from Terminal with `npm start`, these permissions are asked for **Terminal**.

### Screen Recording permission

The first time you press **Read my screen**, macOS asks for Screen Recording permission. Turn Chota Sarth (or Terminal, while you run it with `npm start`) on in **System Settings › Privacy & Security › Screen Recording**, then quit and reopen Chota Sarth. Chota Sarth only looks at your screen when you press the button.

## Make a real app you can double-click

```
npm run dist
```

This creates `dist/Chota Sarth-0.1.0.dmg` (it uses Electron's standard icon for now). Open it and drag Chota Sarth to Applications. Then turn on **Open Chota Sarth when my Mac starts** in Setup so it is always on screen.
The app is not signed with an Apple Developer certificate yet, so the first time, right-click Chota Sarth in Applications and choose **Open**.

## Try it without an API key

```
SARTH_FAKE_AI=1 npm start
```

Every feature works with sample answers, so you can see the whole flow before adding a key.

## How it is built

- `src/assistant.js`: the personal assistant: Claude with Mac tools (Reminders, Calendar, WhatsApp, Mail, Spotlight, apps, music, memory, screen), and the ask-before-acting rule.
- `src/voice.js`: listening and speaking: Mac voices, and ElevenLabs speech-to-text and voices (including cloned ones).
- `src/main.js`: the app core. Floating orb and panel windows, the ⌥ Space shortcut, the menu-bar icon, screen capture, saved data, and every call to Claude (`claude-sonnet-5-5` for reading the screen and writing, `claude-haiku-5-5` for the quick visibility answers).
- `src/preload.js`: the only bridge the windows can use. Pages never see the API key or the file system.
- `src/panel.html` / `panel.js`: the companion window.
- `src/orb.html` / `orb.js`: the floating orb (drag to move, click to open).
- Data is saved in `~/Library/Application Support/Chota Sarth/chota-sarth.json`.

## Next

- Check ChatGPT and Google answers too, not just Claude.
- Find Reddit and X posts automatically.
- A Monday scorecard notification.
- A wake word ("Hey Chota Sarth") so it listens without a key press.
- Sign and notarise the app for one-click installs.

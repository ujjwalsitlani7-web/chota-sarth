# Chota Sarth for Mac

An always-on Mac companion that helps founders get their product found.
A small orb floats over every app. Click it or press **⌥ Space** to open Chota Sarth.

- **Visibility**: asks an AI assistant the 8 questions your buyers ask and shows whether you are named, and who is named instead.
- **Screen**: press *Read my screen* on a Reddit, X or LinkedIn thread. Chota Sarth finds the people describing your problem and drafts a help-first reply to each. On a competitor's site or a search page it gives tips instead.
- **Posts**: for every question you are missing from, it writes LinkedIn, X and Reddit posts in your voice.
- **Approvals**: edit, approve and copy. Chota Sarth never posts, sends or buys anything for you.
- **Ask**: chat about getting seen; it remembers your product and can read answers out loud.

## Run it on your Mac

1. Install **Node.js** (version 20 or newer) from https://nodejs.org.
2. Open **Terminal** and paste:
   ```
   cd ~ && curl -L https://github.com/ujjwalsitlani7-web/chota-sarth/archive/refs/heads/main.zip -o chota-sarth.zip && unzip -oq chota-sarth.zip && cd chota-sarth-main && npm install && npm start
   ```
3. The orb appears on the right of your screen and the Chota Sarth icon appears in the menu bar.
4. In **Setup**, describe your product and paste your **Anthropic API key** (create one at https://console.anthropic.com). The key is encrypted with the Mac's secure storage and is only ever sent to Anthropic.

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

- `src/main.js`: the app core. Floating orb and panel windows, the ⌥ Space shortcut, the menu-bar icon, screen capture, saved data, and every call to Claude (`claude-sonnet-5-5` for reading the screen and writing, `claude-haiku-5-5` for the quick visibility answers).
- `src/preload.js`: the only bridge the windows can use. Pages never see the API key or the file system.
- `src/panel.html` / `panel.js`: the companion window.
- `src/orb.html` / `orb.js`: the floating orb (drag to move, click to open).
- Data is saved in `~/Library/Application Support/Chota Sarth/chota-sarth.json`.

## Next

- Check ChatGPT and Google answers too, not just Claude.
- Find Reddit and X posts automatically.
- A Monday scorecard notification.
- Voice input ("Hey Chota Sarth").
- Sign and notarise the app for one-click installs.

# Life Ledger (phone app)

A static PWA that logs what goes into and out of your head (screen time, what you saw, what you made, mood and energy) across 10 life areas, with a Socratic mentor running on Claude.

- **No server, no account.** Data lives in this app's browser storage on the device. Export/import JSON backups from the Me tab.
- **Claude with your own key.** Calls go straight from the device to `api.anthropic.com` (`anthropic-dangerous-direct-browser-access`). Quick text logs use Claude Haiku 5.5. Screenshots, day reads, chat and the weekly review use Claude Opus 5.5 (or Sonnet 5.5) with server-side refusal fallbacks.
- **Setup codes.** A `#setup=<code>` link or a pasted `LL1:<code>` loads a profile and chat. Keep personal setup codes out of git.

`local.js` provides the small `window.claude.use()` runtime (db, user, sample, downloads) that the page was first written against as a claude.ai artifact, so `index.html` runs the same code in both places.

Live: https://michaandguadi-sys.github.io/life-ledger/ (open in Safari, then Share → Add to Home Screen).

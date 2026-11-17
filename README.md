# Trackr

A scholarship application tracker. Share or paste a link, message or screenshot and Trackr reads it, files the university, deadline and requirements, then reminds you before it closes.

## Run it

```bash
npm install
cp .env.example .env      # then add GEMINI_API_KEY (see below)
npm run dev               # http://localhost:5173
npm test                  # 85 tests: reading, edge cases, load protection, every screen renders
npm run build             # type-checks, builds the PWA
```

Without a Gemini key everything still works: links and text are read by a rule-based fallback, and anything uncertain lands in the Review queue.

## The Gemini key

A Google AI Pro subscription does not include an API key. Create a free key at https://aistudio.google.com/apikey, put it in `.env` as `GEMINI_API_KEY`. Optionally use the $10/month Google Cloud credit that comes with AI Pro (Google Developer Program, My Benefits) to cover usage. The key lives only on the server (`server/parse.ts`); it is never sent to the browser.

## Deploy (Netlify)

Connect the repo, set `GEMINI_API_KEY` (and `ALLOWED_ORIGINS=https://your-site`) in Netlify environment variables. `netlify.toml` already routes `/api/parse` to the function and serves the app as a single-page PWA. Install on Android from Chrome's menu to get the share-sheet entry.

## Status of every roadmap feature

Tested = covered by the automated tests (85 of them, `npm test`). Live = also tried against the real service.

| Phase | Feature | Status |
|---|---|---|
| 1 | Onboarding with consent | Built, tested |
| 1 | Paste a link or text | Built, tested; live against Gemini for text |
| 1 | Android share target | Built; needs an HTTPS deploy and an installed app to try |
| 1 | Screenshot input, several per post | Built; not yet tried live |
| 1 | Reading pipeline and review gate | Built, tested, live for text |
| 1 | University list and spreadsheet views | Built, tested |
| 1 | Full status lifecycle | Built, tested |
| 1 | Deadline reminders | On-device notifications built and tested. Email reminders written, never run (needs Supabase and Resend) |
| 1 | Terms and privacy (GDPR, NDPA) | Drafts; need a lawyer and company details |
| 2 | Requirements checklist, eligibility check | Built, tested |
| 2 | Linked deadlines and time zones | Built, tested |
| 2 | Scam flags | Built, tested |
| 2 | Calendar | .ics file export built and tested. A live subscribe-able feed is not built (needs accounts) |
| 2 | Board view | Built, tested (drag on desktop, picker on touch) |
| 2 | Spreadsheet import | CSV and pasted cells built and tested. .xlsx files are not read directly |
| 2 | Weekly digest | "This week" screen built and tested. Email digest written, never run |
| 2 | Play Store app | Config and steps only (`android/`) |
| 3 | Document vault, essay library, referee tracker | Built, tested |
| 3 | Backward planner | Built, tested |
| 3 | Batch screenshot upload | Built |
| 3 | Weekly re-check of source pages | Built, tested. Runs when the app is opened, not in the background |
| 3 | Browser extension | Built (`extension/`); not yet loaded in Chrome |
| 3 | Mentor share link | Built, tested |
| 4 | Send to a friend | Built, tested |
| 4 | Trending opportunities | Built, tested with a stand-in store. Fills only once deployed with real users |
| 4 | Next-cycle alerts | Built, tested |
| 4 | Outcome stats / year in review | Built, tested |
| 4 | Counsellor plans | Free counsellor view built. School accounts and billing not built |
| 4 | Native iOS | Not built (roadmap: only if demand) |

Also written but never run against a real service: accounts and sync across devices (`src/lib/cloud.ts`).
See `docs/ARCHITECTURE.md` for how the server copes with load.

## Deploy to Vercel

Run `npm run deploy` in this folder. It installs packages, bundles the two server functions into `api/`,
signs you in to Vercel if needed, copies the Gemini settings from your local `.env` into the Vercel project
without printing them, and publishes to production. Run it again after any change.

Server code lives in `server/`; `api/parse.js` and `api/trending.js` are generated from it by `npm run build:api`.
The Netlify setup still works as before.

## Layout

```
src/lib     data model, store, parsing client, dates and time zones, eligibility, planner, ICS, CSV, vault
src/pages   screens        src/components   shared UI
server/parse.ts   the one server-side function (shared by Netlify and the dev server)
extension/  browser extension     android/  Play Store wrapper     supabase/  optional cloud schema
docs/       design notes, iOS shortcut
```

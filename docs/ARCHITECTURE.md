# Trackr architecture (built for many users)

## The shape

```
Phone / browser (does almost everything)            Server (one small job)
-----------------------------------------           --------------------------------------
Tracker data in IndexedDB, per device               /api/parse    read a link, text or screenshots
Views, reminders, plan, eligibility, vault          /api/trending most-added public links
Rule-based reader (works offline)                   send-reminders (daily, optional, needs Supabase)
Queue for links added offline or when busy
        |                                                     |
        +---- POST /api/parse ------------------------------->+--> page fetch --> Gemini
                                                              +--> shared cache (Netlify Blobs)
```

Each person's tracker lives on their own device, so there is no shared database to overload: ten users or ten million cost the server the same for viewing, editing, reminders and planning. The only shared, costly resource is reading new items with AI, so all the load protection is around that one endpoint.

## What protects `/api/parse`

| Risk | Protection | Where |
|---|---|---|
| One person or bot floods it | Platform rate limit, 30 requests a minute per IP, before code runs | `netlify/functions/parse.mts` (`rateLimit`) |
| Same, on another host or in dev | In-code limiter: 20 a minute for links and text, 8 for screenshots, with `Retry-After` | `server/infra.ts` `limiter` |
| A link goes viral | Shared cache keyed by the cleaned-up link: read once a day, served to everyone else from cache | `handleParse`, `blobStore` |
| 50 people add it in the same second | Single flight: one fetch and one AI call, everyone gets that result | `singleFlight` |
| Retry storms on a page that cannot be read | "Could not read" is cached for 10 minutes | `handleParse` |
| AI quota runs out (429) | Try the fallback model, then pause AI calls for 45 seconds and answer with the fetched text so the app's own reader fills the entry and marks it for review | `callGemini`, `breaker` |
| AI is slow or overloaded (503) | One quick retry, a per-model time share, then the fallback model | `callGemini` |
| Too many AI calls at once | At most 4 in flight per instance; the rest wait briefly, then degrade | `gate` |
| Host kills slow functions | Every request has a time budget (`PARSE_BUDGET_MS`, 9 seconds on Netlify). Each step gets a slice and work stops cleanly when it runs out | `parseOnce` |
| Huge uploads | 8 MB body cap measured on the real body, 6 screenshots, text trimmed to 14,000 characters; the app shrinks screenshots first | `handleParse`, `image.ts` |
| Server used to reach private networks | Private and loopback addresses refused, including names that resolve to them, on every redirect hop | `isPrivateHost`, `resolvesPrivate` |
| Wrong data from the AI | Comments cut off, every name checked against the text, a second rule-based reader fills gaps and flags disagreements | `stripThread`, `ground`, `backfill` |

Private content is never cached on the server: only plain public links are. Pasted text and screenshots are sent, read and forgotten.

## On the device

- The tracker is one IndexedDB record; screenshot thumbnails are stored separately so saving stays fast with hundreds of entries.
- Two open tabs stay in step through a BroadcastChannel instead of overwriting each other.
- Everything entering the store (AI output, backups, shared links, CSV) passes through `sanitize.ts`.
- Links added offline, or while the server is busy, wait in a queue and are read later.
- If the device runs out of storage the user is told, rather than losing changes silently.

## Capacity, honestly

- The Gemini free tier is small. Published figures vary and Google no longer lists them; reports range from about 20 to 1,000 requests a day depending on model. It is fine for you and a few testers. For real users, attach billing to the Trackr project (the AI Pro Google Cloud credit can cover early usage).
- Default model is `gemini-flash-lite-latest`: in testing it answered in about 2 seconds. `gemini-flash-latest` took over 12 seconds because it always "thinks", so it is the fallback only.
- Netlify's default limit for a function is about 10 seconds, which is why the budget is 9.

## Not yet proven

- The Netlify Blobs cache, platform rate limit and scheduled function have not run on a deployed site. The same logic is tested with an in-memory store.
- Accounts, sync and email reminders (`src/lib/cloud.ts`, `supabase/schema.sql`, `send-reminders.mts`) are written but have never run against a real Supabase or Resend account. Sync is "latest save wins", not a merge.
- No load test against live Gemini; the concurrency tests use a stand-in.

# ShiftCrew

Paid volunteer and shift management for fests, NGOs and hackathons. Organizers plan events, roles and shifts. Volunteers join shifts without double-booking, check in with a QR pass, and get a stipend for the hours they actually worked. Everything is tracked in an audit log and an append-only wallet ledger.

**Stack:** React 18 (Vite, React Router, TanStack Query) | Node, Express, Mongoose, Zod | MongoDB | PDFKit | QR passes signed with JWT

## Run it locally
```bash
docker compose up -d                  # MongoDB on :27017

cd server
cp .env.example .env                  # set JWT_ACCESS_SECRET to a long random string
npm install
npm run seed                          # demo data (password: Password123)
npm run dev                           # API on http://localhost:5000

cd ../client && npm install && npm run dev     # app on http://localhost:5173
```

### Demo accounts (all use `Password123`)
| Account | What to try |
|---|---|
| `organizer@shiftcrew.test` | Owns the org, events and a pre-funded sandbox wallet. Approve hours, release payments, run reports |
| `volunteer@shiftcrew.test` / `sara@shiftcrew.test` | Join shifts, see the QR pass, add a UPI id, view earnings |
| `lead@shiftcrew.test` | Team lead for Stage Crew and Donor Flow. Gets the Check-in desk |
| `admin@shiftcrew.test` | Platform admin: users, organizations, audit log |

### A 5 minute walkthrough
1. As the volunteer, open **Events**, join a shift. Join a second, overlapping shift and see it blocked.
2. As the organizer, **Manage event > Shifts**, lower a shift's capacity, watch the waitlist work.
3. To try check-in without waiting for a real event, create a shift starting in 15 minutes (Shifts tab), join it as the volunteer, open **My shifts > Show QR pass**, and scan it as the lead on the **Check-in** page (or paste the token).
4. Organizer: **Hours** tab, approve (or adjust with a reason). **Funds and payouts** tab, add sandbox funds, release payments.
5. Volunteer: **Earnings**, add a UPI id first (an id containing `fail` simulates a bank rejection and shows the refund and retry path).

## Features
**Volunteers:** browse events, join shifts (clash detection, waitlist with automatic promotion, approval mode), shift swap board (zero-penalty shift handover with clash checking and direct swap offers), rolling QR pass, My shifts, disputes, earnings and PDF receipts, UPI payout method (encrypted at rest), certificates, badges, notifications (in-app and email).
**Team leads:** check-in desk, camera QR scanner (or paste), roster, manual override with a mandatory reason.
**Organizers:** events and roles (with team leads by email), shifts with unpaid / hourly / flat pay, rosters and approvals, shift swap approvals queue, hours approval with adjustment reasons, wallet funding, one-click payouts, disputes, announcements, certificates, reports with CSV export, audit log.
**Mission Control (Live Event Day Operations):** real-time control room (`/manage/events/:id?tab=live`) powered by Socket.io with JWT handshake auth and `event:<id>` room isolation (restricted strictly to organization members and event role leads). Provides live KPI strips, role columns, memoized shift health tiles (green full, amber late, red gap), real-time activity ticker, accessible incident alerts (`aria-live="polite"`), synthesized Web Audio alert chimes, late volunteer nudging, waitlist backup dispatch (`ping-backups`), and 10s automatic HTTP polling fallback.
**AI Event Operations Planner ("Plan My Event"):** plain-language event staffing drafting. Organizers describe an event in plain text, and the AI drafts roles and shifts with capacity, hours, stipends, and operational assumptions. The server validates and strictly clamps all numbers, computes budget estimates in integer paise against the organization's wallet balance, and returns an editable draft. Nothing is ever saved to the database or published automatically without explicit human review and application.
**Admin:** platform stats, user suspension, organization verification, audit log.

## Setting up a free LLM

ShiftCrew features a shared LLM service in `server/src/services/llm/` built specifically for **FREE tier LLMs**. Free-tier limits are small and change frequently (roughly 15–30 requests per minute plus daily token caps), so the service includes a project-wide rate limiter queue (`LLM_GLOBAL_RPM`), in-memory SHA-256 caching, automatic fallback to a backup provider on HTTP 429 or 5xx, exponential backoff, and a daily token budget tracker.

> [!WARNING]
> **Privacy & Training on Free Tiers:**
> Free-tier LLMs (such as Google Gemini's free tier) may log prompts and use them for human review and model training.
> **Never send real personal data** (names, emails, phone numbers, UPI IDs, tokens, or database IDs) to any LLM. ShiftCrew's backend strips all personal identifiers and encloses user descriptions inside `<<<USER_DATA>>>` blocks. Keep `LLM_ALLOW_USER_DATA=false` (the default) to enforce this privacy boundary.

### Option 1: Google Gemini Flash via Google AI Studio (Recommended Primary)
1. Go to [Google AI Studio](https://aistudio.google.com/) and sign in with your Google account.
2. Click **Get API key** and create a new free API key.
3. Configure `server/.env`:
   ```bash
   LLM_ENABLED=true
   LLM_PROVIDER=gemini
   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta
   LLM_API_KEY=your_gemini_api_key_here
   LLM_MODEL=gemini-1.5-flash
   LLM_GLOBAL_RPM=15
   LLM_DAILY_TOKEN_BUDGET=100000
   LLM_ALLOW_USER_DATA=false
   ```
*(Note: Never hardcode a model name in code; free-tier model names and quotas change often. You can update `LLM_MODEL` to `gemini-2.0-flash` or the current free Gemini model).*

### Option 2: Groq Free Tier (OpenAI-Compatible Backup or Primary)
1. Sign up for a free account at [Groq Cloud Console](https://console.groq.com/).
2. Under **API Keys**, create a free API key.
3. Configure `server/.env`:
   ```bash
   LLM_ENABLED=true
   LLM_PROVIDER=openai-compatible
   LLM_BASE_URL=https://api.groq.com/openai/v1
   LLM_API_KEY=your_groq_api_key_here
   LLM_MODEL=llama-3.3-70b-versatile
   LLM_GLOBAL_RPM=10
   LLM_DAILY_TOKEN_BUDGET=100000
   ```
*(Groq's OpenAI-compatible endpoint also works seamlessly as a fallback provider: set `LLM_FALLBACK_PROVIDER=openai-compatible`, `LLM_FALLBACK_BASE_URL=https://api.groq.com/openai/v1`, and `LLM_FALLBACK_API_KEY=...`).*

### Option 3: Ollama Running Locally (Offline Demos & Development)
1. Install [Ollama](https://ollama.com/) on your machine.
2. Pull a structured JSON-capable model:
   ```bash
   ollama run llama3.1
   ```
3. Configure `server/.env`:
   ```bash
   LLM_ENABLED=true
   LLM_PROVIDER=openai-compatible
   LLM_BASE_URL=http://localhost:11434/v1
   LLM_API_KEY=none
   LLM_MODEL=llama3.1
   LLM_GLOBAL_RPM=20
   LLM_DAILY_TOKEN_BUDGET=200000
   ```

### Volunteer Assistant & Tool Calling Model Requirements
The volunteer chat assistant uses multi-step server tool calling (`getMyUpcomingShifts`, `getMyShiftDetails`, `getMyAttendanceStatus`, `getMyEarningsSummary`, `getPolicyInfo`).
- **Recommended Models:**
  - **Google Gemini Flash** (`LLM_MODEL=gemini-1.5-flash` or `gemini-2.0-flash` with `LLM_PROVIDER=gemini`). Fast, generous free RPM, and highly reliable native function calling.
  - **Groq 70B/120B-class** (`LLM_MODEL=llama-3.3-70b-versatile` with `LLM_PROVIDER=openai-compatible`). Excellent tool-calling compliance and ultra-fast inference.
  - **Avoid tiny 8B models** for the assistant: small 8B parameter models frequently hallucinate function arguments or struggle with structured multi-turn tool loops.
- **Privacy & User Data Flag (`LLM_ALLOW_USER_DATA`):**
  - Because the assistant reads user shifts and earnings to answer questions, it is strictly disabled unless `LLM_ALLOW_USER_DATA=true` in `server/.env`.
  - For sensitive production environments, run a local [Ollama](https://ollama.com/) instance (e.g., `ollama run qwen2.5:32b` or `llama3.3:70b`) or configure an enterprise API provider with zero data retention terms.
- **Consumption Limits:**
  - Enforces 20 messages per user per day.
  - Caches identical question-and-data pairs for 2 minutes.
  - Caps server tool executions at 4 per message.
  - When rate limited or unavailable, gracefully falls back to direct links (`/my-shifts`, `/earnings`).

### Deterministic Mock Provider (Automated Tests & CI)
Automated vitest test suites always use the deterministic `mock` provider and never call an external API:
```bash
LLM_PROVIDER=mock
```

## Design decisions worth reading
- **No overbooking.** A shift's open spots are one counter changed only by an atomic conditional update (`findOneAndUpdate({ spotsLeft: { $gt: 0 } }, { $inc: { spotsLeft: -1 } })`). A signup is claimed first (unique `shiftId + userId`), then a spot is taken, so a double click cannot take two. Clashes are re-checked after claiming. See `server/src/services/shifts.service.js`.
- **Waitlist is self-healing.** `fillFromWaitlist` runs after every freed spot or capacity increase and is safe to call repeatedly.
- **Money is a ledger.** Every wallet change is an append-only `LedgerEntry` with a unique idempotency key, so a replayed webhook or double click cannot apply twice. Debits are conditional (`available >= amount`), so the wallet cannot go negative. `GET /wallet/orgs/:id/reconcile` proves the ledger and the balance agree. Amounts are integer paise.
- **One place payments become money.** `capturePayment` is used by the Razorpay webhook, the checkout callback and the sandbox checkout, and is idempotent.
- **Payouts fail safely.** Payables are claimed one by one (`approved -> processing`) before money moves. A failed payout returns the money and reopens the payable for retry.
- **QR passes** are JWTs valid for 60 seconds and single use (unique `jti`), bound to a volunteer and a shift. Only organizers and that role's team lead can scan.
- **Everything sensitive is audited:** manual check-ins, hour adjustments, approvals, payouts, disputes, role changes, and AI usage (logging input hashes, token counts, and latency, never raw prompt content).
- **No transactions needed.** Correctness relies on single-document atomic operations and unique indexes, so it runs on a plain standalone MongoDB (no replica set).
- **Scheduler is in-process** (`services/scheduler.js`): reminders, event status changes, auto-close of forgotten check-outs, no-show marking, payout worker. Each task claims its work atomically, so several instances are safe. To scale, move the same functions into BullMQ workers.
- **Shift Swap Board zero-penalty handover:** Confirmed volunteers can offer shifts at least 2 hours prior to start without late-cancel penalties. Swaps are listed on the event Swap Board for eligible volunteers (no schedule clash, not already on shift). Upon claim and organizer approval (or event `autoApproveSwaps`), the spot is transferred atomically: the original signup is cancelled without freeing the spot or promoting waitlists (`spotsLeft` and capacity remain unchanged), `estPay` is transferred to the taker's new confirmed signup, and the old QR pass is deactivated immediately. If unapproved or unclaimed 1 hour before start, the scheduler marks the swap expired and the original volunteer keeps their shift.
- **Mission Control real-time architecture:** Live state is computed purely via `computeMissionSnapshot(event, shifts, signups, attendance, now)` in `server/src/services/mission.service.js`. Sockets authenticate via JWT at handshake, and rooms (`event:<id>`) enforce strict authorization (event organization members and role team leads only; volunteers rejected). Updates are throttled to a maximum of 1 per second per event. Rate-limited actions allow organizers to ping waitlisted backups or nudge late volunteers, audited automatically. If websockets drop, the client falls back to 10-second polling against `GET /events/:id/mission`.
- **AI Safety & LLM Provider Policy:**
  1. *Advisory only:* The LLM can never write directly to the database, publish events, modify shifts, or move money. Drafts are held in client state and applied only when the human organizer clicks "Apply", which routes through the standard validated `POST /events/:id/roles` and `POST /events/:id/shifts` endpoints.
  2. *Untrusted output clamping:* All model output is Zod-validated and clamped on the server (max 12 roles, max 40 shifts, capacity 1–200, duration 30m–16h, hourly <= ₹1,000, flat <= ₹5,000, no past dates, non-matching roles dropped with warnings).
  3. *Prompt injection defense:* User descriptions are wrapped with `wrapUntrusted` inside delimited blocks (`<<<USER_DATA ... >>>`), with internal delimiters escaped. The system prompt instructs the model to ignore any instructions inside the data block.
  4. *Privacy protection:* Only event descriptions and operational constraints are sent to LLMs; names, emails, phone numbers, UPI IDs, and tokens are never transmitted. Sensitive features are guarded by `LLM_ALLOW_USER_DATA=false`.
  5. *Free-tier resilience:* Global request queue with `LLM_GLOBAL_RPM` prevents 429 quota exhaustion. An in-memory cache returns cached drafts for identical inputs, automatic fallback switches to a secondary provider on 429/5xx, and backoff with hard timeouts prevents hanging requests.


## Testing
```bash
cd server
npm test                     # fast unit tests, no database needed
npm run test:integration     # end-to-end API flow, needs MongoDB (TEST_MONGO_URI)
npm run test:concurrency     # parallel-request tests, needs REAL MongoDB
```
CI runs all three against a real `mongo:7` service container.

**Honest note about how this was verified.** During development the integration flow (auth, shifts, waitlist, QR check-in, approvals, wallet, payouts, failures, certificates, disputes, reports) was run against FerretDB, a MongoDB-compatible emulator, and passed. That emulator does not guarantee atomic conditional updates under concurrent load, so the parallel tests in `concurrency.test.js` were **not** verified there and are skipped unless `REAL_MONGO=1`. Run them against real MongoDB (`docker compose up -d && npm run test:concurrency`) before relying on the no-overbooking and no-double-payment guarantees. Also unverified: real Razorpay checkout and webhook (written to Razorpay's documented API), SMTP email delivery, and the camera scanner on a real device.

## Payments
- `PAYMENT_PROVIDER=mock` (default): a sandbox checkout that exercises exactly the same capture code as a real webhook. No keys needed.
- `PAYMENT_PROVIDER=razorpay`: set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and point a Razorpay webhook (`payment.captured`, `payment.failed`) at `POST /api/webhooks/razorpay`. Use test mode.
- Payouts to volunteers use a **sandbox provider** (`payoutProvider` in `payouts.service.js`). To go live, implement `send()` against RazorpayX or another payout API. That needs a business account and KYC.
- Payments are described as **stipends**. This is a portfolio project, not a licensed payment institution, and tax and labor rules for paying volunteers vary by country.

## Deploying
- **API (Render/Railway):** build `npm install`, start `npm start`, add a MongoDB Atlas URI. Set `CLIENT_URL` to the frontend origin. If the frontend is on a different site, set `COOKIE_SAMESITE=none` (HTTPS only).
- **Client (Vercel/Netlify):** set `VITE_API_URL` to the API origin. `client/vercel.json` handles SPA routing.
- Set strong, unique `JWT_ACCESS_SECRET`, `QR_SECRET` and `ENCRYPTION_KEY` in production.

## Not built yet (known gaps)
Email verification and password reset, inviting teammates into an organization (members can be added only in the database), volunteer and organizer reviews, geofenced check-in, offline scan queue, Google sign-in, public volunteer profiles, minimum-rest-gap rule between shifts, Redis/BullMQ queues.

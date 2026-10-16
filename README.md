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
**Volunteers:** browse events, join shifts (clash detection, waitlist with automatic promotion, approval mode), rolling QR pass, My shifts, disputes, earnings and PDF receipts, UPI payout method (encrypted at rest), certificates, badges, notifications (in-app and email).
**Team leads:** check-in desk, camera QR scanner (or paste), roster, manual override with a mandatory reason.
**Organizers:** events and roles (with team leads by email), shifts with unpaid / hourly / flat pay, rosters and approvals, hours approval with adjustment reasons, wallet funding, one-click payouts, disputes, announcements, certificates, reports with CSV export, audit log.
**Admin:** platform stats, user suspension, organization verification, audit log.

## Design decisions worth reading
- **No overbooking.** A shift's open spots are one counter changed only by an atomic conditional update (`findOneAndUpdate({ spotsLeft: { $gt: 0 } }, { $inc: { spotsLeft: -1 } })`). A signup is claimed first (unique `shiftId + userId`), then a spot is taken, so a double click cannot take two. Clashes are re-checked after claiming. See `server/src/services/shifts.service.js`.
- **Waitlist is self-healing.** `fillFromWaitlist` runs after every freed spot or capacity increase and is safe to call repeatedly.
- **Money is a ledger.** Every wallet change is an append-only `LedgerEntry` with a unique idempotency key, so a replayed webhook or double click cannot apply twice. Debits are conditional (`available >= amount`), so the wallet cannot go negative. `GET /wallet/orgs/:id/reconcile` proves the ledger and the balance agree. Amounts are integer paise.
- **One place payments become money.** `capturePayment` is used by the Razorpay webhook, the checkout callback and the sandbox checkout, and is idempotent.
- **Payouts fail safely.** Payables are claimed one by one (`approved -> processing`) before money moves. A failed payout returns the money and reopens the payable for retry.
- **QR passes** are JWTs valid for 60 seconds and single use (unique `jti`), bound to a volunteer and a shift. Only organizers and that role's team lead can scan.
- **Everything sensitive is audited:** manual check-ins, hour adjustments, approvals, payouts, disputes, role changes.
- **No transactions needed.** Correctness relies on single-document atomic operations and unique indexes, so it runs on a plain standalone MongoDB (no replica set).
- **Scheduler is in-process** (`services/scheduler.js`): reminders, event status changes, auto-close of forgotten check-outs, no-show marking, payout worker. Each task claims its work atomically, so several instances are safe. To scale, move the same functions into BullMQ workers.

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

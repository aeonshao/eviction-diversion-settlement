# Eviction Diversion & Settlement Opportunity Detector — MVP

A court-facing tool that flags eviction cases likely to settle through mediation, payment plans,
rental assistance, or a voluntary move-out agreement, **before** a judge spends time on them.

> "Which cases should be routed toward resolution before a judge spends time hearing them?"

It does not replace judicial decision-making. It helps clerks and mediation staff decide where to
spend their time.

## Quick start

Requires Node.js ≥ 18. Dependencies: `better-sqlite3` (prebuilt binaries, no compiler needed) and `qrcode`.

```bash
npm install
npm run seed     # loads 12 fictional demo cases (wipes data/court.db)
npm start        # http://localhost:3000
npm test         # 13 tests: scoring, referrals, validation, end-to-end API
```

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `BASE_URL` | `http://localhost:$PORT` | Used in intake links, SMS/email text, and QR codes |
| `CLERK_PASSWORD` | *(unset)* | When set, clerk pages and APIs need HTTP Basic auth (any username). Party intake links stay public. |
| `DB_PATH` | `data/court.db` | SQLite file |

## What's in the MVP

| Piece | Where |
|---|---|
| **Case queue (clerk dashboard)**: cases ranked by settlement potential, recommended action, staff alerts, filters, sorting, new-case entry | `/` |
| **Case detail**: score breakdown listing each rule that fired, recommended actions, referrals, both intakes, workflow status, notes, reminders, activity log | `/case.html?id=…` |
| **Tenant / landlord intake**: mobile-first, about 12 questions, under 5 minutes, unique unguessable link per party, shows the party matching resources after submitting | `/intake/<token>` |
| **Paper notice with QR code**: printable notice for mailing | `/notice/<caseId>/<tenant\|landlord>` |
| **Notification outbox**: SMS/email/paper invites and reminders (simulated) | `/outbox.html` |
| **Program metrics**: % suitable for diversion, intake/tenant response rates, mediation participation, settlement success, hearings avoided | `/metrics.html` |
| **Scoring rules page**: every rule, its weight, and the referral directory, shown in plain language | `/rules.html` |

### Workflow

1. A clerk enters a case (**+ New case**). Each party gets an intake token. Invitations go to the
   outbox by SMS and/or email, plus a paper notice with a QR code.
2. The tenant and landlord each fill out their questionnaire. Either one can reopen the link to update answers.
3. The case is scored as soon as any answers arrive. The score is *provisional* until both parties respond.
   The tier (High / Medium / Low) is assigned only after both intakes are in.
4. Staff work the queue: refer to mediation, connect to assistance, send reminders, and record the outcome
   (settled, move-out agreement, not settled, set for hearing, dismissed). Outcomes feed the metrics.

## Scoring engine (`src/scoring.js`)

A transparent, additive rules engine. There is no machine learning. Each rule has an id, a plain-English label,
a point value, and which intakes it needs. The score is the sum of the rules that fired, clamped to 0–100.

**Tiers:** High ≥ 60 · Medium 30–59 · Low < 30

| Rule | Pts |
|---|---|
| Tenant wants to stay + can pay something + landlord accepts payment plan | +40 |
| Both willing to mediate | +30 |
| Both open to mediation (one unsure) | +10 |
| Landlord would dismiss if paid + tenant can cover ≥50% or has a funding source | +20 |
| Landlord accepts partial + tenant can pay something | +10 |
| Tenant would move with time + landlord would extend move-out | +35 |
| Tenant applied for rental assistance | +10 |
| Tenant can pay ≥50% within 30 days | +10 |
| Family/friends/program could help | +5 |
| Tenant disputes the claim | −25 |
| Tenant has no payment ability and no help | −15 |
| Landlord declined every option | −40 |
| Either party declined mediation | −10 |
| Landlord only wants possession, tenant wants to stay, no extension | −15 |

The score sets the **tier**. The rules that fired set the **pathway**:
payment-plan rules lead to *Mediation / payment plan*, the move-out rule leads to *Move-out discussion*,
and a Low tier leads to *Standard hearing*. If intake is incomplete, the recommendation is *Tenant outreach*
or *Landlord follow-up*, because tenant non-response predicts default judgments.

The three examples from the project brief are seeded as **EV-2026-101 (High)**, **EV-2026-102 (Medium)**
and **EV-2026-103 (Low)**, and they are tested in `test/scoring.test.js`.

## Referrals engine (`src/referrals.js`, `config/referral-programs.json`)

Programs are listed in JSON with conditions that must all be true (`tenant.rent_owed lte 2000`, and so on).
Court staff can edit the file without changing any code. **The programs included are placeholders.
Replace them with your jurisdiction's real programs.** Staff alerts are raised for interpreter needs
(either party) and disability accommodation requests.

## Project layout

```
src/
  server.js      HTTP server and routes (node:http, no framework)
  service.js     case creation, summaries, detail, metrics
  scoring.js     rules engine
  referrals.js   referral matching and staff alerts
  questions.js   questionnaire definitions and server-side validation (single source of truth)
  notify.js      invitation/reminder messages (simulated outbox)
  db.js          SQLite schema and data access
  seed.js        demo data
public/          dashboard, case detail, intake, metrics, outbox, and rules pages (plain HTML/JS)
config/          referral program directory
test/            node:test suites
```

## Not production-ready yet: next steps

- **Auth & roles:** replace the shared Basic-auth password with real staff accounts and SSO, and add an audit log per user.
- **Real messaging:** connect `notify.js` to an SMS/email provider such as Twilio or SendGrid, and set up a print/mail vendor for notices.
- **Case management system integration:** import new filings automatically instead of entering them by hand.
- **Language access:** translate the intake (Spanish first) and choose the language from the notice.
- **Privacy:** encrypt data at rest, set a retention policy, and get legal review of the intake disclaimers.
- **Calibration:** once real outcomes exist, compare tiers against actual settlement rates and adjust the weights. Keep it rules-based.
- **Fairness review:** check that recommendations do not differ systematically by neighborhood or language.

All demo data is fictional.

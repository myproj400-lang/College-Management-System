# Phase 4 handover: online applications and admissions

Lead: Alhaji Mohamed Wurie Bah. Reviewer still required: Brima Conteh, for security and the applicant-to-student handoff.

Branch: `alhaji/admissions`, extending `main`. Phase 5 has not started.

## What an applicant can do

An applicant registers, verifies a contact token, reads open intakes, saves a draft, and resumes it. The server checks fields, declarations, documents, the intake window, and the fee rule. A failed check leaves the valid draft in place. Submission returns one reference. The same idempotency key returns that same receipt. A correction keeps the earlier snapshot and hides internal notes. The applicant accepts or declines an offer. The applicant cannot decide their own case or confirm their own fee.

## What staff can do

An admissions officer publishes an intake, including the rules version, fee, document limits, and whether review may start before payment. Two officers cannot both win the same claim. A final offer, waitlist, or rejection records the officer, reason, and time. If the intake requires a second approval, the recommending officer cannot be the final approver. The bursar records a payment event. A mismatched amount is refused. Replaying the same provider event does not create a second confirmation. The registrar converts an accepted offer once. A second request returns the same student. If that person already has a student record, conversion stops for reconciliation and the offer stays accepted.

## Evidence

`server/tests/admissions.test.ts` passed against a throwaway PostgreSQL. It covers the invalid draft, rejected file, forged payment, payment replay, double submit, hidden file, correction history, concurrent conversion, duplicate identity, a closed deadline, and second approval.

This is developer verification. It is not college user-acceptance testing. No browser was exercised: this repository has no web client.

## Not finished in this phase

- Offer and decision files are not generated from a template (SRS-015). The decision is stored and returned by the API.
- There is no email provider, so a real applicant cannot receive the verification token. `CONTACT_CHANNEL` must stay `undelivered` outside tests.
- File checking is the declared type plus the file signature. It is not a malware scanner.
- Admissions officers are not limited to one programme. Scoped grants are still Brima’s identity work.
- Existing tuition invoices on `main` are unchanged. They are not the application-fee workflow.
- Grading, attendance, learning, and notifications were not changed.

## How to run

From `server/`, install dependencies, copy `.env.example` to `.env`, set `JWT_SECRET`, then:

```bash
npm run db:local
npm run db:deploy
npm run seed
npm run dev
```

`npm test` runs the API tests. `npm run db:verify-migrations` checks that `prisma/migrations` matches `prisma/schema.prisma`.

Create an admissions officer with `POST /api/users` and role `ADMISSIONS_OFFICER`. Create a programme, then `POST /api/admissions/intakes`. Applicants use `POST /api/auth/register-applicant`. Public intake rules are `GET /api/admissions/public/intakes`.

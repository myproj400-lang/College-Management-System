# ICMS backend

Node.js + TypeScript + Express + PostgreSQL (via Prisma) backend for the
Integrated College Management System. This covers **Phase B0: Foundation &
Identity** only - accounts, sessions, role grants, MFA for privileged
roles, and audit evidence. No admissions, academic, learning, results, or
attendance functionality exists yet; those are later authorised phases.

See [`../README.md`](../README.md) for the project-level index of the CRS,
SRS, and Master Development Prompt that govern this work, and
[`../docs/`](../docs) for those documents themselves.

## Stack

- Node.js 20+, TypeScript, Express
- PostgreSQL via Prisma (schema + migrations in `prisma/`)
- Argon2id password hashing (`@node-rs/argon2`), TOTP MFA (`otpauth`)
- Server-side revocable sessions (signed httpOnly cookie referencing a
  `Session` row) - not stateless JWT, so suspension/revocation is
  immediate (SRS-006, SEC-02)
- Vitest + Supertest for tests

## Prerequisites

- Node.js 20+
- A PostgreSQL database. Two options:
  1. **A real PostgreSQL server** (recommended when available) - set
     `DATABASE_URL` in `.env` accordingly and skip the PGlite sections
     below entirely.
  2. **PGlite fallback** (what this phase was developed and verified
     against, since neither Docker nor an installable PostgreSQL were
     available in the build environment) - a real Postgres engine that
     runs embedded, exposed over the real wire protocol on a local port.
     See "Known PGlite limitations" below before relying on it for more
     than local development - it has real constraints a production
     database does not.

## Setup (PostgreSQL, staging/production style)

```bash
npm install
cp .env.example .env
# Edit .env: set DATABASE_URL to your PostgreSQL server, and generate a
# real SESSION_COOKIE_SECRET (see the comment in .env.example).
npx prisma migrate deploy
npm run seed          # creates one fictional SYSTEM_ADMINISTRATOR account - see prisma/seed.ts
npm run build
npm start              # http://localhost:4000
```

## Setup (PGlite fallback, local dev with no PostgreSQL install)

Run each of these to completion before starting the next - see "Known
PGlite limitations" for why order and clean shutdowns matter here.

```bash
npm install
cp .env.example .env    # DATABASE_URL already targets the PGlite defaults below
```

```bash
# Terminal 1 - leave running
npm run db:dev
```

```bash
# Terminal 2, only once against a fresh .pglite-data/
npm run prisma:generate
npx tsx scripts/apply-migrations-pglite.ts   # NOT `prisma migrate deploy` - see below
npm run seed
npm run dev              # http://localhost:4000 - see the watch-mode warning below
```

`.env`'s `DATABASE_URL` must include `sslmode=disable&pgbouncer=true&connection_limit=1`
against PGlite. All three are load-bearing, not tuning knobs - see below.

## Running tests

```bash
# Terminal 1 - leave running
npm run db:test

# Terminal 2, once against a fresh .pglite-test-data/
npm run test:migrate
npm test
```

## Known PGlite limitations

These were found by direct protocol investigation while building this
phase (raw TCP probes, not guesses) and only affect the embedded PGlite
fallback - a real PostgreSQL server has none of these constraints.

1. **No SSL negotiation.** PGlite's wire-protocol server
   (`@electric-sql/pglite-socket`) resets the connection if it receives an
   `SSLRequest` packet, which most Postgres clients (including Prisma)
   send by default. Fix: `sslmode=disable` in `DATABASE_URL`.
2. **Exactly one connection at a time.** A second concurrent connection is
   rejected ("Too many connections"), and following that, the server can
   enter a broken state that persists until it is restarted. Fix: never
   run two processes against the same PGlite instance at once (e.g. don't
   run the seed script while the dev server is also connected - stop one
   before starting the other), and set `connection_limit=1`.
3. **One underlying session multiplexed across separate TCP connections,
   not one session per connection.** Prisma's normal named prepared
   statements (`s0`, `s1`, ...) collide across separate process runs
   ("prepared statement ... already exists") because the *names* persist
   in a session that outlives any one socket. Fix: `pgbouncer=true`, which
   tells Prisma to use unnamed statements - the same accommodation real
   deployments make for transaction-mode PgBouncer.
4. **Abrupt process kills break the single connection slot.** A clean
   `client.end()` / graceful process exit releases the slot; a forced
   kill (`taskkill /F`, `Stop-Process -Force`, a crashed process) can
   leave it stuck until the PGlite server itself is restarted. If the app
   or a script stops responding to `/health/ready`, restart `db:dev` (or
   `db:test`) and re-apply migrations/seed.
5. **`npm run dev`'s hot-reload (`tsx watch`) is unsafe against PGlite.**
   Every file save restarts the module, which creates a *new* PrismaClient
   and therefore a new connection attempt, colliding with limitation #2/#4
   before the old one has released. Against PGlite, prefer a manual
   restart cycle (`Ctrl+C`, then `npm run dev` again) over relying on
   watch-triggered reloads; against a real PostgreSQL server this is a
   non-issue and hot-reload works normally.
6. **A rule-rewritten no-op UPDATE/DELETE (`DO INSTEAD NOTHING`) confuses
   Prisma's query engine specifically over PGlite** ("unexpected message
   from server"), which then kills the connection. This is what the
   `audit_event` append-only rules (migration
   `20260928000001_audit_append_only`) rely on. It was verified directly
   with a plain `pg` client (not through Prisma) both manually and in
   `test/auth.test.ts`, and works correctly - the rows are genuinely
   protected. Avoid issuing raw UPDATE/DELETE against `audit_event`
   through Prisma in this environment; there is no legitimate reason to
   do so from application code regardless.
7. **`prisma migrate dev` / `db push` / `db execute` do not reliably reach
   PGlite** even though `prisma db pull` and application queries do -
   these CLI subcommands appear to use a connection path with a stricter
   preflight check than the one satisfied by limitation #1's fix in every
   case tested. Use `scripts/apply-migrations-pglite.ts` (a single Node
   process, one connection, applies every `prisma/migrations/*/migration.sql`
   file in order) instead, for PGlite only. Real migrations still live as
   normal Prisma migration files in `prisma/migrations/` and
   `prisma migrate deploy` is what a real PostgreSQL deployment uses.

None of this affects a real PostgreSQL server - drop `sslmode=disable`,
`pgbouncer=true`, and `connection_limit=1` from `DATABASE_URL`, and use
`prisma migrate deploy` normally.

## Environment variables

See `.env.example` for the full list with explanations. Nothing in it is a
real secret - `SESSION_COOKIE_SECRET` must be regenerated per environment
(the file explains how), and `SEED_ADMIN_PASSWORD` is a local/test-only
bootstrap value the seed script refuses to run with in production.

## What's implemented (Phase B0)

- Account lifecycle: register (with email verification), activate, login,
  logout, password recovery - SRS-001, SRS-003, SRS-004
- Server-side sessions with idle/absolute expiry and immediate revocation
  on logout, suspension, deactivation, or password reset - SRS-006, SEC-02
- Role grants with scope, grantor, effective dates, and revocation that
  applies to the *next* request without requiring re-login - SRS-002,
  IAM-01
- MFA (TOTP) required before a session is treated as fully authenticated,
  for roles configured in `MFA_REQUIRED_ROLES` - SEC-01. Granting such a
  role to an unenrolled account is rejected outright.
- Argon2id password hashing, single-use/expiring/non-recoverable recovery
  tokens, generic (non-disclosing) authentication error responses,
  per-account lockout after repeated failed logins, IP-scoped rate
  limiting on auth endpoints - SRS-005
- Append-only audit log (database-level, not just application-level) for
  every sensitive action - SEC-04, SRS-063
- Consistent API error shape, request correlation IDs, health/readiness
  endpoints - SRS §19

## What's explicitly NOT implemented yet

Everything outside identity/accounts: admissions, student records,
academic registration, learning management, assessment/results, lecturer
attendance, notifications beyond the dev-only console stub, payment
reconciliation, reporting/exports. See
[`../README.md`](../README.md#delivery-approach) for the phase sequence.

## Open dependency: no email/SMS provider selected

`src/shared/notification.ts` defines the `NotificationPort` interface a
real provider adapter will implement. The current
`ConsoleNotificationPort` only logs (and, in `NODE_ENV=test`, records to
an in-memory array tests can read) - it refuses to run at all if
`NODE_ENV=production`. This is an explicit, tracked gap (CRS D-07), not a
disguised integration.

## Project layout

```
src/
  config/env.ts        # validated environment configuration
  shared/               # cross-cutting: errors, logging, audit, validation,
                         # request context, notification port, health routes
  modules/iam/           # this phase's only module: accounts, sessions,
                         # role grants, MFA, password/token handling
  app.ts, server.ts
prisma/
  schema.prisma
  migrations/            # versioned SQL, source of truth for schema history
  seed.ts
scripts/
  dev-db.ts                    # PGlite dev/test database (see above)
  apply-migrations-pglite.ts   # PGlite-only migration runner (see above)
test/
  setup.ts, helpers.ts, auth.test.ts
```

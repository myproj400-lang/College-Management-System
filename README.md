# College Management System

A college management system for Murialdo.

## Backend (`server/`)

REST API built with **Node.js, Express, TypeScript, Prisma and PostgreSQL**.

### Features

- **Accounts & roles:** Admin, Registrar, Bursar, Lecturer, Student. Login with JWT; passwords hashed with bcrypt; login rate-limited; role changes and deactivation take effect immediately.
- **Academic structure:** departments, programmes, courses (with assigned lecturer).
- **Students & staff:** profiles, student status (active / suspended / withdrawn / graduated), search and paging.
- **Academic calendar:** terms with start/end dates, a registration (add/drop) window, a maximum credit load, and a "current term".
- **Registration rules:** students register and drop courses themselves only while the window is open. Registration checks prerequisites (circular chains are refused), the term's credit limit, and overdue fees. The registry can override with `override: true`, which is recorded in the audit trail.
- **Grades:** lecturers grade only their own courses, either as coursework + exam marks (each course sets its coursework weight, 40% by default) or as a single final score. Letter grade and grade point are worked out automatically. Transcripts show per-semester GPA, CGPA and academic standing (probation below 2.0).
- **Results publication:** students see marks only after the registry publishes a term's results. Publishing warns if anyone is still ungraded; afterwards, lecturers can't change grades and only the registry can amend them (audited).
- **Timetable:** weekly class slots per term, refusing double-booked rooms and lecturer clashes; personal timetables for students and lecturers.
- **Attendance:** lecturers mark attendance per class date; students see their attendance percentage per course.
- **Fees:** invoices, payments (cash, bank transfer, mobile money, cheque) with numbered receipts (`RCPT-000001`), balances, outstanding-fees list; overpayments are rejected.
- **Announcements:** notices for everyone, one role, or one programme, with optional scheduling and expiry.
- **Reports:** college summary (students by status and programme, fees billed/collected/outstanding), per-course results (average, pass rate, grade distribution), and the academic-probation list.
- **Audit trail:** who created or changed accounts, students, enrollments, grades, terms, invoices and payments, and when. Viewable by admins.

The grading scale and probation threshold live in `server/src/lib/grading.ts` (A ≥ 70, B ≥ 60, C ≥ 50, D ≥ 45, F below; pass = D or better; probation below 2.0 CGPA). Adjust them to the college's regulations.

### Running it locally

Requires Node.js 20 or newer. No PostgreSQL install is needed for development.

```bash
cd server
npm install
cp .env.example .env        # then set JWT_SECRET and the seed admin password
npm run db:local            # terminal 1: starts a local PostgreSQL on port 5433
npm run db:push             # terminal 2: creates the tables
npm run seed                # creates the first admin account from .env
npm run dev                 # API on http://localhost:4000
```

Sign in with the seed admin (`POST /api/auth/login`), then change its password. Before students can register, create an academic term (`POST /api/terms`).

Applicant registration (`POST /api/auth/register-applicant`) does not send email until a provider is approved. Leave `CONTACT_CHANNEL=undelivered`. The value `capture` is only for automated tests and is refused when `NODE_ENV=production`. An uploaded application receipt does not confirm a fee. Fee confirmation is a bursar payment event that matches the reference, amount, and currency. The 150 SLE figure used in tests is an example, not a college tariff.

### Tests

```bash
cd server
npm test                        # end-to-end API tests on a throwaway PostgreSQL
npm run db:verify-migrations    # checks prisma/migrations produce exactly schema.prisma
```

After changing `prisma/schema.prisma`, add a migration (`npm run db:migrate`) and run both commands.

### Production

Set `DATABASE_URL` to a real PostgreSQL database and a long random `JWT_SECRET`, then:

```bash
npm install
npm run db:deploy   # applies prisma/migrations
npm run seed
npm run build
npm start
```

### API overview

All routes are under `/api`. Everything except `/health` and `/auth/login` needs an `Authorization: Bearer <token>` header.

| Area | Endpoints | Who |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/register-applicant`, `POST /auth/verify-contact`, `GET /auth/me`, `POST /auth/change-password` | anyone / signed in |
| Admissions | `GET /admissions/public/intakes`, applications, documents, decisions, `POST /admissions/payments/events`, `POST /admissions/applications/:id/convert` | public intakes; applicant owns the draft; admissions officer reviews; bursar verifies the fee; registrar converts |
| Users | `GET/POST /users`, `PATCH /users/:id` | Admin |
| Departments | `GET /departments[/:id]`, `POST`, `PATCH /:id`, `DELETE /:id` | read: all · write: Admin, Registrar · delete: Admin |
| Programmes | `GET /programmes[/:id]`, `POST`, `PATCH /:id`, `DELETE /:id` | same as above |
| Courses | `GET /courses[/:id]`, `POST`, `PATCH /:id`, `DELETE /:id` | same as above |
| Students | `GET /students`, `GET /students/:id`, `POST`, `PATCH /:id` | Admin, Registrar (Bursar read); students see only themselves |
| Staff | `GET /staff[/:id]`, `POST`, `PATCH /:id` | Admin (Registrar read) |
| Prerequisites | `POST /courses/:id/prerequisites`, `DELETE /courses/:id/prerequisites/:prerequisiteId` | Admin, Registrar |
| Terms | `GET /terms`, `GET /terms/current`, `POST /terms`, `PATCH /terms/:id`, `POST /terms/:id/set-current`, `POST /terms/:id/publish-results`, `POST /terms/:id/unpublish-results` | read: all · write: Admin, Registrar · unpublish: Admin |
| Enrollments | `GET /enrollments`, `POST /enrollments`, `PATCH /enrollments/:id/status` | Admin, Registrar; students register/drop themselves during add/drop; lecturers see their courses |
| Grades | `PUT /enrollments/:id/grade`, `GET /students/:id/transcript` | course lecturer (until published), Admin, Registrar; student sees own published transcript |
| Timetable | `GET /timetable`, `POST /timetable`, `PATCH/DELETE /timetable/:id`, `GET /students/:id/timetable`, `GET /staff/:id/timetable` | read: all · write: Admin, Registrar; personal timetables: owner and registry |
| Attendance | `POST /attendance`, `GET /courses/:id/attendance`, `GET /students/:id/attendance` | course lecturer, Admin, Registrar; student sees own |
| Fees | `POST /fees/invoices`, `POST /fees/invoices/:id/payments`, `GET /fees/payments/:id/receipt`, `GET /fees/outstanding`, `GET /students/:id/fees` | Admin, Bursar; student sees own fees and receipts |
| Announcements | `GET /announcements`, `GET /announcements/all`, `POST`, `PATCH /:id`, `DELETE /:id` | read: everyone (filtered to them) · manage: Admin, Registrar, Bursar |
| Reports | `GET /reports/summary`, `GET /reports/courses/:id/results`, `GET /reports/probation` | Admin, Registrar (Bursar: summary; Lecturer: own courses' results) |
| Audit trail | `GET /audit-logs` | Admin |

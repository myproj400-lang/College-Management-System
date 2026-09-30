# College Management System

A college management system for Murialdo.

## Backend (`server/`)

REST API built with **Node.js, Express, TypeScript, Prisma and PostgreSQL**.

### Features

- **Accounts & roles:** Admin, Registrar, Bursar, Lecturer, Student. Login with JWT; passwords hashed with bcrypt; login rate-limited; role changes and deactivation take effect immediately.
- **Academic structure:** departments, programmes, courses (with assigned lecturer).
- **Students & staff:** profiles, student status (active / suspended / withdrawn / graduated), search and paging.
- **Enrollment:** course registration by the registrar or by students themselves.
- **Grades:** lecturers enter scores for their own courses; letter grade and grade point are worked out automatically; transcripts with per-semester GPA and CGPA.
- **Attendance:** lecturers mark attendance per class date; students see their attendance percentage per course.
- **Fees:** invoices, payments (cash, bank transfer, mobile money, cheque), balances, outstanding-fees list; overpayments are rejected.

The grading scale lives in `server/src/lib/grading.ts` (A ≥ 70, B ≥ 60, C ≥ 50, D ≥ 45, F below) — adjust it to the college's regulations.

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

Sign in with the seed admin (`POST /api/auth/login`), then change its password.

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
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password` | anyone / signed in |
| Users | `GET/POST /users`, `PATCH /users/:id` | Admin |
| Departments | `GET /departments[/:id]`, `POST`, `PATCH /:id`, `DELETE /:id` | read: all · write: Admin, Registrar · delete: Admin |
| Programmes | `GET /programmes[/:id]`, `POST`, `PATCH /:id`, `DELETE /:id` | same as above |
| Courses | `GET /courses[/:id]`, `POST`, `PATCH /:id`, `DELETE /:id` | same as above |
| Students | `GET /students`, `GET /students/:id`, `POST`, `PATCH /:id` | Admin, Registrar (Bursar read); students see only themselves |
| Staff | `GET /staff[/:id]`, `POST`, `PATCH /:id` | Admin (Registrar read) |
| Enrollments | `GET /enrollments`, `POST /enrollments`, `PATCH /enrollments/:id/status` | Admin, Registrar; students enroll themselves; lecturers see their courses |
| Grades | `PUT /enrollments/:id/grade`, `GET /students/:id/transcript` | course lecturer, Admin, Registrar; student sees own transcript |
| Attendance | `POST /attendance`, `GET /courses/:id/attendance`, `GET /students/:id/attendance` | course lecturer, Admin, Registrar; student sees own |
| Fees | `POST /fees/invoices`, `POST /fees/invoices/:id/payments`, `GET /fees/outstanding`, `GET /students/:id/fees` | Admin, Bursar; student sees own |

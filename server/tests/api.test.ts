import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

// One end-to-end walk through the system. The steps share state and run in order.
const app = createApp();
const api = (token?: string) => {
  const wrap = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  return {
    get: (p: string) => wrap(request(app).get(`/api${p}`)),
    post: (p: string, body?: object) => wrap(request(app).post(`/api${p}`)).send(body ?? {}),
    put: (p: string, body: object) => wrap(request(app).put(`/api${p}`)).send(body),
    patch: (p: string, body: object) => wrap(request(app).patch(`/api${p}`)).send(body),
  };
};
const login = async (email: string, password: string) =>
  (await request(app).post('/api/auth/login').send({ email, password })).body.token as string;

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const YEAR = '2026/2027';
const T = { academicYear: YEAR, semester: 1 };

const s: Record<string, any> = {};

beforeAll(async () => {
  await prisma.user.create({
    data: {
      email: 'admin@test.local',
      passwordHash: await bcrypt.hash('Admin12345', 4),
      firstName: 'Ada',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });
});
afterAll(() => prisma.$disconnect());

describe('auth', () => {
  it('rejects missing and bad credentials', async () => {
    expect((await api().get('/courses')).status).toBe(401);
    expect((await api().post('/auth/login', { email: 'admin@test.local', password: 'wrong' })).status).toBe(401);
  });
  it('logs the admin in', async () => {
    s.admin = await login('admin@test.local', 'Admin12345');
    expect(s.admin).toBeTruthy();
    expect((await api(s.admin).get('/health')).status).toBe(200);
  });
});

describe('academic structure', () => {
  it('creates department, programme, lecturers and courses', async () => {
    const A = api(s.admin);
    s.dept = (await A.post('/departments', { code: 'cs', name: 'Computer Science' })).body;
    expect(s.dept.code).toBe('CS');
    expect((await A.post('/departments', { code: 'CS', name: 'Duplicate' })).status).toBe(409);

    s.prog = (await A.post('/programmes', { code: 'BSC-CS', name: 'BSc Computer Science', level: "Bachelor's", durationYears: 4, departmentId: s.dept.id })).body;
    s.prog2 = (await A.post('/programmes', { code: 'DIP-IT', name: 'Diploma IT', level: 'Diploma', durationYears: 2, departmentId: s.dept.id })).body;

    const staff = (n: number) => ({ email: `lect${n}@test.local`, password: 'Lecturer123', firstName: 'Lec', lastName: `Turer${n}`, staffNumber: `STF00${n}`, position: 'Lecturer', departmentId: s.dept.id });
    s.lect1 = (await A.post('/staff', staff(1))).body;
    s.lect2 = (await A.post('/staff', staff(2))).body;
    expect(s.lect1.staffNumber).toBe('STF001');

    const course = (code: string, credits: number, lecturerId?: string) =>
      A.post('/courses', { code, title: `${code} course`, creditHours: credits, semester: 1, departmentId: s.dept.id, lecturerId });
    s.cs101 = (await course('CS101', 3, s.lect1.id)).body;
    s.cs201 = (await course('CS201', 3, s.lect1.id)).body;
    s.math = (await course('MATH101', 2)).body;
    s.eng = (await course('ENG101', 3, s.lect2.id)).body;
    expect(s.cs101.courseworkWeight).toBe(40);
  });

  it('manages prerequisites and blocks cycles', async () => {
    const A = api(s.admin);
    expect((await A.post(`/courses/${s.cs201.id}/prerequisites`, { prerequisiteId: s.cs101.id })).status).toBe(201);
    expect((await A.post(`/courses/${s.cs101.id}/prerequisites`, { prerequisiteId: s.cs201.id })).status).toBe(400);
    expect((await A.post(`/courses/${s.cs101.id}/prerequisites`, { prerequisiteId: s.cs101.id })).status).toBe(400);
    const detail = (await A.get(`/courses/${s.cs201.id}`)).body;
    expect(detail.prerequisites[0].prerequisite.code).toBe('CS101');
  });
});

describe('academic calendar', () => {
  it('creates terms and sets the current one', async () => {
    const A = api(s.admin);
    s.termA = (await A.post('/terms', { ...T, startDate: iso(-10), endDate: iso(100), registrationOpensAt: iso(-1), registrationClosesAt: iso(7), maxCredits: 6 })).body;
    expect(s.termA.id).toBeTruthy();
    s.termB = (await A.post('/terms', { academicYear: '2025/2026', semester: 2, startDate: iso(-200), endDate: iso(-100), registrationOpensAt: iso(-210), registrationClosesAt: iso(-190) })).body;
    expect((await A.post('/terms', { ...T, semester: 2, startDate: iso(10), endDate: iso(5), registrationOpensAt: iso(1), registrationClosesAt: iso(2) })).status).toBe(400);
    expect((await A.patch(`/terms/${s.termA.id}`, { endDate: iso(-20) })).status).toBe(400);

    await A.post(`/terms/${s.termA.id}/set-current`);
    expect((await A.get('/terms/current')).body.id).toBe(s.termA.id);
  });
});

describe('students and registration', () => {
  it('creates students', async () => {
    const A = api(s.admin);
    const mk = (n: number, programmeId: string) => A.post('/students', { email: `stu${n}@test.local`, password: 'Student123', firstName: 'Stu', lastName: `Dent${n}`, studentNumber: `STU00${n}`, programmeId });
    s.stu1 = (await mk(1, s.prog.id)).body;
    s.stu2 = (await mk(2, s.prog2.id)).body;
    expect(s.stu1.studentNumber).toBe('STU001');
    expect((await A.post('/students', { email: 'x@test.local', password: 'short', firstName: 'a', lastName: 'b', studentNumber: 'STU9', programmeId: s.prog.id })).status).toBe(400);

    s.lect1Tok = await login('lect1@test.local', 'Lecturer123');
    s.stu1Tok = await login('stu1@test.local', 'Student123');
    s.stu2Tok = await login('stu2@test.local', 'Student123');
  });

  it('lets a student self-register within the window', async () => {
    const r = await api(s.stu1Tok).post('/enrollments', { studentId: s.stu1.id, courseId: s.cs101.id, ...T });
    expect(r.status).toBe(201);
    s.enrCs101 = r.body;
    expect((await api(s.admin).post('/enrollments', { studentId: s.stu1.id, courseId: s.math.id, ...T })).status).toBe(201);
  });

  it('enforces registration rules', async () => {
    const S = api(s.stu1Tok);
    // someone else
    expect((await S.post('/enrollments', { studentId: s.stu2.id, courseId: s.cs101.id, ...T })).status).toBe(403);
    // duplicate
    expect((await api(s.admin).post('/enrollments', { studentId: s.stu1.id, courseId: s.cs101.id, ...T })).status).toBe(409);
    // closed window
    const closed = await S.post('/enrollments', { studentId: s.stu1.id, courseId: s.eng.id, academicYear: '2025/2026', semester: 2 });
    expect(closed.status).toBe(400);
    expect(closed.body.error).toMatch(/closed/);
    // no such term
    expect((await S.post('/enrollments', { studentId: s.stu1.id, courseId: s.eng.id, academicYear: '2030/2031', semester: 1 })).status).toBe(400);
    // credit limit: 3 + 2 + 3 > 6
    const credits = await S.post('/enrollments', { studentId: s.stu1.id, courseId: s.eng.id, ...T });
    expect(credits.status).toBe(400);
    expect(credits.body.error).toMatch(/Credit limit/);
    // prerequisite not passed
    const prereq = await S.post('/enrollments', { studentId: s.stu1.id, courseId: s.cs201.id, ...T });
    expect(prereq.body.error).toMatch(/Prerequisites not passed: CS101/);
    // students can't override
    expect((await S.post('/enrollments', { studentId: s.stu1.id, courseId: s.cs201.id, ...T, override: true })).status).toBe(403);
  });

  it('lets the registry override, and audits it', async () => {
    const r = await api(s.admin).post('/enrollments', { studentId: s.stu1.id, courseId: s.cs201.id, ...T, override: true });
    expect(r.status).toBe(201);
    s.enrCs201 = r.body;
    const logs = (await api(s.admin).get(`/audit-logs?entity=Enrollment&entityId=${r.body.id}`)).body.items;
    expect(logs[0].details.overridden.join(' ')).toMatch(/Prerequisites/);
  });

  it('blocks self-registration when fees are overdue', async () => {
    await api(s.admin).post('/fees/invoices', { studentId: s.stu2.id, academicYear: YEAR, description: 'Late fees', amount: 100, dueDate: iso(-3) });
    const r = await api(s.stu2Tok).post('/enrollments', { studentId: s.stu2.id, courseId: s.cs101.id, ...T });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/overdue fees of 100.00/);
  });

  it('lets a student drop their own course during add/drop', async () => {
    const mine = (await api(s.stu1Tok).get('/enrollments')).body;
    const math = mine.find((e: any) => e.course.code === 'MATH101');
    expect((await api(s.stu1Tok).patch(`/enrollments/${math.id}/status`, { status: 'COMPLETED' })).status).toBe(403);
    expect((await api(s.stu2Tok).patch(`/enrollments/${math.id}/status`, { status: 'DROPPED' })).status).toBe(403);
    const r = await api(s.stu1Tok).patch(`/enrollments/${math.id}/status`, { status: 'DROPPED' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('DROPPED');

    // Taking a dropped course up again reuses the same enrollment.
    const again = await api(s.admin).post('/enrollments', { studentId: s.stu1.id, courseId: s.math.id, ...T, override: true });
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ id: math.id, status: 'ENROLLED' });
    await api(s.stu1Tok).patch(`/enrollments/${math.id}/status`, { status: 'DROPPED' });
  });
});

describe('timetable', () => {
  it('books slots and detects clashes', async () => {
    const A = api(s.admin);
    const slot = (courseId: string, start: string, end: string, room: string) =>
      A.post('/timetable', { courseId, ...T, dayOfWeek: 1, startTime: start, endTime: end, room });
    expect((await slot(s.cs101.id, '09:00', '11:00', 'A1')).status).toBe(201);
    const room = await slot(s.math.id, '10:00', '12:00', 'a1');
    expect(room.status).toBe(409);
    expect(room.body.error).toMatch(/Room/);
    const lect = await slot(s.cs201.id, '10:00', '11:30', 'B2');
    expect(lect.status).toBe(409);
    expect(lect.body.error).toMatch(/lecturer/);
    expect((await slot(s.cs201.id, '11:00', '12:00', 'B2')).status).toBe(201);
    expect((await slot(s.eng.id, '12:00', '11:00', 'C3')).status).toBe(400);

    const mine = (await api(s.stu1Tok).get(`/students/${s.stu1.id}/timetable?academicYear=${YEAR}&semester=1`)).body;
    expect(mine.map((x: any) => x.course.code)).toEqual(['CS101', 'CS201']);
    const lecturer = (await api(s.lect1Tok).get(`/staff/${s.lect1.id}/timetable?academicYear=${YEAR}&semester=1`)).body;
    expect(lecturer).toHaveLength(2);
    expect((await api(s.stu1Tok).get(`/students/${s.stu2.id}/timetable?academicYear=${YEAR}&semester=1`)).status).toBe(403);
  });
});

describe('grades and results publication', () => {
  it('combines coursework and exam marks', async () => {
    // 80 * 40% + 60 * 60% = 68 → B
    const r = await api(s.lect1Tok).put(`/enrollments/${s.enrCs101.id}/grade`, { courseworkScore: 80, examScore: 60 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ score: 68, grade: 'B', gradePoint: 3 });
    expect((await api(s.stu1Tok).put(`/enrollments/${s.enrCs101.id}/grade`, { score: 100 })).status).toBe(403);
    expect((await api(s.lect1Tok).put(`/enrollments/${s.enrCs101.id}/grade`, { score: 50, examScore: 3 })).status).toBe(400);
  });

  it('hides marks from students until results are published', async () => {
    const mine = (await api(s.stu1Tok).get('/enrollments')).body;
    expect(mine.find((e: any) => e.course.code === 'CS101').score).toBeNull();
    expect((await api(s.stu1Tok).get(`/students/${s.stu1.id}/transcript`)).body.terms).toHaveLength(0);
    // staff still see them
    expect((await api(s.admin).get(`/students/${s.stu1.id}/transcript`)).body.terms).toHaveLength(1);
  });

  it('refuses to publish with ungraded students unless forced', async () => {
    expect((await api(s.admin).post(`/terms/${s.termA.id}/publish-results`)).status).toBe(409);
    await api(s.lect1Tok).put(`/enrollments/${s.enrCs201.id}/grade`, { score: 40 });
    expect((await api(s.admin).post(`/terms/${s.termA.id}/publish-results`)).status).toBe(200);
  });

  it('locks grades against lecturer edits after publication', async () => {
    expect((await api(s.lect1Tok).put(`/enrollments/${s.enrCs201.id}/grade`, { score: 90 })).status).toBe(403);
    const amend = await api(s.admin).put(`/enrollments/${s.enrCs201.id}/grade`, { score: 50 });
    expect(amend.body.grade).toBe('C');
    const logs = (await api(s.admin).get(`/audit-logs?action=grade.set&entityId=${s.enrCs201.id}`)).body.items;
    expect(logs[0].details).toMatchObject({ afterPublication: true, from: { score: 40, grade: 'F' } });
  });

  it('shows the published transcript with standing', async () => {
    const tr = (await api(s.stu1Tok).get(`/students/${s.stu1.id}/transcript`)).body;
    // CS101 B (3.0 × 3) + CS201 C (2.0 × 3) = 15 / 6 = 2.5
    expect(tr.cgpa).toBe(2.5);
    expect(tr.standing).toBe('GOOD');
    expect(tr.terms[0]).toMatchObject({ resultsPublished: true, credits: 6 });
    expect(tr.terms[0].courses.find((c: any) => c.code === 'CS101')).toMatchObject({ courseworkScore: 80, examScore: 60 });
    expect((await api(s.stu1Tok).get(`/students/${s.stu2.id}/transcript`)).status).toBe(403);
  });

  it('reports course results and probation', async () => {
    const r = (await api(s.lect1Tok).get(`/reports/courses/${s.cs101.id}/results?academicYear=${YEAR}&semester=1`)).body;
    expect(r).toMatchObject({ enrolled: 1, graded: 1, average: 68, passRate: 100 });
    expect(r.distribution.B).toBe(1);
    const lect2 = await login('lect2@test.local', 'Lecturer123');
    expect((await api(lect2).get(`/reports/courses/${s.cs101.id}/results?academicYear=${YEAR}&semester=1`)).status).toBe(403);
    const probation = (await api(s.admin).get('/reports/probation')).body;
    expect(probation.students.map((x: any) => x.studentNumber)).not.toContain('STU001');
  });
});

describe('attendance', () => {
  it('records attendance for the course lecturer only', async () => {
    const L = api(s.lect1Tok);
    expect((await L.post('/attendance', { courseId: s.cs101.id, date: '2026-10-01', records: [{ enrollmentId: s.enrCs101.id, status: 'PRESENT' }] })).status).toBe(200);
    await L.post('/attendance', { courseId: s.cs101.id, date: '2026-10-02', records: [{ enrollmentId: s.enrCs101.id, status: 'ABSENT' }] });
    expect((await L.post('/attendance', { courseId: s.eng.id, date: '2026-10-01', records: [{ enrollmentId: s.enrCs101.id, status: 'PRESENT' }] })).status).toBe(403);
    expect((await L.post('/attendance', { courseId: s.cs101.id, date: '2026-10-01', records: [{ enrollmentId: s.enrCs201.id, status: 'PRESENT' }] })).status).toBe(400);
    const summary = (await api(s.stu1Tok).get(`/students/${s.stu1.id}/attendance`)).body;
    expect(summary.find((a: any) => a.course.code === 'CS101').percentage).toBe(50);
  });
});

describe('fees and receipts', () => {
  it('records payments with numbered receipts and rejects overpayment', async () => {
    const A = api(s.admin);
    const inv = (await A.post('/fees/invoices', { studentId: s.stu1.id, academicYear: YEAR, description: 'Tuition', amount: 1500.5, dueDate: iso(30) })).body;
    const pay = await A.post(`/fees/invoices/${inv.id}/payments`, { amount: 1000, method: 'MOBILE_MONEY', reference: 'OM-123' });
    expect(pay.status).toBe(201);
    expect(pay.body.receiptNumber).toMatch(/^RCPT-\d{6}$/);
    s.payment = pay.body;
    expect((await A.post(`/fees/invoices/${inv.id}/payments`, { amount: 600, method: 'CASH' })).status).toBe(400);
    expect((await A.post(`/fees/invoices/${inv.id}/payments`, { amount: 1.005, method: 'CASH' })).status).toBe(400);

    const fees = (await api(s.stu1Tok).get(`/students/${s.stu1.id}/fees`)).body;
    expect(fees.totalBalance).toBe('500.50');
    expect(fees.invoices[0].payments[0].receiptNumber).toBe(s.payment.receiptNumber);
  });

  it('shows a receipt to its owner only', async () => {
    const r = await api(s.stu1Tok).get(`/fees/payments/${s.payment.id}/receipt`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ amount: '1000.00', balanceAfterPayment: '500.50', method: 'MOBILE_MONEY' });
    expect((await api(s.stu2Tok).get(`/fees/payments/${s.payment.id}/receipt`)).status).toBe(403);
    expect((await api(s.stu1Tok).post('/fees/invoices', { studentId: s.stu1.id, academicYear: YEAR, description: 'x', amount: 1, dueDate: iso(1) })).status).toBe(403);
  });
});

describe('announcements', () => {
  it('shows each user only the notices meant for them', async () => {
    const A = api(s.admin);
    await A.post('/announcements', { title: 'Welcome back', body: 'Term starts Monday' });
    await A.post('/announcements', { title: 'Students: exam rules', body: '...', audience: 'STUDENT' });
    await A.post('/announcements', { title: 'Staff meeting', body: '...', audience: 'LECTURER' });
    await A.post('/announcements', { title: 'Diploma IT orientation', body: '...', programmeId: s.prog2.id });
    await A.post('/announcements', { title: 'Old notice', body: '...', expiresAt: iso(-1), publishedAt: iso(-5) });
    await A.post('/announcements', { title: 'Future notice', body: '...', publishedAt: iso(5) });

    const titles = async (tok: string) => (await api(tok).get('/announcements')).body.map((a: any) => a.title).sort();
    expect(await titles(s.stu1Tok)).toEqual(['Students: exam rules', 'Welcome back']);
    expect(await titles(s.stu2Tok)).toEqual(['Diploma IT orientation', 'Students: exam rules', 'Welcome back']);
    expect(await titles(s.lect1Tok)).toEqual(['Staff meeting', 'Welcome back']);
    expect((await api(s.stu1Tok).post('/announcements', { title: 'Hack', body: 'x' })).status).toBe(403);
    expect((await A.get('/announcements/all')).body).toHaveLength(6);
  });
});

describe('reports and audit', () => {
  it('summarises the college', async () => {
    const r = (await api(s.admin).get('/reports/summary')).body;
    expect(r.students.byStatus.ACTIVE).toBe(2);
    expect(r.fees).toEqual({ billed: '1600.50', collected: '1000.00', outstanding: '600.50' });
    expect((await api(s.stu1Tok).get('/reports/summary')).status).toBe(403);
  });

  it('keeps an audit trail visible to admins only', async () => {
    const actions = (await api(s.admin).get('/audit-logs?pageSize=100')).body.items.map((l: any) => l.action);
    for (const a of ['student.create', 'enrollment.create', 'enrollment.status', 'grade.set', 'term.publishResults', 'invoice.create', 'payment.create']) {
      expect(actions).toContain(a);
    }
    expect((await api(s.stu1Tok).get('/audit-logs')).status).toBe(403);
  });
});

describe('account control', () => {
  it('applies deactivation immediately', async () => {
    await api(s.admin).patch(`/users/${s.stu2.user.id}`, { isActive: false });
    expect((await api(s.stu2Tok).get('/auth/me')).status).toBe(401);
    const me = (await api(s.admin).get('/auth/me')).body;
    expect((await api(s.admin).patch(`/users/${me.id}`, { isActive: false })).status).toBe(400);
    const log = (await api(s.admin).get(`/audit-logs?action=user.update&entityId=${s.stu2.user.id}`)).body.items[0];
    expect(log.details).toMatchObject({ isActive: false, passwordReset: false });
  });

  it('changes a password', async () => {
    expect((await api(s.lect1Tok).post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'NewPass456' })).status).toBe(400);
    expect((await api(s.lect1Tok).post('/auth/change-password', { currentPassword: 'Lecturer123', newPassword: 'NewPass456' })).status).toBe(200);
  });
});

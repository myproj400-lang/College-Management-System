import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { capturedContacts } from '../src/lib/admissions/contactChannel';

const app = createApp();
const api = (token?: string) => {
  const wrap = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  return {
    get: (p: string) => wrap(request(app).get(`/api${p}`)),
    post: (p: string, body?: object) => wrap(request(app).post(`/api${p}`)).send(body ?? {}),
    patch: (p: string, body?: object) => wrap(request(app).patch(`/api${p}`)).send(body),
  };
};
const login = async (email: string, password: string) =>
  (await request(app).post('/api/auth/login').send({ email, password })).body.token as string;

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF').toString('base64');
const fakePdf = Buffer.from('<html>not a pdf</html>').toString('base64');

const s: Record<string, any> = {};

async function verifyApplicant(email: string, password: string) {
  capturedContacts.length = 0;
  const registered = await api().post('/auth/register-applicant', {
    email,
    password,
    firstName: 'Amina',
    lastName: 'Kamara',
  });
  expect(registered.status).toBe(202);
  expect(registered.body.token).toBeUndefined();
  const token = capturedContacts.find((item) => item.email === email)?.token;
  expect(token).toBeTruthy();
  expect((await api().post('/auth/verify-contact', { token })).status).toBe(200);
  expect((await api().post('/auth/verify-contact', { token })).status).toBe(400);
  return login(email, password);
}

afterAll(async () => {
  await prisma.applicationPaymentEvent.deleteMany();
  await prisma.applicationDecision.deleteMany();
  await prisma.applicationDocument.deleteMany();
  await prisma.applicationSnapshot.deleteMany();
  await prisma.deadlineExtension.deleteMany();
  await prisma.submissionIdempotency.deleteMany();
  await prisma.application.deleteMany();
  await prisma.intake.deleteMany();
  await prisma.student.deleteMany({
    where: { OR: [{ studentNumber: { startsWith: 'STU-' } }, { studentNumber: 'MANUAL-EXISTING-1' }] },
  });
  await prisma.$disconnect();
});

beforeAll(async () => {
  await prisma.user.create({
    data: {
      email: 'admin-admissions@test.local',
      passwordHash: await bcrypt.hash('Admin12345', 4),
      firstName: 'Ada',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });
  s.admin = await login('admin-admissions@test.local', 'Admin12345');
});

describe('applicant account', () => {
  it('hides whether an address is already registered and blocks login until verification', async () => {
    const before = await api().post('/auth/login', { email: 'amina@test.local', password: 'Applicant123' });
    expect(before.status).toBe(401);
    s.applicant = await verifyApplicant('amina@test.local', 'Applicant123');
    const again = await api().post('/auth/register-applicant', {
      email: 'amina@test.local',
      password: 'Applicant123',
      firstName: 'Amina',
      lastName: 'Kamara',
    });
    expect(again.status).toBe(202);
    expect(again.body.message).toBe(
      (await api().post('/auth/register-applicant', {
        email: 'nobody-new@test.local',
        password: 'Applicant123',
        firstName: 'N',
        lastName: 'Ew',
      })).body.message,
    );
  });
});

describe('admissions workflow', () => {
  it('publishes an intake and keeps an invalid draft', async () => {
    const admin = api(s.admin);
    const dept = (await admin.post('/departments', { code: 'SCI', name: 'Science' })).body;
    s.programme = (await admin.post('/programmes', { code: 'BSC-SCI', name: 'BSc Science', level: "Bachelor's", durationYears: 4, departmentId: dept.id })).body;
    s.officer = (await admin.post('/users', { email: 'admit@test.local', password: 'Officer123', firstName: 'Omar', lastName: 'Bangura', role: 'ADMISSIONS_OFFICER' })).body;
    s.officer2 = (await admin.post('/users', { email: 'admit2@test.local', password: 'Officer123', firstName: 'Fatu', lastName: 'Sesay', role: 'ADMISSIONS_OFFICER' })).body;
    s.bursar = (await admin.post('/users', { email: 'bursar-a@test.local', password: 'Bursar1234', firstName: 'B', lastName: 'Ursar', role: 'BURSAR' })).body;
    s.registrar = (await admin.post('/users', { email: 'registry-a@test.local', password: 'Registry123', firstName: 'R', lastName: 'Egistrar', role: 'REGISTRAR' })).body;
    s.officerToken = await login('admit@test.local', 'Officer123');
    s.officer2Token = await login('admit2@test.local', 'Officer123');
    s.bursarToken = await login('bursar-a@test.local', 'Bursar1234');
    s.registrarToken = await login('registry-a@test.local', 'Registry123');

    const intake = {
      programmeId: s.programme.id,
      name: 'Example 2026 intake',
      opensAt: iso(-1),
      closesAt: iso(30),
      timezone: 'UTC',
      entryRequirements: 'Example entry text for tests, not a college rule.',
      feeInstructions: 'Example fee of 150 SLE. Not a production tariff.',
      feeRequired: true,
      reviewBeforePayment: false,
      feeAmount: 150,
      currency: 'SLE',
      requiredDocuments: [{ code: 'ID', label: 'Identification' }],
      declarations: [{ code: 'TRUTH', text: 'Example declaration used only in tests.' }],
      maxDocumentBytes: 200000,
      allowedContentTypes: ['application/pdf'],
      secondApprovalRequired: false,
    };
    s.intake = (await api(s.officerToken).post('/admissions/intakes', intake)).body;
    expect(s.intake.ruleVersion).toBe(1);
    const published = (await api().get('/admissions/public/intakes')).body;
    expect(published.some((item: { id: string }) => item.id === s.intake.id)).toBe(true);

    s.application = (await api(s.applicant).post('/admissions/applications', { intakeId: s.intake.id })).body;
    expect(s.application.state).toBe('DRAFT');
    const bad = await api(s.applicant).post(`/admissions/applications/${s.application.id}/submit`).set('Idempotency-Key', 'submit-invalid-0001');
    expect(bad.status).toBe(400);
    expect(bad.body.details.dateOfBirth).toBeTruthy();
    const reloaded = (await api(s.applicant).get(`/admissions/applications/${s.application.id}`)).body;
    expect(reloaded.state).toBe('DRAFT');
    expect(reloaded.draft).toEqual({});
  });

  it('rejects a forged payment and an unsafe upload, then accepts one submission', async () => {
    const applicant = api(s.applicant);
    const saved = (
      await applicant.patch(`/admissions/applications/${s.application.id}`, {
        revision: s.application.revision,
        dateOfBirth: '2004-05-06',
        phone: '23276000000',
        address: '12 Example Street',
        acknowledgedDeclarationCodes: ['TRUTH'],
      })
    ).body;
    expect(saved.revision).toBe(2);
    expect((await applicant.patch(`/admissions/applications/${s.application.id}`, { revision: 1, phone: '23276000001' })).status).toBe(409);

    const rejected = await applicant.post(`/admissions/applications/${s.application.id}/documents`, {
      requirementCode: 'ID',
      fileName: 'id.pdf',
      contentType: 'application/pdf',
      contentBase64: fakePdf,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('file-rejected');

    const uploaded = (
      await applicant.post(`/admissions/applications/${s.application.id}/documents`, {
        requirementCode: 'ID',
        fileName: 'id.pdf',
        contentType: 'application/pdf',
        contentBase64: pdf,
      })
    ).body;
    expect(uploaded.documents.some((doc: { state: string }) => doc.state === 'AVAILABLE')).toBe(true);
    const receipt = await applicant.post(`/admissions/applications/${s.application.id}/documents`, {
      requirementCode: 'PAYMENT_RECEIPT',
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      contentBase64: pdf,
    });
    expect(receipt.status).toBe(201);
    expect(receipt.body.feeStatus).toBe('PENDING');

    const forged = await applicant.post('/admissions/payments/events', {
      reference: s.application.paymentReference,
      providerId: 'example-provider',
      eventId: 'evt-forged',
      amount: 150,
      currency: 'SLE',
      state: 'CONFIRMED',
    });
    expect(forged.status).toBe(403);
    const stillPending = (await applicant.get(`/admissions/applications/${s.application.id}`)).body;
    expect(stillPending.feeStatus).toBe('PENDING');

    const unpaid = await applicant.post(`/admissions/applications/${s.application.id}/submit`).set('Idempotency-Key', 'submit-unpaid-0001');
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.code).toBe('payment-pending');

    const paid = await api(s.bursarToken).post('/admissions/payments/events', {
      reference: s.application.paymentReference,
      providerId: 'example-provider',
      eventId: 'evt-100',
      amount: 150,
      currency: 'SLE',
      state: 'CONFIRMED',
    });
    expect(paid.status).toBe(201);
    const replay = await api(s.bursarToken).post('/admissions/payments/events', {
      reference: s.application.paymentReference,
      providerId: 'example-provider',
      eventId: 'evt-100',
      amount: 150,
      currency: 'SLE',
      state: 'CONFIRMED',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(await prisma.applicationPaymentEvent.count({ where: { eventId: 'evt-100' } })).toBe(1);

    const mismatch = await api(s.bursarToken).post('/admissions/payments/events', {
      reference: s.application.paymentReference,
      providerId: 'example-provider',
      eventId: 'evt-wrong',
      amount: 10,
      currency: 'SLE',
      state: 'CONFIRMED',
    });
    expect(mismatch.status).toBe(409);

    const first = await applicant.post(`/admissions/applications/${s.application.id}/submit`).set('Idempotency-Key', 'submit-paid-0001');
    const second = await applicant.post(`/admissions/applications/${s.application.id}/submit`).set('Idempotency-Key', 'submit-paid-0001');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    s.reference = first.body.reference;
    s.submitted = first.body;
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.reference).toBe(first.body.reference);
    expect(await prisma.application.count({ where: { reference: first.body.reference } })).toBe(1);
    expect(first.body.snapshots).toBeUndefined();
  });

  it('hides the file from another applicant and keeps correction history', async () => {
    s.other = await verifyApplicant('other@test.local', 'Applicant123');
    const hidden = await api(s.other).get(`/admissions/applications/${s.application.id}`);
    expect(hidden.status).toBe(404);
    const doc = s.submitted.documents.find((item: { state: string }) => item.state === 'AVAILABLE');
    const download = await api(s.other).get(`/admissions/applications/${s.application.id}/documents/${doc.id}`);
    expect(download.status).toBe(404);
    const ownerDownload = await api(s.applicant).get(`/admissions/applications/${s.application.id}/documents/${doc.id}`);
    expect(ownerDownload.status).toBe(200);
    expect(ownerDownload.headers['content-type']).toContain('application/pdf');

    const officerView = (await api(s.officerToken).get(`/admissions/applications/${s.application.id}`)).body;
    const claim = await api(s.officerToken).post(`/admissions/applications/${s.application.id}/claim`, {
      assignmentRevision: officerView.assignmentRevision,
    });
    expect(claim.status).toBe(200);
    const clash = await api(s.officer2Token).post(`/admissions/applications/${s.application.id}/claim`, {
      assignmentRevision: officerView.assignmentRevision,
    });
    expect(clash.status).toBe(409);

    const correction = await api(s.officerToken).post(`/admissions/applications/${s.application.id}/corrections`, {
      fields: ['phone'],
      deadline: iso(2),
      message: 'Send a current phone number.',
      internalNote: 'Example internal note',
      assignmentRevision: claim.body.assignmentRevision,
    });
    expect(correction.status).toBe(200);
    const applicantView = (await api(s.applicant).get(`/admissions/applications/${s.application.id}`)).body;
    expect(JSON.stringify(applicantView)).not.toContain('Example internal note');

    const blocked = await api(s.applicant).patch(`/admissions/applications/${s.application.id}`, {
      revision: applicantView.revision,
      address: '99 Other Street',
    });
    expect(blocked.status).toBe(409);
    const edited = (
      await api(s.applicant).patch(`/admissions/applications/${s.application.id}`, {
        revision: applicantView.revision,
        phone: '23276111111',
      })
    ).body;
    const resubmitted = await api(s.applicant)
      .post(`/admissions/applications/${s.application.id}/resubmit`)
      .set('Idempotency-Key', 'resubmit-phone-0001');
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.reference).toBe(s.reference);
    const staff = (await api(s.officerToken).get(`/admissions/applications/${s.application.id}`)).body;
    expect(staff.snapshots).toHaveLength(2);
    expect(staff.snapshots[0].payload.phone).toBe('23276000000');
    expect(staff.snapshots[1].payload.phone).toBe('23276111111');
    expect(edited.revision).toBeGreaterThan(applicantView.revision);
  });

  it('converts an accepted offer once and stops a duplicate identity', async () => {
    const selfDecision = await api(s.applicant).post(`/admissions/applications/${s.application.id}/decisions`, {
      kind: 'FINAL',
      outcome: 'OFFERED',
      reason: 'no',
      assignmentRevision: 1,
    });
    expect(selfDecision.status).toBe(403);

    let current = (await api(s.officerToken).get(`/admissions/applications/${s.application.id}`)).body;
    const claimed = await api(s.officerToken).post(`/admissions/applications/${s.application.id}/claim`, {
      assignmentRevision: current.assignmentRevision,
    });
    const offered = await api(s.officerToken).post(`/admissions/applications/${s.application.id}/decisions`, {
      kind: 'FINAL',
      outcome: 'OFFERED',
      reason: 'Example offer for the test intake.',
      offerDeadline: iso(7),
      conditions: 'Example condition',
      assignmentRevision: claimed.body.assignmentRevision,
    });
    expect(offered.status).toBe(200);
    expect(offered.body.state).toBe('OFFERED');
    const accepted = await api(s.applicant).post(`/admissions/applications/${s.application.id}/respond`, { decision: 'ACCEPT' });
    expect(accepted.body.state).toBe('ACCEPTED');

    const adminConvert = await api(s.admin).post(`/admissions/applications/${s.application.id}/convert`);
    expect(adminConvert.status).toBe(403);
    const [first, second] = await Promise.all([
      api(s.registrarToken).post(`/admissions/applications/${s.application.id}/convert`),
      api(s.registrarToken).post(`/admissions/applications/${s.application.id}/convert`),
    ]);
    expect([200, 201]).toContain(first.status);
    expect([200, 201]).toContain(second.status);
    expect(first.body.studentId).toBe(second.body.studentId);
    expect(await prisma.student.count({ where: { id: first.body.studentId } })).toBe(1);
    const third = await api(s.registrarToken).post(`/admissions/applications/${s.application.id}/convert`);
    expect(third.status).toBe(200);
    expect(third.body.studentId).toBe(first.body.studentId);

    s.secondApplicant = await verifyApplicant('second@test.local', 'Applicant123');
    const closed = (
      await api(s.officerToken).post('/admissions/intakes', {
        programmeId: s.programme.id,
        name: 'Closed example intake',
        opensAt: iso(-10),
        closesAt: iso(-1),
        timezone: 'UTC',
        entryRequirements: 'Example',
        feeInstructions: 'No fee in this example.',
        feeRequired: false,
        requiredDocuments: [],
        declarations: [{ code: 'TRUTH', text: 'Example declaration used only in tests.' }],
        maxDocumentBytes: 200000,
        allowedContentTypes: ['application/pdf'],
      })
    ).body;
    const late = (await api(s.secondApplicant).post('/admissions/applications', { intakeId: closed.id })).body;
    await api(s.secondApplicant).patch(`/admissions/applications/${late.id}`, {
      revision: late.revision,
      dateOfBirth: '2003-01-02',
      phone: '23276222222',
      address: '4 Example Road',
      acknowledgedDeclarationCodes: ['TRUTH'],
    });
    const missed = await api(s.secondApplicant).post(`/admissions/applications/${late.id}/submit`).set('Idempotency-Key', 'late-submit-0001');
    expect(missed.status).toBe(409);
    expect(missed.body.code).toBe('deadline-closed');

    const existing = (await api(s.secondApplicant).post('/admissions/applications', { intakeId: s.intake.id })).body;
    await prisma.student.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'second@test.local' } })).id,
        studentNumber: 'MANUAL-EXISTING-1',
        programmeId: s.programme.id,
      },
    });
    await prisma.application.update({
      where: { id: existing.id },
      data: { state: 'ACCEPTED', feeStatus: 'NOT_REQUIRED', feeRequiredSnapshot: false },
    });
    const conflict = await api(s.registrarToken).post(`/admissions/applications/${existing.id}/convert`);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('identity-conflict');
    expect((await api(s.registrarToken).get(`/admissions/applications/${existing.id}`)).body.state).toBe('ACCEPTED');
  });

  it('refuses a sole final decision when the intake requires a second officer', async () => {
    const intake = (
      await api(s.officerToken).post('/admissions/intakes', {
        programmeId: s.programme.id,
        name: 'Second approval example',
        opensAt: iso(-1),
        closesAt: iso(10),
        timezone: 'UTC',
        entryRequirements: 'Example',
        feeInstructions: 'No fee in this example.',
        feeRequired: false,
        requiredDocuments: [],
        declarations: [{ code: 'TRUTH', text: 'Example declaration used only in tests.' }],
        maxDocumentBytes: 200000,
        allowedContentTypes: ['application/pdf'],
        secondApprovalRequired: true,
      })
    ).body;
    const applicant = await verifyApplicant('third@test.local', 'Applicant123');
    const draft = (await api(applicant).post('/admissions/applications', { intakeId: intake.id })).body;
    const saved = (
      await api(applicant).patch(`/admissions/applications/${draft.id}`, {
        revision: draft.revision,
        dateOfBirth: '2002-03-04',
        phone: '23276333333',
        address: '8 Example Lane',
        acknowledgedDeclarationCodes: ['TRUTH'],
      })
    ).body;
    const submitted = await api(applicant).post(`/admissions/applications/${draft.id}/submit`).set('Idempotency-Key', 'second-approval-0001');
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const view = (await api(s.officerToken).get(`/admissions/applications/${draft.id}`)).body;
    const claimed = await api(s.officerToken).post(`/admissions/applications/${draft.id}/claim`, {
      assignmentRevision: view.assignmentRevision,
    });
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    const held = await api(s.officerToken).post(`/admissions/applications/${draft.id}/decisions`, {
      kind: 'FINAL',
      outcome: 'OFFERED',
      reason: 'Too soon',
      offerDeadline: iso(3),
      assignmentRevision: claimed.body.assignmentRevision,
    });
    expect(held.status).toBe(409);
    expect(held.body.code).toBe('second-approval');
    const recommended = await api(s.officerToken).post(`/admissions/applications/${draft.id}/decisions`, {
      kind: 'RECOMMENDATION',
      outcome: 'OFFERED',
      reason: 'Example recommendation',
      assignmentRevision: claimed.body.assignmentRevision,
    });
    expect(recommended.status).toBe(200);
    expect(recommended.body.state).toBe('UNDER_REVIEW');
    const claimedBySecond = await api(s.officer2Token).post(`/admissions/applications/${draft.id}/claim`, {
      assignmentRevision: recommended.body.assignmentRevision,
    });
    const offered = await api(s.officer2Token).post(`/admissions/applications/${draft.id}/decisions`, {
      kind: 'FINAL',
      outcome: 'OFFERED',
      reason: 'Example final decision by a second officer',
      offerDeadline: iso(3),
      assignmentRevision: claimedBySecond.body.assignmentRevision,
    });
    expect(offered.status, JSON.stringify(offered.body)).toBe(200);
    expect(offered.body.state).toBe('OFFERED');
    expect(saved.revision).toBeGreaterThan(draft.revision);
  });
});

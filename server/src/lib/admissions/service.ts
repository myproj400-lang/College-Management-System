import { createHash, randomBytes } from 'node:crypto';
import {
  ApplicationFeeStatus,
  ApplicationState,
  DecisionKind,
  DecisionOutcome,
  Prisma,
  Role,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { HttpError } from '../../middleware/error';
import { audit } from '../audit';
import { contentMatches, newStorageKey, removeStored, safeFileName, writeStored } from './files';

const OPEN_STATES: ApplicationState[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CORRECTION_REQUESTED',
  'OFFERED',
  'WAITLISTED',
  'ACCEPTED',
];

const WITHDRAW_STATES: ApplicationState[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CORRECTION_REQUESTED',
  'OFFERED',
  'WAITLISTED',
  'ACCEPTED',
];

export const applicationInclude = {
  documents: { orderBy: { createdAt: 'asc' as const } },
  decisions: { orderBy: { createdAt: 'asc' as const } },
  snapshots: { orderBy: { revision: 'asc' as const } },
  intake: true,
  programme: { select: { id: true, code: true, name: true } },
  applicant: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.ApplicationInclude;

export type ApplicationRecord = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>;

type Draft = {
  dateOfBirth?: string;
  phone?: string;
  address?: string;
  previousSchool?: string;
  acknowledgedDeclarationCodes?: string[];
};

type DocRequirement = { code: string; label: string };
type Declaration = { code: string; text: string };

const STAFF_READ: Role[] = ['ADMISSIONS_OFFICER', 'REGISTRAR', 'BURSAR'];
const NOTE_ROLES: Role[] = ['ADMISSIONS_OFFICER', 'REGISTRAR'];

export function asDraft(value: Prisma.JsonValue): Draft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Draft;
}

export function asDocRequirements(value: Prisma.JsonValue): DocRequirement[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DocRequirement => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as { code?: unknown; label?: unknown };
    return typeof row.code === 'string' && typeof row.label === 'string';
  });
}

export function asDeclarations(value: Prisma.JsonValue): Declaration[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Declaration => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as { code?: unknown; text?: unknown };
    return typeof row.code === 'string' && typeof row.text === 'string';
  });
}

export function asStringList(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const item = (value as Record<string, unknown>)[key];
        if (item !== undefined) acc[key] = stable(item);
        return acc;
      }, {});
  }
  return value;
}

function submissionHash(action: string, app: ApplicationRecord): string {
  const documents = app.documents
    .filter((doc) => doc.state === 'AVAILABLE')
    .map((doc) => doc.id)
    .sort();
  return createHash('sha256')
    .update(JSON.stringify(stable({ action, applicationId: app.id, draft: asDraft(app.draft), documents })))
    .digest('hex');
}

function jsonBody(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function replay(
  row: { requestHash: string; statusCode: number; response: Prisma.JsonValue },
  hash: string,
): { status: number; body: Prisma.JsonValue } {
  if (row.requestHash !== hash) {
    throw new HttpError(409, 'This idempotency key was already used for a different submission.', 'idempotency-conflict');
  }
  return { status: row.statusCode, body: row.response };
}

async function runIdempotent(
  userId: string,
  key: string,
  hash: string,
  applicationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<{ status: number; body: unknown }>,
) {
  const existing = await prisma.submissionIdempotency.findUnique({ where: { userId_key: { userId, key } } });
  if (existing) return replay(existing, hash);

  try {
    return await prisma.$transaction(async (tx) => {
      const again = await tx.submissionIdempotency.findUnique({ where: { userId_key: { userId, key } } });
      if (again) return replay(again, hash);
      const produced = await work(tx);
      const saved = await tx.submissionIdempotency.create({
        data: {
          userId,
          key,
          requestHash: hash,
          applicationId,
          statusCode: produced.status,
          response: jsonBody(produced.body),
        },
      });
      return { status: saved.statusCode, body: saved.response };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.submissionIdempotency.findUnique({ where: { userId_key: { userId, key } } });
      if (winner) return replay(winner, hash);
    }
    throw err;
  }
}

async function nextNumber(tx: Prisma.TransactionClient, name: string, prefix: string): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO "ReferenceCounter" ("name", "next") VALUES (${name}, 1)
    ON CONFLICT ("name") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ next: number }>>`
    UPDATE "ReferenceCounter"
    SET "next" = "next" + 1
    WHERE "name" = ${name}
    RETURNING ("next" - 1) AS "next"
  `;
  if (!rows[0]) throw new HttpError(500, 'Could not allocate a reference');
  return `${prefix}-${String(rows[0].next).padStart(6, '0')}`;
}

export function nextAction(app: {
  state: ApplicationState;
  feeStatus: ApplicationFeeStatus;
  feeRequiredSnapshot: boolean;
  reviewBeforePayment: boolean;
  correctionMessage: string | null;
}): string {
  if (app.state === 'DRAFT' && app.feeRequiredSnapshot && !app.reviewBeforePayment && !['CONFIRMED', 'WAIVED'].includes(app.feeStatus)) {
    return 'Wait for verified payment, then submit. An uploaded receipt is not confirmation.';
  }
  switch (app.state) {
    case 'DRAFT':
      return 'Complete the application and submit it.';
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'WAITLISTED':
      return 'Wait for an admissions decision.';
    case 'CORRECTION_REQUESTED':
      return app.correctionMessage ?? 'Update the requested fields and resubmit.';
    case 'OFFERED':
      return 'Accept or decline the offer before the deadline.';
    case 'ACCEPTED':
      return 'Wait for the registry to convert this offer into a student record.';
    case 'REJECTED':
    case 'DECLINED':
    case 'EXPIRED':
    case 'WITHDRAWN':
      return 'No further action is available on this application.';
    case 'CONVERTED':
      return 'This application has been converted to a student record.';
    default:
      return 'Check the application status.';
  }
}

export function present(app: ApplicationRecord, role: Role) {
  const notes = NOTE_ROLES.includes(role);
  return {
    id: app.id,
    state: app.state,
    revision: app.revision,
    reference: app.reference,
    paymentReference: app.paymentReference,
    submittedAt: app.submittedAt,
    ruleVersion: app.ruleVersion,
    draft: asDraft(app.draft),
    feeStatus: app.feeStatus,
    feeAmount: app.feeAmountSnapshot,
    currency: app.currencySnapshot,
    feeRequired: app.feeRequiredSnapshot,
    reviewBeforePayment: app.reviewBeforePayment,
    requirementsMet: app.requirementsMet,
    offerDeadline: app.offerDeadline,
    offerConditions: app.offerConditions,
    correctionFields: notes || role === 'APPLICANT' || role === 'STUDENT' ? asStringList(app.correctionFields) : [],
    correctionDeadline: app.correctionDeadline,
    correctionMessage: app.correctionMessage,
    convertedStudentId: app.convertedStudentId,
    assignmentRevision: notes ? app.assignmentRevision : undefined,
    applicant: {
      id: app.applicant.id,
      firstName: app.applicant.firstName,
      lastName: app.applicant.lastName,
      email: app.applicant.email,
    },
    programme: app.programme,
    intake: {
      id: app.intake.id,
      name: app.intake.name,
      timezone: app.intake.timezone,
      opensAt: app.intake.opensAt,
      closesAt: app.intake.closesAt,
      ruleVersion: app.intake.ruleVersion,
      entryRequirements: app.intake.entryRequirements,
      feeInstructions: app.intake.feeInstructions,
    },
    documents: app.documents.map((doc) => ({
      id: doc.id,
      requirementCode: doc.requirementCode,
      fileName: doc.fileName,
      contentType: doc.contentType,
      byteSize: doc.byteSize,
      state: doc.state,
      createdAt: doc.createdAt,
    })),
    decisions: app.decisions.map((decision) => ({
      id: decision.id,
      kind: decision.kind,
      outcome: decision.outcome,
      reason: decision.reason,
      createdAt: decision.createdAt,
      ...(notes ? { internalNote: decision.internalNote, actorId: decision.actorId } : {}),
    })),
    snapshots: notes
      ? app.snapshots.map((snapshot) => ({
          revision: snapshot.revision,
          ruleVersion: snapshot.ruleVersion,
          payload: snapshot.payload,
          createdAt: snapshot.createdAt,
        }))
      : undefined,
    nextAction: nextAction(app),
  };
}

export async function loadVisible(user: { id: string; role: Role }, id: string): Promise<ApplicationRecord> {
  const app = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
  if (!app) throw new HttpError(404, 'Application not found', 'not-found');
  if (user.role === 'APPLICANT' || user.role === 'STUDENT') {
    if (app.applicantId !== user.id) throw new HttpError(404, 'Application not found', 'not-found');
    return app;
  }
  if (!STAFF_READ.includes(user.role)) throw new HttpError(403, 'You do not have permission to do this');
  return app;
}

function missingDocumentCodes(required: DocRequirement[], documents: { requirementCode: string; state: string }[]) {
  const available = new Set(documents.filter((doc) => doc.state === 'AVAILABLE').map((doc) => doc.requirementCode));
  return required.map((item) => item.code).filter((code) => !available.has(code));
}

async function refreshRequirements(tx: Prisma.TransactionClient, applicationId: string, required: DocRequirement[]) {
  const documents = await tx.applicationDocument.findMany({ where: { applicationId } });
  const met = missingDocumentCodes(required, documents).length === 0;
  await tx.application.update({ where: { id: applicationId }, data: { requirementsMet: met } });
  return met;
}

const submitDraft = z
  .object({
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    phone: z.string().trim().min(5).max(30),
    address: z.string().trim().min(5).max(300),
    previousSchool: z.string().trim().max(200).optional(),
    acknowledgedDeclarationCodes: z.array(z.string()).default([]),
  })
  .superRefine((draft, ctx) => {
    const [year, month, day] = draft.dateOfBirth.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Enter a real calendar date' });
    }
  });

function assertDeclarations(draft: Draft, declarations: Declaration[]) {
  const acknowledged = new Set(draft.acknowledgedDeclarationCodes ?? []);
  const missing = declarations.filter((item) => !acknowledged.has(item.code)).map((item) => item.code);
  if (missing.length > 0) {
    throw new HttpError(400, `Acknowledge these declarations: ${missing.join(', ')}`, 'declarations-missing');
  }
}

async function assertWindow(tx: Prisma.TransactionClient, app: ApplicationRecord, now: Date) {
  if (now >= app.intake.opensAt && now <= app.intake.closesAt) return;
  if (now < app.intake.opensAt) {
    throw new HttpError(409, 'This intake is not open yet.', 'not-open');
  }
  const extension = await tx.deadlineExtension.findFirst({
    where: { applicationId: app.id, expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
  });
  if (!extension) throw new HttpError(409, 'The intake deadline has passed.', 'deadline-closed');
}

function assertFeeForSubmit(app: ApplicationRecord) {
  const intake = app.intake;
  if ((app.feeStatus === 'CONFIRMED' || app.feeStatus === 'WAIVED') && intake.feeRequired) {
    const amountMatches = app.feeAmountSnapshot !== null && intake.feeAmount !== null && app.feeAmountSnapshot.equals(intake.feeAmount);
    if (!amountMatches || app.currencySnapshot !== intake.currency) {
      throw new HttpError(409, 'The verified fee does not match the current intake fee. Finance must reconcile it before submission.', 'fee-mismatch');
    }
  }
  if (intake.feeRequired && !intake.reviewBeforePayment && app.feeStatus !== 'CONFIRMED' && app.feeStatus !== 'WAIVED') {
    throw new HttpError(409, 'Payment is not confirmed yet. An uploaded receipt does not confirm payment.', 'payment-pending');
  }
}

async function commitSnapshot(
  tx: Prisma.TransactionClient,
  app: ApplicationRecord,
  actorId: string,
  action: 'application.submit' | 'application.resubmit',
) {
  const draft = asDraft(app.draft);
  const parsed = submitDraft.parse(draft);
  const declarations = asDeclarations(app.intake.declarations);
  assertDeclarations(parsed, declarations);
  const required = asDocRequirements(app.state === 'DRAFT' ? app.intake.requiredDocuments : (app.requiredDocuments ?? app.intake.requiredDocuments));
  const missing = missingDocumentCodes(required, app.documents);
  if (missing.length > 0) {
    throw new HttpError(400, `These documents are still missing or not accepted: ${missing.join(', ')}`, 'documents-incomplete');
  }

  const now = new Date();
  if (app.state === 'DRAFT') {
    await assertWindow(tx, app, now);
    assertFeeForSubmit(app);
  } else if (app.correctionDeadline && now > app.correctionDeadline) {
    throw new HttpError(409, 'The correction deadline has passed.', 'deadline-closed');
  }

  const reference = app.reference ?? (await nextNumber(tx, 'application', 'APP'));
  const feeRequired = app.state === 'DRAFT' ? app.intake.feeRequired : app.feeRequiredSnapshot;
  await tx.applicationSnapshot.create({
    data: {
      applicationId: app.id,
      revision: app.revision,
      ruleVersion: app.intake.ruleVersion,
      payload: jsonBody(parsed),
    },
  });
  const updated = await tx.application.update({
    where: { id: app.id },
    data: {
      state: 'SUBMITTED',
      reference,
      submittedAt: app.submittedAt ?? now,
      revision: { increment: 1 },
      ruleVersion: app.intake.ruleVersion,
      draft: jsonBody(parsed),
      requiredDocuments: app.state === 'DRAFT' ? jsonBody(asDocRequirements(app.intake.requiredDocuments)) : undefined,
      feeRequiredSnapshot: feeRequired,
      feeAmountSnapshot: app.state === 'DRAFT' ? app.intake.feeAmount : undefined,
      currencySnapshot: app.state === 'DRAFT' ? app.intake.currency : undefined,
      reviewBeforePayment: app.state === 'DRAFT' ? app.intake.reviewBeforePayment : undefined,
      feeStatus: !feeRequired && app.feeStatus === 'PENDING' ? 'NOT_REQUIRED' : undefined,
      assignedOfficerId: null,
      assignmentRevision: { increment: 1 },
      correctionFields: Prisma.JsonNull,
      correctionDeadline: null,
      correctionMessage: null,
      requirementsMet: true,
    },
    include: applicationInclude,
  });
  await audit(tx, actorId, action, 'Application', app.id, { reference, revision: app.revision });
  return updated;
}

export async function createApplication(applicantId: string, intakeId: string) {
  const intake = await prisma.intake.findUnique({ where: { id: intakeId } });
  if (!intake || !intake.isActive) throw new HttpError(404, 'Intake not found', 'not-found');
  const open = await prisma.application.findFirst({
    where: { applicantId, intakeId, state: { in: OPEN_STATES } },
  });
  if (open) {
    throw new HttpError(409, `You already have an open application for this intake (${open.id}). Resume that application.`, 'duplicate-application');
  }
  const created = await prisma.application.create({
    data: {
      applicantId,
      intakeId,
      programmeId: intake.programmeId,
      paymentReference: `FEE-${randomBytes(6).toString('hex').toUpperCase()}`,
      draft: {},
      feeRequiredSnapshot: intake.feeRequired,
      feeAmountSnapshot: intake.feeAmount,
      currencySnapshot: intake.currency,
      reviewBeforePayment: intake.reviewBeforePayment,
      feeStatus: intake.feeRequired ? 'PENDING' : 'NOT_REQUIRED',
      requiredDocuments: jsonBody(asDocRequirements(intake.requiredDocuments)),
    },
    include: applicationInclude,
  });
  await audit(prisma, applicantId, 'application.create', 'Application', created.id, { intakeId });
  return created;
}

const draftPatch = z.object({
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
  address: z.string().trim().min(1).max(300).optional(),
  previousSchool: z.string().trim().max(200).optional(),
  acknowledgedDeclarationCodes: z.array(z.string()).optional(),
});

export async function saveDraft(applicantId: string, applicationId: string, revision: number, patch: unknown) {
  const parsed = draftPatch.parse(patch);
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: applicationInclude });
  if (!app || app.applicantId !== applicantId) throw new HttpError(404, 'Application not found', 'not-found');
  if (app.state !== 'DRAFT' && app.state !== 'CORRECTION_REQUESTED') {
    throw new HttpError(409, 'This application cannot be edited in its current state.', 'state-conflict');
  }
  if (revision !== app.revision) {
    throw new HttpError(409, 'This application was saved somewhere else. Reload it and try again.', 'stale-revision');
  }
  if (app.state === 'CORRECTION_REQUESTED') {
    const allowed = new Set(asStringList(app.correctionFields));
    const current = asDraft(app.draft);
    for (const key of Object.keys(parsed) as (keyof typeof parsed)[]) {
      if (parsed[key] === undefined) continue;
      const changed = JSON.stringify(parsed[key]) !== JSON.stringify(current[key]);
      if (changed && !allowed.has(key)) {
        throw new HttpError(409, `You can only change the fields admissions asked for. '${key}' is not one of them.`, 'correction-limited');
      }
    }
  }
  const draft = { ...asDraft(app.draft), ...parsed };
  const data: Prisma.ApplicationUpdateInput = { draft: jsonBody(draft), revision: { increment: 1 } };
  if (app.state === 'DRAFT') {
    data.feeRequiredSnapshot = app.intake.feeRequired;
    data.feeAmountSnapshot = app.intake.feeAmount;
    data.currencySnapshot = app.intake.currency;
    data.reviewBeforePayment = app.intake.reviewBeforePayment;
    data.requiredDocuments = jsonBody(asDocRequirements(app.intake.requiredDocuments));
    if (app.feeStatus === 'PENDING' || app.feeStatus === 'NOT_REQUIRED') {
      data.feeStatus = app.intake.feeRequired ? 'PENDING' : 'NOT_REQUIRED';
    }
  }
  return prisma.application.update({ where: { id: app.id }, data, include: applicationInclude });
}

export async function addDocument(
  applicantId: string,
  applicationId: string,
  input: { requirementCode: string; fileName: string; contentType: string; bytes: Buffer },
) {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: applicationInclude });
  if (!app || app.applicantId !== applicantId) throw new HttpError(404, 'Application not found', 'not-found');
  if (app.state !== 'DRAFT' && app.state !== 'CORRECTION_REQUESTED') {
    throw new HttpError(409, 'Documents cannot be changed in the current state.', 'state-conflict');
  }
  const allowedTypes = asStringList(app.intake.allowedContentTypes);
  if (!allowedTypes.includes(input.contentType)) {
    throw new HttpError(400, 'This file type is not accepted for the intake.', 'file-type');
  }
  if (input.bytes.length > app.intake.maxDocumentBytes) {
    throw new HttpError(400, `The file is larger than the limit of ${app.intake.maxDocumentBytes} bytes.`, 'file-size');
  }
  const code = input.requirementCode.trim();
  const known = new Set(asDocRequirements(app.intake.requiredDocuments).map((item) => item.code));
  if (code !== 'PAYMENT_RECEIPT' && !known.has(code)) {
    throw new HttpError(400, 'This document is not required for the intake.', 'file-requirement');
  }
  if (app.state === 'CORRECTION_REQUESTED') {
    const allowed = new Set(asStringList(app.correctionFields));
    if (!allowed.has(`document:${code}`) && !allowed.has('documents')) {
      throw new HttpError(409, 'Admissions has not asked you to replace this document.', 'correction-limited');
    }
  }

  const matches = contentMatches(input.contentType, input.bytes);
  if (!matches) {
    await prisma.applicationDocument.create({
      data: {
        applicationId,
        requirementCode: code,
        fileName: safeFileName(input.fileName),
        contentType: input.contentType,
        byteSize: input.bytes.length,
        storageKey: newStorageKey(),
        state: 'REJECTED',
      },
    });
    throw new HttpError(400, 'The file content does not match the declared type, so it was not accepted.', 'file-rejected');
  }

  const storageKey = newStorageKey();
  await writeStored(storageKey, input.bytes);
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.applicationDocument.create({
        data: {
          applicationId,
          requirementCode: code,
          fileName: safeFileName(input.fileName),
          contentType: input.contentType,
          byteSize: input.bytes.length,
          storageKey,
          state: 'UPLOADED',
        },
      });
      await tx.applicationDocument.update({ where: { id: created.id }, data: { state: 'SCANNING' } });
      await tx.applicationDocument.update({ where: { id: created.id }, data: { state: 'AVAILABLE' } });
      if (code !== 'PAYMENT_RECEIPT') {
        await tx.applicationDocument.updateMany({
          where: { applicationId, requirementCode: code, state: 'AVAILABLE', id: { not: created.id } },
          data: { state: 'REJECTED' },
        });
      }
      const required = asDocRequirements(app.requiredDocuments ?? app.intake.requiredDocuments);
      await refreshRequirements(tx, applicationId, required);
      return tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: applicationInclude });
    });
  } catch (err) {
    await removeStored(storageKey);
    throw err;
  }
}

export async function submitApplication(applicantId: string, applicationId: string, idempotencyKey: string) {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: applicationInclude });
  if (!app || app.applicantId !== applicantId) throw new HttpError(404, 'Application not found', 'not-found');
  const hash = submissionHash('submit', app);
  const existing = await prisma.submissionIdempotency.findUnique({ where: { userId_key: { userId: applicantId, key: idempotencyKey } } });
  if (existing) return replay(existing, hash);
  if (app.state !== 'DRAFT') throw new HttpError(409, 'Only a draft can be submitted.', 'state-conflict');
  return runIdempotent(applicantId, idempotencyKey, hash, app.id, async (tx) => {
    const current = await tx.application.findUniqueOrThrow({ where: { id: app.id }, include: applicationInclude });
    if (current.state !== 'DRAFT') throw new HttpError(409, 'Only a draft can be submitted.', 'state-conflict');
    const updated = await commitSnapshot(tx, current, applicantId, 'application.submit');
    return { status: 201, body: present(updated, 'APPLICANT') };
  });
}

export async function resubmitApplication(applicantId: string, applicationId: string, idempotencyKey: string) {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: applicationInclude });
  if (!app || app.applicantId !== applicantId) throw new HttpError(404, 'Application not found', 'not-found');
  const hash = submissionHash('resubmit', app);
  const existing = await prisma.submissionIdempotency.findUnique({ where: { userId_key: { userId: applicantId, key: idempotencyKey } } });
  if (existing) return replay(existing, hash);
  if (app.state !== 'CORRECTION_REQUESTED') {
    throw new HttpError(409, 'Resubmission is only available after admissions asks for a correction.', 'state-conflict');
  }
  return runIdempotent(applicantId, idempotencyKey, hash, app.id, async (tx) => {
    const current = await tx.application.findUniqueOrThrow({ where: { id: app.id }, include: applicationInclude });
    if (current.state !== 'CORRECTION_REQUESTED') {
      throw new HttpError(409, 'Resubmission is only available after admissions asks for a correction.', 'state-conflict');
    }
    const updated = await commitSnapshot(tx, current, applicantId, 'application.resubmit');
    return { status: 200, body: present(updated, 'APPLICANT') };
  });
}

export async function withdrawApplication(applicantId: string, applicationId: string) {
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app || app.applicantId !== applicantId) throw new HttpError(404, 'Application not found', 'not-found');
  if (!WITHDRAW_STATES.includes(app.state)) {
    throw new HttpError(409, 'This application cannot be withdrawn.', 'state-conflict');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.application.updateMany({
      where: { id: applicationId, state: { in: WITHDRAW_STATES } },
      data: { state: 'WITHDRAWN' },
    });
    if (changed.count !== 1) throw new HttpError(409, 'This application cannot be withdrawn.', 'state-conflict');
    await audit(tx, applicantId, 'application.withdraw', 'Application', applicationId, { from: app.state });
    return tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: applicationInclude });
  });
  return updated;
}

export async function respondToOffer(applicantId: string, applicationId: string, decision: 'ACCEPT' | 'DECLINE') {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Application" WHERE id = ${applicationId} AND "applicantId" = ${applicantId} FOR UPDATE
    `;
    if (rows.length === 0) throw new HttpError(404, 'Application not found', 'not-found');
    const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: applicationInclude });
    if (app.state !== 'OFFERED') throw new HttpError(409, 'There is no open offer to answer.', 'state-conflict');
    const now = new Date();
    if (app.offerDeadline && now > app.offerDeadline) {
      await tx.application.update({ where: { id: app.id }, data: { state: 'EXPIRED' } });
      throw new HttpError(409, 'The offer deadline has passed.', 'deadline-closed');
    }
    const state = decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
    await audit(tx, applicantId, 'application.respond', 'Application', app.id, { decision });
    return tx.application.update({ where: { id: app.id }, data: { state }, include: applicationInclude });
  });
}

export async function claimApplication(officerId: string, applicationId: string, assignmentRevision: number) {
  const existing = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!existing) throw new HttpError(404, 'Application not found', 'not-found');
  if (existing.applicantId === officerId) throw new HttpError(403, 'You cannot review your own application');
  const claimed = await prisma.application.updateMany({
    where: { id: applicationId, assignmentRevision, state: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
    data: { assignedOfficerId: officerId, state: 'UNDER_REVIEW', assignmentRevision: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    throw new HttpError(409, 'Another reviewer updated this application. Reload it and try again.', 'stale-revision');
  }
  await audit(prisma, officerId, 'application.claim', 'Application', applicationId, {});
  return prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: applicationInclude });
}

export async function requestCorrection(
  officerId: string,
  applicationId: string,
  input: { fields: string[]; deadline: Date; message: string; internalNote?: string; assignmentRevision: number },
) {
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new HttpError(404, 'Application not found', 'not-found');
  if (app.applicantId === officerId) throw new HttpError(403, 'You cannot review your own application');
  if (app.state !== 'UNDER_REVIEW' || app.assignedOfficerId !== officerId) {
    throw new HttpError(409, 'Claim this application before requesting a correction.', 'state-conflict');
  }
  if (input.assignmentRevision !== app.assignmentRevision) {
    throw new HttpError(409, 'Another reviewer updated this application. Reload it and try again.', 'stale-revision');
  }
  const updated = await prisma.application.update({
    where: { id: applicationId },
    data: {
      state: 'CORRECTION_REQUESTED',
      correctionFields: jsonBody(input.fields),
      correctionDeadline: input.deadline,
      correctionMessage: input.message,
      assignmentRevision: { increment: 1 },
    },
    include: applicationInclude,
  });
  await audit(prisma, officerId, 'application.correction', 'Application', applicationId, {
    fields: input.fields,
    internalNote: input.internalNote ?? null,
  });
  return updated;
}

export async function decideApplication(
  officerId: string,
  applicationId: string,
  input: {
    kind: DecisionKind;
    outcome: Exclude<DecisionOutcome, 'REOPENED'>;
    reason: string;
    internalNote?: string;
    offerDeadline?: Date;
    conditions?: string;
    assignmentRevision: number;
  },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
    const app = await tx.application.findUnique({ where: { id: applicationId }, include: applicationInclude });
    if (!app) throw new HttpError(404, 'Application not found', 'not-found');
    if (app.applicantId === officerId) throw new HttpError(403, 'You cannot review your own application');
    if (app.state !== 'UNDER_REVIEW' || app.assignedOfficerId !== officerId) {
      throw new HttpError(409, 'Claim this application before recording a decision.', 'state-conflict');
    }
    if (input.assignmentRevision !== app.assignmentRevision) {
      throw new HttpError(409, 'Another reviewer updated this application. Reload it and try again.', 'stale-revision');
    }
    if (input.kind === 'REOPEN') throw new HttpError(400, 'Use the reopen action for a waitlisted application.');
    if (app.intake.secondApprovalRequired && input.kind === 'FINAL') {
      const recommendation = await tx.applicationDecision.findFirst({
        where: { applicationId, kind: 'RECOMMENDATION' },
        orderBy: { createdAt: 'desc' },
      });
      if (!recommendation || recommendation.actorId === officerId) {
        throw new HttpError(409, 'A different admissions officer must recommend this application before a final decision.', 'second-approval');
      }
    }
    if (input.outcome === 'OFFERED' && input.kind === 'FINAL') {
      if (!input.offerDeadline || input.offerDeadline <= new Date()) {
        throw new HttpError(400, 'An offer needs a response deadline in the future.');
      }
    }
    await tx.applicationDecision.create({
      data: {
        applicationId,
        kind: input.kind,
        outcome: input.outcome,
        reason: input.reason,
        internalNote: input.internalNote,
        actorId: officerId,
      },
    });
    const data: Prisma.ApplicationUpdateInput = { assignmentRevision: { increment: 1 } };
    if (input.kind === 'FINAL') {
      if (input.outcome === 'OFFERED') {
        data.state = 'OFFERED';
        data.offerDeadline = input.offerDeadline;
        data.offerConditions = input.conditions ?? null;
      } else if (input.outcome === 'WAITLISTED') {
        data.state = 'WAITLISTED';
      } else {
        data.state = 'REJECTED';
      }
    }
    await audit(tx, officerId, 'application.decision', 'Application', applicationId, {
      kind: input.kind,
      outcome: input.outcome,
    });
    return tx.application.update({ where: { id: applicationId }, data, include: applicationInclude });
  });
}

export async function reopenApplication(officerId: string, applicationId: string, reason: string) {
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new HttpError(404, 'Application not found', 'not-found');
  if (app.state !== 'WAITLISTED') throw new HttpError(409, 'Only a waitlisted application can be reopened.', 'state-conflict');
  return prisma.$transaction(async (tx) => {
    await tx.applicationDecision.create({
      data: { applicationId, kind: 'REOPEN', outcome: 'REOPENED', reason, actorId: officerId },
    });
    await audit(tx, officerId, 'application.reopen', 'Application', applicationId, {});
    return tx.application.update({
      where: { id: applicationId },
      data: { state: 'UNDER_REVIEW', assignedOfficerId: officerId, assignmentRevision: { increment: 1 } },
      include: applicationInclude,
    });
  });
}

export async function recordPaymentEvent(
  actorId: string,
  input: {
    reference: string;
    providerId: string;
    eventId: string;
    amount: Prisma.Decimal;
    currency: string;
    state: Exclude<ApplicationFeeStatus, 'NOT_REQUIRED' | 'PENDING'>;
    reason?: string;
  },
) {
  const existing = await prisma.applicationPaymentEvent.findUnique({
    where: { providerId_eventId: { providerId: input.providerId, eventId: input.eventId } },
  });
  if (existing) {
    const application = await prisma.application.findUniqueOrThrow({ where: { id: existing.applicationId }, include: applicationInclude });
    return { duplicate: true, application };
  }
  const app = await prisma.application.findUnique({ where: { paymentReference: input.reference }, include: { intake: true } });
  if (!app) throw new HttpError(404, 'No application matches that payment reference.', 'not-found');
  const expectedAmount = app.feeAmountSnapshot ?? app.intake.feeAmount;
  const expectedCurrency = app.currencySnapshot ?? app.intake.currency;
  if (!expectedAmount || !expectedCurrency || !expectedAmount.equals(input.amount) || expectedCurrency !== input.currency) {
    throw new HttpError(409, 'The payment amount or currency does not match the application fee.', 'fee-mismatch');
  }
  if ((input.state === 'WAIVED' || input.state === 'REFUNDED') && !input.reason) {
    throw new HttpError(400, 'A waiver or refund needs a reason.');
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.applicationPaymentEvent.create({
      data: {
        applicationId: app.id,
        providerId: input.providerId,
        eventId: input.eventId,
        reference: input.reference,
        amount: input.amount,
        currency: input.currency,
        state: input.state,
        reason: input.reason,
        actorId,
      },
    });
    await audit(tx, actorId, 'application.payment', 'Application', app.id, {
      providerId: input.providerId,
      eventId: input.eventId,
      state: input.state,
    });
    return tx.application.update({
      where: { id: app.id },
      data: { feeStatus: input.state },
      include: applicationInclude,
    });
  });
  return { duplicate: false, application: updated };
}

export async function convertApplication(registrarId: string, applicationId: string) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ state: ApplicationState; convertedStudentId: string | null; applicantId: string }>>`
      SELECT state, "convertedStudentId", "applicantId" FROM "Application" WHERE id = ${applicationId} FOR UPDATE
    `;
    if (locked.length === 0) throw new HttpError(404, 'Application not found', 'not-found');
    if (locked[0].convertedStudentId || locked[0].state === 'CONVERTED') {
      const current = await tx.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: { convertedStudent: true },
      });
      return {
        created: false,
        studentId: current.convertedStudentId,
        studentNumber: current.convertedStudent?.studentNumber ?? null,
        applicationId,
      };
    }
    if (locked[0].state !== 'ACCEPTED') {
      throw new HttpError(409, 'Only an accepted offer can be converted.', 'state-conflict');
    }
    const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: applicationInclude });
    if (app.feeRequiredSnapshot && app.feeStatus !== 'CONFIRMED' && app.feeStatus !== 'WAIVED') {
      throw new HttpError(409, 'Application fee is not verified.', 'payment-pending');
    }
    const existingStudent = await tx.student.findUnique({ where: { userId: app.applicantId } });
    if (existingStudent) {
      throw new HttpError(
        409,
        'This person already has a student record. Registry must reconcile the identity before a new student number is issued.',
        'identity-conflict',
      );
    }
    const draft = asDraft(app.draft);
    const studentNumber = await nextNumber(tx, 'student', 'STU');
    const student = await tx.student.create({
      data: {
        userId: app.applicantId,
        studentNumber,
        programmeId: app.programmeId,
        yearOfStudy: 1,
        phone: draft.phone,
        address: draft.address,
        dateOfBirth: draft.dateOfBirth ? new Date(`${draft.dateOfBirth}T00:00:00.000Z`) : undefined,
      },
    });
    await tx.user.update({ where: { id: app.applicantId }, data: { role: 'STUDENT' } });
    await tx.application.update({
      where: { id: app.id },
      data: { state: 'CONVERTED', convertedStudentId: student.id },
    });
    await audit(tx, registrarId, 'application.convert', 'Application', app.id, { studentId: student.id, studentNumber });
    return { created: true, studentId: student.id, studentNumber, applicationId };
  });
}

export async function listApplications(
  user: { id: string; role: Role },
  query: { intakeId?: string; programmeId?: string; state?: ApplicationState; requirementsMet?: boolean; page: number; pageSize: number },
) {
  const where: Prisma.ApplicationWhereInput = {
    intakeId: query.intakeId,
    programmeId: query.programmeId,
    state: query.state,
    requirementsMet: query.requirementsMet,
  };
  if (user.role === 'APPLICANT' || user.role === 'STUDENT') where.applicantId = user.id;
  else if (!STAFF_READ.includes(user.role)) throw new HttpError(403, 'You do not have permission to do this');
  const [items, total] = await Promise.all([
    prisma.application.findMany({
      where,
      include: applicationInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.application.count({ where }),
  ]);
  return { items: items.map((item) => present(item, user.role)), total, page: query.page, pageSize: query.pageSize };
}

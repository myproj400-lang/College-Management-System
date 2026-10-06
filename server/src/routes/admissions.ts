import { Router } from 'express';
import { ApplicationState, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { pagination } from '../lib/validation';
import { audit } from '../lib/audit';
import { config } from '../config';
import { readStored } from '../lib/admissions/files';
import {
  addDocument,
  asDeclarations,
  asDocRequirements,
  asStringList,
  claimApplication,
  convertApplication,
  createApplication,
  decideApplication,
  listApplications,
  loadVisible,
  present,
  recordPaymentEvent,
  reopenApplication,
  requestCorrection,
  respondToOffer,
  resubmitApplication,
  saveDraft,
  submitApplication,
  withdrawApplication,
} from '../lib/admissions/service';

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

const docRequirement = z.object({
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
});
const declaration = z.object({
  code: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(1000),
});

const intakeObject = z.object({
    programmeId: z.string().min(1),
    name: z.string().trim().min(2).max(160),
    opensAt: z.coerce.date(),
    closesAt: z.coerce.date(),
    timezone: z.string().trim().min(1).max(64),
    entryRequirements: z.string().trim().min(1).max(4000),
    feeInstructions: z.string().trim().min(1).max(2000),
    feeRequired: z.boolean(),
    reviewBeforePayment: z.boolean().default(false),
    feeAmount: z.number().positive().optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    requiredDocuments: z.array(docRequirement).max(20),
    declarations: z.array(declaration).max(20),
    maxDocumentBytes: z.number().int().min(1).max(config.maxDocumentBytes),
    allowedContentTypes: z.array(z.enum(ALLOWED_TYPES)).min(1),
    secondApprovalRequired: z.boolean().default(false),
  });

const intakeBody = intakeObject.superRefine((body, ctx) => {
    if (body.closesAt <= body.opensAt) {
      ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'The closing time must be after the opening time' });
    }
    if (body.feeRequired && (body.feeAmount === undefined || body.currency === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['feeAmount'], message: 'A required fee needs an amount and a currency' });
    }
  });

function intakeData(body: z.infer<typeof intakeBody>): Prisma.IntakeCreateInput {
  return {
    programme: { connect: { id: body.programmeId } },
    name: body.name,
    opensAt: body.opensAt,
    closesAt: body.closesAt,
    timezone: body.timezone,
    entryRequirements: body.entryRequirements,
    feeInstructions: body.feeInstructions,
    feeRequired: body.feeRequired,
    reviewBeforePayment: body.reviewBeforePayment,
    feeAmount: body.feeAmount,
    currency: body.currency,
    requiredDocuments: body.requiredDocuments,
    declarations: body.declarations,
    maxDocumentBytes: body.maxDocumentBytes,
    allowedContentTypes: body.allowedContentTypes,
    secondApprovalRequired: body.secondApprovalRequired,
  };
}

function presentIntake(intake: {
  id: string;
  name: string;
  opensAt: Date;
  closesAt: Date;
  timezone: string;
  entryRequirements: string;
  feeInstructions: string;
  feeRequired: boolean;
  reviewBeforePayment: boolean;
  feeAmount: Prisma.Decimal | null;
  currency: string | null;
  requiredDocuments: Prisma.JsonValue;
  declarations: Prisma.JsonValue;
  maxDocumentBytes: number;
  allowedContentTypes: Prisma.JsonValue;
  ruleVersion: number;
  isActive: boolean;
  programme: { id: string; code: string; name: string };
}) {
  return {
    id: intake.id,
    name: intake.name,
    opensAt: intake.opensAt,
    closesAt: intake.closesAt,
    timezone: intake.timezone,
    entryRequirements: intake.entryRequirements,
    feeInstructions: intake.feeInstructions,
    feeRequired: intake.feeRequired,
    reviewBeforePayment: intake.reviewBeforePayment,
    feeAmount: intake.feeAmount,
    currency: intake.currency,
    requiredDocuments: asDocRequirements(intake.requiredDocuments),
    declarations: asDeclarations(intake.declarations),
    maxDocumentBytes: intake.maxDocumentBytes,
    allowedContentTypes: asStringList(intake.allowedContentTypes),
    ruleVersion: intake.ruleVersion,
    isActive: intake.isActive,
    programme: intake.programme,
  };
}

const intakeInclude = { programme: { select: { id: true, code: true, name: true } } } as const;

export const publicAdmissionsRouter = Router();

publicAdmissionsRouter.get(
  '/intakes',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const intakes = await prisma.intake.findMany({
      where: { isActive: true, closesAt: { gt: now } },
      include: intakeInclude,
      orderBy: { opensAt: 'asc' },
    });
    res.json(intakes.map(presentIntake));
  }),
);

const router = Router();
const configureIntake = requireRole('ADMIN', 'ADMISSIONS_OFFICER');
const review = requireRole('ADMISSIONS_OFFICER');
const finance = requireRole('BURSAR');
const registry = requireRole('REGISTRAR');
const applicant = requireRole('APPLICANT', 'STUDENT');

router.get(
  '/intakes',
  configureIntake,
  asyncHandler(async (_req, res) => {
    const intakes = await prisma.intake.findMany({ include: intakeInclude, orderBy: { createdAt: 'desc' } });
    res.json(intakes.map(presentIntake));
  }),
);

router.post(
  '/intakes',
  configureIntake,
  asyncHandler(async (req, res) => {
    const body = intakeBody.parse(req.body);
    const programme = await prisma.programme.findUnique({ where: { id: body.programmeId } });
    if (!programme) throw new HttpError(400, 'Programme not found');
    const intake = await prisma.intake.create({ data: intakeData(body), include: intakeInclude });
    await audit(prisma, req.user!.id, 'intake.create', 'Intake', intake.id, { ruleVersion: intake.ruleVersion });
    res.status(201).json(presentIntake(intake));
  }),
);

router.patch(
  '/intakes/:id',
  configureIntake,
  asyncHandler(async (req, res) => {
    const body = intakeObject.partial().parse(req.body);
    const current = await prisma.intake.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, 'Intake not found', 'not-found');
    const merged = intakeBody.parse({
      programmeId: body.programmeId ?? current.programmeId,
      name: body.name ?? current.name,
      opensAt: body.opensAt ?? current.opensAt,
      closesAt: body.closesAt ?? current.closesAt,
      timezone: body.timezone ?? current.timezone,
      entryRequirements: body.entryRequirements ?? current.entryRequirements,
      feeInstructions: body.feeInstructions ?? current.feeInstructions,
      feeRequired: body.feeRequired ?? current.feeRequired,
      reviewBeforePayment: body.reviewBeforePayment ?? current.reviewBeforePayment,
      feeAmount: body.feeAmount ?? (current.feeAmount ? Number(current.feeAmount) : undefined),
      currency: body.currency ?? current.currency ?? undefined,
      requiredDocuments: body.requiredDocuments ?? asDocRequirements(current.requiredDocuments),
      declarations: body.declarations ?? asDeclarations(current.declarations),
      maxDocumentBytes: body.maxDocumentBytes ?? current.maxDocumentBytes,
      allowedContentTypes: body.allowedContentTypes ?? asStringList(current.allowedContentTypes),
      secondApprovalRequired: body.secondApprovalRequired ?? current.secondApprovalRequired,
    });
    const intake = await prisma.intake.update({
      where: { id: current.id },
      data: { ...intakeData(merged), ruleVersion: { increment: 1 } },
      include: intakeInclude,
    });
    await audit(prisma, req.user!.id, 'intake.update', 'Intake', intake.id, { ruleVersion: intake.ruleVersion });
    res.json(presentIntake(intake));
  }),
);

router.post(
  '/intakes/:id/extensions',
  review,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        applicationId: z.string().min(1),
        reason: z.string().trim().min(3).max(500),
        expiresAt: z.coerce.date(),
      })
      .parse(req.body);
    if (body.expiresAt <= new Date()) throw new HttpError(400, 'The extension must expire in the future.');
    const application = await prisma.application.findUnique({ where: { id: body.applicationId } });
    if (!application || application.intakeId !== req.params.id) throw new HttpError(404, 'Application not found', 'not-found');
    const extension = await prisma.deadlineExtension.create({
      data: {
        intakeId: req.params.id,
        applicationId: application.id,
        reason: body.reason,
        expiresAt: body.expiresAt,
        actorId: req.user!.id,
      },
    });
    await audit(prisma, req.user!.id, 'intake.extension', 'Application', application.id, { expiresAt: body.expiresAt.toISOString() });
    res.status(201).json({ id: extension.id, applicationId: extension.applicationId, expiresAt: extension.expiresAt });
  }),
);

router.post(
  '/applications',
  applicant,
  asyncHandler(async (req, res) => {
    const body = z.object({ intakeId: z.string().min(1) }).parse(req.body);
    const created = await createApplication(req.user!.id, body.intakeId);
    res.status(201).json(present(created, req.user!.role));
  }),
);

router.get(
  '/applications',
  asyncHandler(async (req, res) => {
    const query = pagination
      .extend({
        intakeId: z.string().optional(),
        programmeId: z.string().optional(),
        state: z.nativeEnum(ApplicationState).optional(),
        requirementsMet: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    res.json(
      await listApplications(req.user!, {
        ...query,
        requirementsMet: query.requirementsMet === undefined ? undefined : query.requirementsMet === 'true',
      }),
    );
  }),
);

router.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const app = await loadVisible(req.user!, req.params.id);
    res.json(present(app, req.user!.role));
  }),
);

router.patch(
  '/applications/:id',
  applicant,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        revision: z.number().int(),
        dateOfBirth: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        previousSchool: z.string().optional(),
        acknowledgedDeclarationCodes: z.array(z.string()).optional(),
      })
      .parse(req.body);
    const { revision, ...patch } = body;
    const saved = await saveDraft(req.user!.id, req.params.id, revision, patch);
    res.json(present(saved, req.user!.role));
  }),
);

router.post(
  '/applications/:id/documents',
  applicant,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        requirementCode: z.string().trim().min(1).max(40),
        fileName: z.string().trim().min(1).max(120),
        contentType: z.enum(ALLOWED_TYPES),
        contentBase64: z.string().min(1),
      })
      .parse(req.body);
    const bytes = Buffer.from(body.contentBase64, 'base64');
    if (bytes.length === 0) throw new HttpError(400, 'The file is empty.', 'file-empty');
    const saved = await addDocument(req.user!.id, req.params.id, { ...body, bytes });
    res.status(201).json(present(saved, req.user!.role));
  }),
);

router.get(
  '/applications/:id/documents/:documentId',
  asyncHandler(async (req, res) => {
    const app = await loadVisible(req.user!, req.params.id);
    const document = app.documents.find((item) => item.id === req.params.documentId);
    if (!document || document.state !== 'AVAILABLE') throw new HttpError(404, 'Document not found', 'not-found');
    const bytes = await readStored(document.storageKey);
    res.setHeader('Content-Type', document.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
    res.send(bytes);
  }),
);

function idempotencyKey(req: { get(name: string): string | undefined }) {
  const key = req.get('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 80) {
    throw new HttpError(400, 'Send an Idempotency-Key header between 8 and 80 characters.', 'idempotency-key');
  }
  return key;
}

router.post(
  '/applications/:id/submit',
  applicant,
  asyncHandler(async (req, res) => {
    const result = await submitApplication(req.user!.id, req.params.id, idempotencyKey(req));
    res.status(result.status).json(result.body);
  }),
);

router.post(
  '/applications/:id/resubmit',
  applicant,
  asyncHandler(async (req, res) => {
    const result = await resubmitApplication(req.user!.id, req.params.id, idempotencyKey(req));
    res.status(result.status).json(result.body);
  }),
);

router.post(
  '/applications/:id/withdraw',
  applicant,
  asyncHandler(async (req, res) => {
    const updated = await withdrawApplication(req.user!.id, req.params.id);
    res.json(present(updated, req.user!.role));
  }),
);

router.post(
  '/applications/:id/respond',
  applicant,
  asyncHandler(async (req, res) => {
    const body = z.object({ decision: z.enum(['ACCEPT', 'DECLINE']) }).parse(req.body);
    const updated = await respondToOffer(req.user!.id, req.params.id, body.decision);
    res.json(present(updated, req.user!.role));
  }),
);

router.post(
  '/applications/:id/claim',
  review,
  asyncHandler(async (req, res) => {
    const body = z.object({ assignmentRevision: z.number().int() }).parse(req.body);
    const updated = await claimApplication(req.user!.id, req.params.id, body.assignmentRevision);
    res.json(present(updated, req.user!.role));
  }),
);

router.post(
  '/applications/:id/corrections',
  review,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        fields: z.array(z.string().trim().min(1)).min(1),
        deadline: z.coerce.date(),
        message: z.string().trim().min(1).max(1000),
        internalNote: z.string().trim().max(2000).optional(),
        assignmentRevision: z.number().int(),
      })
      .parse(req.body);
    if (body.deadline <= new Date()) throw new HttpError(400, 'The correction deadline must be in the future.');
    const updated = await requestCorrection(req.user!.id, req.params.id, body);
    res.json(present(updated, req.user!.role));
  }),
);

router.post(
  '/applications/:id/decisions',
  review,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        kind: z.enum(['RECOMMENDATION', 'FINAL']),
        outcome: z.enum(['OFFERED', 'WAITLISTED', 'REJECTED']),
        reason: z.string().trim().min(1).max(2000),
        internalNote: z.string().trim().max(2000).optional(),
        offerDeadline: z.coerce.date().optional(),
        conditions: z.string().trim().max(2000).optional(),
        assignmentRevision: z.number().int(),
      })
      .parse(req.body);
    const updated = await decideApplication(req.user!.id, req.params.id, body);
    res.json(present(updated, req.user!.role));
  }),
);

router.post(
  '/applications/:id/reopen',
  review,
  asyncHandler(async (req, res) => {
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const updated = await reopenApplication(req.user!.id, req.params.id, body.reason);
    res.json(present(updated, req.user!.role));
  }),
);

router.post(
  '/applications/:id/convert',
  registry,
  asyncHandler(async (req, res) => {
    const result = await convertApplication(req.user!.id, req.params.id);
    res.status(result.created ? 201 : 200).json(result);
  }),
);

router.post(
  '/payments/events',
  finance,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        reference: z.string().trim().min(4).max(80),
        providerId: z.string().trim().min(2).max(80),
        eventId: z.string().trim().min(2).max(120),
        amount: z.number().positive(),
        currency: z.string().trim().length(3).toUpperCase(),
        state: z.enum(['CONFIRMED', 'FAILED', 'WAIVED', 'REFUNDED']),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .parse(req.body);
    const result = await recordPaymentEvent(req.user!.id, { ...body, amount: new Prisma.Decimal(body.amount) });
    res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      feeStatus: result.application.feeStatus,
      applicationId: result.application.id,
    });
  }),
);

export default router;

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'APPLICANT';
ALTER TYPE "Role" ADD VALUE 'ADMISSIONS_OFFICER';

-- CreateEnum
CREATE TYPE "ApplicationState" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUESTED', 'OFFERED', 'WAITLISTED', 'REJECTED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DocumentState" AS ENUM ('INITIATED', 'UPLOADED', 'SCANNING', 'AVAILABLE', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApplicationFeeStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'FAILED', 'WAIVED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('RECOMMENDATION', 'FINAL', 'REOPEN');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('OFFERED', 'WAITLISTED', 'REJECTED', 'REOPENED');

-- CreateTable
CREATE TABLE "Intake" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "entryRequirements" TEXT NOT NULL,
    "feeInstructions" TEXT NOT NULL,
    "feeRequired" BOOLEAN NOT NULL,
    "reviewBeforePayment" BOOLEAN NOT NULL DEFAULT false,
    "feeAmount" DECIMAL(12,2),
    "currency" TEXT,
    "requiredDocuments" JSONB NOT NULL,
    "declarations" JSONB NOT NULL,
    "maxDocumentBytes" INTEGER NOT NULL,
    "allowedContentTypes" JSONB NOT NULL,
    "secondApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "state" "ApplicationState" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reference" TEXT,
    "paymentReference" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "ruleVersion" INTEGER,
    "draft" JSONB NOT NULL,
    "requiredDocuments" JSONB,
    "feeStatus" "ApplicationFeeStatus" NOT NULL DEFAULT 'PENDING',
    "feeAmountSnapshot" DECIMAL(12,2),
    "currencySnapshot" TEXT,
    "feeRequiredSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "reviewBeforePayment" BOOLEAN NOT NULL DEFAULT false,
    "assignmentRevision" INTEGER NOT NULL DEFAULT 0,
    "assignedOfficerId" TEXT,
    "offerDeadline" TIMESTAMP(3),
    "offerConditions" TEXT,
    "correctionFields" JSONB,
    "correctionDeadline" TIMESTAMP(3),
    "correctionMessage" TEXT,
    "convertedStudentId" TEXT,
    "requirementsMet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSnapshot" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "requirementCode" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "state" "DocumentState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDecision" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "DecisionKind" NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "internalNote" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationPaymentEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "state" "ApplicationFeeStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadlineExtension" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadlineExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionIdempotency" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceCounter" (
    "name" TEXT NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "ReferenceCounter_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "ContactVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "deliveryStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Application_reference_key" ON "Application"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Application_paymentReference_key" ON "Application"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "Application_convertedStudentId_key" ON "Application"("convertedStudentId");

-- CreateIndex
CREATE INDEX "Application_applicantId_idx" ON "Application"("applicantId");

-- CreateIndex
CREATE INDEX "Application_state_intakeId_idx" ON "Application"("state", "intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationSnapshot_applicationId_revision_key" ON "ApplicationSnapshot"("applicationId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationDocument_storageKey_key" ON "ApplicationDocument"("storageKey");

-- CreateIndex
CREATE INDEX "ApplicationDocument_applicationId_requirementCode_idx" ON "ApplicationDocument"("applicationId", "requirementCode");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationPaymentEvent_providerId_eventId_key" ON "ApplicationPaymentEvent"("providerId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionIdempotency_userId_key_key" ON "SubmissionIdempotency"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ContactVerification_userId_key" ON "ContactVerification"("userId");

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_convertedStudentId_fkey" FOREIGN KEY ("convertedStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSnapshot" ADD CONSTRAINT "ApplicationSnapshot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDocument" ADD CONSTRAINT "ApplicationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDecision" ADD CONSTRAINT "ApplicationDecision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDecision" ADD CONSTRAINT "ApplicationDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationPaymentEvent" ADD CONSTRAINT "ApplicationPaymentEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationPaymentEvent" ADD CONSTRAINT "ApplicationPaymentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineExtension" ADD CONSTRAINT "DeadlineExtension_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineExtension" ADD CONSTRAINT "DeadlineExtension_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineExtension" ADD CONSTRAINT "DeadlineExtension_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactVerification" ADD CONSTRAINT "ContactVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed reference sequences used by application numbers and converted student numbers.
INSERT INTO "ReferenceCounter" ("name", "next") VALUES ('application', 1), ('student', 1);

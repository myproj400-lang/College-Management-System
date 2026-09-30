# Requirements register

Integrated College Management System. Phase 1 planning record.

| Item | Value |
|---|---|
| Baseline | ICMS CRS 001 v1.0 and ICMS SRS 001 v1.0, 26 September 2026 |
| Baseline status in the documents | Proposed. Signature blocks are blank |
| Accepted for planning | Yes, by Alhaji Mohamed Wurie Bah on 30 September 2026 (decision DL-01) |
| Codebase | `main` at `307a6b7` (decision DL-02) |
| Branch | `alhaji/requirements-review` |
| Register status | Draft for Brima Conteh’s review |

Every row below is **proposed**. A related screen or API on `main` does not verify a requirement. “Partial” means some behaviour on `main` overlaps the requirement and still has to be reconciled. “Conflict” means current behaviour must not be treated as the approved rule. “Absent” means `main` has no corresponding workflow.

Collaboration phases name the lead. CRS releases name the product increment. That mapping is decision DL-11 and is still open. Until it is agreed, do not start a later release because an earlier collaboration phase feels finished.

Security, audit, integrity, and the applicable service targets apply in every release. They are not deferred to Phase 12 or Phase 13.

## Release map

| CRS release | Contents | Collaboration lead |
|---|---|---|
| 1 Foundation and admissions | IAM, APP, ADM, STU, application-fee states | Brima: identity (Phase 3). Alhaji: applications and admissions (Phase 4). Alhaji: student master record (part of Phase 5) |
| 2 Academic learning | ACA, LMS except discussions | Alhaji: registration (Phase 5). Brima: learning (Phase 6). Alhaji verifies enrolment and classroom access |
| 3 Results | RES, GRD | Brima: assessment (Phase 8). Alhaji verifies calculations and approval. Alhaji: publication (Phase 9) |
| 4 Attendance and agreed support | ATT, notifications, reports, and any included Should items | Alhaji: lecturer attendance (Phase 7) and notifications (Phase 10). Brima: reporting (Phase 11) |

## Identity and accounts

Brima Conteh leads Phase 3. Alhaji reviews authentication and permissions. CRS release 1.

| SRS | Requirement | CRS | Priority | Main at 307a6b7 | Status |
|---|---|---|---|---|---|
| SRS-001 | One person identity, separate account, several applications without duplicating the person | IAM-01, STU-01 | M | Partial. `User` is the account. No separate Person. Email is unique | Proposed |
| SRS-002 | Role grant with scope, dates, grantor, and revocation on the next request | IAM-01 | M | Absent. One `Role` on `User` | Proposed |
| SRS-003 | Invited, active, suspended, and deactivated accounts. Suspension revokes sessions and keeps academic records | IAM-02 | M | Partial. `isActive` only. No invited state | Proposed |
| SRS-004 | Contact verification before activation. Single-use expiring recovery proof. Student numbers are not reset secrets | APP-01, SEC-01 | M | Absent | Proposed |
| SRS-005 | Adaptive password hash, MFA for privileged roles, throttling, neutral unknown-account responses, no secrets in logs | SEC-01, SEC-02 | M | Partial. bcrypt and login rate limiting exist. MFA is absent | Proposed |
| SRS-006 | Idle and absolute session expiry, logout, server-side revocation, step-up for sensitive actions | SEC-02 | M | Partial. JWT login exists. Idle expiry, revocation, and step-up are not established | Proposed |

## Applications and admissions

Alhaji Mohamed Wurie Bah leads Phase 4. Brima reviews the applicant-to-student transition. CRS release 1. Payment confirmation is SRS-048, also led here.

| SRS | Requirement | CRS | Priority | Main at 307a6b7 | Status |
|---|---|---|---|---|---|
| SRS-007 | Draft save with revision. A stale save conflicts. Owner and admissions staff only | APP-01 | M | Absent | Proposed |
| SRS-008 | Published intake rules. A submission stores an immutable rule version and value snapshot | APP-02 | M | Absent | Proposed |
| SRS-009 | Server validation, field errors, retained valid input, declarations, deadline unless an audited extension exists | APP-03 | M | Absent | Proposed |
| SRS-010 | File states: initiated, uploaded, scanning, available, rejected. Only available files count | APP-04 | M | Absent | Proposed |
| SRS-011 | One submission reference and timestamp per successful commit. Same idempotency key returns the same receipt | APP-05 | M | Absent | Proposed |
| SRS-012 | Applicant status separate from internal notes. Correction creates a new snapshot and keeps the old one | APP-07 | M | Absent | Proposed |
| SRS-013 | Scoped review queues. A conflicting claim does not overwrite the other officer | ADM-01 | M | Absent | Proposed |
| SRS-014 | Recommended and final decisions are separate. Final decision needs delegated authority, actor, reason, and time | ADM-02 | M | Absent | Proposed |
| SRS-015 | Offer and decision documents from an approved template. Internal comments stay off the applicant document | ADM-03 | M | Absent | Proposed |
| SRS-016 | Convert an accepted eligible offer once. Retry returns the same student. An existing person stops for registry reconciliation | ADM-04 | M | Absent | Proposed |
| SRS-048 | Payment attempt separate from verified fee satisfaction. Match provider, reference, amount, and currency. Pending, confirmed, failed, waived, refunded | APP-06, SUP-02 | M | Conflict. `FeeInvoice` and `Payment` are student billing with local receipts, not verified application fees | Proposed |

## Student records and registration

Alhaji Mohamed Wurie Bah leads Phase 5. Brima reviews shared academic records and the admitted-applicant handoff.

Student master data is CRS release 1. Academic registration is CRS release 2. Both are Phase 5, but they are not the same release.

| SRS | Requirement | CRS | Priority | Release | Main at 307a6b7 | Status |
|---|---|---|---|---|---|---|
| SRS-017 | Programme, admission year, status, and identity history. Students may edit contact details only. Staff changes need a reason and keep prior values | STU-01, STU-02 | M | 1 | Partial. `Student` has number, programme, status, phone, and address. No field history. No separate legal-identity control | Proposed |
| SRS-018 | Effective-dated status. Duplicate suspects go to registry. A merge is reversible. Name similarity never auto-merges | STU-03, STU-04 | M | 1 | Partial. Status is active, suspended, withdrawn, or graduated. No deferred or completed. No duplicate queue | Proposed |
| SRS-019 | Versioned programmes, courses, credits, periods, and policy references. Retire referenced rows. Do not recalculate old results | ACA-01 | M | 2 | Partial. Department, programme, course, and term exist. Delete routes exist. No policy version | Proposed |
| SRS-020 | Unique offering for course, period, and section. Lecturer reassignment changes access and keeps historic authorship | ACA-02 | M | 2 | Conflict. `Course.lecturerId` mixes definition and delivery | Proposed |
| SRS-021 | Server checks for status, prerequisites, credit limit, holds, and window. An override records rule, actor, reason, and scope | ACA-03 | M | 2 | Partial. Prerequisites, window, credit limit, and `override: true` exist. Overdue-fee hold follows the current billing model | Proposed |
| SRS-022 | Approved enrolment grants classroom access. Withdrawal blocks new work immediately. No duplicate enrolment on retry | ACA-04 | M | 2 | Absent. No classroom. The 60-second propagation figure is a proposed SRS detail, not a signed target | Proposed |
| SRS-023 | Detect lecturer and room overlaps. Substitution keeps the original session and links the replacement | ACA-05 | M | 2 | Partial. Weekly `ClassSession` clash checks exist. No substitution history | Proposed |
| SRS-024 | Add, drop, deferral, and repeat, each with its own enrolment for a repeated attempt | ACA-06 | M | 2 | Partial. Enrol and drop exist. Repeat policy is not modelled | Proposed |

## Learning

Brima Conteh leads Phase 6. Alhaji verifies enrolment, classroom access, lecturer assignment, and submissions. CRS release 2. SRS-029 stays out until D-08.

| SRS | Requirement | CRS | Priority | Main at 307a6b7 | Status |
|---|---|---|---|---|---|
| SRS-025 | One classroom per offering. A guessed URL does not bypass enrolment or assignment | LMS-01 | M | Absent | Proposed |
| SRS-026 | Draft, scheduled, published, and archived resources. Students cannot open unreleased files | LMS-02 | M | Absent | Proposed |
| SRS-027 | Announcements for one offering and audience, with revision history. External links are labelled | LMS-02, SUP-01 | M | Partial. `Announcement` is global, by role, or by programme. Not per offering | Proposed |
| SRS-028 | Archive an offering. Copying materials excludes submissions, marks, private feedback, and student discussion | LMS-07 | M | Absent | Proposed |
| SRS-029 | Moderated discussion. Disabled if the release does not include it | LMS-08 | S | Absent. Not included until D-08 | Proposed |
| SRS-030 | Assignment instructions, file types, maximum mark, due time, late policy, and attempts. Later changes are versioned | LMS-03 | M | Absent | Proposed |
| SRS-031 | Receipt only after the submission and accepted files commit. A failed transfer stays a draft | LMS-04 | M | Absent | Proposed |
| SRS-032 | Keep permitted attempts, name the attempt that is marked, compute lateness from server time. A retry does not add an attempt | LMS-04 | M | Absent | Proposed |
| SRS-033 | Private draft and released feedback. Classroom marks are not official results | LMS-05 | M | Absent | Proposed |
| SRS-034 | Quiz attempt bound to the delivered question version. Only approved objective rules are auto-scored | LMS-06 | M | Absent | Proposed |
| SRS-035 | Interrupted quiz resumes only inside the server deadline. Reopening a closed attempt needs authority and a reason | LMS-06 | M | Absent | Proposed |

## Assessment, grading, and publication

Brima Conteh leads Phase 8 (mark entry, approval, and grading rules). Alhaji verifies the calculations and the approval workflow, and leads Phase 9 (publication and correction). CRS release 3. Do not activate a scale until D-04 is signed. The constants in `server/src/lib/grading.ts` are not that signature.

| SRS | Requirement | CRS | Priority | Lead | Main at 307a6b7 | Status |
|---|---|---|---|---|---|---|
| SRS-036 | Marks only for a valid enrolment and component, as a decimal or an approved exception code. Incomplete sheets do not submit | RES-01 | M | Brima | Conflict. One coursework score, exam score, and final score on `Enrollment`. No component or exception code | Proposed |
| SRS-037 | Preview a learning-mark or file import. Record the source attempt. Import does not publish | RES-01, INT-03 | M | Brima | Absent | Proposed |
| SRS-038 | Lock a submitted revision. Approval binds to that revision. A return needs reasons. A new edit invalidates the old approval | RES-02 | M | Brima | Absent. No mark-sheet revision | Proposed |
| SRS-039 | Publish a complete authorised batch atomically. Students cannot see a partial cohort | RES-03 | M | Alhaji | Conflict. `resultsPublishedAt` publishes a whole term | Proposed |
| SRS-040 | A student receives only their own published results. A slip shows version and is not an official transcript | RES-03, SUP-06 | M | Alhaji | Partial. Students see marks only after the term flag is set. No result version or slip | Proposed |
| SRS-041 | A correction keeps the published version and adds an approved successor | RES-04 | M | Alhaji | Absent. Amendments overwrite the enrolment scores | Proposed |
| SRS-042 | Bind offering and result to approved weights, intervals, points, inclusion, and rounding. Incomplete policy blocks publication | GRD-01 | M | Brima, Alhaji verifies | Conflict. Fixed bands in `grading.ts` | Proposed |
| SRS-043 | Decimal GPA from credits and points. Store enough evidence to reproduce the result. A zero credit total is “Not applicable” | GRD-02 | M | Brima, Alhaji verifies | Partial. `computeGpa` exists and is not bound to a policy version | Proposed |
| SRS-044 | Absent, incomplete, withheld, exempted, withdrawn, and deferred are distinct codes with explicit GPA effects. Missing is not zero | GRD-03 | M | Brima, Alhaji verifies | Absent | Proposed |
| SRS-045 | Keep every attempt. Apply the approved repeat rule. An appeal uses the correction workflow | GRD-04 | M | Brima, Alhaji verifies | Absent | Proposed |

The mark originator cannot be the only final approver or publisher. That separation is in the SRS permission model and applies to SRS-038 and SRS-039.

## Lecturer attendance

Alhaji Mohamed Wurie Bah leads Phase 7. Brima reviews permissions, corrections, and links to lecturer and course records. CRS release 4. Student attendance is not part of this lead until D-08 includes SRS-051.

| SRS | Requirement | CRS | Priority | Main at 307a6b7 | Status |
|---|---|---|---|---|---|
| SRS-046 | Workplace presence and teaching delivery are separate. A teaching record references the session, lecturer or substitute, topic, mode, check-in, check-out, and outcome | ATT-01, ATT-02 | M | Absent | Proposed |
| SRS-047 | Flag missing check-outs, overlaps, late records, and unsupported sessions. Corrections keep the original. Reports separate delivered, cancelled, substituted, and unresolved | ATT-03, ATT-05 | M | Absent | Proposed |
| ATT-04 | QR or location evidence only if the attendance policy selects it. Replay must not duplicate a record. No continuous tracking | ATT-04 | M, conditional | Absent | Proposed |
| SRS-051 | Lecturers may record student attendance for assigned sessions. The student sees only their own history | SUP-05 | S | Conflict. Student `AttendanceRecord` is already implemented. It is not accepted scope until D-08 | Proposed |

No attendance action deducts salary or issues a disciplinary sanction.

## Notifications, reports, and optional records

| SRS | Requirement | CRS | Priority | Lead | Main at 307a6b7 | Status |
|---|---|---|---|---|---|---|
| SRS-049 | Commit the business event, then queue notice delivery. Deduplicate. External messages omit grades and document contents. A mail failure does not undo the academic action | SUP-01 | M | Alhaji, Phase 10. Brima supports event integration | Partial. Notices exist. No delivery queue tied to a committed event | Proposed |
| SRS-050 | Reports and exports use the same permissions as screens, state filters and generation time, neutralise spreadsheet formulas, and recheck access when a job runs | SUP-03, SUP-04 | M | Brima, Phase 11. Alhaji checks figures against source records | Partial. Summary, course results, and probation reports exist. Export controls are not established | Proposed |
| SRS-052 | Transcript request, approval, issue, and revocation use published result versions | SUP-06 | S | Unassigned until D-08 | Absent. Not included | Proposed |

## Shared data, interfaces, privacy, and release controls

These are not a separate product release. Brima leads architecture (Phase 2) and security (Phase 12). Alhaji checks access restrictions and backup recovery, and leads testing (Phase 13) and pilot acceptance (Phase 14). Brima leads production deployment (Phase 15). Alhaji leads guides, training, and operational acceptance in that phase.

| SRS | Requirement | CRS | Priority | Main at 307a6b7 | Status |
|---|---|---|---|---|---|
| SRS-053 | Immutable internal ids, required parents, and uniqueness. No orphan enrolments, submissions, results, or teaching records | DAT-01 | M | Partial. Current tables use ids and foreign keys. The admissions and learning graph is absent | Proposed |
| SRS-054 | Creation, modification, and decision metadata, plus the policy version used. Published results link to components, credits, approvals, and predecessors | DAT-02 | M | Partial. `AuditLog` records some changes. No result lineage | Proposed |
| SRS-055 | Approved retention by record class. Holds stop disposal. Disposal includes private files | DAT-03 | M | Absent | Proposed |
| SRS-056 | Every change rechecks actor, scope, state, schema, and policy on the server. Client totals are untrusted | INT-01 | M | Partial. Existing routes check the server. Future modules must do the same | Proposed |
| SRS-057 | Authenticate provider callbacks. Timeout and retry safe operations only. An outage leaves internal records committed | INT-02 | M | Absent. No payment or mail provider is selected (D-07) | Proposed |
| SRS-058 | Approved import mapping, preview, per-row outcomes, and a documented retry or rollback | INT-03 | M | Absent | Proposed |
| SRS-059 | The interface distinguishes draft, submitted, awaiting review, and published, and shows the server receipt | APP-05, LMS-04, RES-03 | M | Absent. No web client in this repository | Proposed |
| SRS-060 | Core tasks at 360-pixel width, 200% zoom, and keyboard only. Errors name the field. Status is not colour alone | NFR-06 | M | Absent. No web client | Proposed |
| SRS-061 | Show save and upload state. Keep a recoverable draft. Show file limits before upload. Full offline use is out of scope | NFR-07 | M | Absent. No web client | Proposed |
| SRS-062 | Protect traffic, sensitive storage, and backups. Private files. Secrets stay out of source and ordinary logs | SEC-03 | M | Partial. Passwords are hashed. `.env.example` has placeholders. Backup protection is not demonstrated | Proposed |
| SRS-063 | Audit authentication, role changes, decisions, marks, publication, attendance corrections, and sensitive exports. Ordinary roles cannot change audit rows | SEC-04 | M | Partial. `AuditLog` is written by the application. Database tamper detection is not established | Proposed |
| SRS-064 | Collect approved fields only, show privacy notices, and support authorised correction and disposal | SEC-05 | M | Absent until D-06 | Proposed |
| SRS-065 | Separate production and test data. Record emergency access. Do not copy production data into test without an approved process | SEC-06 | M | Partial. Tests can use a throwaway database. Production isolation is not demonstrated | Proposed |
| SRS-066 | 95% of ordinary record requests within 2 seconds at 200 concurrent users, over 30 minutes | NFR-01 | M | Absent. Not measured. Target itself awaits D-09 | Proposed |
| SRS-067 | Dataset of 5,000 students, 300 staff, and 3 academic years | NFR-02 | M | Absent. Not measured | Proposed |
| SRS-068 | 99.5% monthly availability excluding agreed maintenance | NFR-03 | M | Absent. Not measured | Proposed |
| SRS-069 | Recovery point within 24 hours and core service restored within 8 hours in a drill | NFR-04 | M | Absent. Not drilled | Proposed |
| SRS-070 | Confirmed applications, conversions, submissions, and publications are not lost or duplicated when a response is interrupted | NFR-05 | M | Absent for those workflows. They do not exist on `main` yet | Proposed |
| SRS-071 | At least 90% of pilot users complete agreed tasks without a facilitator | NFR-08 | M | Absent. Alhaji leads the pilot in Phase 14 | Proposed |
| SRS-072 | Trial import with counts and a signed comparison before cutover | INT-03, CRS delivery | M | Absent | Proposed |
| SRS-073 | Institution, period, upload, session, and notification settings change without a code edit, and those changes are audited | ACA-01, SEC-06 | M | Partial. Some limits are columns or code constants, including the grading scale | Proposed |
| SRS-074 | Operators can see health, job backlog, and provider failure without private academic content in the alert | NFR-03, SEC-06 | M | Partial. A health route exists. Job and provider alerts do not | Proposed |
| SRS-075 | Release with environment separation, schema check, backup checkpoint, and a rollback plan that keeps committed transactions | SEC-06, CRS delivery | M | Partial. Prisma migrations exist for the current schema. No release drill | Proposed |
| SRS-076 | Handover includes deploy steps, configuration, restore, role guides, schemas, test evidence, and known issues | CRS delivery | M | Partial. `README.md` covers local setup of the current API | Proposed |
| SRS-077 | Every approved requirement has an executed test or inspection, or an explicit deferral | CRS acceptance | M | Partial. `server/tests/api.test.ts` covers the current API, not this register | Proposed |
| SRS-078 | A release passes its Must requirements and has no open critical or high defect on access, integrity, or core workflows | CRS acceptance | M | Not started. No release has been offered for acceptance | Proposed |

## Verification families

These families are defined by the SRS. None have been executed against this baseline.

| Family | Covers |
|---|---|
| T01 | SRS-001 to SRS-006 |
| T02 | SRS-007 to SRS-012 |
| T03 | SRS-013 to SRS-018 |
| T04 | SRS-019 to SRS-024 |
| T05 | SRS-025 to SRS-029 |
| T06 | SRS-030 to SRS-035 |
| T07 | SRS-036 to SRS-041 |
| T08 | SRS-042 to SRS-045, after signed expected results exist |
| T09 | SRS-046, SRS-047, and SRS-051 if included |
| T10 | SRS-048 to SRS-050, and SRS-052 if included |
| T11 | SRS-053 to SRS-055 |
| T12 | SRS-056 to SRS-058 |
| T13 | SRS-059 to SRS-061 and SRS-071 |
| T14 | SRS-062 to SRS-065 |
| T15 | SRS-066 to SRS-070 |
| T16 | SRS-072 to SRS-076 |
| T17 | SRS-077 and SRS-078 |

## What this register does not authorise

Phase 2 has not started. No schema, route, or grading change is authorised by this document. Should items SRS-029, SRS-051, and SRS-052 stay deferred until D-08. The next step is Brima’s review of this draft.

# Integrated College Management System (ICMS)

One connected platform for online applications and admissions, student
records, learning management, academic result processing and lecturer
attendance — for a single college, prepared for Brima Conteh and Alhaji
M.W. Bah.

**Status: requirements and planning stage. No application code exists yet.**
This workspace currently holds the governing project documents only.

## Governing documents

All authoritative requirements live in [`docs/`](docs):

| File | Version | Role |
|---|---|---|
| `College_Management_CRS.docx` / `.pdf` | v1.0, 26 Sep 2026 (ICMS CRS 001) | Customer Requirements Specification — business needs, scope, workflows, acceptance criteria |
| `College_Management_SRS.docx` / `.pdf` | v1.0, 26 Sep 2026 (ICMS SRS 001) | Software Requirements Specification — detailed behaviour, data model, interfaces, verification plan |
| `College_Management_Master_Development_Prompt.docx` | v1.0, 26 Sep 2026 | Operating brief for the development AI: phased delivery discipline, scope control, and the two-developer collaboration model |
| `College_System_Basic_Operation_Guide.docx` | v1.1, 26 Sep 2026 | Illustrated day-to-day operation guide for applicants, students, lecturers and staff |
| `College_System_Basic_Operation_Guide.v1.0-superseded.docx` | v1.0 | Earlier edition, kept for reference only — **use the v1.1 file above** |

Read the CRS and SRS before making any implementation decision. The Master
Development Prompt governs *how* development proceeds (phase-by-phase,
with explicit customer approval between phases); it does not add scope
beyond the CRS/SRS.

## Precedence

CRS (customer intent) → SRS (refined software behaviour) → approved
decisions/change requests. Where documents conflict, that conflict must be
raised and resolved through change control before implementation — nothing
here authorises silently picking the easier interpretation.

## Scope at a glance

- **In baseline:** online admissions, student records, academic
  registration, learning management (materials/assignments/quizzes/
  feedback), assessment & result publication, lecturer attendance, and
  common services (roles, audit, notifications, exports, backup).
- **Should (conditional):** student attendance, transcript requests,
  discussion forums, extra notification channels.
- **Could (separate estimate/approval):** native mobile apps, biometric
  attendance, live video teaching, advanced analytics.
- **Out of baseline:** payroll, library/hostel/transport, procurement,
  full tuition billing, remote exam proctoring, automated admission or
  disciplinary decisions.

## Open decisions blocking design approval

Single college vs. multi-tenant; user volumes/budget/hosting owner;
admissions eligibility/fees/documents/payment method; grading scale,
rounding, repeat and appeal rules; what "lecturer attendance" covers
(presence, teaching delivery, or both) and its verification/correction
rules; retention and privacy policy; migration source systems; which
Should/Could items are funded; technology stack (intentionally
unspecified by the CRS/SRS). See CRS §"Risks dependencies and decisions"
and SRS §26 for the full list.

## Delivery approach

Development proceeds in customer-authorised phases (CRS: foundation &
admissions → academic/learning → results → attendance & rollout).
Security, auditability and data integrity apply throughout, not as a
final cleanup step. Two developers share one repository with per-phase
lead/reviewer assignments as defined in the Master Development Prompt;
`main` stays protected, and phase advancement requires explicit sponsor
approval.

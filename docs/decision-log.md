# Decision log

Integrated College Management System. Planning records for Phase 1.

Working baseline: ICMS CRS 001 version 1.0 and ICMS SRS 001 version 1.0, both dated 26 September 2026. Source copies reviewed: `docs/College_Management_CRS.docx` and `docs/College_Management_SRS.docx` on `origin/brima/foundation-identity` at commit `a041341`. Those Word files are not on `main`. The college signature blocks in both documents are still blank.

Nothing in this log is a signed college policy. Example grades, fees, and attendance rules in code or in the specifications stay examples until the named process owner approves them.

| ID | Date | Question | Decision | Decided by | Status | Affects | Implementation consequence |
|---|---|---|---|---|---|---|---|
| DL-01 | 30 September 2026 | Are the unsigned CRS and SRS the working baseline? | Yes. ICMS CRS 001 v1.0 and ICMS SRS 001 v1.0 are the working baseline for planning and later authorised phases. | Alhaji Mohamed Wurie Bah | Approved for planning | All requirements | Follow the CRS and SRS identifiers in `docs/requirements-register.md`. Do not invent admission, grading, or attendance policy where those documents leave it open. College signatures are still required before production activation. |
| DL-02 | 30 September 2026 | Which codebase do we extend? | `main` at commit `307a6b7`. Do not build Alhaji’s modules on `brima/foundation-identity`. | Alhaji Mohamed Wurie Bah | Approved for planning | Repository, all later phases | Later authorised work extends the API already on `main`. Brima’s branch stays intact. How that branch is reconciled is DL-12, which is still open. |
| DL-03 | 30 September 2026 | Where do Phase 1 planning records live? | Branch `alhaji/requirements-review`, containing this log and the requirements register only. | Alhaji Mohamed Wurie Bah | Approved for planning | Phase 1 | No application code, schema change, or edit to `main` in this step. |
| DL-04 | 30 September 2026 | Which stack follows from building on `main`? | The stack already on `main`: Node.js, Express, TypeScript, Prisma, and PostgreSQL. | Alhaji Mohamed Wurie Bah, as a consequence of DL-02 | Approved as the engineering stack on `main` | Architecture | This accepts the existing server stack. It is not a college hosting or procurement approval. Providers, timezone, and deployment owner remain open under D-02 and D-09. |

## Open decisions from the CRS

These remain unresolved. Do not fill them with values from `server/src/lib/grading.ts` or from the current fee and attendance tables.

| ID | Question | Owner | Needed before | Status |
|---|---|---|---|---|
| D-01 | College name, campuses, and whether this is one institution or separate colleges | Sponsor and architect | Data and access design | Open |
| D-02 | Expected volumes, budget, delivery dates, and hosting owner | Sponsor and IT | Sizing and deployment | Open |
| D-03 | Admission eligibility, documents, fees, payment method, and decision makers | Admissions and finance | Admission configuration | Open |
| D-04 | Assessment weights, grading scale, rounding, repeats, appeals, and result signatories | Registry and academic authority | Calculation and publication design | Open |
| D-05 | Whether lecturer attendance means workplace presence, teaching delivery, or both, including leave, verification, and correction | HR and academic departments | Attendance implementation | Open |
| D-06 | Retention, privacy notices, access scopes, and support arrangements | Institutional data owner and IT | Production data collection | Open |
| D-07 | Source records and external integrations | Sponsor and IT | Migration and integrations | Open |
| D-08 | Which Should and Could items to fund, including discussions (SRS-029), student attendance (SRS-051), and transcripts (SRS-052) | Sponsor | Release scope | Open |
| D-09 | Recovery and performance targets against real operational resources | IT and sponsor | Service acceptance | Open |

## Open decisions raised by this review

| ID | Question | Owner | Needed before | Status |
|---|---|---|---|---|
| DL-11 | The collaboration plan has 16 phases. The CRS and SRS have four releases. Proposed working rule, not yet joint: collaboration phases name the lead; CRS releases name the product increment. | Alhaji Mohamed Wurie Bah and Brima Conteh | Start of implementation | Open |
| DL-12 | `origin/brima/foundation-identity` contains a separate identity backend and the governing documents. `main` is now the codebase to extend. What happens to Brima’s branch: leave it, review it, or fold selected parts into `main` later? | Both developers | Before identity work is merged | Open |
| DL-13 | Behaviour already on `main` conflicts with the working baseline and must not be treated as approved college policy. See the list below. | Module lead for the phase that touches that behaviour, with the other developer reviewing | The authorised phase that changes that area | Open |

### DL-13 conflicts on `main` at `307a6b7`

- Grading bands, pass point, and probation threshold are constants in `server/src/lib/grading.ts`. SRS-042 requires a versioned policy. The CRS illustration (GPA 3.125) is an example, not the rule.
- A course row carries `lecturerId` and `courseworkWeight`. SRS-020 requires a course definition separate from an offering in a period and section.
- Results visibility is a term flag, `AcademicTerm.resultsPublishedAt`. SRS-039 requires an atomic cohort version. SRS-041 requires a successor version for a correction.
- One `User.role` is stored. SRS-002 requires scoped grants with dates and a grantor. One person can hold several grants.
- Student attendance (`AttendanceRecord` on an enrolment) is implemented. SRS-051 is Should and is not included until D-08. Lecturer teaching attendance (SRS-046) is absent.
- `FeeInvoice` and `Payment` bill students and issue local receipts. The CRS limits fees to application-payment verification. A browser receipt or staff-entered payment is not provider confirmation (SRS-048).
- Course, department, and programme routes allow delete. SRS-019 requires referenced configuration to be retired, not removed.
- There is no separate Person, Application, Offering, mark-sheet revision, or teaching-session record.

## Decisions made by starting Phase 4

| ID | Date | Question | Decision | Decided by | Status | Affects | Implementation consequence |
|---|---|---|---|---|---|---|---|
| DL-15 | 30 September 2026 | May Alhaji start his own development path before Brima’s identity branch is merged? | Yes. Phase 4, online applications and admissions, starts on `alhaji/admissions`, extending `main`. Phase 5 has not started. | Alhaji Mohamed Wurie Bah | Approved to start Phase 4 | SRS-007 to SRS-016, SRS-048 | The substitutes in DL-14 are temporary. Brima still reviews the applicant-to-student handoff. |

### DL-14 temporary substitutes

These are engineering substitutes, not college policy. They stay until Brima’s identity work and the open CRS decisions replace them.

| Topic | Substitute on this branch | Still unresolved |
|---|---|---|
| Person and account | The existing `User` row is both account and applicant | A separate Person model and scoped role grants (SRS-001, SRS-002), decision DL-12 |
| Roles | Added `APPLICANT` and `ADMISSIONS_OFFICER` to the single role field | Several grants on one account |
| Who may act | Admissions officers decide. The registry converts. The bursar records fee events. An administrator does not decide or convert. Officers can see every application | Programme-scoped grants. D-03 names the real decision makers |
| Conversion | The same user id becomes role `STUDENT` when a student profile is created | Multi-role continuity without replacing the applicant role |
| Contact verification | The token is hashed. `CONTACT_CHANNEL=undelivered` does not send it. Tests use `capture`, which production refuses | An approved email or SMS provider (D-07). Password recovery is still absent |
| Verification lifetime | `CONTACT_VERIFICATION_TTL_HOURS` defaults to 24 | IT security owner approval |
| Files | PDF, JPEG, and PNG are checked by declared type and file signature. Rejected bytes are not stored. Only `AVAILABLE` files can be downloaded | A malware scanner. The intermediate scan states are not kept after a successful check |
| Fees | A bursar event must match reference, amount, and currency. An uploaded receipt does not confirm payment. There is no payment provider | D-03 and D-07. Existing tuition invoices are unchanged and are not this workflow |
| Time and money in tests | Intakes in tests use timezone `UTC` and an example fee of 150 SLE | D-01 and D-04. Those figures are examples |

## Phase 1 status

Phase 1 planning records remain on this history. Brima Conteh has not yet reviewed them. Phase 4 has started because Alhaji authorised his own path. Phase 5 has not started. Phase 2 and Phase 3 remain Brima’s.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { prisma } from "../src/shared/prisma";
import { sentNotifications } from "../src/shared/notification";
import { computeTotp, createTestAdmin, uniqueEmail } from "./helpers";

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

function lastTokenFor(email: string): string {
  const event = [...sentNotifications].reverse().find((e) => e.to === email);
  if (!event) throw new Error(`No notification captured for ${email}`);
  return event.data.token;
}

async function registerVerifyLogin(email: string, password: string) {
  await request(app).post("/api/v1/auth/register").send({ email, password }).expect(202);
  const token = lastTokenFor(email);
  await request(app).post("/api/v1/auth/verify-email").send({ token }).expect(200);
  const res = await request(app).post("/api/v1/auth/login").send({ email, password }).expect(200);
  const cookie = res.headers["set-cookie"][0];
  return { cookie, mfaRequired: res.body.mfaRequired as boolean };
}

describe("account lifecycle (SRS-001 to SRS-006)", () => {
  it("registers, verifies, and logs in a new account", async () => {
    const email = uniqueEmail("student");
    const { cookie, mfaRequired } = await registerVerifyLogin(email, "StudentPassword1!");
    expect(mfaRequired).toBe(false);

    const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.account.email).toBe(email);
    expect(me.body.account.status).toBe("ACTIVE");
    expect(me.body.roleGrants).toEqual([]);
  });

  it("login before email verification is rejected", async () => {
    const email = uniqueEmail("unverified");
    await request(app).post("/api/v1/auth/register").send({ email, password: "SomePassword1!" }).expect(202);
    const res = await request(app).post("/api/v1/auth/login").send({ email, password: "SomePassword1!" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("does not disclose whether an email is registered (SRS-005)", async () => {
    const email = uniqueEmail("student");
    await registerVerifyLogin(email, "RealPassword1!");

    const wrongPassword = await request(app).post("/api/v1/auth/login").send({ email, password: "wrong-password-1" });
    const unknownEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: uniqueEmail("nobody"), password: "wrong-password-1" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it("logout revokes the session immediately", async () => {
    const email = uniqueEmail("student");
    const { cookie } = await registerVerifyLogin(email, "StudentPassword1!");

    await request(app).get("/api/v1/auth/me").set("Cookie", cookie).expect(200);
    await request(app).post("/api/v1/auth/logout").set("Cookie", cookie).expect(200);
    const afterLogout = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(afterLogout.status).toBe(401);
  });

  it("password reset invalidates existing sessions and the token is single-use (SRS-004)", async () => {
    const email = uniqueEmail("student");
    const { cookie } = await registerVerifyLogin(email, "OldPassword1!");
    await request(app).get("/api/v1/auth/me").set("Cookie", cookie).expect(200);

    await request(app).post("/api/v1/auth/password-reset/request").send({ email }).expect(202);
    const token = lastTokenFor(email);

    await request(app)
      .post("/api/v1/auth/password-reset/confirm")
      .send({ token, newPassword: "NewPassword1!" })
      .expect(200);

    // Old session must now be dead.
    const staleSession = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(staleSession.status).toBe(401);

    // Old password no longer works; new one does.
    await request(app).post("/api/v1/auth/login").send({ email, password: "OldPassword1!" }).expect(401);
    await request(app).post("/api/v1/auth/login").send({ email, password: "NewPassword1!" }).expect(200);

    // Replaying the same reset token must fail (single-use).
    const replay = await request(app)
      .post("/api/v1/auth/password-reset/confirm")
      .send({ token, newPassword: "AnotherPassword1!" });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("INVALID_TOKEN");
  });
});

describe("role grants and permission enforcement (SRS-002, IAM-01)", () => {
  it("a non-privileged account cannot call an admin-only route", async () => {
    const email = uniqueEmail("student");
    const { cookie } = await registerVerifyLogin(email, "StudentPassword1!");
    const res = await request(app)
      .post("/api/v1/accounts/some-account-id/status")
      .set("Cookie", cookie)
      .send({ action: "suspend" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("granting a role is visible immediately, and revocation applies to the next request without re-login", async () => {
    const admin = await createTestAdmin();
    const adminLogin = await request(app).post("/api/v1/auth/login").send({ email: admin.email, password: admin.password }).expect(200);
    expect(adminLogin.body.mfaRequired).toBe(true);
    const adminCookie = adminLogin.headers["set-cookie"][0];

    // Protected routes are blocked until MFA completes.
    const beforeMfa = await request(app).get("/api/v1/auth/me").set("Cookie", adminCookie);
    expect(beforeMfa.status).toBe(403);
    expect(beforeMfa.body.error.code).toBe("MFA_REQUIRED");

    await request(app)
      .post("/api/v1/auth/mfa/verify")
      .set("Cookie", adminCookie)
      .send({ code: computeTotp(admin.mfaSecret) })
      .expect(200);

    const studentEmail = uniqueEmail("lecturer");
    const { cookie: lecturerCookie } = await registerVerifyLogin(studentEmail, "LecturerPassword1!");
    const lecturerMe = await request(app).get("/api/v1/auth/me").set("Cookie", lecturerCookie).expect(200);
    const lecturerAccountId = lecturerMe.body.account.id;

    const grantRes = await request(app)
      .post(`/api/v1/accounts/${lecturerAccountId}/role-grants`)
      .set("Cookie", adminCookie)
      .send({ role: "LECTURER", scopeType: "COURSE_OFFERING", scopeId: "OFFERING-TEST-1" })
      .expect(201);
    const grantId = grantRes.body.roleGrant.id;

    const withGrant = await request(app).get("/api/v1/auth/me").set("Cookie", lecturerCookie).expect(200);
    expect(withGrant.body.roleGrants).toHaveLength(1);
    expect(withGrant.body.roleGrants[0].role).toBe("LECTURER");

    await request(app)
      .post(`/api/v1/accounts/role-grants/${grantId}/revoke`)
      .set("Cookie", adminCookie)
      .send({ reason: "test" })
      .expect(200);

    // Same lecturer session cookie, no re-login - the revocation must
    // already apply to this very next request (SRS-002).
    const afterRevoke = await request(app).get("/api/v1/auth/me").set("Cookie", lecturerCookie).expect(200);
    expect(afterRevoke.body.roleGrants).toEqual([]);
  });

  it("granting an MFA-required role to an unenrolled account is rejected", async () => {
    const admin = await createTestAdmin();
    const adminLogin = await request(app).post("/api/v1/auth/login").send({ email: admin.email, password: admin.password }).expect(200);
    const adminCookie = adminLogin.headers["set-cookie"][0];
    await request(app).post("/api/v1/auth/mfa/verify").set("Cookie", adminCookie).send({ code: computeTotp(admin.mfaSecret) }).expect(200);

    const targetEmail = uniqueEmail("finance");
    const { cookie: targetCookie } = await registerVerifyLogin(targetEmail, "FinancePassword1!");
    const targetMe = await request(app).get("/api/v1/auth/me").set("Cookie", targetCookie).expect(200);

    const res = await request(app)
      .post(`/api/v1/accounts/${targetMe.body.account.id}/role-grants`)
      .set("Cookie", adminCookie)
      .send({ role: "FINANCE_VERIFIER", scopeType: "INSTITUTION" });
    expect(res.status).toBe(422);
  });
});

describe("account status transitions (SRS-003)", () => {
  it("suspending an account revokes its active session and blocks future login", async () => {
    const admin = await createTestAdmin();
    const adminLogin = await request(app).post("/api/v1/auth/login").send({ email: admin.email, password: admin.password }).expect(200);
    const adminCookie = adminLogin.headers["set-cookie"][0];
    await request(app).post("/api/v1/auth/mfa/verify").set("Cookie", adminCookie).send({ code: computeTotp(admin.mfaSecret) }).expect(200);

    const email = uniqueEmail("student");
    const { cookie } = await registerVerifyLogin(email, "StudentPassword1!");
    const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie).expect(200);

    await request(app)
      .post(`/api/v1/accounts/${me.body.account.id}/status`)
      .set("Cookie", adminCookie)
      .send({ action: "suspend", reason: "test" })
      .expect(200);

    const staleSession = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(staleSession.status).toBe(401);

    const loginAttempt = await request(app).post("/api/v1/auth/login").send({ email, password: "StudentPassword1!" });
    expect(loginAttempt.status).toBe(403);
    expect(loginAttempt.body.error.code).toBe("ACCOUNT_NOT_ACTIVE");
  });
});

describe("audit evidence (SEC-04, SRS-063)", () => {
  // Deliberately NOT using prisma.$executeRawUnsafe here: against the
  // PGlite test/dev database, running a raw UPDATE/DELETE that a rule
  // rewrites to "DO INSTEAD NOTHING" causes Prisma's query engine to
  // receive a response shape it doesn't expect ("unexpected message from
  // server"), which kills the shared connection for the rest of the
  // suite. This reproduces reliably against PGlite but not against real
  // PostgreSQL, where rule-rewritten no-op statements are a completely
  // standard pattern - see server/README.md "Known PGlite limitations".
  // A plain `pg` client sidesteps Prisma's parsing entirely, and a full
  // close-before-Prisma-resumes cycle keeps to the one-connection-at-a-
  // time rule the rest of this suite depends on.
  it("audit_event rows cannot be updated or deleted by the application role", async () => {
    const id = randomUUID();
    await prisma.auditEvent.create({
      data: { id, action: "test.append_only", objectType: "Test", objectId: "obj", correlationId: "corr" },
    });
    await prisma.$disconnect();

    const raw = new Client({ connectionString: process.env.DATABASE_URL });
    await raw.connect();
    await raw.query(`UPDATE audit_event SET action = 'tampered' WHERE id = '${id}'`);
    const afterUpdate = await raw.query(`SELECT action FROM audit_event WHERE id = '${id}'`);
    expect(afterUpdate.rows[0].action).toBe("test.append_only");

    await raw.query(`DELETE FROM audit_event WHERE id = '${id}'`);
    const afterDelete = await raw.query(`SELECT action FROM audit_event WHERE id = '${id}'`);
    expect(afterDelete.rows).toHaveLength(1);
    await raw.end();
  });

  it("records an audit event for login", async () => {
    const email = uniqueEmail("student");
    await registerVerifyLogin(email, "StudentPassword1!");
    const account = await prisma.account.findUniqueOrThrow({ where: { email } });
    const events = await prisma.auditEvent.findMany({ where: { objectId: account.id, action: "account.login" } });
    expect(events.length).toBeGreaterThan(0);
  });
});

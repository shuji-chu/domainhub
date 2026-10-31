import test from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { AppModule } from "../dist/app.module";
import { PrismaService } from "../dist/prisma.service";

process.env.NODE_ENV = "test";
process.env.PUBLIC_APP_URL = "http://127.0.0.1:5173";

test("registration, one-time email verification, quota, login cookie, csrf and logout", async t => {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const prisma = app.get(PrismaService);
  await prisma.session.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.quotaLedger.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.user.deleteMany({ where: { emailNormalized: "auth-e2e@example.test" } });
  await prisma.rateLimitBucket.deleteMany();
  t.after(async () => { await app.close(); });

  const registration = await fetch(base + "/auth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "auth-e2e@example.test", password: "StrongPass1234" }),
  });
  assert.equal(registration.status, 201);
  const mail = await fetch(base + "/auth/__test__/last-email").then(r => r.json());
  assert.ok(mail.verificationUrl);
  const token = new URL(mail.verificationUrl).searchParams.get("token");
  assert.ok(token);

  const verified = await fetch(base + "/auth/email/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  assert.equal(verified.status, 201);
  assert.equal((await verified.json()).quotaAwarded, 1);
  assert.equal(await prisma.quotaLedger.count({ where: { user: { emailNormalized: "auth-e2e@example.test" }, delta: 1 } }), 1);

  const replay = await fetch(base + "/auth/email/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
  });
  assert.equal(replay.status, 400);

  const login = await fetch(base + "/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "auth-e2e@example.test", password: "StrongPass1234" }),
  });
  assert.equal(login.status, 201);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /__Host-domainhub_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const pair = cookie.split(";")[0];

  const csrfResponse = await fetch(base + "/auth/csrf", { headers: { cookie: pair } });
  assert.equal(csrfResponse.status, 200);
  const { csrfToken } = await csrfResponse.json();
  const logout = await fetch(base + "/auth/logout", {
    method: "POST", headers: { cookie: pair, "x-csrf-token": csrfToken, origin: process.env.PUBLIC_APP_URL },
  });
  assert.equal(logout.status, 201);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  const rejected = await fetch(base + "/auth/csrf", { headers: { cookie: pair } });
  assert.equal(rejected.status, 401);
});

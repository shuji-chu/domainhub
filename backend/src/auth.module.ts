import {
  BadRequestException, CanActivate, ConflictException, Controller, ExecutionContext,
  ForbiddenException, Injectable, Module, OnModuleInit, Post, Get, Req, Res, TooManyRequestsException,
  UnauthorizedException, UseGuards, Logger,
} from "@nestjs/common";
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import * as argon2 from "argon2";
import * as nodemailer from "nodemailer";
import { PrismaService } from "./prisma.service";

const COOKIE = process.env.SESSION_COOKIE_NAME || "__Host-domainhub_session";
const IDLE_MS = Number(process.env.SESSION_IDLE_TIMEOUT_SECONDS || 1800) * 1000;
const ABSOLUTE_MS = Number(process.env.SESSION_ABSOLUTE_TIMEOUT_SECONDS || 604800) * 1000;
const VERIFY_MS = 30 * 60 * 1000;
const log = new Logger("Auth");

function sha(value: string): Buffer { return createHash("sha256").update(value).digest(); }
function randomToken(): string { return randomBytes(32).toString("base64url"); }
function ipPrefix(value?: string): string | undefined {
  if (!value) return undefined;
  const ip = value.replace(/^::ffff:/, "");
  if (isIP(ip) === 4) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  if (isIP(ip) === 6) return ip.split(":").slice(0, 4).join(":") + "::/56";
  return undefined;
}
function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("邮箱格式不正确");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("邮箱格式不正确");
  return email;
}
function passwordValid(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128 &&
    /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
function sameOrigin(candidate: string, allowed: string): boolean {\n  try { return new URL(candidate).origin === new URL(allowed).origin; } catch { return false; }\n}\nfunction safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

@Injectable()
class Mailer implements OnModuleInit {
  private transport: nodemailer.Transporter | null = null;
  private lastTestUrl: string | null = null;
  async onModuleInit(): Promise<void> {
    if (process.env.SMTP_HOST) {
      this.transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USERNAME ? { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } : undefined,
      });
    } else if (process.env.NODE_ENV === "production") {
      throw new Error("Production requires SMTP_HOST and server-side SMTP credentials");
    }
  }
  async sendVerification(email: string, token: string): Promise<void> {
    const url = `${process.env.PUBLIC_APP_URL || "http://localhost:5173"}/verify-email?token=${encodeURIComponent(token)}`;
    if (this.transport) {
      await this.transport.sendMail({
        from: process.env.MAIL_FROM || "DomainHub <no-reply@example.invalid>",
        to: email, replyTo: process.env.MAIL_REPLY_TO,
        subject: "验证你的 DomainHub 邮箱",
        text: `请在 30 分钟内打开以下链接完成邮箱验证：\n${url}`,
      });
    } else {
      // Mock adapter: token is kept only in process memory for automated tests.
      this.lastTestUrl = url;
      log.log(`Mock verification email queued for ${email.replace(/(^.).*(@.*$)/, "$1***$2")}`);
    }
  }
  getLastTestUrl(): string | null { return this.lastTestUrl; }
}

@Injectable()
class RateLimitService {
  constructor(private readonly db: PrismaService) {}
  private digest(value: string): string {
    const key = process.env.RATE_LIMIT_HMAC_KEY || process.env.TOKEN_HASH_PEPPER || "development-only-change-me";
    return createHmac("sha256", key).update(value).digest("hex");
  }
  async hit(dimension: string, subject: string, windowMs: number, limit: number): Promise<void> {
    const now = new Date();
    const startMs = Math.floor(now.getTime() / windowMs) * windowMs;
    const start = new Date(startMs);
    const expires = new Date(startMs + windowMs * 2);
    const key = this.digest(subject);
    const bucket = await this.db.rateLimitBucket.upsert({
      where: { dimension_subjectHash_windowStart: { dimension, subjectHash: key, windowStart: start } },
      create: { dimension, subjectHash: key, windowStart: start, count: 1, expiresAt: expires },
      update: { count: { increment: 1 } },
    });
    if (bucket.count > limit) {
      const retry = Math.max(1, Math.ceil((startMs + windowMs - now.getTime()) / 1000));
      throw new TooManyRequestsException({ message: "请求过于频繁，请稍后重试", retryAfter: retry });
    }
  }
}

@Injectable()
class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly limits: RateLimitService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<any>();
    const path = String(req.routerPath || req.url || "");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "unknown";
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const plans: Record<string, Array<[string, number, number]>> = {
      register: [["ip", 3600000, 5], ["ip", 86400000, 20], ["email", 86400000, 3]],
      login: [["ip", 600000, 10], ["ip", 86400000, 50], ["email", 900000, 5]],
      verifySend: [["ip", 3600000, 5], ["ip", 86400000, 10], ["email", 3600000, 3], ["email", 86400000, 5]],
    };
    const kind = path.includes("register") ? "register" :
      (path.includes("verification/send") ? "verifySend" : "login");
    for (const [dimension, windowMs, limit] of plans[kind]) {
      await this.limits.hit(dimension, dimension === "ip" ? ip : email, windowMs, limit);
    }
    return true;
  }
}

@Injectable()
class SessionGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<any>();
    const raw = cookieValue(req.headers.cookie, COOKIE);
    if (!raw || raw.length < 40) throw new UnauthorizedException("需要登录");
    const session = await this.db.session.findUnique({
      where: { tokenHash: sha(raw) }, include: { user: { include: { credential: true } } },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now ||
        session.user.status !== "active" || !session.user.emailVerifiedAt ||
        !session.user.credential || session.passwordVersion !== session.user.credential.passwordVersion) {
      throw new UnauthorizedException("登录状态已失效");
    }
    req.user = { id: session.user.id, email: session.user.email, sessionId: session.id };
    req.sessionSecret = raw;
    if (!session.lastRenewedAt || now.getTime() - session.lastRenewedAt.getTime() >= 5 * 60 * 1000) {
      const idle = new Date(Math.min(now.getTime() + IDLE_MS, session.absoluteExpiresAt.getTime()));
      await this.db.session.updateMany({
        where: { id: session.id, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
        data: { lastSeenAt: now, lastRenewedAt: now, idleExpiresAt: idle },
      });
    }
    return true;
  }
}

@Injectable()
class AuthService {
  constructor(private readonly db: PrismaService, private readonly mailer: Mailer) {}
  async register(body: any, ip?: string): Promise<{ message: string }> {
    const email = normalizeEmail(body?.email);
    if (!passwordValid(body?.password)) throw new BadRequestException("密码至少 12 位，且须包含大小写字母和数字");
    const passwordHash = await argon2.hash(body.password, {
      type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32,
    });
    let user: any;
    try {
      user = await this.db.$transaction(async tx => {
        const created = await tx.user.create({
          data: { email, emailNormalized: email, status: "pending_verification",
            credential: { create: { passwordHash, passwordChangedAt: new Date(), passwordVersion: 1 } } },
        });
        const token = randomToken();
        await tx.emailVerificationToken.create({
          data: { userId: created.id, tokenHash: sha(token), expiresAt: new Date(Date.now() + VERIFY_MS), requestIpPrefix: ipPrefix(ip) },
        });
        return { ...created, verificationToken: token };
      });
    } catch (error: any) {
      if (error?.code === "P2002") return { message: "如果该邮箱可以注册，我们会发送验证邮件" };
      throw error;
    }
    await this.mailer.sendVerification(user.email, user.verificationToken);
    return { message: "如果该邮箱可以注册，我们会发送验证邮件" };
  }
  async sendVerification(body: any, ip?: string): Promise<{ message: string }> {
    const email = normalizeEmail(body?.email);
    const user = await this.db.user.findUnique({ where: { emailNormalized: email } });
    if (user && user.status === "pending_verification") {
      const token = randomToken();
      await this.db.$transaction(async tx => {
        await tx.emailVerificationToken.updateMany({
          where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() },
        });
        await tx.emailVerificationToken.create({
          data: { userId: user.id, tokenHash: sha(token), expiresAt: new Date(Date.now() + VERIFY_MS), requestIpPrefix: ip || undefined },
        });
      });
      await this.mailer.sendVerification(email, token);
    }
    return { message: "如果该邮箱对应待验证账号，我们会发送验证邮件" };
  }
  async verifyEmail(body: any): Promise<{ message: string; quotaAwarded: number }> {
    if (typeof body?.token !== "string" || body.token.length < 30) throw new BadRequestException("验证链接无效或已过期");
    const tokenHash = sha(body.token);
    return this.db.$transaction(async tx => {
      const token = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
      const now = new Date();
      if (!token || token.consumedAt || token.expiresAt <= now) throw new BadRequestException("验证链接无效或已过期");
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new BadRequestException("验证链接无效或已过期");
      const user = await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: now, status: "active" } });
      await tx.quotaLedger.createMany({
        data: [{ userId: user.id, delta: 1, sourceType: "email_verification",
          idempotencyKey: `email_verification:${user.id}`, reason: "邮箱验证奖励" }],
        skipDuplicates: true,
      });
      return { message: "邮箱验证成功", quotaAwarded: 1 };
    });
  }
  async login(body: any, req: any): Promise<{ user: { id: string; email: string } }> {
    const email = normalizeEmail(body?.email);
    const user = await this.db.user.findUnique({ where: { emailNormalized: email }, include: { credential: true } });
    const valid = user?.credential ? await argon2.verify(user.credential.passwordHash, String(body?.password || "")) : false;
    if (!user || !valid || user.status !== "active" || !user.emailVerifiedAt || !user.credential) {
      throw new UnauthorizedException("邮箱或密码错误");
    }
    const now = new Date();
    const raw = randomToken();
    const result = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      const active = await tx.session.count({ where: { userId: user.id, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } } });
      if (active >= 5) throw new ConflictException("活跃会话已达 5 个上限，请先撤销其他设备");
      const session = await tx.session.create({
        data: { userId: user.id, tokenHash: sha(raw), createdAt: now, lastSeenAt: now,
          idleExpiresAt: new Date(now.getTime() + IDLE_MS), absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_MS),
          passwordVersion: user.credential!.passwordVersion, ipPrefix: ipPrefix(req.ip),
          userAgentHash: req.headers["user-agent"] ? sha(req.headers["user-agent"]) : undefined },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      return session;
    });
    req.authCookie = raw;
    return { user: { id: user.id, email: user.email } };
  }
  async logout(req: any): Promise<void> {
    if (req.user?.sessionId) await this.db.session.updateMany({
      where: { id: req.user.sessionId, revokedAt: null }, data: { revokedAt: new Date() },
    });
  }
  csrf(raw: string): string {
    const key = process.env.CSRF_SECRET || process.env.SESSION_HASH_PEPPER || "development-only-change-me";
    return createHmac("sha256", key).update(`csrf:${raw}`).digest("base64url");
  }
}

@Controller("auth")
class AuthController {
  constructor(private readonly auth: AuthService, private readonly guard: SessionGuard, private readonly mailer: Mailer) {}
  @Post("register")
  @UseGuards(AuthRateLimitGuard)
  async register(@Req() req: any, @Res({ passthrough: true }) res: any): Promise<any> {
    return this.auth.register(req.body, req.ip);
  }
  @Post("email/verification/send")
  @UseGuards(AuthRateLimitGuard)
  async sendVerification(@Req() req: any): Promise<any> { return this.auth.sendVerification(req.body, req.ip); }
  @Post("email/verify")
  async verify(@Req() req: any): Promise<any> { return this.auth.verifyEmail(req.body); }
  @Post("login")
  @UseGuards(AuthRateLimitGuard)
  async login(@Req() req: any, @Res({ passthrough: true }) res: any): Promise<any> {
    const result = await this.auth.login(req.body, req);
    const raw = req.authCookie as string;
    res.header("Set-Cookie", `${COOKIE}=${raw}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    return result;
  }
  @Get("csrf")
  @UseGuards(SessionGuard)
  csrf(@Req() req: any): any { return { csrfToken: this.auth.csrf(req.sessionSecret) }; }
  @Post("logout")
  @UseGuards(SessionGuard)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any): Promise<any> {
    const supplied = String(req.headers["x-csrf-token"] || "");
    if (!safeEqual(supplied, this.auth.csrf(req.sessionSecret))) throw new ForbiddenException("CSRF 校验失败");
    await this.auth.logout(req);
    res.header("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return { message: "已退出登录" };
  }
  @Get("__test__/last-email")
  async lastEmail(): Promise<any> {
    if (process.env.NODE_ENV !== "test") throw new ForbiddenException();
    return { verificationUrl: this.mailer.getLastTestUrl() };
  }
}

@Module({
  controllers: [AuthController],
  providers: [PrismaService, Mailer, AuthService, RateLimitService, AuthRateLimitGuard, SessionGuard],
  exports: [SessionGuard, PrismaService],
})
export class AuthModule {}

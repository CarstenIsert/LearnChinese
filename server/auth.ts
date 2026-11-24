import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import type http from 'node:http';
import { db, deleteUserAccount, seedUserWorkspace } from './db.ts';

export const SESSION_COOKIE_NAME = 'lc_session';
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  createdAt: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function isAuthEnforced(): boolean {
  return process.env.AUTH_ENFORCED !== 'false';
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const rawVal = part.slice(eqIndex + 1).trim();
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return Boolean(req.secure || proto?.split(',')[0].trim() === 'https');
}

function buildSessionCookie(token: string, maxAgeSeconds: number, req: Request): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttpsRequest(req) || process.env.COOKIE_SECURE === 'true') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function setSessionCookie(res: Response, token: string, req: Request): void {
  res.setHeader('Set-Cookie', buildSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000), req));
}

function clearSessionCookie(res: Response, req: Request): void {
  res.setHeader('Set-Cookie', buildSessionCookie('', 0, req));
}

export function createAuthSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  db.prepare(`DELETE FROM auth_sessions WHERE expires_at <= datetime('now')`).run();
  db.prepare(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`
  ).run(tokenHash, userId, expiresAt);

  return token;
}

export function deleteAuthSessionByToken(token: string): void {
  const tokenHash = hashToken(token);
  db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(tokenHash);
}

export function getAuthenticatedUserFromRequest(req: http.IncomingMessage): AuthUser | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role, u.created_at, s.expires_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | {
        id: number;
        email: string;
        display_name: string;
        role: 'admin' | 'user';
        created_at: string;
        expires_at: string;
      }
    | undefined;

  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(tokenHash);
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getAuthenticatedUserFromRequest(req);
  if (user) {
    req.user = user;
    next();
    return;
  }

  if (!isAuthEnforced()) {
    next();
    return;
  }

  res.status(401).json({ error: 'Authentication required' });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// Simple in-memory rate limiter for auth and AI endpoints
const authRateMap = new Map<string, { count: number; resetAt: number }>();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 25;

export function createInMemoryRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  errorMessage?: string;
}) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string): { allowed: boolean; retryAfterSeconds?: number } {
      const now = Date.now();
      if (hits.size > 2000) {
        for (const [k, entry] of hits.entries()) {
          if (entry.resetAt <= now) hits.delete(k);
        }
      }
      const existing = hits.get(key);
      if (!existing || existing.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + options.windowMs });
        return { allowed: true };
      }
      if (existing.count >= options.maxRequests) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
        };
      }
      existing.count += 1;
      return { allowed: true };
    },
    middleware(req: Request, res: Response, next: NextFunction): void {
      const key = req.user ? `user:${req.user.id}` : `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
      const result = this.check(key);
      if (!result.allowed) {
        if (result.retryAfterSeconds) {
          res.setHeader('Retry-After', String(result.retryAfterSeconds));
        }
        res.status(429).json({
          error:
            options.errorMessage ||
            'Zu viele Anfragen. Bitte warte kurz und versuche es gleich noch einmal.',
        });
        return;
      }
      next();
    },
  };
}

function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  if (authRateMap.size > 1000) {
    for (const [key, entry] of authRateMap.entries()) {
      if (entry.resetAt <= now) {
        authRateMap.delete(key);
      }
    }
  }

  const existing = authRateMap.get(ip);

  if (!existing || existing.resetAt <= now) {
    authRateMap.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    next();
    return;
  }

  if (existing.count >= AUTH_MAX_ATTEMPTS) {
    res.status(429).json({ error: 'Too many authentication attempts. Please try again later.' });
    return;
  }

  existing.count += 1;
  next();
}

const registerUserTx = db.transaction(
  (input: {
    email: string;
    password: string;
    displayName: string;
    inviteCode?: string;
    bootstrapToken?: string;
  }) => {
    const email = normalizeEmail(input.email);
    const existingUser = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existingUser) {
      throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });
    }

    const userCount = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
    const isFirstUser = userCount === 0;
    const role: 'admin' | 'user' = isFirstUser ? 'admin' : 'user';

    if (isFirstUser) {
      const expectedBootstrap = (process.env.ADMIN_BOOTSTRAP_TOKEN || '').trim();
      if (expectedBootstrap) {
        const provided = (input.bootstrapToken || input.inviteCode || '').trim();
        const a = Buffer.from(provided);
        const b = Buffer.from(expectedBootstrap);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          throw Object.assign(new Error('Invalid admin bootstrap token.'), { status: 403 });
        }
      }
    } else {
      const code = input.inviteCode?.trim();
      if (!code) {
        throw Object.assign(new Error('An invite code is required to register.'), { status: 403 });
      }
      const invite = db
        .prepare(`SELECT code, used_by_user_id, expires_at FROM invite_codes WHERE code = ?`)
        .get(code) as
        | { code: string; used_by_user_id: number | null; expires_at: string | null }
        | undefined;

      if (!invite || invite.used_by_user_id !== null) {
        throw Object.assign(new Error('Invalid or already used invite code.'), { status: 403 });
      }
      if (invite.expires_at && Date.parse(invite.expires_at) <= Date.now()) {
        throw Object.assign(new Error('Invite code has expired.'), { status: 403 });
      }
    }

    const passwordHash = hashPassword(input.password);
    const result = db
      .prepare(
        `INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)`
      )
      .run(email, passwordHash, input.displayName.trim(), role);

    const newUserId = Number(result.lastInsertRowid);

    if (!isFirstUser && input.inviteCode) {
      db.prepare(
        `UPDATE invite_codes SET used_by_user_id = ?, used_at = datetime('now') WHERE code = ?`
      ).run(newUserId, input.inviteCode.trim());
    }

    seedUserWorkspace(newUserId, { displayName: input.displayName.trim() });

    return db
      .prepare(`SELECT id, email, display_name, role, created_at FROM users WHERE id = ?`)
      .get(newUserId) as {
      id: number;
      email: string;
      display_name: string;
      role: 'admin' | 'user';
      created_at: string;
    };
  }
);

export function createAuthRouter(): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    const userCount = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
    const user = getAuthenticatedUserFromRequest(req);
    if (!user) {
      res.status(isAuthEnforced() ? 401 : 200).json({
        authenticated: false,
        user: null,
        authEnforced: isAuthEnforced(),
        requiresBootstrapAdmin: userCount === 0,
      });
      return;
    }

    res.json({
      authenticated: true,
      user,
      authEnforced: isAuthEnforced(),
      requiresBootstrapAdmin: false,
    });
  });

  router.post('/register', authRateLimit, (req, res) => {
    const { email, password, displayName, inviteCode, bootstrapToken } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
      inviteCode?: string;
      bootstrapToken?: string;
    };

    const trimmedName = displayName?.trim() || '';
    const trimmedEmail = email?.trim() || '';
    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) && trimmedEmail.length <= 254;
    if (
      !isEmailValid ||
      !trimmedName ||
      trimmedName.length > 80 ||
      !password ||
      password.length < 8 ||
      password.length > 128
    ) {
      res.status(400).json({
        error:
          'Valid email, displayName (max 80 chars), and password (8–128 chars) are required.',
      });
      return;
    }

    try {
      const created = registerUserTx({
        email: trimmedEmail,
        password,
        displayName: trimmedName,
        inviteCode,
        bootstrapToken,
      });
      const token = createAuthSession(created.id);
      setSessionCookie(res, token, req);
      res.status(201).json({
        user: {
          id: created.id,
          email: created.email,
          displayName: created.display_name,
          role: created.role,
          createdAt: created.created_at,
        },
      });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500;
      const message =
        status >= 400 && status < 500 ? err.message : 'Registration failed.';
      res.status(status).json({ error: message });
    }
  });

  router.post('/login', authRateLimit, (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password || email.length > 254 || password.length > 128) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const row = db
      .prepare(
        `SELECT id, email, password_hash, display_name, role, created_at FROM users WHERE email = ?`
      )
      .get(normalizeEmail(email)) as
      | {
          id: number;
          email: string;
          password_hash: string;
          display_name: string;
          role: 'admin' | 'user';
          created_at: string;
        }
      | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = createAuthSession(row.id);
    setSessionCookie(res, token, req);
    res.json({
      user: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        createdAt: row.created_at,
      },
    });
  });

  router.post('/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      deleteAuthSessionByToken(token);
    }
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  router.delete('/account', requireAuth, (req, res) => {
    const { password } = (req.body || {}) as { password?: string };
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Bitte gib zur Bestätigung dein Passwort ein.' });
      return;
    }

    const row = db
      .prepare(`SELECT id, password_hash FROM users WHERE id = ?`)
      .get(req.user!.id) as { id: number; password_hash: string } | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Passwort ist nicht korrekt.' });
      return;
    }

    const result = deleteUserAccount(req.user!.id);
    if (!result.ok) {
      res.status(400).json({ error: result.error || 'Konto konnte nicht gelöscht werden.' });
      return;
    }

    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  router.get('/invites', requireAuth, requireAdmin, (_req, res) => {
    const invites = db
      .prepare(
        `SELECT code, created_by_user_id, used_by_user_id, expires_at, used_at, created_at
         FROM invite_codes
         ORDER BY created_at DESC`
      )
      .all();
    res.json({ invites });
  });

  router.post('/invites', requireAuth, requireAdmin, (req, res) => {
    const { expiresInDays } = (req.body || {}) as { expiresInDays?: number };
    const code = crypto.randomBytes(6).toString('hex');
    const days = typeof expiresInDays === 'number' && expiresInDays > 0 ? expiresInDays : 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO invite_codes (code, created_by_user_id, expires_at) VALUES (?, ?, ?)`
    ).run(code, req.user!.id, expiresAt);

    res.status(201).json({ code, expiresAt });
  });

  return router;
}

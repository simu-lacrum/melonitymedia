// ─────────────────────────────────────────────────────────────
// Auth Routes
//
// Key design decisions:
// 1. First registered user → ADMIN (checked by counting users)
// 2. JWT in HttpOnly cookie (not header) for XSS protection
// 3. bcrypt with 12 rounds (balance between security and speed)
// 4. Zod validation on every input (never trust the client)
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET!; // validated at startup (M-3)
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
// Parse the duration string to seconds for jwt.sign()
// ms('7d') returns 604800000 (ms), so we divide by 1000 for seconds
const JWT_EXPIRES_SECONDS = Math.floor(ms(JWT_EXPIRES_IN as ms.StringValue) / 1000);
const BCRYPT_ROUNDS = 12;

// ── Validation Schemas ──────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  name: z.string().min(1, 'Имя обязательно').optional(),
});

const loginSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(1, 'Пароль обязателен'),
});

// Helper: create JWT and set as HttpOnly cookie
function issueToken(res: Response, payload: { id: string; email: string; role: string }) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_SECONDS });

  res.cookie('melonity_token', token, {
    httpOnly: true,         // JS can't read this cookie
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',     // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    path: '/',
  });

  return token;
}

// ── POST /register ──────────────────────────────────────────
router.post('/register', authRateLimit, async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email, password, name } = parsed.data;

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Пользователь с таким email уже существует' });
      return;
    }

    // First user ever → ADMIN. This is the bootstrap mechanism:
    // no seed script needed, just register and you're admin.
    const userCount = await prisma.user.count();
    const role = userCount === 0 ? 'ADMIN' : 'USER';

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: { email, passwordHash, name, role },
    });

    issueToken(res, { id: user.id, email: user.email, role: user.role });

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('[Auth] Registration error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// ── POST /login ─────────────────────────────────────────────
router.post('/login', authRateLimit, async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Неверный email или пароль' });
      return;
    }

    if (user.isBanned) {
      res.status(403).json({ error: 'Аккаунт заблокирован' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Неверный email или пароль' });
      return;
    }

    issueToken(res, { id: user.id, email: user.email, role: user.role });

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// ── POST /logout ────────────────────────────────────────────
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('melonity_token', { path: '/' });
  res.json({ success: true });
});

// ── GET /me ─────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        maxThreads: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }

    res.json({ user });
  } catch (err) {
    console.error('[Auth] /me error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

export default router;

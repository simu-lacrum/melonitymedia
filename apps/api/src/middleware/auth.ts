// ─────────────────────────────────────────────────────────────
// JWT Authentication Middleware
//
// Reads JWT from HttpOnly cookie "melonity_token".
// Why cookie instead of Authorization header?
// - HttpOnly cookies are immune to XSS (JS can't read them)
// - Automatically sent with every request (no client-side code)
// - SameSite=Strict prevents CSRF in modern browsers
// ─────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import type { JwtPayload } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.melonity_token;

  if (!token) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // Check if user is banned — instant rejection
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { isBanned: true },
    });

    if (!user || user.isBanned) {
      res.clearCookie('melonity_token');
      res.status(403).json({ error: 'Аккаунт заблокирован' });
      return;
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

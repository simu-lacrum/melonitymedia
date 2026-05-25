// ─────────────────────────────────────────────────────────────
// Admin Guard Middleware
// Simple role check — must come AFTER auth middleware.
// ─────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Доступ только для администраторов' });
    return;
  }
  next();
}

// ─────────────────────────────────────────────────────────────
// Express type extensions
// Adds typed user object to Request after JWT verification.
// ─────────────────────────────────────────────────────────────

export interface JwtPayload {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export {};

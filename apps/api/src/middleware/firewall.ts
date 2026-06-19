// ─────────────────────────────────────────────────────────────
// IP Firewall Middleware
//
// Checks incoming IP against Redis SET "firewall:blocked_ips".
// If the IP is in the set → immediate 403 Forbidden.
// Admin manages the blocklist via /api/admin/firewall endpoints.
//
// Why Redis SET? O(1) lookups, shared across all API instances,
// changes take effect instantly (no restart needed).
// ─────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';

const BLOCKED_IPS_KEY = 'firewall:blocked_ips';

export async function firewallMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Use req.ip which respects app.set('trust proxy', 1) configuration.
  // Raw x-forwarded-for header is user-controllable and can be spoofed (M-5).
  const clientIp = req.ip || req.socket.remoteAddress || '';

  try {
    const isBlocked = await redis.sismember(BLOCKED_IPS_KEY, clientIp);
    if (isBlocked) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  } catch (err) {
    // If Redis is down, don't block legitimate traffic
    // Log the error but let the request through
    console.error('[Firewall] Redis check failed:', err);
  }

  next();
}

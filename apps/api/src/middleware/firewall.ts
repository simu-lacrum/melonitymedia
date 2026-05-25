// ─────────────────────────────────────────────────────────────
// IP Firewall Middleware
//
// Checks incoming IP against Redis SET "firewall:blocked_ips".
// If the IP is in the set → immediate 403 Forbidden.
// Admin manages the blocklist via /admin/firewall endpoints.
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
  // Get real client IP (works behind nginx/load balancer)
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '';

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

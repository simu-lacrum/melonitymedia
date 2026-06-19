// ─────────────────────────────────────────────────────────────
// MelonityMedia API Server — Main Entry Point
//
// Architecture overview:
// ┌─────────────┐     ┌──────────┐     ┌──────────┐
// │   Next.js   │────▶│  Express │────▶│  BullMQ  │
// │  Frontend   │     │   API    │     │  Queues  │
// └─────────────┘     └────┬─────┘     └────┬─────┘
//                          │                 │
//                     ┌────▼─────┐     ┌────▼─────┐
//                     │ PostgreSQL│    │  Worker   │
//                     │ (Prisma) │    │(Patchright)│
//                     └──────────┘    └──────────┘
//
// The API server handles HTTP requests and WebSocket connections.
// It NEVER runs browser automation directly — that's the worker's job.
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createSocketServer } from './lib/socket.js';
import { firewallMiddleware } from './middleware/firewall.js';
import { apiRateLimit } from './middleware/rate-limit.js';

// Route imports
import authRoutes from './routes/auth.js';
import accountsRoutes from './routes/accounts.js';
import proxiesRoutes from './routes/proxies.js';
import workspaceRoutes from './routes/workspace.js';
import videosRoutes from './routes/videos.js';
import analyticsRoutes from './routes/analytics.js';
import adminRoutes from './routes/admin.js';
import { registerCronJobs } from './lib/cron-scheduler.js';

// ── Fail-fast: Validate critical secrets at startup ────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error(
    '\n╔══════════════════════════════════════════════════════════════╗\n' +
    '║  FATAL: JWT_SECRET must be set and at least 16 characters  ║\n' +
    '║  Set it in .env: JWT_SECRET=your-secure-random-string      ║\n' +
    '╚══════════════════════════════════════════════════════════════╝\n',
  );
  process.exit(1);
}

const MASTER_KEY = process.env.MASTER_KEY;
if (!MASTER_KEY) {
  console.error(
    '\n╔══════════════════════════════════════════════════════════════╗\n' +
    '║  FATAL: MASTER_KEY is required for cookie encryption        ║\n' +
    '║  Generate: node -e "console.log(require(\'crypto\')         ║\n' +
    '║    .randomBytes(32).toString(\'base64\'))"                   ║\n' +
    '╚══════════════════════════════════════════════════════════════╝\n',
  );
  process.exit(1);
}
const masterKeyBuf = Buffer.from(MASTER_KEY, 'base64');
if (masterKeyBuf.length !== 32) {
  console.error(
    '\n╔══════════════════════════════════════════════════════════════╗\n' +
    '║  FATAL: MASTER_KEY must be 32 bytes (base64 encoded)       ║\n' +
    '║  Generate: node -e "console.log(require(\'crypto\')         ║\n' +
    '║    .randomBytes(32).toString(\'base64\'))"                   ║\n' +
    '╚══════════════════════════════════════════════════════════════╝\n',
  );
  process.exit(1);
}

const PORT = parseInt(process.env.PORT_API || '4000', 10);

// ── Express App Setup ───────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// Attach Socket.io to the same HTTP server
// This allows real-time log streaming to the frontend
const io = createSocketServer(httpServer);

// Make Socket.io accessible in route handlers for emitting events
app.set('io', io);

// ── Global Middleware ───────────────────────────────────────

// Security headers (XSS protection, CSP, etc.)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — allow frontend origin with credentials (cookies)
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// Parse JSON bodies (limit 10mb for large import payloads)
app.use(express.json({ limit: '10mb' }));

// Parse cookies (needed for JWT HttpOnly cookie)
app.use(cookieParser());

// Trust proxy headers (needed when behind nginx/docker)
app.set('trust proxy', 1);

// IP Firewall — check every request against Redis blacklist
app.use(firewallMiddleware);

// General API rate limit; auth routes keep their stricter per-route limiter.
app.use('/api', apiRateLimit);

// ── API Routes ──────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/proxies', proxiesRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/videos', videosRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);

// ── Health Check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Debug Diagnostics (queue status + stuck accounts) ───────
app.get('/api/health/debug', async (_req, res) => {
  try {
    const { loginQueue } = await import('./lib/bullmq.js');
    const { prisma } = await import('./lib/prisma.js');

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      loginQueue.getWaitingCount(),
      loginQueue.getActiveCount(),
      loginQueue.getCompletedCount(),
      loginQueue.getFailedCount(),
      loginQueue.getDelayedCount(),
    ]);

    // Get recent failed jobs with error details
    const failedJobs = await loginQueue.getFailed(0, 5);
    const failedDetails = failedJobs.map(j => ({
      id: j.id,
      data: j.data,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      timestamp: j.timestamp,
    }));

    // Count stuck VERIFYING accounts
    const stuckAccounts = await prisma.socialAccount.findMany({
      where: { status: 'VERIFYING' },
      select: { id: true, username: true, createdAt: true, platform: true },
      take: 20,
    });

    res.json({
      loginQueue: { waiting, active, completed, failed, delayed },
      failedDetails,
      stuckVerifying: stuckAccounts,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 404 Handler ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ── Start Server ────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║     MelonityMedia API Server                 ║
  ║     Running on http://localhost:${PORT}          ║
  ╚══════════════════════════════════════════════╝
  `);

  // Register cron jobs (analytics, shadowban checks)
  registerCronJobs().catch(err => {
    console.error('[Server] Failed to register cron jobs:', err);
  });
});

// ── Graceful Shutdown ───────────────────────────────────────
// Ensures DB connections and active jobs are properly closed
const shutdown = async (signal: string) => {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

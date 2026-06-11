// ─────────────────────────────────────────────────────────────
// Socket.io Server Setup
// Namespace: /logs — for live worker terminal output.
//
// Why rooms? Each user should only see logs from their own
// worker jobs, not from other users. Rooms enforce this:
// user joins room "user:{userId}", worker emits to that room.
//
// Login verification events (login:success, login:failed,
// login:2fa_required) are relayed from worker → frontend.
// ─────────────────────────────────────────────────────────────

import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!; // validated at startup (index.ts)

interface TokenPayload {
  id: string;
  email: string;
  role: string;
}

export function createSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
    },
  });

  // /logs namespace — live worker terminal
  const logsNamespace = io.of('/logs');

  // Auth middleware: verify JWT from handshake OR accept worker userId
  logsNamespace.use((socket, next) => {
    // Option 1: JWT token (from frontend browser)
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.cookie
        ?.split(';')
        .find((c: string) => c.trim().startsWith('melonity_token='))
        ?.replace(/^\s*melonity_token=/, '');

    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
        (socket as any).userId = payload.id;
        (socket as any).isWorker = false;
        return next();
      } catch {
        return next(new Error('Invalid token'));
      }
    }

    // Option 2: Worker auth with userId (from worker service)
    const workerUserId = socket.handshake.auth?.userId;
    if (workerUserId && typeof workerUserId === 'string') {
      (socket as any).userId = workerUserId;
      (socket as any).isWorker = true;
      return next();
    }

    return next(new Error('Authentication required'));
  });

  logsNamespace.on('connection', (socket) => {
    const userId = (socket as any).userId as string;
    const isWorker = (socket as any).isWorker as boolean;
    // Each connection joins the user's room for isolated log streaming
    socket.join(`user:${userId}`);
    console.log(`[Socket] ${isWorker ? 'Worker' : 'User'} ${userId} connected to /logs`);

    // ── Login verification event relay ────────────────────
    // Worker emits these events. We relay them to ALL sockets
    // in the user's room (including frontend clients).
    const loginEvents = ['login:success', 'login:failed', 'login:2fa_required'] as const;
    for (const event of loginEvents) {
      socket.on(event, (data: any) => {
        // Broadcast to room (excluding the sender to avoid echo)
        socket.to(`user:${userId}`).emit(event, data);
      });
    }

    // ── Worker error event relay ─────────────────────────
    // Structured errors from ALL worker handlers (upload, warmup, etc.)
    // with code, title, message, and actionable advice.
    socket.on('worker:error', (data: any) => {
      socket.to(`user:${userId}`).emit('worker:error', data);
    });

    // ── Account status change events ────────────────────
    // Worker emits when account status changes so frontend can update in real-time
    socket.on('account:status_changed', (data: any) => {
      socket.to(`user:${userId}`).emit('account:status_changed', data);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] ${isWorker ? 'Worker' : 'User'} ${userId} disconnected from /logs`);
    });
  });

  return io;
}

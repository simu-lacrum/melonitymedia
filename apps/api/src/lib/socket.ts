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

  // Auth middleware: verify JWT from handshake
  logsNamespace.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.cookie
        ?.split(';')
        .find((c: string) => c.trim().startsWith('melonity_token='))
        ?.replace(/^\s*melonity_token=/, '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
      (socket as any).userId = payload.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  logsNamespace.on('connection', (socket) => {
    const userId = (socket as any).userId as string;
    // Each user joins their own room for isolated log streaming
    socket.join(`user:${userId}`);
    console.log(`[Socket] User ${userId} connected to /logs`);

    // ── Login verification event relay ────────────────────
    // Worker emits these events to the /logs namespace.
    // We relay them to the specific user's room.
    const loginEvents = ['login:success', 'login:failed', 'login:2fa_required'] as const;
    for (const event of loginEvents) {
      socket.on(event, (data: any) => {
        // Broadcast to all sockets in this user's room
        // (covers multiple tabs/devices)
        logsNamespace.to(`user:${userId}`).emit(event, data);
      });
    }

    socket.on('disconnect', () => {
      console.log(`[Socket] User ${userId} disconnected from /logs`);
    });
  });

  return io;
}

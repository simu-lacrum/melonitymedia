// ─────────────────────────────────────────────────────────────
// Socket Logger — Streams worker logs to frontend in real-time
//
// Each log message is sent to the user's Socket.io room,
// so they see a live terminal of what the worker is doing.
// ─────────────────────────────────────────────────────────────

import { io, Socket } from 'socket.io-client';

const API_URL = process.env.CORS_ORIGIN || 'http://localhost:4000';

class SocketLogger {
  private socket: Socket | null = null;
  private userId: string | null = null;

  /** Connect to the API server's /logs namespace */
  connect(token: string, userId: string): void {
    this.userId = userId;
    this.socket = io(`${API_URL}/logs`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[SocketLogger] Connected to /logs namespace');
    });

    this.socket.on('connect_error', (err) => {
      console.error('[SocketLogger] Connection error:', err.message);
    });
  }

  /** Send a log line to the user's room */
  log(level: 'INFO' | 'WARN' | 'ERROR', message: string, taskId?: string): void {
    if (!this.socket || !this.userId) return;

    this.socket.emit('log', {
      userId: this.userId,
      level,
      message,
      taskId,
      timestamp: new Date().toISOString(),
    });

    // Also log to stdout for Docker logs
    const prefix = `[${level}]`;
    console.log(`${prefix} ${message}`);
  }

  /** Notify task progress update */
  progress(taskId: string, progress: number): void {
    if (!this.socket) return;
    this.socket.emit('task:progress', {
      userId: this.userId,
      taskId,
      progress,
    });
  }

  /** Notify task completion */
  complete(taskId: string): void {
    if (!this.socket) return;
    this.socket.emit('task:complete', { userId: this.userId, taskId });
  }

  /** Notify task failure */
  failed(taskId: string, error: string): void {
    if (!this.socket) return;
    this.socket.emit('task:failed', { userId: this.userId, taskId, error });
  }

  /** Disconnect from Socket.io */
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketLogger = new SocketLogger();

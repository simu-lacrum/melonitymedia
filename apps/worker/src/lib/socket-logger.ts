// ─────────────────────────────────────────────────────────────
// Socket Logger — Streams worker logs to frontend in real-time
//
// Each log message is sent to the user's Socket.io room,
// so they see a live terminal of what the worker is doing.
//
// Two usage modes:
// 1. Singleton: socketLogger.connect(...) → socketLogger.log(...)
// 2. Per-job:   new SocketLogger(userId) — auto-connects
// ─────────────────────────────────────────────────────────────

import { io, Socket } from 'socket.io-client';

const API_URL =
  process.env.WORKER_API_URL ||
  process.env.API_INTERNAL_URL ||
  process.env.API_URL ||
  'http://localhost:4000';

export class SocketLogger {
  private socket: Socket | null = null;
  private userId: string | null = null;

  /**
   * Create a per-job logger that auto-connects.
   * Used by handlers: new SocketLogger(userId)
   */
  constructor(userId?: string) {
    if (userId) {
      this.userId = userId;
      this.socket = io(`${API_URL}/logs`, {
        auth: { userId },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
      });
    }
  }

  /** Connect to the API server's /logs namespace (singleton mode) */
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

  // ── Convenience methods (used by handlers) ────────────────

  /** Send info-level log */
  info(message: string, taskId?: string): void {
    this.log('INFO', message, taskId);
  }

  /** Send warning-level log */
  warn(message: string, taskId?: string): void {
    this.log('WARN', message, taskId);
  }

  /** Send error-level log */
  error(message: string, taskId?: string): void {
    this.log('ERROR', message, taskId);
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

/** Singleton instance for global worker logging */
export const socketLogger = new SocketLogger();

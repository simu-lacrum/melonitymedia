// ─────────────────────────────────────────────────────────────
// Global Worker Log Store — singleton module
//
// Keeps Socket.IO connection alive and logs persisted across
// page navigations. Components subscribe via useSyncExternalStore.
// ─────────────────────────────────────────────────────────────

import { io, Socket } from 'socket.io-client';

export interface LogLine {
  id: string;
  timestamp: string;
  level: 'info' | 'error' | 'success' | 'warning';
  message: string;
}

// ── Module-level state (survives navigation) ─────────────────
let socket: Socket | null = null;
let logs: LogLine[] = [];
let connected = false;
let listeners = new Set<() => void>();

// Max logs to keep in memory
const MAX_LOGS = 200;

// ── Notify all subscribers ───────────────────────────────────
function emit() {
  listeners.forEach((fn) => fn());
}

// ── Connect (idempotent) ─────────────────────────────────────
export function ensureConnected() {
  if (socket?.connected) return;
  if (socket) {
    // Already created but disconnected — reconnect
    socket.connect();
    return;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const origin = apiUrl.replace(/\/api\/?$/, '') || apiUrl;
  socket = io(`${origin}/logs`, {
    withCredentials: true,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    connected = true;
    addLog({
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: 'WebSocket Connected: Streaming worker logs...',
    });
  });

  socket.on('disconnect', () => {
    connected = false;
    emit();
  });

  socket.on('worker:log', (data: LogLine) => {
    addLog(data);
  });
}

function addLog(log: LogLine) {
  logs = [...logs.slice(-(MAX_LOGS - 1)), log];
  emit();
}

// ── Public API ───────────────────────────────────────────────
export function getSnapshot(): { logs: LogLine[]; connected: boolean } {
  return { logs, connected };
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearLogs() {
  logs = [];
  emit();
}

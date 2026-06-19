import type { Request, Response } from 'express';
import { request as httpRequest } from 'http';
import type { IncomingMessage, Server as HttpServer } from 'http';
import net from 'net';
import type { Duplex } from 'stream';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma.js';

const JWT_SECRET = process.env.JWT_SECRET!;
const WORKER_HOST = process.env.VNC_WORKER_HOST || 'worker';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export async function getOwnedVncSession(userId: string, taskId: string, jobId: string) {
  return prisma.vncSession.findFirst({
    where: {
      userId,
      taskId,
      jobId,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      taskId: true,
      accountId: true,
      jobId: true,
      webPort: true,
      password: true,
      status: true,
    },
  });
}

export function buildNoVncClientUrl(taskId: string, jobId: string, password: string): string {
  const base = `/api/workspace/jobs/${encodeURIComponent(taskId)}/vnc/${encodeURIComponent(jobId)}`;
  const wsPath = `api/workspace/jobs/${encodeURIComponent(taskId)}/vnc/${encodeURIComponent(jobId)}/websockify`;
  const params = new URLSearchParams({
    autoconnect: '1',
    resize: 'scale',
    path: wsPath,
    password,
  });
  return `${base}/vnc.html?${params.toString()}`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

async function authenticateUpgradeUser(req: IncomingMessage): Promise<string> {
  const token = parseCookies(req.headers.cookie).melonity_token;
  if (!token) {
    throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  }

  let payload: { id?: string };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { id?: string };
  } catch {
    throw Object.assign(new Error('Invalid token'), { statusCode: 401 });
  }

  if (!payload.id) {
    throw Object.assign(new Error('Invalid token'), { statusCode: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { isBanned: true, isApproved: true },
  });

  if (!user || user.isBanned || !user.isApproved) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  }

  return payload.id;
}

function writeSocketError(socket: Duplex, statusCode: number, message: string): void {
  const statusText = statusCode === 401
    ? 'Unauthorized'
    : statusCode === 403
      ? 'Forbidden'
      : statusCode === 404
        ? 'Not Found'
        : 'Bad Gateway';
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    '\r\n' +
    body,
  );
}

function buildUpgradeRequest(req: IncomingMessage, upstreamPath: string, webPort: number): string {
  const lines = [
    `GET ${upstreamPath} HTTP/1.1`,
    `Host: ${WORKER_HOST}:${webPort}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
  ];

  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    const value = req.rawHeaders[i + 1];
    if (!name || value === undefined) continue;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === 'host' || lower === 'cookie') continue;
    lines.push(`${name}: ${value}`);
  }

  return `${lines.join('\r\n')}\r\n\r\n`;
}

export function attachVncWebSocketProxy(httpServer: HttpServer): void {
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const match = url.pathname.match(/^\/api\/workspace\/jobs\/([^/]+)\/vnc\/([^/]+)\/websockify$/);
    if (!match) return;

    void (async () => {
      let taskId: string;
      let jobId: string;
      try {
        taskId = decodeURIComponent(match[1]);
        jobId = decodeURIComponent(match[2]);
      } catch {
        writeSocketError(socket, 404, 'Monitor not found');
        return;
      }

      try {
        const userId = await authenticateUpgradeUser(req);
        const session = await getOwnedVncSession(userId, taskId, jobId);
        if (!session) {
          writeSocketError(socket, 404, 'Monitor not found');
          return;
        }

        const upstream = net.connect(session.webPort, WORKER_HOST);
        upstream.on('connect', () => {
          upstream.write(buildUpgradeRequest(req, `/websockify${url.search}`, session.webPort));
          if (head.length > 0) upstream.write(head);
          socket.pipe(upstream);
          upstream.pipe(socket);
        });

        upstream.on('error', () => {
          if (!socket.destroyed) writeSocketError(socket, 502, 'Monitor is unavailable');
        });
        socket.on('error', () => upstream.destroy());
      } catch (err) {
        const statusCode = typeof (err as { statusCode?: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 502;
        writeSocketError(socket, statusCode, statusCode === 401 ? 'Authentication required' : 'Monitor is unavailable');
      }
    })();
  });
}

export function proxyNoVncHttp(
  req: Request,
  res: Response,
  webPort: number,
  upstreamPath: string,
): Promise<void> {
  return new Promise((resolve) => {
    const headers = { ...req.headers };
    for (const name of Object.keys(headers)) {
      if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === 'cookie') {
        delete headers[name];
      }
    }

    const upstreamReq = httpRequest({
      hostname: WORKER_HOST,
      port: webPort,
      method: req.method,
      path: upstreamPath === '/' ? '/vnc.html' : upstreamPath,
      headers: {
        ...headers,
        host: `${WORKER_HOST}:${webPort}`,
      },
    }, (upstreamRes) => {
      res.status(upstreamRes.statusCode || 502);
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (!value || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
        res.setHeader(name, value);
      }
      upstreamRes.pipe(res);
      upstreamRes.on('end', resolve);
    });

    upstreamReq.on('error', () => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Monitor is unavailable' });
      } else {
        res.end();
      }
      resolve();
    });

    if (req.method === 'GET' || req.method === 'HEAD') {
      upstreamReq.end();
    } else {
      req.pipe(upstreamReq);
    }
  });
}

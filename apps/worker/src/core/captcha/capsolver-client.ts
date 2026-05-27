// ─────────────────────────────────────────────────────────────
// CapSolver client — TikTok / hCaptcha solver
//
// API docs: https://docs.capsolver.com/
//
// We use AntiTiktokTask (not the ProxyLess variant) — the
// solver uses OUR pinned proxy URL so the solve traffic
// comes from the same IP as the session. This is critical:
// CapSolver-pool IP solving a captcha for a session on
// a different IP = automatic re-challenge.
// ─────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_DURATION_MS = 120_000;  // CapSolver SLA: < 30s for TikTok, 120s ceiling

type CaptchaType = 'tiktok' | 'hcaptcha';

export interface TikTokCaptchaInput {
  type: 'tiktok';
  websiteURL: string;
  bodyImage?: string;    // base64 background, no prefix
  pieceImage?: string;   // base64 piece (slider only)
  challengeType?: 'slide' | 'whirl' | 'rotate' | 'shape' | '3d';
  proxyUrl: string;      // http://user:pass@host:port — from loadAccountContext
  userAgent: string;     // must match the session's UA
}

export interface HCaptchaInput {
  type: 'hcaptcha';
  websiteURL: string;
  websiteKey: string;
  proxyUrl: string;
  userAgent: string;
}

export type CaptchaSolveInput = TikTokCaptchaInput | HCaptchaInput;

export type TikTokSolution =
  | { kind: 'slider'; x: number; y?: number }
  | { kind: 'whirl';  angle: number }
  | { kind: 'shape';  points: Array<{ x: number; y: number }> };

export interface HCaptchaSolution {
  kind: 'hcaptcha';
  token: string;
}

export type CaptchaSolution = TikTokSolution | HCaptchaSolution;

function getConfig() {
  const apiKey = process.env.CAPSOLVER_API_KEY;
  const apiUrl = process.env.CAPSOLVER_API_URL ?? 'https://api.capsolver.com';
  if (!apiKey) {
    throw new Error(
      '[capsolver] CAPSOLVER_API_KEY not set. Either set it in .env or refactor caller to skip captcha.',
    );
  }
  return { apiKey, apiUrl };
}

function parseProxyUrl(proxyUrl: string) {
  const url = new URL(proxyUrl);
  return {
    proxyType: 'http' as const,
    proxyAddress: url.hostname,
    proxyPort: parseInt(url.port, 10),
    proxyLogin: url.username ? decodeURIComponent(url.username) : undefined,
    proxyPassword: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

function buildTask(input: CaptchaSolveInput) {
  const proxy = parseProxyUrl(input.proxyUrl);

  if (input.type === 'tiktok') {
    return {
      type: 'AntiTiktokTask',
      websiteURL: input.websiteURL,
      userAgent: input.userAgent,
      ...(input.bodyImage ? { bodyImage: input.bodyImage } : {}),
      ...(input.pieceImage ? { pieceImage: input.pieceImage } : {}),
      ...(input.challengeType ? { challengeType: input.challengeType } : {}),
      ...proxy,
    };
  }

  if (input.type === 'hcaptcha') {
    return {
      type: 'HCaptchaTask',
      websiteURL: input.websiteURL,
      websiteKey: input.websiteKey,
      userAgent: input.userAgent,
      ...proxy,
    };
  }

  throw new Error(`[capsolver] unsupported captcha type`);
}

function parseSolution(raw: unknown, captchaType: CaptchaType): CaptchaSolution {
  if (!raw || typeof raw !== 'object') {
    throw new Error('[capsolver] empty solution from API');
  }
  const r = raw as Record<string, unknown>;

  if (captchaType === 'hcaptcha') {
    if (typeof r.gRecaptchaResponse === 'string') {
      return { kind: 'hcaptcha', token: r.gRecaptchaResponse };
    }
    throw new Error(`[capsolver] hcaptcha solution missing token: ${JSON.stringify(r).slice(0, 120)}`);
  }

  // tiktok
  if (typeof r.x === 'number') {
    return { kind: 'slider', x: r.x, y: typeof r.y === 'number' ? r.y : undefined };
  }
  if (typeof r.angle === 'number') {
    return { kind: 'whirl', angle: r.angle };
  }
  if (Array.isArray(r.points)) {
    return { kind: 'shape', points: r.points as Array<{ x: number; y: number }> };
  }
  throw new Error(`[capsolver] unrecognized TikTok solution shape: ${JSON.stringify(r).slice(0, 120)}`);
}

export async function solveCaptcha(input: CaptchaSolveInput): Promise<CaptchaSolution> {
  const { apiKey, apiUrl } = getConfig();

  // ── Submit task ───────────────────────────────────────────
  const createRes = await fetch(`${apiUrl}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: buildTask(input),
    }),
  });

  if (!createRes.ok) {
    throw new Error(`[capsolver] createTask HTTP ${createRes.status}: ${await createRes.text()}`);
  }

  const createJson = (await createRes.json()) as {
    errorId?: number;
    errorCode?: string;
    errorDescription?: string;
    taskId?: string;
  };

  if (createJson.errorId && createJson.errorId !== 0) {
    throw new Error(
      `[capsolver] createTask error ${createJson.errorCode}: ${createJson.errorDescription}`,
    );
  }
  if (!createJson.taskId) {
    throw new Error('[capsolver] createTask returned no taskId');
  }

  // ── Poll for result ───────────────────────────────────────
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_POLL_DURATION_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const resultRes = await fetch(`${apiUrl}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: createJson.taskId }),
    });

    if (!resultRes.ok) {
      throw new Error(`[capsolver] getTaskResult HTTP ${resultRes.status}`);
    }

    const resultJson = (await resultRes.json()) as {
      errorId?: number;
      errorCode?: string;
      errorDescription?: string;
      status?: 'processing' | 'ready';
      solution?: unknown;
    };

    if (resultJson.errorId && resultJson.errorId !== 0) {
      throw new Error(
        `[capsolver] getTaskResult error ${resultJson.errorCode}: ${resultJson.errorDescription}`,
      );
    }
    if (resultJson.status === 'ready') {
      return parseSolution(resultJson.solution, input.type);
    }
    // status === 'processing' — continue polling
  }

  throw new Error(`[capsolver] timeout after ${MAX_POLL_DURATION_MS}ms`);
}

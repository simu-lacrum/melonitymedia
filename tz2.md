# PROMPT: MelonityMedia Documentation & Code Hardening Pass

**Role:** You are a senior backend engineer working on MelonityMedia (TikTok/YouTube Shorts SaaS automation panel). The project's documentation has been reviewed and 8 issues were identified — some are documentation gaps, three (#1, #5, #6) require both code AND documentation changes, and the rest are doc-only or housekeeping. Execute the following changes as a single PR titled `chore(docs): hardening pass — carrier rule, shadowban gate, fingerprint consistency, env, first-run flow` split into logical commits per section below.

**Mandatory before starting:**
1. `git checkout -b chore/docs-hardening-pass`
2. Run `npm run typecheck && npm run lint` — must be green before you start.
3. For every code change in this prompt, add a unit test (Vitest) that covers the new branch.
4. For every doc change, ensure markdown lint passes (`npx markdownlint-cli2 "**/*.md"`).
5. **Do not** introduce new dependencies. Everything in this prompt uses libraries already present.
6. **Do not** rewrite files wholesale. Use targeted edits — find the exact section by header and patch in place.

**Definition of done per item:** unit test added + doc updated + manual smoke test described in commit message.

---

## ISSUE 1 — Broken `.env.example` fragment in README

**File:** `README.md` (root)

**Symptom:** The "Переменные окружения" section contains a corrupted fragment:
```
REDIS_URL=redis://localhost:***@handle
}
```

**Fix:** Locate the section starting with `## ⚙️ Переменные окружения` and replace the entire fenced bash block with:

````markdown
## ⚙️ Переменные окружения

```bash
# ── Database ──────────────────────────────────────────
DATABASE_URL=postgresql://melonity:***@localhost:5432/melonitymedia

# ── Redis (BullMQ + Cache + Firewall) ─────────────────
REDIS_URL=redis://localhost:6379

# ── JWT Auth ──────────────────────────────────────────
JWT_SECRET=replace_me_64_hex_chars
JWT_EXPIRES_IN=7d

# ── Cookie Encryption (AES-256-GCM) ───────────────────
# Generate ONCE per environment with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# 32 bytes -> 44 chars base64. NEVER change after launch — old cookies become unrecoverable.
# Use scripts/rotate-master-key.mjs for safe rotation.
MASTER_KEY=replace_me_44_chars_base64

# ── Server Ports ──────────────────────────────────────
PORT_API=4000
PORT_WEB=3000

# ── File Storage ──────────────────────────────────────
UPLOAD_DIR=./uploads

# ── CORS ──────────────────────────────────────────────
CORS_ORIGIN=http://localhost:3000

# ── Frontend (exposed to browser) ─────────────────────
NEXT_PUBLIC_API_URL=http://localhost:4000
```
````

**Also update `.env.example`** — make sure the same 11 variables are present in the same order, with `replace_me_*` placeholders for secrets. Do NOT commit actual values.

**Commit:** `fix(docs): repair corrupted env vars block in README`

---

## ISSUE 2 — `local-development.md` missing TikTok account onboarding flow

**File:** `docs/guides/local-development.md`

**Fix:** Locate the section `## 6. Первый запуск` and replace it entirely with:

```markdown
## 6. Первый запуск

Регистрация владельца панели и первый прогон end-to-end:

1. Откройте http://localhost:3000
2. Зарегистрируйтесь через `/auth/register` — это **владелец панели MelonityMedia**, не TikTok-аккаунт.
3. После авторизации вы попадёте на `/account/dashboard`.

### 6.1. Добавление первого прокси

> Без прокси воркер не запустит ни одну задачу — это hard gate.

1. Перейдите в `/account/proxies` → **«Добавить прокси»**.
2. Заполните поля:
   - **Type:** `LTE_MOBILE` (для TikTok — обязательно; `STATIC_RESIDENTIAL` допустим для YouTube Shorts).
   - **Host / Port / Login / Pass:** из дашборда вашего proxy-провайдера.
   - **Rotation Link:** URL для смены IP (если есть). Cooldown минимум 900 сек (15 мин).
   - **Carrier:** реальный оператор (T-Mobile, Verizon, MTS, Beeline, ...). Это критично — антифрод TikTok корреллирует ASN с заявленным carrier.
   - **Country / DMA:** должны совпадать с регионом, который carrier реально обслуживает.
3. Нажмите **«Тест»** — система проверит соединение и сохранит `bgpPathValid` флаг.

### 6.2. Импорт первого TikTok-аккаунта

> log:pass-формат **не поддерживается** — TikTok с 2024 принудительно требует SMS-challenge при логине через прокси. Импортируются ТОЛЬКО cookies.

1. Установите расширение Cookie-Editor / EditThisCookie в обычный Chrome.
2. Залогиньтесь вручную в TikTok с **того же региона**, что и купленный прокси (если прокси US — VPN/RDP в US, иначе TikTok сразу выставит challenge).
3. Экспортируйте cookies → `JSON` или `Netscape .txt`.
4. В панели: `/account/profiles` → **«Импорт аккаунтов»** → перетащите файл cookies в DropZone.
5. Дождитесь сообщения «Аккаунт импортирован, fingerprint сгенерирован». Cookies моментально шифруются AES-256-GCM перед записью в БД.

### 6.3. Привязка прокси к аккаунту (14-day pin)

1. В таблице `/account/profiles` выберите аккаунт чекбоксом.
2. **Bulk Actions** → **«Привязать прокси»** → выберите тот, что добавили в 6.1.
3. После привязки `proxyPinnedAt = now()`. Менять прокси у этого аккаунта в течение 14 дней нельзя без `force=true` (см. `backend-contracts.md` → Carrier Stability Rule).

### 6.4. Прогрев аккаунта (обязательно перед первым заливом)

1. В таблице `/account/profiles` выберите аккаунт → **«Запустить прогрев»**.
2. Статус сменится на `WARMING_UP`. Worker автоматически запустит 10-day curriculum:
   - Day 1-3: passive FYP scroll
   - Day 4-6: light engagement (likes, 1 comment)
   - Day 7-10: active engagement (likes, comments, saves, follows)
3. Колонка **«Warmup Day»** покажет прогресс `X / 10`.
4. Когда `warmupCompletedAt != null` → аккаунт допускается в очередь `upload`.

### 6.5. Первый залив

1. `/account/workspace` → выберите готовый аккаунт.
2. Перетащите .mp4 в **«Медиатеку»**. Видео автоматически уникализируется per account (FFmpeg detereministic transforms).
3. Заполните пулы названий/описаний/тегов, нажмите **«ЗАПУСТИТЬ ЗАДАЧУ»**.
4. Следите за **Live Terminal** — Socket.io транслирует логи воркера в реальном времени.

> [!WARNING]
> **Не запускайте заливы на аккаунтах со статусом `WARMING_UP` или `SHADOWBAN_SUSPECTED`** — система их отфильтрует, но если форс-пушите через API, риск перманентной потери аккаунта возрастает кратно.
```

**Commit:** `docs(guides): expand first-run flow with proxy/cookie/warmup steps`

---

## ISSUE 3 — README "Cookie refresh" feature не объяснён

**File:** `README.md`

**Fix:** В hero-таблице `## 🎯 Обзор` найдите строку:
```
| 🍪 **Cookie-based auth** | AES-256-GCM шифрование cookies, pre-flight валидация через curl-impersonate |
```

Добавьте **сразу после неё** новую строку:
```
| 🔄 **Cookie refresh** | Lightweight продление сессий через Patchright (5-10 мин FYP scrolling), обновляет `tt_webid` / `s_v_web_id` без переавторизации |
```

И в таблице очередей (`## 📦 Система очередей`) найдите строку для очереди `cookies` и замените её описание на:
```
| `cookies` | `cookies.ts` | Кнопка / Cron | Refresh сессии: Patchright session → лёгкий FYP scroll 5-10 мин → re-export cookies → re-encrypt → save. **Не путать** с "нагулом кук на сайтах-донорах" (deprecated, не работает с 2024). |
```

**Commit:** `docs(readme): clarify cookie refresh feature scope`

---

## ISSUE 4 — Card компонент: legitimize ограниченный glassmorphism

**Context from owner:** Glassmorphism применяется **только** к Header (внутри `Card.tsx` есть ветка для header-варианта). В остальных Card-инстансах используется flat dark surface.

**File:** `README.md`

**Fix:**

1. В таблице `## 🧩 UI-компоненты` найдите строку Card и замените на:
```
| `Card` | `Card.tsx` | Контейнер с тонкой границей и spatial elevation. **Только в варианте `header`** используется лёгкий backdrop-blur для глобальной шапки. |
```

2. В секции `## 🎨 Дизайн-система → Дизайн-принципы (Strict Corporate Dark)` замените строку про `Без neon glow` на пару строк:
```
| **Без neon glow** | Никаких `box-shadow` с цветным свечением (`rgba(255,20,105,...)`) |
| **Glassmorphism — exception** | `backdrop-filter: blur(12px)` допустим ТОЛЬКО в `Card.tsx` варианте `header`. Все остальные Card используют сплошной `--color-surface-dark`. |
```

**Code (apps/web/src/components/ui/Card.tsx):** Enforce the rule at component level. Replace the component body with:

```tsx
import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type CardVariant = "surface" | "elevated" | "header";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

/**
 * Strict Corporate Dark Card.
 *
 * - `surface` (default): flat `--color-surface-dark`, hairline border, spatial shadow.
 * - `elevated`: same as surface + `--color-surface-elevated` background + stronger shadow.
 * - `header`: ONLY for the global sticky header. Uses backdrop-blur for the glass effect.
 *   Do NOT reuse `variant="header"` elsewhere — glassmorphism is forbidden outside the header
 *   by the design system (see README → Дизайн-принципы).
 */
export function Card({
  variant = "surface",
  className,
  ...rest
}: CardProps) {
  const base =
    "rounded-xl border border-white/[0.04] text-white";
  const variants: Record<CardVariant, string> = {
    surface:
      "bg-[var(--color-surface-dark)] shadow-[0_8px_30px_rgba(0,0,0,0.2)]",
    elevated:
      "bg-[var(--color-surface-elevated)] shadow-[0_12px_40px_rgba(0,0,0,0.28)]",
    header:
      "bg-[rgba(28,32,38,0.72)] backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.32)]",
  };

  return (
    <div className={cn(base, variants[variant], className)} {...rest} />
  );
}
```

**Test (apps/web/src/components/ui/__tests__/Card.test.tsx):**

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Card } from "../Card";

describe("Card", () => {
  it("defaults to flat surface (no backdrop-blur)", () => {
    const { container } = render(<Card>x</Card>);
    expect(container.firstChild).not.toHaveClass("backdrop-blur-xl");
  });

  it("applies backdrop-blur only when variant=header", () => {
    const { container } = render(<Card variant="header">x</Card>);
    expect(container.firstChild).toHaveClass("backdrop-blur-xl");
  });

  it("elevated variant keeps shadow but no blur", () => {
    const { container } = render(<Card variant="elevated">x</Card>);
    expect(container.firstChild).not.toHaveClass("backdrop-blur-xl");
  });
});
```

**Commit:** `feat(ui): formalize Card variants — glassmorphism scoped to header only`

---

## ISSUE 5 — Carrier-change rule (CRITICAL)

**Context:** TikTok с августа 2025 коррелирует identity (IP + device fingerprint) в 14-дневном rolling-окне. Смена carrier у одного и того же аккаунта внутри окна = "unstable identity" score → shadowban на 14-21 день. В backend-contracts.md правило отсутствует, API его не enforces — это самый критичный gap.

### 5.1. Code — Prisma schema

**File:** `apps/api/prisma/schema.prisma`

Найдите модель `Proxy` и убедитесь, что присутствуют поля `carrier`, `country`, `asn`. Если каких-то нет — добавьте:

```prisma
model Proxy {
  // ... existing fields ...
  type            ProxyType  @default(STATIC_RESIDENTIAL)
  carrier         String?    // "T-Mobile" | "Verizon" | "AT&T" | "MTS" | "Beeline" | etc.
  country         String     @default("US")
  asn             Int?       // 21928 = T-Mobile US, 6167 = Verizon, etc.
  dma             String?    // US Designated Market Area, optional
  bgpPathValid    Boolean    @default(false)
  // ...
}
```

В модели `SocialAccount` убедитесь, что есть `pinnedProxyId`, `proxyPinnedAt`:

```prisma
model SocialAccount {
  // ...
  pinnedProxyId    String?
  proxyPinnedAt    DateTime?
  pinnedProxy      Proxy?    @relation(fields: [pinnedProxyId], references: [id])
  // ...
}
```

Сгенерируйте миграцию: `npx prisma migrate dev --name carrier_fields_required`.

### 5.2. Code — Server-side guard

**File:** `apps/api/src/lib/proxy-pin-rules.ts` (new file)

```typescript
import type { Proxy, SocialAccount } from "@prisma/client";

export const PROXY_PIN_WINDOW_DAYS = 14;

export interface PinViolation {
  code:
    | "PIN_WINDOW_ACTIVE"
    | "CARRIER_CHANGE_BLOCKED"
    | "COUNTRY_CHANGE_BLOCKED"
    | "PROXY_NOT_LTE_FOR_TIKTOK";
  message: string;
  daysRemaining?: number;
  oldCarrier?: string | null;
  newCarrier?: string | null;
  oldCountry?: string | null;
  newCountry?: string | null;
}

/**
 * Validate a proxy reassignment against the 14-day correlation window rules.
 *
 * Returns `null` if the change is safe, or a `PinViolation` describing why it must be blocked.
 *
 * Rules enforced (TikTok 2026 antifraud):
 *  1. Within 14 days of pinning a proxy, you cannot reassign to a different proxy
 *     of the SAME carrier without explicit `force` — frequent rotations are themselves a signal.
 *  2. Carrier change at any point within the 14-day window is a hard block —
 *     correlation window resets, account hits shadowban for 14-21 days.
 *  3. Country change at any point is a hard block — TikTok geo-correlates with carrier.
 *  4. TikTok accounts younger than 30 days must use LTE_MOBILE proxy. Residential is rejected.
 */
export function validatePinChange(args: {
  account: Pick<
    SocialAccount,
    "id" | "platform" | "pinnedProxyId" | "proxyPinnedAt" | "createdAt"
  >;
  oldProxy: Pick<Proxy, "id" | "carrier" | "country" | "type"> | null;
  newProxy: Pick<Proxy, "id" | "carrier" | "country" | "type">;
  now?: Date;
}): PinViolation | null {
  const { account, oldProxy, newProxy } = args;
  const now = args.now ?? new Date();

  // Rule 4: TikTok + young account => must be LTE_MOBILE.
  const ageDays = (now.getTime() - account.createdAt.getTime()) / 86_400_000;
  if (
    account.platform === "TIKTOK" &&
    ageDays < 30 &&
    newProxy.type !== "LTE_MOBILE"
  ) {
    return {
      code: "PROXY_NOT_LTE_FOR_TIKTOK",
      message:
        `TikTok accounts younger than 30 days require LTE_MOBILE proxy (got ${newProxy.type}). ` +
        `Datacenter and residential proxies trigger BGP path scoring on new accounts.`,
    };
  }

  // If there's no previous pin, anything goes (within Rule 4 above).
  if (!oldProxy || !account.proxyPinnedAt) {
    return null;
  }

  // Same proxy reassignment — always allowed (idempotent).
  if (oldProxy.id === newProxy.id) {
    return null;
  }

  const pinAgeDays =
    (now.getTime() - account.proxyPinnedAt.getTime()) / 86_400_000;
  const daysRemaining = Math.ceil(PROXY_PIN_WINDOW_DAYS - pinAgeDays);

  // Rule 3: country change at any point — hard block.
  if (oldProxy.country !== newProxy.country) {
    return {
      code: "COUNTRY_CHANGE_BLOCKED",
      message:
        `Cannot switch proxy country (${oldProxy.country} -> ${newProxy.country}) ` +
        `for an account that already has session history. TikTok geo-correlates with carrier; ` +
        `country change forces full re-warming. Use force=true if you accept the risk.`,
      daysRemaining: Math.max(daysRemaining, 0),
      oldCountry: oldProxy.country,
      newCountry: newProxy.country,
    };
  }

  // Rule 2: TikTok-specific carrier change rule (any time, but most punishing within 14d).
  if (
    account.platform === "TIKTOK" &&
    oldProxy.carrier !== newProxy.carrier
  ) {
    return {
      code: "CARRIER_CHANGE_BLOCKED",
      message:
        `Carrier change (${oldProxy.carrier ?? "unknown"} -> ${newProxy.carrier ?? "unknown"}) ` +
        `resets the 14-day TikTok correlation window. Expected shadowban 14-21 days. ` +
        `Use force=true if you accept the risk.`,
      daysRemaining: Math.max(daysRemaining, 0),
      oldCarrier: oldProxy.carrier,
      newCarrier: newProxy.carrier,
    };
  }

  // Rule 1: within the 14-day window, even same-carrier swaps need a heads-up.
  if (pinAgeDays < PROXY_PIN_WINDOW_DAYS) {
    return {
      code: "PIN_WINDOW_ACTIVE",
      message:
        `Account is pinned to current proxy for ${daysRemaining} more day(s). ` +
        `Swapping within the 14-day window is permitted only with force=true.`,
      daysRemaining,
    };
  }

  return null;
}
```

**File:** `apps/api/src/routes/accounts.ts`

Найдите хэндлер `POST /api/accounts/bulk-proxy` и хэндлер `PATCH /api/accounts/:id` (там, где меняется `proxyId`). Перед записью в БД вставьте guard:

```typescript
import { validatePinChange } from "../lib/proxy-pin-rules.js";

// ... внутри хэндлера, ДО `prisma.socialAccount.update(...)`:

const force = req.query.force === "true" && req.user.role === "ADMIN";

for (const accountId of accountIds) {
  const account = await prisma.socialAccount.findUniqueOrThrow({
    where: { id: accountId, userId: req.user.id }, // tenant isolation
    select: {
      id: true,
      platform: true,
      pinnedProxyId: true,
      proxyPinnedAt: true,
      createdAt: true,
    },
  });

  const newProxy = await prisma.proxy.findUniqueOrThrow({
    where: { id: proxyId, userId: req.user.id },
    select: { id: true, carrier: true, country: true, type: true },
  });

  const oldProxy = account.pinnedProxyId
    ? await prisma.proxy.findUnique({
        where: { id: account.pinnedProxyId },
        select: { id: true, carrier: true, country: true, type: true },
      })
    : null;

  const violation = validatePinChange({ account, oldProxy, newProxy });

  if (violation && !force) {
    return res.status(409).json({
      success: false,
      error: violation.message,
      code: violation.code,
      details: {
        daysRemaining: violation.daysRemaining,
        oldCarrier: violation.oldCarrier,
        newCarrier: violation.newCarrier,
        oldCountry: violation.oldCountry,
        newCountry: violation.newCountry,
      },
    });
  }

  if (violation && force) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "PROXY_PIN_FORCE_OVERRIDE",
        entityType: "SocialAccount",
        entityId: account.id,
        metadata: {
          violation: violation.code,
          oldProxyId: oldProxy?.id ?? null,
          newProxyId: newProxy.id,
          oldCarrier: violation.oldCarrier,
          newCarrier: violation.newCarrier,
        },
      },
    });
  }

  await prisma.socialAccount.update({
    where: { id: accountId },
    data: {
      pinnedProxyId: newProxy.id,
      proxyPinnedAt: new Date(),
    },
  });
}
```

### 5.3. Tests

**File:** `apps/api/src/lib/__tests__/proxy-pin-rules.test.ts` (new file)

```typescript
import { describe, it, expect } from "vitest";
import { validatePinChange } from "../proxy-pin-rules.js";

const day = 86_400_000;

const mkAccount = (overrides: Partial<Parameters<typeof validatePinChange>[0]["account"]> = {}) => ({
  id: "acc-1",
  platform: "TIKTOK" as const,
  pinnedProxyId: "prx-old",
  proxyPinnedAt: new Date("2026-05-10T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"), // 4+ months old
  ...overrides,
});

const proxy = (overrides: Partial<Parameters<typeof validatePinChange>[0]["newProxy"]> = {}) => ({
  id: "prx-new",
  carrier: "T-Mobile",
  country: "US",
  type: "LTE_MOBILE" as const,
  ...overrides,
});

const now = new Date("2026-05-15T00:00:00Z"); // 5 days after pin

describe("validatePinChange", () => {
  it("returns null when no previous pin", () => {
    const result = validatePinChange({
      account: mkAccount({ pinnedProxyId: null, proxyPinnedAt: null }),
      oldProxy: null,
      newProxy: proxy(),
      now,
    });
    expect(result).toBeNull();
  });

  it("returns null when reassigning to same proxy", () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ id: "prx-old" }),
      now,
    });
    expect(result).toBeNull();
  });

  it("blocks carrier change for TikTok account", () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ carrier: "Verizon" }),
      now,
    });
    expect(result?.code).toBe("CARRIER_CHANGE_BLOCKED");
    expect(result?.oldCarrier).toBe("T-Mobile");
    expect(result?.newCarrier).toBe("Verizon");
    expect(result?.daysRemaining).toBe(9);
  });

  it("blocks country change with priority over carrier change", () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ carrier: "Vodafone", country: "DE" }),
      now,
    });
    expect(result?.code).toBe("COUNTRY_CHANGE_BLOCKED");
  });

  it("warns within 14-day window for same-carrier swap", () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ id: "prx-other-tmobile", carrier: "T-Mobile" }),
      now,
    });
    expect(result?.code).toBe("PIN_WINDOW_ACTIVE");
    expect(result?.daysRemaining).toBe(9);
  });

  it("allows same-carrier swap after 14 days", () => {
    const result = validatePinChange({
      account: mkAccount({ proxyPinnedAt: new Date(now.getTime() - 15 * day) }),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ id: "prx-other-tmobile" }),
      now,
    });
    expect(result).toBeNull();
  });

  it("rejects datacenter proxy for TikTok account younger than 30 days", () => {
    const result = validatePinChange({
      account: mkAccount({
        createdAt: new Date(now.getTime() - 10 * day),
        pinnedProxyId: null,
        proxyPinnedAt: null,
      }),
      oldProxy: null,
      newProxy: proxy({ type: "DATACENTER_DEPRECATED" }),
      now,
    });
    expect(result?.code).toBe("PROXY_NOT_LTE_FOR_TIKTOK");
  });

  it("allows residential proxy for TikTok account older than 30 days", () => {
    const result = validatePinChange({
      account: mkAccount({
        createdAt: new Date(now.getTime() - 60 * day),
        pinnedProxyId: null,
        proxyPinnedAt: null,
      }),
      oldProxy: null,
      newProxy: proxy({ type: "STATIC_RESIDENTIAL" }),
      now,
    });
    expect(result).toBeNull();
  });

  it("does not enforce carrier rule on YouTube accounts", () => {
    const result = validatePinChange({
      account: mkAccount({ platform: "YOUTUBE" as any }),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ carrier: "Verizon" }),
      now,
    });
    // Only the within-window soft-warn applies.
    expect(result?.code).toBe("PIN_WINDOW_ACTIVE");
  });
});
```

### 5.4. Docs

**File:** `docs/architecture/backend-contracts.md`

Найдите блок `### Proxy Contract` и **полностью замените** его на:

````markdown
### Proxy Contract — Carrier Stability Rule (TikTok 2026)

Pinning policy: один аккаунт = один прокси на 14+ дней. `SocialAccount.proxyPinnedAt` фиксируется при первой привязке и при каждой смене.

```typescript
// Enforced server-side in apps/api/src/lib/proxy-pin-rules.ts
// (function `validatePinChange`)

// HARD BLOCKS (returns HTTP 409 unless ?force=true is passed by ADMIN):

// 1. PROXY_NOT_LTE_FOR_TIKTOK
//    TikTok account younger than 30 days requires `type === "LTE_MOBILE"`.
//    Residential / datacenter on fresh accounts triggers BGP path scoring.

// 2. COUNTRY_CHANGE_BLOCKED
//    Cannot swap proxy across countries on an account with existing
//    session history. TikTok geo-correlates carrier with country.
//    Full re-warm required if you proceed.

// 3. CARRIER_CHANGE_BLOCKED (TikTok-only)
//    Cannot swap to a different carrier (T-Mobile -> Verizon, etc.).
//    Resets the 14-day correlation window. Expected shadowban 14-21 days.

// SOFT WARN (still requires force, but lower-risk):

// 4. PIN_WINDOW_ACTIVE
//    Same-carrier, same-country swap within 14 days of last pin.
//    Frequent rotations within window are themselves a signal.

// Override mechanism:
//   POST /api/accounts/bulk-proxy?force=true       (ADMIN role only)
//   PATCH /api/accounts/:id?force=true             (ADMIN role only)
// Every force-override writes an AuditLog row with the violation code.

// LTE rotation cooldown:
//   Proxy.rotationCooldown — minimum seconds between IP rotations (default 900 = 15 min).
//   Worker enforces: if (now - lastRotatedAt) < rotationCooldown → reject rotation request.
```

**Frontend handling:**
- В `/account/profiles` при попытке bulk-bind показывается modal с человекочитаемой причиной из `error.message` и кнопкой «Override (admin only)» если у текущего юзера `role === ADMIN`.
- В `/account/proxies` при добавлении нового прокси индикатор `bgpPathValid: false` рисует ⚠️ жёлтый бейдж.
````

**Commit:** `feat(api): enforce TikTok carrier stability rule + 14-day pin window`

---

## ISSUE 6 — Shadowban detection: add 24h post-publish guard

**File:** `apps/worker/src/handlers/shadowban-detector.ts`

Найдите функцию-обработчик (точное имя зависит от существующего кода — `processShadowbanCheck` / `runShadowbanDetector` / similar). Замените логику отбора видео на следующую — **обязательно с гардами по возрасту**:

```typescript
import { prisma } from "../lib/prisma.js";
import { socketLogger } from "../lib/socket-logger.js";

/**
 * Shadowban detection thresholds.
 *
 * The 24-hour gate is critical: fresh videos with low view counts are
 * statistically normal (TikTok ramps distribution over hours, not minutes).
 * Without this gate, a 30-min-old video with 50 views would falsely flag
 * the account and block its entire upload queue.
 */
const SHADOWBAN_MIN_VIDEO_AGE_HOURS = 24;
const SHADOWBAN_VIEW_THRESHOLD = 100;
const SHADOWBAN_CONSECUTIVE_VIDEOS = 3;
const SHADOWBAN_LOOKBACK_DAYS = 14;

export async function detectShadowbanForAccount(accountId: string): Promise<{
  flagged: boolean;
  reason?: string;
  matchedVideos?: string[];
}> {
  const account = await prisma.socialAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      id: true,
      userId: true,
      nickname: true,
      status: true,
      warmupCompletedAt: true,
    },
  });

  // Only flag warmed-up accounts in a normal state.
  if (account.status !== "ALIVE") return { flagged: false };
  if (!account.warmupCompletedAt) return { flagged: false };

  const ageGateThreshold = new Date(
    Date.now() - SHADOWBAN_MIN_VIDEO_AGE_HOURS * 3_600_000,
  );
  const lookbackThreshold = new Date(
    Date.now() - SHADOWBAN_LOOKBACK_DAYS * 86_400_000,
  );

  // Fetch only videos that:
  //  1. Are at least 24h old (give TikTok time to ramp distribution).
  //  2. Are within the 14-day lookback window (older videos aren't representative).
  // Ordered newest-first so we evaluate the most recent N consecutive ones.
  const candidates = await prisma.video.findMany({
    where: {
      accountId,
      uploadedAt: {
        lte: ageGateThreshold,   // CRITICAL: video must be >= 24h old
        gte: lookbackThreshold,
      },
    },
    orderBy: { uploadedAt: "desc" },
    take: SHADOWBAN_CONSECUTIVE_VIDEOS,
    select: { id: true, views: true, uploadedAt: true },
  });

  if (candidates.length < SHADOWBAN_CONSECUTIVE_VIDEOS) {
    // Not enough aged data — explicitly do nothing. Account stays ALIVE.
    return { flagged: false };
  }

  const allLowView = candidates.every(
    (v) => v.views < SHADOWBAN_VIEW_THRESHOLD,
  );

  if (!allLowView) return { flagged: false };

  // Flag it.
  await prisma.socialAccount.update({
    where: { id: accountId },
    data: { status: "SHADOWBAN_SUSPECTED" },
  });

  // Cancel any pending upload jobs for this account.
  await prisma.task.updateMany({
    where: { accountId, status: "PENDING", type: "UPLOAD" },
    data: { status: "CANCELLED", cancelReason: "SHADOWBAN_SUSPECTED" },
  });

  socketLogger.emit("log", {
    timestamp: new Date().toISOString(),
    level: "warn",
    message:
      `[Shadowban] Account ${account.nickname} flagged: ` +
      `${candidates.length} consecutive videos (>=24h old) with <${SHADOWBAN_VIEW_THRESHOLD} views. ` +
      `Pending uploads cancelled. Recommend manual organic post from mobile after 7-day cooldown.`,
    accountId,
  });

  return {
    flagged: true,
    reason:
      `${candidates.length} consecutive videos (each >=24h old) under ${SHADOWBAN_VIEW_THRESHOLD} views`,
    matchedVideos: candidates.map((v) => v.id),
  };
}
```

**Test:** `apps/worker/src/handlers/__tests__/shadowban-detector.test.ts` (new file)

Use Prisma's `vitest-mock-extended` pattern or your existing test helpers. Required cases:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectShadowbanForAccount } from "../shadowban-detector.js";
import { prisma } from "../../lib/prisma.js";

vi.mock("../../lib/prisma.js");
vi.mock("../../lib/socket-logger.js", () => ({
  socketLogger: { emit: vi.fn() },
}));

const hour = 3_600_000;
const now = Date.now();

const mkAccount = (overrides = {}) => ({
  id: "acc-1",
  userId: "u-1",
  nickname: "test",
  status: "ALIVE",
  warmupCompletedAt: new Date(now - 30 * 24 * hour),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("detectShadowbanForAccount", () => {
  it("does NOT flag accounts still in warmup", async () => {
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(
      mkAccount({ warmupCompletedAt: null }),
    );
    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(false);
    expect(prisma.video.findMany).not.toHaveBeenCalled();
  });

  it("does NOT flag when there are <3 videos older than 24h", async () => {
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(mkAccount());
    (prisma.video.findMany as any).mockResolvedValue([
      { id: "v1", views: 5, uploadedAt: new Date(now - 30 * hour) },
      { id: "v2", views: 12, uploadedAt: new Date(now - 26 * hour) },
      // only 2 aged videos
    ]);
    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(false);
  });

  it("does NOT flag fresh videos with low views (the 24h gate)", async () => {
    // 3 videos but all under 24h old — must NOT trigger
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(mkAccount());
    // Prisma `lte: 24h-ago` filter should already exclude these,
    // so findMany returns empty.
    (prisma.video.findMany as any).mockResolvedValue([]);
    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(false);
  });

  it("flags when 3+ consecutive aged videos all under 100 views", async () => {
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(mkAccount());
    (prisma.video.findMany as any).mockResolvedValue([
      { id: "v1", views: 30, uploadedAt: new Date(now - 26 * hour) },
      { id: "v2", views: 55, uploadedAt: new Date(now - 50 * hour) },
      { id: "v3", views: 8, uploadedAt: new Date(now - 75 * hour) },
    ]);
    (prisma.socialAccount.update as any).mockResolvedValue({});
    (prisma.task.updateMany as any).mockResolvedValue({ count: 2 });

    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(true);
    expect(r.matchedVideos).toEqual(["v1", "v2", "v3"]);
    expect(prisma.socialAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SHADOWBAN_SUSPECTED" } }),
    );
    expect(prisma.task.updateMany).toHaveBeenCalled();
  });

  it("does NOT flag when at least one aged video has >=100 views", async () => {
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(mkAccount());
    (prisma.video.findMany as any).mockResolvedValue([
      { id: "v1", views: 30, uploadedAt: new Date(now - 26 * hour) },
      { id: "v2", views: 250, uploadedAt: new Date(now - 50 * hour) }, // healthy
      { id: "v3", views: 8, uploadedAt: new Date(now - 75 * hour) },
    ]);
    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(false);
    expect(prisma.socialAccount.update).not.toHaveBeenCalled();
  });
});
```

### 6.1. Docs

**File:** `docs/architecture/backend-contracts.md`

Найдите блок `### Queue: \`shadowban-check\`` и замените его на:

````markdown
### Queue: `shadowban-check` (NEW in v3)

```typescript
interface ShadowbanCheckPayload {
  accountId: string;
}

// Worker logic (apps/worker/src/handlers/shadowban-detector.ts):
//
// THRESHOLDS:
//   SHADOWBAN_MIN_VIDEO_AGE_HOURS = 24
//   SHADOWBAN_VIEW_THRESHOLD = 100
//   SHADOWBAN_CONSECUTIVE_VIDEOS = 3
//   SHADOWBAN_LOOKBACK_DAYS = 14
//
// ALGORITHM:
//   1. Skip if account.status !== "ALIVE" OR warmupCompletedAt is null.
//   2. Fetch the most recent N videos that satisfy BOTH:
//        - uploadedAt <= now - 24h    (CRITICAL: 24h post-publish gate;
//                                       TikTok ramps distribution over hours)
//        - uploadedAt >= now - 14d    (older videos aren't representative)
//   3. If fewer than SHADOWBAN_CONSECUTIVE_VIDEOS aged videos exist, exit silently.
//   4. If ALL of them have views < SHADOWBAN_VIEW_THRESHOLD:
//        - account.status -> SHADOWBAN_SUSPECTED
//        - cancel all PENDING upload tasks for this account
//        - emit Socket.io warning to frontend
//
// WHY THE 24-HOUR GATE MATTERS:
//   A 30-minute-old video with 50 views is statistically normal.
//   Without this gate, every fresh upload would briefly satisfy the "low views"
//   criterion and prematurely flag the account, blocking its entire queue.
//
// RECOVERY (manual):
//   Owner reviews the flagged account in /account/profiles, decides whether to:
//     (a) pause uploads 7+ days then resume with organic content, OR
//     (b) discard the account.
//   Status reverts to ALIVE only via manual user action — never automatically.
```
````

**File:** `docs/guides/repository-map.md`

Найдите строку про `shadowban-detector.ts` и замените на:
```
| `src/handlers/shadowban-detector.ts` | Детекция шэдоубана: 3+ consecutive видео >=24ч после публикации с <100 views = SHADOWBAN_SUSPECTED + отмена pending uploads |
```

**Commit:** `fix(worker): add 24h post-publish gate to shadowban detection`

---

## ISSUE 7 — Fingerprint Consistency Rules

**File:** `apps/worker/src/core/browser/fingerprint-manager.ts`

Add a public `validateFingerprintConsistency` function that runs on every generated fingerprint AND on every load from DB (to catch corrupted data). Replace OR augment the existing module with:

```typescript
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

export interface AccountFingerprint {
  userAgent: string;
  platform: "Win32" | "MacIntel" | "Linux x86_64";
  screen: { width: number; height: number; colorDepth: 24 };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;          // BCP 47, e.g. "en-US", "ru-RU"
  timezone: string;        // IANA, e.g. "America/Chicago"
  hardwareConcurrency: 4 | 6 | 8 | 12 | 16;
  deviceMemory: 4 | 8;     // Chrome caps reported deviceMemory at 8
  maxTouchPoints: 0 | 1 | 5;
  webgl: { vendor: string; renderer: string };
  canvas: { seed: string }; // hex
  fonts: string[];
  chromeMajor: number;      // must match system Chrome major version
}

/**
 * Consistency rules for AccountFingerprint.
 *
 * Bot-detection systems (Cloudflare, DataDome, TikTok BotManager) flag
 * any internally inconsistent fingerprint within 1 request. Generating
 * a Windows UA with a MacIntel platform is an instant red flag.
 *
 * Throws on first violation with a precise message. Used both at
 * generation time and on load from DB (defence in depth against
 * tampering or schema drift).
 */
export function validateFingerprintConsistency(fp: AccountFingerprint): void {
  // 1. UA OS must match navigator.platform.
  const uaOsMatches: Record<AccountFingerprint["platform"], RegExp> = {
    Win32: /Windows NT \d+\.\d+/,
    MacIntel: /Macintosh; Intel Mac OS X/,
    "Linux x86_64": /X11; Linux x86_64/,
  };
  if (!uaOsMatches[fp.platform].test(fp.userAgent)) {
    throw new FingerprintInconsistencyError(
      `userAgent OS does not match platform=${fp.platform}. UA="${fp.userAgent}"`,
    );
  }

  // 2. WebGL renderer must match OS family.
  const rendererOk =
    (fp.platform === "Win32" && /ANGLE \(.+\)/.test(fp.webgl.renderer)) ||
    (fp.platform === "MacIntel" &&
      /(Apple|AMD Radeon Pro|Intel.+(?:Iris|UHD))/.test(fp.webgl.renderer)) ||
    (fp.platform === "Linux x86_64" &&
      /(Mesa|llvmpipe|NVIDIA)/i.test(fp.webgl.renderer));
  if (!rendererOk) {
    throw new FingerprintInconsistencyError(
      `webgl.renderer "${fp.webgl.renderer}" doesn't match platform=${fp.platform}. ` +
        `Windows must report ANGLE, macOS must report Apple/AMD Radeon Pro/Intel Iris-UHD, ` +
        `Linux must report Mesa/llvmpipe/NVIDIA.`,
    );
  }

  // 3. Screen >= viewport with realistic chrome (>=80px height for taskbar/header).
  if (fp.viewport.width > fp.screen.width) {
    throw new FingerprintInconsistencyError(
      `viewport.width (${fp.viewport.width}) exceeds screen.width (${fp.screen.width}). ` +
        `This is physically impossible.`,
    );
  }
  if (fp.viewport.height > fp.screen.height - 80) {
    throw new FingerprintInconsistencyError(
      `viewport.height (${fp.viewport.height}) leaves <80px for taskbar/header ` +
        `on screen.height ${fp.screen.height}. Real browsers always reserve chrome space.`,
    );
  }

  // 4. Timezone <-> locale country sanity check.
  const localeCountry = fp.locale.split("-")[1]?.toUpperCase();
  const tzRegion = fp.timezone.split("/")[0];
  const validRegions: Record<string, string[]> = {
    US: ["America"],
    GB: ["Europe"],
    DE: ["Europe"],
    FR: ["Europe"],
    RU: ["Europe", "Asia"],
    KZ: ["Asia"],
    UA: ["Europe"],
    JP: ["Asia"],
    BR: ["America"],
    IN: ["Asia"],
    AU: ["Australia"],
  };
  if (localeCountry && validRegions[localeCountry]) {
    if (!validRegions[localeCountry].includes(tzRegion)) {
      throw new FingerprintInconsistencyError(
        `locale ${fp.locale} country ${localeCountry} doesn't match timezone region ${tzRegion}. ` +
          `Expected one of: ${validRegions[localeCountry].join(", ")}.`,
      );
    }
  }

  // 5. hardwareConcurrency and deviceMemory bounds.
  if (![4, 6, 8, 12, 16].includes(fp.hardwareConcurrency)) {
    throw new FingerprintInconsistencyError(
      `hardwareConcurrency must be one of {4,6,8,12,16}, got ${fp.hardwareConcurrency}.`,
    );
  }
  if (![4, 8].includes(fp.deviceMemory)) {
    throw new FingerprintInconsistencyError(
      `deviceMemory must be 4 or 8 (Chrome caps reported value at 8), got ${fp.deviceMemory}.`,
    );
  }

  // 6. Chrome major in UA must match system Chrome.
  const uaChromeMajor = parseInt(
    fp.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "0",
    10,
  );
  if (uaChromeMajor !== fp.chromeMajor) {
    throw new FingerprintInconsistencyError(
      `Chrome major in userAgent (${uaChromeMajor}) doesn't match fingerprint.chromeMajor ` +
        `(${fp.chromeMajor}). System Chrome version must be reflected in UA.`,
    );
  }

  // 7. maxTouchPoints sanity: desktop UA -> 0; iOS/Android UA -> 5.
  if (
    fp.maxTouchPoints !== 0 &&
    /Windows NT|Macintosh; Intel|X11; Linux/.test(fp.userAgent)
  ) {
    throw new FingerprintInconsistencyError(
      `Desktop userAgent must have maxTouchPoints=0 (got ${fp.maxTouchPoints}). ` +
        `Non-zero touch points on a desktop UA is a top-3 antifraud signal.`,
    );
  }
}

export class FingerprintInconsistencyError extends Error {
  constructor(message: string) {
    super(`[fingerprint-consistency] ${message}`);
    this.name = "FingerprintInconsistencyError";
  }
}

/**
 * Detects the major version of the system-installed Chrome at startup.
 * Worker process MUST cache this value at boot and use it for all
 * subsequent fingerprint generation.
 */
let cachedChromeMajor: number | null = null;

export function getSystemChromeMajor(): number {
  if (cachedChromeMajor !== null) return cachedChromeMajor;

  try {
    const out = execSync("google-chrome --version", {
      encoding: "utf8",
      timeout: 5_000,
    });
    const major = parseInt(out.match(/(\d+)\./)?.[1] ?? "0", 10);
    if (major < 130) {
      throw new Error(
        `System Chrome too old (major=${major}). Patchright requires Chrome 148+.`,
      );
    }
    cachedChromeMajor = major;
    return major;
  } catch (err) {
    throw new Error(
      `Failed to detect system Chrome version. Ensure google-chrome-stable is installed. ` +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}

/**
 * Generate a stable per-account fingerprint. Pure function of accountId
 * (and the live system Chrome major version, captured once at worker boot).
 *
 * Same accountId -> identical fingerprint forever. NEVER regenerate for
 * an existing account; doing so resets TikTok's identity correlation and
 * triggers shadowban.
 */
export function generateFingerprintForAccount(
  accountId: string,
  geo: { country: string; city: string },
): AccountFingerprint {
  const chromeMajor = getSystemChromeMajor();
  const seedHex = createHash("sha256").update(accountId).digest("hex");
  const seed = (n: number) =>
    parseInt(seedHex.slice(n * 4, n * 4 + 8), 16);

  // --- pick OS family (Windows-biased, real-world distribution) ---
  const osRoll = seed(0) % 100;
  const platform: AccountFingerprint["platform"] =
    osRoll < 72 ? "Win32" : osRoll < 92 ? "MacIntel" : "Linux x86_64";

  // --- resolution (top-5 most common per OS) ---
  const winResolutions = [
    { w: 1920, h: 1080 },
    { w: 1366, h: 768 },
    { w: 2560, h: 1440 },
    { w: 1536, h: 864 },
    { w: 1440, h: 900 },
  ];
  const macResolutions = [
    { w: 1440, h: 900 },
    { w: 1680, h: 1050 },
    { w: 1920, h: 1080 },
    { w: 2560, h: 1600 },
  ];
  const linuxResolutions = [
    { w: 1920, h: 1080 },
    { w: 2560, h: 1440 },
    { w: 1366, h: 768 },
  ];
  const pool =
    platform === "Win32"
      ? winResolutions
      : platform === "MacIntel"
        ? macResolutions
        : linuxResolutions;
  const res = pool[seed(1) % pool.length];

  // --- viewport: screen minus realistic chrome ---
  const viewport = {
    width: res.w,
    height: res.h - (80 + (seed(2) % 40)), // 80-119px taskbar+chrome
  };

  // --- WebGL ---
  const winGPUs = [
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  ];
  const macGPUs = [
    { vendor: "Apple Inc.", renderer: "Apple M1" },
    { vendor: "Apple Inc.", renderer: "Apple M2" },
    { vendor: "ATI Technologies Inc.", renderer: "AMD Radeon Pro 5500M OpenGL Engine" },
    { vendor: "Intel Inc.", renderer: "Intel(R) Iris(TM) Plus Graphics OpenGL Engine" },
  ];
  const linuxGPUs = [
    { vendor: "Mesa", renderer: "Mesa Intel(R) UHD Graphics 620 (KBL GT2)" },
    { vendor: "Mesa/X.org", renderer: "llvmpipe (LLVM 15.0.7, 256 bits)" },
  ];
  const gpuPool =
    platform === "Win32" ? winGPUs : platform === "MacIntel" ? macGPUs : linuxGPUs;
  const webgl = gpuPool[seed(3) % gpuPool.length];

  // --- locale & timezone from proxy geo (NOT from machine) ---
  const localeByCountry: Record<string, string> = {
    US: "en-US", GB: "en-GB", DE: "de-DE", FR: "fr-FR",
    RU: "ru-RU", KZ: "ru-KZ", UA: "uk-UA", JP: "ja-JP",
    BR: "pt-BR", IN: "en-IN", AU: "en-AU",
  };
  const timezoneByCity: Record<string, string> = {
    "New York": "America/New_York", "Chicago": "America/Chicago",
    "Los Angeles": "America/Los_Angeles", "Houston": "America/Chicago",
    "Moscow": "Europe/Moscow", "Almaty": "Asia/Almaty",
    "Berlin": "Europe/Berlin", "London": "Europe/London",
    "Paris": "Europe/Paris", "Tokyo": "Asia/Tokyo",
  };
  const locale = localeByCountry[geo.country] ?? "en-US";
  const timezone = timezoneByCity[geo.city] ?? "America/Chicago";

  // --- userAgent (Chrome version pinned to system) ---
  const osTokens: Record<AccountFingerprint["platform"], string> = {
    Win32: "Windows NT 10.0; Win64; x64",
    MacIntel: "Macintosh; Intel Mac OS X 10_15_7",
    "Linux x86_64": "X11; Linux x86_64",
  };
  const userAgent =
    `Mozilla/5.0 (${osTokens[platform]}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;

  const fp: AccountFingerprint = {
    userAgent,
    platform,
    screen: { width: res.w, height: res.h, colorDepth: 24 },
    viewport,
    devicePixelRatio: platform === "MacIntel" ? 2 : 1,
    locale,
    timezone,
    hardwareConcurrency: ([4, 6, 8, 8, 8, 12, 16] as const)[seed(4) % 7],
    deviceMemory: ([4, 8, 8, 8] as const)[seed(5) % 4],
    maxTouchPoints: 0, // desktop only in this generator
    webgl,
    canvas: { seed: seedHex.slice(0, 16) },
    fonts: pickFonts(platform, seed(6)),
    chromeMajor,
  };

  // Defence in depth: never return an invalid fingerprint, even by accident.
  validateFingerprintConsistency(fp);
  return fp;
}

function pickFonts(
  platform: AccountFingerprint["platform"],
  seed: number,
): string[] {
  const winFonts = [
    "Arial", "Calibri", "Cambria", "Consolas", "Courier New",
    "Georgia", "Segoe UI", "Tahoma", "Times New Roman", "Verdana",
  ];
  const macFonts = [
    "Helvetica Neue", "San Francisco", "Menlo", "Monaco", "Avenir",
    "Geneva", "Lucida Grande", "Optima", "Palatino", "Times",
  ];
  const linuxFonts = [
    "DejaVu Sans", "DejaVu Serif", "Liberation Sans", "Liberation Mono",
    "Ubuntu", "Noto Sans", "Noto Mono",
  ];
  const pool =
    platform === "Win32"
      ? winFonts
      : platform === "MacIntel"
        ? macFonts
        : linuxFonts;
  // Pick a 6-8 font subset deterministically.
  const count = 6 + (seed % 3);
  return pool.slice(0, count);
}
```

**Test:** `apps/worker/src/core/browser/__tests__/fingerprint-manager.test.ts` (new file)

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  generateFingerprintForAccount,
  validateFingerprintConsistency,
  FingerprintInconsistencyError,
} from "../fingerprint-manager.js";

vi.mock("node:child_process", () => ({
  execSync: () => "Google Chrome 148.0.7778.168\n",
}));

describe("validateFingerprintConsistency", () => {
  const base = () =>
    generateFingerprintForAccount("acc-test-1", {
      country: "US",
      city: "Chicago",
    });

  it("accepts a generated fingerprint", () => {
    expect(() => validateFingerprintConsistency(base())).not.toThrow();
  });

  it("rejects Windows UA with MacIntel platform", () => {
    const fp = base();
    fp.platform = "MacIntel";
    expect(() => validateFingerprintConsistency(fp)).toThrow(
      FingerprintInconsistencyError,
    );
  });

  it("rejects viewport wider than screen", () => {
    const fp = base();
    fp.viewport.width = fp.screen.width + 100;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/viewport.width/);
  });

  it("rejects viewport that leaves no chrome space", () => {
    const fp = base();
    fp.viewport.height = fp.screen.height - 10;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/taskbar/);
  });

  it("rejects locale/timezone mismatch", () => {
    const fp = base();
    fp.locale = "ru-RU";
    fp.timezone = "America/Chicago";
    expect(() => validateFingerprintConsistency(fp)).toThrow(/locale/);
  });

  it("rejects unrealistic deviceMemory", () => {
    const fp = base();
    (fp as any).deviceMemory = 32;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/deviceMemory/);
  });

  it("rejects Chrome major mismatch", () => {
    const fp = base();
    fp.chromeMajor = 100;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/Chrome major/);
  });

  it("rejects non-zero maxTouchPoints on desktop UA", () => {
    const fp = base();
    fp.maxTouchPoints = 5 as any;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/maxTouchPoints/);
  });

  it("is deterministic per accountId", () => {
    const a = generateFingerprintForAccount("acc-XYZ", {
      country: "US",
      city: "Chicago",
    });
    const b = generateFingerprintForAccount("acc-XYZ", {
      country: "US",
      city: "Chicago",
    });
    expect(a).toEqual(b);
  });

  it("differs across accountIds", () => {
    const a = generateFingerprintForAccount("acc-A", {
      country: "US",
      city: "Chicago",
    });
    const b = generateFingerprintForAccount("acc-B", {
      country: "US",
      city: "Chicago",
    });
    expect(a.canvas.seed).not.toEqual(b.canvas.seed);
  });
});
```

### 7.1. Wire the validator into the load path

**File:** `apps/worker/src/core/browser/patchright-launcher.ts`

В функции, которая читает `account.fingerprint` из БД перед запуском контекста, добавьте вызов валидатора СРАЗУ ПОСЛЕ чтения:

```typescript
import {
  validateFingerprintConsistency,
  type AccountFingerprint,
} from "./fingerprint-manager.js";

// ... inside launchStealthContext / equivalent:
const fingerprint = account.fingerprint as AccountFingerprint;
validateFingerprintConsistency(fingerprint); // throws on tampered/legacy data
```

### 7.2. Docs

**File:** `docs/architecture/backend-contracts.md`

Найдите `### Fingerprint Contract` и **полностью замените** на:

````markdown
### Fingerprint Contract

Per-account stable fingerprint. Generated ONCE per account from `accountId` seed.
**NEVER changes after creation.** Stored in `SocialAccount.fingerprint` (JSON).
Validated at generation and on every load.

```typescript
interface AccountFingerprint {
  userAgent: string;
  platform: "Win32" | "MacIntel" | "Linux x86_64";
  screen: { width: number; height: number; colorDepth: 24 };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;          // BCP 47 (en-US, ru-RU, ...)
  timezone: string;        // IANA (America/Chicago, Europe/Moscow, ...)
  hardwareConcurrency: 4 | 6 | 8 | 12 | 16;
  deviceMemory: 4 | 8;     // Chrome caps reported value at 8
  maxTouchPoints: 0 | 1 | 5;
  webgl: { vendor: string; renderer: string };
  canvas: { seed: string }; // 16-char hex
  fonts: string[];
  chromeMajor: number;     // must match installed system Chrome major
}
```

**Consistency Rules (enforced in `validateFingerprintConsistency`):**

1. **OS coherence.** `userAgent` OS token must match `platform`:
   - `Windows NT 10.0` -> `platform = "Win32"`
   - `Macintosh; Intel Mac OS X` -> `platform = "MacIntel"`
   - `X11; Linux` -> `platform = "Linux x86_64"`
2. **GPU coherence.** `webgl.renderer` must match the OS:
   - Windows -> must contain `ANGLE (...)`.
   - macOS -> must contain `Apple`, `AMD Radeon Pro`, or `Intel ... Iris/UHD`.
   - Linux -> must contain `Mesa`, `llvmpipe`, or `NVIDIA`.
3. **Display geometry.** `screen.width >= viewport.width` AND
   `screen.height - viewport.height >= 80` (chrome/taskbar space).
4. **Geo coherence.** `locale` country must match `timezone` region
   (e.g. `en-US` requires `America/*`; `ru-RU` requires `Europe/*` or `Asia/*`).
5. **Hardware realism.** `hardwareConcurrency in {4,6,8,12,16}`,
   `deviceMemory in {4,8}` (Chrome doesn't report higher values).
6. **Chrome version pinning.** UA Chrome major **must equal** `chromeMajor`,
   which is captured from the live system Chrome at worker startup
   via `getSystemChromeMajor()`. A UA claiming Chrome 100 while the
   container ships Chrome 148 is a top-tier antifraud signal.
7. **Touch coherence.** Desktop UAs (Windows / macOS / Linux) require
   `maxTouchPoints = 0`. Non-zero touch points on desktop UA is one of
   the strongest "synthetic browser" signals TikTok looks for.

A `FingerprintInconsistencyError` is thrown on the first violation —
generation aborts; load aborts with a worker-level log so the operator
can decide to regenerate (allowed only for accounts that have never
published — see UI warning in `/account/profiles`).

**Why this matters:** rotating or randomising fingerprint per session is
the #1 cause of TikTok shadowban in 2026. A stable, internally consistent
fingerprint correlates with the proxy IP over the 14-day window and
keeps the account in "real user" cluster of TikTok's ML classifier.
````

**Commit:** `feat(worker): enforce fingerprint internal consistency + Chrome version pinning`

---

## ISSUE 8 — Remove deprecated `browser-automation.ts`

**File:** `apps/worker/src/core/browser-automation.ts`

If file still exists:

1. Verify no imports remain: `npx tsc --noEmit && grep -r "browser-automation" apps/worker/src` should return zero references in active code.
2. Delete the file: `git rm apps/worker/src/core/browser-automation.ts`.
3. Update `docs/guides/repository-map.md`: remove the line beginning with
   `| src/core/browser-automation.ts | DEPRECATED ...`.
4. Also remove any ESLint override that allowed legacy imports in that file (search `eslint.config.mjs` for the filename, remove the override block).

**Commit:** `chore(worker): remove deprecated browser-automation.ts (Selenium/UC legacy)`

---

## Final acceptance checks

Before opening the PR, run **all** of:

```bash
npm run typecheck         # zero errors in api/web/worker
npm run lint              # zero errors, no-restricted-imports active
npm test                  # all unit tests pass (must include the new tests above)
npx prisma validate       # apps/api
npx markdownlint-cli2 "**/*.md"
```

Manually:
- Open `/account/profiles`, attempt a TikTok bulk-bind with a different carrier proxy — expect 409 with `CARRIER_CHANGE_BLOCKED`.
- Force-override as ADMIN — expect 200, then verify `AuditLog` row exists.
- Upload a fresh test video, then immediately trigger `shadowban-check` — expect `flagged: false` because the video is <24h old.
- Set `uploadedAt = now() - 25h` on three test videos with views=10/20/30 — trigger check, expect `flagged: true` and account status `SHADOWBAN_SUSPECTED`.
- Tamper a stored fingerprint in DB (set `platform: "MacIntel"` on a Windows UA), restart worker — expect a startup-time error or per-job throw with `FingerprintInconsistencyError`.

If any of the above fails, fix before merging. Do not bypass.

## PR description template

```
## Documentation & Code Hardening Pass

Closes #N (docs review)

### Critical fixes
- [x] (#5) TikTok carrier-stability rule: 14-day window + carrier/country guards now enforced in API
- [x] (#6) Shadowban detector: hard 24h post-publish gate added, prevents false-positive on fresh uploads
- [x] (#7) Fingerprint consistency validator: 7 rules enforced at generation AND load

### Documentation fixes
- [x] (#1) Repaired corrupted env-vars block in README
- [x] (#2) Expanded first-run flow with proxy/cookie/warmup steps
- [x] (#3) Clarified cookie-refresh feature scope vs deprecated "donor sites"
- [x] (#4) Formalized Card variants — glassmorphism scoped to header only

### Housekeeping
- [x] (#8) Removed deprecated browser-automation.ts (Selenium/UC legacy)

### Tests added
- `apps/api/src/lib/__tests__/proxy-pin-rules.test.ts` (9 cases)
- `apps/worker/src/handlers/__tests__/shadowban-detector.test.ts` (5 cases)
- `apps/worker/src/core/browser/__tests__/fingerprint-manager.test.ts` (9 cases)
- `apps/web/src/components/ui/__tests__/Card.test.tsx` (3 cases)
```

**End of prompt.**


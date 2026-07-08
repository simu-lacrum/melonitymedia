// ─────────────────────────────────────────────────────────────
// Worker Error Classifier — User-facing error messages & advice
//
// Every worker job (upload, warmup, login, edit-profile, cookies,
// analytics, shadowban) uses this to emit structured error events
// to the frontend via Socket.io. Users always see:
//   1. What happened (human-readable description)
//   2. Why it happened (technical detail)
//   3. What they can do (actionable advice)
//
// Events emitted: worker:error { accountId, handler, code, ... }
// Frontend listens on Socket.io /logs namespace.
// ─────────────────────────────────────────────────────────────

import { SocketLogger } from './socket-logger.js';

// ── Error codes by category ─────────────────────────────────

export type WorkerErrorCode =
  // Auth & Session
  | 'COOKIES_EXPIRED'
  | 'SESSION_INVALID'
  | 'AUTH_NEEDED'
  | 'ACCOUNT_BANNED'
  | 'ACCOUNT_SUSPENDED'
  | 'SHADOWBAN_DETECTED'
  // Browser & Captcha
  | 'BROWSER_CRASH'
  | 'PAGE_TIMEOUT'
  | 'CAPTCHA_FAILED'
  | 'SELECTOR_NOT_FOUND'
  // Network
  | 'PROXY_ERROR'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  // Content
  | 'VIDEO_NOT_FOUND'
  | 'VIDEO_REJECTED'
  | 'UPLOAD_TIMEOUT'
  | 'PROFILE_SAVE_FAILED'
  // Infra
  | 'NO_PROXY'
  | 'NO_FINGERPRINT'
  | 'NO_COOKIES'
  | 'FFMPEG_ERROR'
  | 'DISK_ERROR'
  // Generic
  | 'UNKNOWN_ERROR';

export type WorkerHandler =
  | 'upload'
  | 'warmup'
  | 'login'
  | 'edit-profile'
  | 'cookies'
  | 'analytics'
  | 'shadowban'
  | 'cleanup';

interface WorkerErrorEvent {
  accountId: string;
  handler: WorkerHandler;
  code: WorkerErrorCode;
  title: string;       // short summary
  message: string;     // what happened
  advice: string;      // what user can do
  detail?: string;     // technical detail (optional)
  timestamp: string;
}

// ── Error → code classification ─────────────────────────────

interface ClassifiedError {
  code: WorkerErrorCode;
  title: string;
  message: string;
  advice: string;
}

/**
 * Classify a raw error message into a structured error with advice.
 * Context-aware: uses handler name to give relevant suggestions.
 */
export function classifyError(
  rawMessage: string,
  handler: WorkerHandler,
): ClassifiedError {
  const msg = rawMessage.toLowerCase();

  // ── Auth / Session ────────────────────────────────────────
  if (msg.includes('expired') || msg.includes('cookie') && msg.includes('invalid')) {
    return {
      code: 'COOKIES_EXPIRED',
      title: 'Cookies истекли',
      message: 'Сессия аккаунта больше не действительна.',
      advice: 'Обновите cookies: откройте меню аккаунта → «Обновить куки», или заново импортируйте аккаунт.',
    };
  }

  if (msg.includes('banned') || msg.includes('заблокирован')) {
    return {
      code: 'ACCOUNT_BANNED',
      title: 'Аккаунт заблокирован',
      message: 'Платформа заблокировала этот аккаунт.',
      advice: 'Рекомендуем подождать 48-72 часа и проверить аккаунт вручную через мобильное приложение. Если бан перманентный — используйте другой аккаунт.',
    };
  }

  if (msg.includes('suspended') || msg.includes('приостановлен')) {
    return {
      code: 'ACCOUNT_SUSPENDED',
      title: 'Аккаунт приостановлен',
      message: 'Платформа временно приостановила аккаунт.',
      advice: 'Войдите в аккаунт вручную через мобильное приложение, чтобы пройти проверку платформы. Часто помогает подтверждение номера телефона.',
    };
  }

  if (msg.includes('shadowban')) {
    return {
      code: 'SHADOWBAN_DETECTED',
      title: 'Подозрение на теневой бан',
      message: 'Несколько последних видео получили менее 100 просмотров.',
      advice: 'Прекратите публикации на 5-7 дней. Затем опубликуйте 1-2 оригинальных видео вручную через мобильное приложение. Не используйте автозалив первую неделю после разблокировки.',
    };
  }

  if (msg.includes('auth_needed') || msg.includes('no fingerprint') || msg.includes('no cookies')) {
    return {
      code: 'AUTH_NEEDED',
      title: 'Требуется авторизация',
      message: 'Аккаунт не авторизован или отсутствуют cookies.',
      advice: 'Повторно импортируйте аккаунт через login:password или обновите cookies.',
    };
  }

  // ── Browser & Page ────────────────────────────────────────
  if (msg.includes('captcha') || msg.includes('verify.*human')) {
    const captchaAdvice = handler === 'upload'
      ? 'Попробуйте: 1) Поменять прокси на мобильный (меньше капчи). 2) Подождать 15-30 минут и повторить. 3) Зайти вручную через мобильное приложение, чтобы «прогреть» IP.'
      : handler === 'warmup'
      ? 'Капча при прогреве — нормально для нового аккаунта. Попробуйте поменять прокси. Если капча повторяется — зайдите в аккаунт вручную через мобильное приложение.'
      : 'Попробуйте сменить прокси на мобильный или подождать 30 минут.';
    return {
      code: 'CAPTCHA_FAILED',
      title: 'Капча не решена',
      message: 'Платформа показала капчу, которую не удалось решить автоматически.',
      advice: captchaAdvice,
    };
  }

  if (msg.includes('timeout') || msg.includes('navigation timeout') || msg.includes('waitforurl')) {
    return {
      code: 'PAGE_TIMEOUT',
      title: 'Страница не загрузилась',
      message: 'Браузер не дождался загрузки страницы за отведённое время.',
      advice: 'Проверьте прокси — возможно он медленный или заблокирован. Попробуйте другой прокси или повторите позже.',
    };
  }

  if (msg.includes('browser') && (msg.includes('crash') || msg.includes('disconnect'))) {
    return {
      code: 'BROWSER_CRASH',
      title: 'Браузер упал',
      message: 'Браузерный процесс завершился неожиданно.',
      advice: 'Повторите задачу. Если ошибка повторяется — перезапустите воркер (docker restart worker).',
    };
  }

  if (msg.includes('locator') || msg.includes('selector') || msg.includes('not found') || msg.includes('element')) {
    const selectorAdvice = handler === 'edit-profile'
      ? 'Платформа могла обновить интерфейс. Попробуйте позже или отредактируйте профиль вручную через приложение.'
      : handler === 'upload'
      ? 'Платформа могла обновить интерфейс загрузки. Попробуйте позже. Если ошибка повторяется — сообщите разработчику.'
      : 'Интерфейс платформы мог измениться. Попробуйте позже.';
    return {
      code: 'SELECTOR_NOT_FOUND',
      title: 'Элемент не найден',
      message: 'Не удалось найти нужный элемент на странице.',
      advice: selectorAdvice,
    };
  }

  // ── Network ───────────────────────────────────────────────
  if (
    msg.includes('socks proxy authentication is not supported') ||
    msg.includes('socks5 proxy authentication') ||
    (msg.includes('socks') && msg.includes('authentication') && msg.includes('not supported'))
  ) {
    return {
      code: 'PROXY_ERROR',
      title: 'Прокси несовместим с браузером',
      message: 'SOCKS-прокси с логином и паролем не поддерживается браузерным запуском.',
      advice: 'Можно использовать любой привязанный прокси, но для SOCKS нужен вариант без авторизации. Если у провайдера есть HTTP endpoint этого же прокси, привяжите HTTP endpoint и повторите вход.',
    };
  }

  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('etimedout') || msg.includes('proxy')) {
    return {
      code: 'PROXY_ERROR',
      title: 'Ошибка прокси',
      message: 'Не удалось подключиться через прокси.',
      advice: 'Проверьте прокси: 1) Привяжите другой прокси к аккаунту. 2) Убедитесь, что прокси активен и не заблокирован. 3) Если используете мобильный прокси — проверьте ротацию IP.',
    };
  }

  if (msg.includes('rate') && msg.includes('limit')) {
    return {
      code: 'RATE_LIMITED',
      title: 'Превышен лимит',
      message: 'Платформа ограничила количество действий.',
      advice: 'Подождите 1-2 часа перед повторной попыткой. Не более 3 видео в день на аккаунт. Увеличьте задержку между действиями.',
    };
  }

  if (msg.includes('network') || msg.includes('fetch') && msg.includes('fail')) {
    return {
      code: 'NETWORK_ERROR',
      title: 'Ошибка сети',
      message: 'Проблема с сетевым подключением.',
      advice: 'Проверьте интернет-соединение сервера и доступность прокси. Повторите задачу.',
    };
  }

  // ── Content / Upload ──────────────────────────────────────
  if (msg.includes('video') && (msg.includes('not found') || msg.includes('not exist') || msg.includes('no such file'))) {
    return {
      code: 'VIDEO_NOT_FOUND',
      title: 'Видео не найдено',
      message: 'Видеофайл отсутствует на сервере.',
      advice: 'Загрузите видео повторно. Файл мог быть удалён системой очистки или не загружен полностью.',
    };
  }

  if (msg.includes('rejected') || msg.includes('community guideline') || msg.includes('violation')) {
    return {
      code: 'VIDEO_REJECTED',
      title: 'Видео отклонено',
      message: 'Платформа отклонила видео из-за нарушения правил.',
      advice: 'Проверьте контент видео. Возможные причины: защита авторских прав, запрещённый контент, спам. Попробуйте другое видео.',
    };
  }

  if (msg.includes('ffmpeg') || msg.includes('uniquif')) {
    return {
      code: 'FFMPEG_ERROR',
      title: 'Ошибка обработки видео',
      message: 'Не удалось обработать видео (уникализация).',
      advice: 'Проверьте формат видео (MP4, MOV). Убедитесь, что файл не повреждён. Попробуйте загрузить видео без уникализации.',
    };
  }

  // ── Infrastructure ────────────────────────────────────────
  if (msg.includes('no proxy') || msg.includes('no_proxy')) {
    return {
      code: 'NO_PROXY',
      title: 'Прокси не назначен',
      message: 'У аккаунта нет привязанного прокси.',
      advice: 'Привяжите прокси к аккаунту: меню аккаунта → «Привязать прокси».',
    };
  }

  if (msg.includes('no fingerprint') || msg.includes('no_fingerprint')) {
    return {
      code: 'NO_FINGERPRINT',
      title: 'Нет фингерпринта',
      message: 'У аккаунта отсутствует сгенерированный фингерпринт.',
      advice: 'Переимпортируйте аккаунт — фингерпринт будет сгенерирован автоматически.',
    };
  }

  if (msg.includes('disk') || msg.includes('enospc') || msg.includes('no space')) {
    return {
      code: 'DISK_ERROR',
      title: 'Нет места на диске',
      message: 'На сервере закончилось место.',
      advice: 'Очистите диск: удалите ненужные видео, запустите cleanup. Если проблема повторяется — увеличьте объём диска.',
    };
  }

  // ── Default ───────────────────────────────────────────────
  const defaultAdvice: Record<WorkerHandler, string> = {
    upload: 'Попробуйте загрузить видео повторно. Если ошибка повторяется — проверьте прокси и cookies аккаунта.',
    warmup: 'Попробуйте запустить прогрев повторно. Если ошибка повторяется — проверьте прокси.',
    login: 'Повторите попытку входа. Если ошибка повторяется — проверьте учётные данные.',
    'edit-profile': 'Попробуйте отредактировать профиль повторно или сделайте это вручную через приложение.',
    cookies: 'Повторите обновление cookies. Если ошибка повторяется — переимпортируйте аккаунт.',
    analytics: 'Сбор статистики будет повторён автоматически. Никаких действий не требуется.',
    shadowban: 'Проверка на теневой бан будет повторена автоматически.',
    cleanup: 'Очистка файлов будет повторена автоматически.',
  };

  return {
    code: 'UNKNOWN_ERROR',
    title: 'Неизвестная ошибка',
    message: rawMessage.slice(0, 200),
    advice: defaultAdvice[handler] || 'Попробуйте повторить действие.',
  };
}

// ── Emit structured error to frontend ───────────────────────

/**
 * Classify error, log it, and emit structured event to frontend.
 * Call this in every handler's catch block.
 */
export function emitWorkerError(
  logger: SocketLogger,
  accountId: string,
  handler: WorkerHandler,
  err: unknown,
): ClassifiedError {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const classified = classifyError(rawMessage, handler);

  // Log human-readable error
  logger.error(`❌ [${handler}] ${classified.title}: ${classified.message}`);
  logger.warn(`💡 Совет: ${classified.advice}`);

  // Emit structured event for frontend toast/notification
  const socket = (logger as any).socket;
  if (socket) {
    const event: WorkerErrorEvent = {
      accountId,
      handler,
      code: classified.code,
      title: classified.title,
      message: classified.message,
      advice: classified.advice,
      detail: rawMessage.slice(0, 500),
      timestamp: new Date().toISOString(),
    };
    socket.emit('worker:error', event);
  }

  return classified;
}

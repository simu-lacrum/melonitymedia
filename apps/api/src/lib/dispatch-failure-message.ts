export interface DispatchFailure {
  accountId: string;
  error?: string;
}

const BUSY_TASK_LABELS: Record<string, string> = {
  upload: 'залив',
  warmup: 'прогрев',
  login: 'авторизация',
  'edit-profile': 'редактирование профиля',
  cookies: 'обновление cookies',
  analytics: 'сбор статистики',
};

export function describeDispatchFailure(error?: string): string {
  if (!error) return 'Аккаунт не прошёл предварительную проверку.';

  if (error.startsWith('ACCOUNT_BUSY')) {
    const task = error.split(':')[1] || 'другая задача';
    return `Аккаунт уже занят: выполняется ${BUSY_TASK_LABELS[task] || task}. Дождитесь завершения задачи.`;
  }

  switch (error) {
    case 'WARMUP_ALREADY_COMPLETED':
      return 'Прогрев уже завершён: аккаунт готов к заливу, повторная задача не нужна.';
    case 'WARMUP_REQUIRED':
      return 'Прогрев аккаунта не завершён. Завершите прогрев или выберите аккаунт со статусом «Готов».';
    case 'NO_PROXY':
      return 'К аккаунту не привязан рабочий прокси.';
    case 'PROXY_UNAVAILABLE':
      return 'Закреплённый прокси недоступен. Проверьте его или привяжите рабочий прокси той же страны.';
    case 'NO_COOKIES':
      return 'У аккаунта нет валидных cookies. Выполните вход или импорт cookies.';
    case 'NO_FINGERPRINT':
      return 'У аккаунта нет fingerprint. Переимпортируйте аккаунт.';
    case 'NO_ACCOUNT':
      return 'Аккаунт не найден или больше недоступен текущему пользователю.';
    case 'ACCOUNT_BANNED':
      return 'Аккаунт заблокирован платформой.';
    case 'ACCOUNT_SHADOWBAN_SUSPECTED':
      return 'Для аккаунта обнаружены признаки ограничения охватов.';
    case 'ACCOUNT_PAUSED':
      return 'Аккаунт приостановлен. Возобновите его перед запуском.';
    default:
      return `Аккаунт не прошёл предварительную проверку (${error}).`;
  }
}

export function describeDispatchFailures(failures: DispatchFailure[]): string {
  if (failures.length === 0) return '';

  const uniqueReasons = [...new Set(failures.map((failure) => describeDispatchFailure(failure.error)))];
  const prefix = failures.length === 1
    ? 'Задача не запущена для выбранного аккаунта.'
    : `Задача не запущена для ${failures.length} аккаунтов.`;

  return `${prefix} ${uniqueReasons.join(' ')}`;
}

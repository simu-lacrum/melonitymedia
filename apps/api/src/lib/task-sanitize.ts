const SENSITIVE_CONFIG_KEYS = new Set([
  'password',
  'secret',
  'token',
  'vncPassword',
  'vncPort',
  'vncUrl',
  'webPort',
]);

function sanitizeConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeConfigValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    const isSensitive = [...SENSITIVE_CONFIG_KEYS].some(sensitive =>
      normalizedKey === sensitive.toLowerCase() || normalizedKey.endsWith(sensitive.toLowerCase()),
    );
    if (isSensitive) continue;
    result[key] = sanitizeConfigValue(nestedValue);
  }

  return result;
}

export function sanitizeTaskConfig(config: unknown): unknown {
  return sanitizeConfigValue(config);
}

export function buildTaskMonitorUrl(taskId: string, jobId: string): string {
  return `/api/workspace/jobs/${encodeURIComponent(taskId)}/monitor/${encodeURIComponent(jobId)}`;
}

import { clsx, type ClassValue } from 'clsx';

/** Merge class names — wrapper over clsx for Tailwind */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Format date to Russian locale */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

/** Format file size to human-readable string */
export function formatFileSize(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/** Format number with spaces (Russian style: 1 234 567) */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('ru-RU').format(num);
}

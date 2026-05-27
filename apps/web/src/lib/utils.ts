import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n);
}

export function formatRelativeTime(date: Date | string | null | undefined) {
  if (!date) return '';
  return formatDistanceToNow(new Date(date), { locale: ru, addSuffix: true });
}

export function formatAbsoluteTime(date: Date | string | null | undefined) {
  if (!date) return '';
  return format(new Date(date), 'd MMMM yyyy, HH:mm', { locale: ru });
}

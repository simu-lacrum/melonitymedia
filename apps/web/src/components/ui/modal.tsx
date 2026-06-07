'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  variant?: 'default' | 'destructive';
  loading?: boolean;
  children?: React.ReactNode;
}

/**
 * Modal — Emil Kowalski Design Engineering
 *
 * - CSS transitions instead of keyframes (interruptible)
 * - transform-origin: center (modals are exempt from origin-aware rule)
 * - Entry: scale(0.96) + opacity:0 → scale(1) + opacity:1
 * - Exit: fast snap back (200ms vs 250ms enter)
 */
export function Modal({
  open, onClose, title, description,
  confirmLabel = 'Подтвердить', cancelLabel = 'Отмена',
  onConfirm, variant = 'default', loading, children,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on Escape key (no animation on keyboard action — instant close)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // RAF to ensure DOM is painted before triggering transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      setVisible(false);
      // Wait for exit transition to complete before unmounting
      timeoutRef.current = setTimeout(() => setMounted(false), 200);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [open, handleKeyDown]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay — CSS transition (interruptible) */}
      <div
        className={cn(
          'absolute inset-0 bg-black/60',
          'transition-opacity duration-200 ease-out',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />

      {/* Card — origin: center (modals exempt from origin-aware rule) */}
      <div
        className={cn(
          'relative bg-surface-dark rounded-2xl p-6 w-full max-w-md mx-4',
          'transition-[opacity,transform] ease-[cubic-bezier(0.23,1,0.32,1)]',
          visible
            ? 'opacity-100 scale-100 duration-[250ms]'
            : 'opacity-0 scale-[0.96] duration-200',
        )}
        style={{ transformOrigin: 'center' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-gray transition-colors duration-150 ease-out cursor-pointer hover:text-pure-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <h3 className="text-lg font-semibold text-pure-white pr-8">{title}</h3>
        {description && (
          <p className="text-sm text-muted-gray mt-2">{description}</p>
        )}

        {/* Custom content */}
        {children}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

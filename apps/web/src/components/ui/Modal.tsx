'use client';

import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

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

export function Modal({
  open, onClose, title, description,
  confirmLabel = 'Подтвердить', cancelLabel = 'Отмена',
  onConfirm, variant = 'default', loading, children,
}: ModalProps) {
  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 animate-[fadeIn_200ms_ease]"
        onClick={onClose}
      />

      {/* Card */}
      <div className={cn(
        'relative bg-surface-dark rounded-2xl p-6 w-full max-w-md mx-4',
        'animate-[scaleIn_200ms_ease]',
      )}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-gray hover:text-pure-white transition-colors"
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
            variant={variant === 'destructive' ? 'destructive' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

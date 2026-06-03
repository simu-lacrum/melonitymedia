'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}

/**
 * Drawer — Emil Kowalski Design Engineering
 *
 * - iOS-like drawer curve: cubic-bezier(0.32, 0.72, 0, 1)
 * - CSS transition (interruptible) instead of keyframe
 * - will-change: transform for GPU compositing
 * - Overlay: opacity transition (interruptible)
 * - Asymmetric: enter 280ms, exit 200ms (faster response)
 */
export function Drawer({ open, onClose, title, children, width = '480px' }: DrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      setVisible(false);
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
    <>
      {/* Overlay — CSS transition (interruptible) */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50',
          'transition-opacity ease-out',
          visible ? 'opacity-100 duration-[280ms]' : 'opacity-0 duration-200',
        )}
        onClick={onClose}
      />

      {/* Panel — iOS drawer curve, GPU-composited */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full bg-surface-dark shadow-2xl',
          'flex flex-col',
          'ease-[cubic-bezier(0.32,0.72,0,1)]',
          visible
            ? 'translate-x-0 duration-[280ms]'
            : 'translate-x-full duration-200',
        )}
        style={{
          width: `min(${width}, 100vw)`,
          willChange: 'transform',
          transitionProperty: 'transform',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-muted-gray/10">
          <h3 className="text-lg font-semibold text-pure-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-muted-gray transition-colors duration-150 ease-out p-1 cursor-pointer hover:text-pure-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </>
  );
}

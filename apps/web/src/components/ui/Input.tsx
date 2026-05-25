'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm text-muted-gray font-medium">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-10 px-4 rounded-xl bg-surface-dark text-pure-white text-sm',
            'border border-transparent transition-all duration-200',
            'placeholder:text-muted-gray/60',
            'focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30',
            error && 'border-alert-red focus:border-alert-red focus:ring-alert-red/30',
            className,
          )}
          {...props}
        />
        {error && (
          <p className="text-xs text-alert-red mt-0.5">{error}</p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

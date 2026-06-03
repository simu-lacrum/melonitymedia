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
          <label htmlFor={inputId} className="text-sm text-muted-gray font-semibold uppercase tracking-wide">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full h-12 px-4 rounded-lg bg-surface-dark text-pure-white text-sm font-medium',
            'border border-pure-white/[0.1] transition-[border-color,background-color,box-shadow] duration-200 ease-out',
            'placeholder:text-muted-gray/50',
            'focus:border-pure-white/[0.4] focus:outline-none focus:bg-night-base',
            error && 'border-alert-red focus:border-alert-red',
            className,
          )}
          {...props}
        />
        {error && (
          <p className="text-xs text-alert-red mt-1 font-medium">{error}</p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

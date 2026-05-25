'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Button — Strict Edition
// ─────────────────────────────────────────────────────────────

const variants = {
  primary: 'btn-primary-strict',
  accent: 'btn-accent-strict',
  outline: 'btn-outline-strict',
  secondary: 'bg-surface-dark text-pure-white border border-pure-white/[0.1] hover:border-pure-white/[0.2] hover:bg-surface-elevated',
  ghost: 'bg-transparent text-muted-gray hover:text-pure-white hover:bg-pure-white/[0.05]',
  destructive: 'bg-alert-red text-pure-white hover:brightness-110',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-sm rounded-md gap-1.5',
  md: 'h-10 px-4 text-sm rounded-lg gap-2',
  lg: 'h-12 px-6 text-base rounded-lg gap-2.5',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center font-semibold transition-all duration-300 cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none uppercase tracking-wide',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';

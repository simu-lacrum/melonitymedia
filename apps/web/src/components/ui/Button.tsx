'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Button — Primary interactive element
// Variants follow design.md: Melon Pink CTA with glow effect,
// Surface Dark secondary, Ghost transparent, Alert Red destructive.
// ─────────────────────────────────────────────────────────────

const variants = {
  primary: 'bg-melon-pink text-pure-white hover:shadow-[0_0_20px_var(--color-pink-alpha)] hover:scale-[1.02] active:scale-[0.98]',
  secondary: 'bg-surface-dark text-pure-white border border-muted-gray/30 hover:border-muted-gray/60 hover:brightness-110',
  ghost: 'bg-transparent text-muted-gray hover:bg-surface-dark hover:text-pure-white',
  destructive: 'bg-alert-red text-pure-white hover:brightness-110 active:scale-[0.98]',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-sm rounded-lg gap-1.5',
  md: 'h-10 px-4 text-base rounded-xl gap-2',
  lg: 'h-12 px-6 text-lg rounded-xl gap-2.5',
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
          'inline-flex items-center justify-center font-semibold transition-all duration-200 cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none',
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

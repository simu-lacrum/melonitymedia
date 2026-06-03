'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { Slot, Slottable } from '@radix-ui/react-slot';
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
  sm: 'h-8 px-3 text-sm rounded-full gap-1.5',
  md: 'h-10 px-4 text-sm rounded-lg gap-2',
  lg: 'h-12 px-6 text-base rounded-lg gap-2.5', icon: 'h-10 w-10',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: React.ReactNode;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center font-semibold cursor-pointer',
          'transition-[transform,filter,box-shadow] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
          'active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 uppercase tracking-wide',
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
        <Slottable>{children}</Slottable>
      </Comp>
    );
  },
);

Button.displayName = 'Button';





import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type CardVariant = "surface" | "elevated" | "header" | "interactive";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

/**
 * Strict Corporate Dark Card.
 *
 * - `surface` (default): flat `--color-surface-dark`, hairline border, spatial shadow.
 * - `elevated`: same as surface + `--color-surface-elevated` background + stronger shadow.
 * - `header`: ONLY for the global sticky header. Uses backdrop-blur for the glass effect.
 * - `interactive`: same as surface but with hover effects.
 */
export function Card({
  variant = "surface",
  className,
  ...rest
}: CardProps) {
  const base =
    "rounded-xl border border-white/[0.04] text-white";
  const variants: Record<CardVariant, string> = {
    surface:
      "bg-[var(--color-surface-dark)] shadow-[0_8px_30px_rgba(0,0,0,0.2)]",
    elevated:
      "bg-[var(--color-surface-elevated)] shadow-[0_12px_40px_rgba(0,0,0,0.28)]",
    header:
      "bg-[rgba(28,32,38,0.72)] backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.32)]",
    interactive:
      "bg-[var(--color-surface-dark)] shadow-[0_8px_30px_rgba(0,0,0,0.2)] hover:bg-[var(--color-surface-elevated)] transition-colors cursor-pointer",
  };

  return (
    <div className={cn(base, variants[variant], className)} {...rest} />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-white/60", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} /> }

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('p-6 pt-0', className)} {...props} /> }

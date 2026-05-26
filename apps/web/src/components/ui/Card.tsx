import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type CardVariant = "surface" | "elevated" | "header";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

/**
 * Strict Corporate Dark Card.
 *
 * - `surface` (default): flat `--color-surface-dark`, hairline border, spatial shadow.
 * - `elevated`: same as surface + `--color-surface-elevated` background + stronger shadow.
 * - `header`: ONLY for the global sticky header. Uses backdrop-blur for the glass effect.
 *   Do NOT reuse `variant="header"` elsewhere — glassmorphism is forbidden outside the header
 *   by the design system (see README → Дизайн-принципы).
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
  };

  return (
    <div className={cn(base, variants[variant], className)} {...rest} />
  );
}

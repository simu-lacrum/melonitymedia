import { cn } from '@/lib/utils';

const badgeVariants = {
  success: 'bg-success-green/10 text-success-green',
  warning: 'bg-warning-amber/10 text-warning-amber',
  error: 'bg-alert-red/10 text-alert-red',
  info: 'bg-melon-pink/10 text-melon-pink',
  neutral: 'bg-muted-gray/10 text-muted-gray',
} as const;

interface BadgeProps {
  variant?: keyof typeof badgeVariants;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap',
      badgeVariants[variant],
      className,
    )}>
      {children}
    </span>
  );
}

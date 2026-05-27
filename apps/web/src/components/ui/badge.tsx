import { cn } from '@/lib/utils';

const badgeVariants = {
  active: 'bg-success-green/10 text-success-green border border-success-green/20', success: 'bg-success-green/10 text-success-green border border-success-green/20',
  warning: 'bg-warning-amber/10 text-warning-amber border border-warning-amber/20',
  error: 'bg-alert-red/10 text-alert-red border border-alert-red/20',
  info: 'bg-pure-white/10 text-pure-white border border-pure-white/20',
  neutral: 'bg-night-base text-muted-gray border border-pure-white/[0.1]',
} as const;

interface BadgeProps { showDot?: boolean;
  variant?: keyof typeof badgeVariants;
  children?: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', showDot, children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
      badgeVariants[variant],
      className,
    )}>
      {showDot && <span className='w-1.5 h-1.5 rounded-full bg-current mr-1.5' />} {children}
    </span>
  );
}



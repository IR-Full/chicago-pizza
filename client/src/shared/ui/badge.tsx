import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/cn';

/** The design system's tags: quiet tonal pills, one per accent ramp. */
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.02em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-brand-200 text-brand-800',
        secondary: 'border-transparent bg-muted text-foreground/75',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'border-primary text-brand-700',
        success: 'border-transparent bg-sage-200 text-sage-800',
        warning: 'border-transparent bg-brand-300 text-brand-900',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

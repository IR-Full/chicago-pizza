import { cn } from '@/shared/lib/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-card bg-muted', className)} {...props} />;
}

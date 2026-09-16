'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
}

/**
 * A styled native checkbox — keeps `react-hook-form` registration trivial and
 * stays accessible without an extra Radix dependency.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, checked, ...props }, ref) => (
    <label className={cn('inline-flex cursor-pointer select-none items-center gap-2 text-sm', className)}>
      <span className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          className="peer h-[18px] w-[18px] appearance-none rounded-[6px] border-[1.5px] border-primary bg-card transition-colors checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <Check
          className="pointer-events-none absolute h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
        />
      </span>
      {label}
    </label>
  ),
);
Checkbox.displayName = 'Checkbox';

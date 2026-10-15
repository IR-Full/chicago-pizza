'use client';

import { forwardRef, type ClipboardEvent } from 'react';
import { IMaskMixin } from 'react-imask';
import { Input, type InputProps } from './input';

const MaskedInput = IMaskMixin<HTMLInputElement>(({ inputRef, ...props }) => (
  <Input {...props} ref={inputRef} />
));

type PhoneInputProps = Omit<InputProps, 'value' | 'defaultValue' | 'onChange' | 'type'> & {
  value?: string;
  onValueChange: (value: string) => void;
};

/** Display a permanent Russian phone mask; keep only the API value in the form. */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value = '', onValueChange, onPaste, ...props }, ref) => (
    <MaskedInput
      {...props}
      inputRef={ref}
      type="text"
      inputMode="tel"
      autoComplete="tel"
      mask="+7 (000) 000 - 00 - 00"
      lazy={false}
      placeholderChar="x"
      overwrite
      unmask
      value={value.replace(/^\+7/, '')}
      prepare={(input: string) => {
        const digits = input.replace(/\D/g, '');
        return digits.length === 11 && /^[78]/.test(digits) ? `+7${digits.slice(1)}` : input;
      }}
      onAccept={(digits: string) => onValueChange(digits ? `+7${digits}` : '')}
      onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
        onPaste?.(event);
        if (event.defaultPrevented) return;
        const digits = event.clipboardData.getData('text').replace(/\D/g, '');
        // Whole-number paste/autofill commonly contains +7 or the domestic 8.
        if (digits.length === 11 && /^[78]/.test(digits)) {
          event.preventDefault();
          onValueChange(`+7${digits.slice(1)}`);
        }
      }}
    />
  ),
);
PhoneInput.displayName = 'PhoneInput';

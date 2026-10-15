import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhoneInput } from './phone-input';

function Example() {
  const [value, setValue] = useState('');
  return (
    <>
      <PhoneInput aria-label="Телефон" value={value} onValueChange={setValue} />
      <output data-testid="raw">{value}</output>
    </>
  );
}

describe('PhoneInput', () => {
  it.each([0, 4])('keeps digits and advances the caret from position %s', (position) => {
    render(<Example />);
    const input = screen.getByLabelText('Телефон') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(position, position);
    for (const digit of '9281234567') {
      fireEvent.keyDown(input, { key: digit });
      const start = input.selectionStart!;
      const end = input.selectionEnd!;
      fireEvent.input(input, {
        target: {
          value: input.value.slice(0, start) + digit + input.value.slice(end),
          selectionStart: start + 1,
          selectionEnd: start + 1,
        },
        inputType: 'insertText',
        data: digit,
      });
    }
    expect(input).toHaveValue('+7 (928) 123 - 45 - 67');
    expect(screen.getByTestId('raw')).toHaveTextContent('+79281234567');
  });
  it('keeps the full mask visible while the optional value is empty', () => {
    render(<Example />);
    expect(screen.getByLabelText('Телефон')).toHaveValue('+7 (xxx) xxx - xx - xx');
    expect(screen.getByTestId('raw')).toBeEmptyDOMElement();
  });

  it('fills the mask and stores the API number without punctuation', () => {
    render(<Example />);
    fireEvent.input(screen.getByLabelText('Телефон'), { target: { value: '+7 (928) 123 - 45 - 67' } });
    expect(screen.getByLabelText('Телефон')).toHaveValue('+7 (928) 123 - 45 - 67');
    expect(screen.getByTestId('raw')).toHaveTextContent('+79281234567');
  });

  it.each(['+7 (928) 123-45-67', '8 (928) 123-45-67', '9281234567'])(
    'accepts a pasted phone: %s',
    (phone) => {
      render(<Example />);
      const input = screen.getByLabelText('Телефон');
      if (phone.length === 10) {
        // Partial/national paste follows the mask's normal input processing.
        fireEvent.input(input, { target: { value: phone } });
      } else {
        fireEvent.paste(input, { clipboardData: { getData: () => phone } });
      }
      expect(input).toHaveValue('+7 (928) 123 - 45 - 67');
      expect(screen.getByTestId('raw')).toHaveTextContent('+79281234567');
    },
  );

  it('normalizes a domestic number inserted by autofill', () => {
    render(<Example />);
    fireEvent.input(screen.getByLabelText('Телефон'), { target: { value: '89281234567' } });
    expect(screen.getByTestId('raw')).toHaveTextContent('+79281234567');
  });

  it('rejects letters and restores the permanent mask after clearing', () => {
    render(<Example />);
    const input = screen.getByLabelText('Телефон');
    fireEvent.input(input, { target: { value: 'letters928' } });
    expect(input).toHaveValue('+7 (928) xxx - xx - xx');
    fireEvent.input(input, { target: { value: '' } });
    expect(input).toHaveValue('+7 (xxx) xxx - xx - xx');
    expect(screen.getByTestId('raw')).toBeEmptyDOMElement();
  });
});

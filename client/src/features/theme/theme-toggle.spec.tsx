import { act, fireEvent } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { ruMessages } from '@/test/utils';
import { ThemeToggle } from './theme-toggle';

const theme = vi.hoisted(() => ({ resolvedTheme: undefined as string | undefined, setTheme: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => theme }));

describe('ThemeToggle hydration', () => {
  it.each(['dark', 'light'])(
    'hydrates with the browser theme %s without mismatched attributes',
    async (resolved) => {
      theme.resolvedTheme = undefined;
      theme.setTheme.mockClear();
      const element = (
        <NextIntlClientProvider locale="ru" messages={ruMessages}>
          <ThemeToggle />
        </NextIntlClientProvider>
      );
      const container = document.createElement('div');
      container.innerHTML = renderToString(element);
      document.body.append(container);
      expect(container.querySelector('button')).toHaveAttribute('aria-label', 'Тёмная');

      theme.resolvedTheme = resolved;
      const errors: unknown[] = [];
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
      let root: ReturnType<typeof hydrateRoot> | undefined;
      try {
        await act(async () => {
          root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
        });
        const button = container.querySelector('button')!;
        expect(button).toHaveAttribute('aria-label', resolved === 'dark' ? 'Светлая' : 'Тёмная');
        expect(errors).toEqual([]);
        fireEvent.click(button);
        expect(theme.setTheme).toHaveBeenCalledWith(resolved === 'dark' ? 'light' : 'dark');
      } finally {
        await act(async () => root?.unmount());
        consoleError.mockRestore();
        container.remove();
      }
    },
  );
});

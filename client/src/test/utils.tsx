import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ru from '@/shared/i18n/messages/ru.json';

/**
 * Components read their copy through next-intl and their data through React
 * Query, so both providers come along in every render. The real Russian
 * message catalogue is used rather than stubs — a missing key is then a test
 * failure, not a silently rendered placeholder.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // gcTime must stay high: data written by a mutation's onSuccess has no
      // observer yet, and a zero gcTime would collect it before the assertion.
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface Options extends Omit<RenderOptions, 'wrapper'> {
  locale?: string;
  messages?: AbstractIntlMessages;
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  { locale = 'ru', messages = ru, queryClient = createTestQueryClient(), ...options }: Options = {},
): RenderResult & { queryClient: QueryClient } {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}

/**
 * React 18's test renderer cannot render an async Server Component: it sees a
 * promise where a tree should be. This resolves them the way the Next.js
 * server does — depth first — so a page that composes several of them can be
 * asserted on as ordinary markup. Client components are left untouched.
 */
export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolveServerTree(child)));
  if (!isValidElement(node)) return node;

  const element = node as ReactElement<{ children?: ReactNode }>;

  if (typeof element.type === 'function' && element.type.constructor?.name === 'AsyncFunction') {
    const rendered = await (element.type as (props: unknown) => Promise<ReactNode>)(element.props);
    return resolveServerTree(rendered);
  }

  const children = element.props?.children;
  if (children === undefined) return element;

  return cloneElement(element, undefined, await resolveServerTree(children));
}

/** Message catalogue re-exported so specs can assert against the real copy. */
export { ru as ruMessages };

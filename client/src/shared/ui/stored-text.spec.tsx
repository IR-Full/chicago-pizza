import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { StoredText } from './stored-text';

it('preserves ordinary Cyrillic, punctuation and emoji', () => {
  renderWithProviders(<StoredText text="Здравствуйте! Спасибо 🥤" />);
  expect(screen.getByText('Здравствуйте! Спасибо 🥤')).toBeInTheDocument();
});
it('explains irreversibly damaged text rather than inventing a message', () => {
  renderWithProviders(<StoredText text={'\uFFFD\uFFFD\uFFFD'} />);
  expect(screen.getByText('Текст сообщения повреждён при сохранении')).toBeInTheDocument();
});

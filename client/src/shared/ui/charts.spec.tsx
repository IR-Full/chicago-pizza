import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { BarList } from './bar-list';
import { ColumnChart } from './column-chart';

const POINTS = [
  { label: '09-20', value: 400 },
  { label: '09-21', value: 900 },
  { label: '09-22', value: 0 },
];

const money = (value: number) => `${value} ₽`;

const chart = (points = POINTS) =>
  renderWithProviders(
    <ColumnChart
      points={points}
      formatValue={money}
      tableLabel="День"
      valueLabel="Выручка"
      peakLabel="Лучший день"
    />,
  );

describe('ColumnChart — the marks', () => {
  it('scales each column against the axis maximum, not the tallest bar', () => {
    const { container } = chart();
    const bars = [...container.querySelectorAll('[style*="height"]')] as HTMLElement[];

    // The axis rounds 900 up to 1000, so the tallest column is 90% — ticks
    // that read "1 000" would otherwise sit above a bar drawn at full height.
    expect(bars[0].style.height).toBe('40%');
    expect(bars[1].style.height).toBe('90%');
  });

  it('draws nothing at all for a day with no revenue', () => {
    const { container } = chart();
    const bars = [...container.querySelectorAll('[style*="height"]')] as HTMLElement[];

    // A stub of colour for zero would read as "a little", which is a lie.
    expect(bars[2].style.height).toBe('0%');
  });

  it('gives a tiny non-zero value enough height to be visible', () => {
    const { container } = chart([
      { label: '09-20', value: 1000 },
      { label: '09-21', value: 1 },
    ]);
    const bars = [...container.querySelectorAll('[style*="height"]')] as HTMLElement[];

    expect(bars[1].style.height).toBe('2%');
  });

  it('caps the column width so the band keeps some air', () => {
    const { container } = chart();
    const slots = [...container.querySelectorAll('[role="img"]')] as HTMLElement[];

    expect(slots[0].style.maxWidth).toBe('24px');
  });
});

describe('ColumnChart — reading it', () => {
  it('labels only the extreme, not every column', () => {
    chart();

    // A number on every column is chaos and goes unread.
    expect(screen.getByText(/Лучший день: 09-21 · 900 ₽/)).toBeInTheDocument();
    expect(screen.queryByText(/09-20 · 400 ₽/)).not.toBeInTheDocument();
  });

  it('names every column for a screen reader', () => {
    chart();

    expect(screen.getByRole('img', { name: '09-20: 400 ₽' })).toBeInTheDocument();
  });

  it('prefers the caller’s detail text over the bare value', () => {
    renderWithProviders(
      <ColumnChart
        points={[{ label: '09-20', value: 400, detail: '400 ₽ · 3 зак.' }]}
        formatValue={money}
        tableLabel="День"
        valueLabel="Выручка"
        peakLabel="Лучший день"
      />,
    );

    expect(screen.getByRole('img', { name: '09-20: 400 ₽ · 3 зак.' })).toBeInTheDocument();
  });

  it('shows the hovered column’s value', () => {
    chart();

    fireEvent.mouseEnter(screen.getByRole('img', { name: '09-20: 400 ₽' }).parentElement!);

    expect(screen.getByRole('status')).toHaveTextContent('09-20 · 400 ₽');
  });

  it('rounds the axis to numbers a person would say', () => {
    const { container } = chart([{ label: '09-20', value: 1473 }]);

    // 1 473 becomes an axis topping out at 2 000, not at 1 473.
    expect(container.textContent).toContain('2000 ₽');
  });

  /** The same numbers, reachable without reading a chart at all. */
  it('offers every value as a table', () => {
    chart();

    const table = screen.getByRole('table');
    expect(within(table).getByText('09-20')).toBeInTheDocument();
    expect(within(table).getByText('400 ₽')).toBeInTheDocument();
    expect(within(table).getByText('0 ₽')).toBeInTheDocument();
  });

  it('renders nothing rather than an empty frame', () => {
    const { container } = chart([]);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('BarList', () => {
  const rows = [
    { label: 'Пепперони', value: 756, note: '12 шт' },
    { label: '4 сыра', value: 260, note: '4 шт' },
  ];

  it('scales each bar against the largest row', () => {
    const { container } = renderWithProviders(
      <BarList rows={rows} formatValue={money} emptyLabel="Нет данных" />,
    );
    const bars = [...container.querySelectorAll('[style*="width"]')] as HTMLElement[];

    expect(bars[0].style.width).toBe('100%');
    expect(bars[1].style.width).toMatch(/^34\./);
  });

  it('puts the value and the note beside the name', () => {
    renderWithProviders(<BarList rows={rows} formatValue={money} emptyLabel="Нет данных" />);

    expect(screen.getByText('756 ₽ · 12 шт')).toBeInTheDocument();
  });

  it('says there is nothing rather than drawing an empty chart', () => {
    renderWithProviders(<BarList rows={[]} formatValue={money} emptyLabel="Нет данных" />);

    expect(screen.getByText('Нет данных')).toBeInTheDocument();
  });

  it('keeps a row of zero visible', () => {
    const { container } = renderWithProviders(
      <BarList rows={[{ label: 'Ничего', value: 0 }]} formatValue={money} emptyLabel="—" />,
    );
    const bar = container.querySelector('[style*="width"]') as HTMLElement;

    // A row with no bar at all looks like a rendering failure.
    expect(bar.style.width).toBe('2%');
  });
});

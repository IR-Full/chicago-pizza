import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Checkbox } from './checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { FormField } from './form-field';
import { Input } from './input';
import { Label } from './label';
import { RadioGroup, RadioGroupItem } from './radio-group';
import { Skeleton } from './skeleton';
import { Textarea } from './textarea';

/**
 * The primitives carry the design system: pill buttons in the display face,
 * borderless surface cards, tonal tags. The assertions cover behaviour
 * (disabled, loading, forwarding) plus the few classes that *are* the design
 * decision, so a refactor cannot quietly undo them.
 */
describe('Button', () => {
  it('renders its label and handles a click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Заказать</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Заказать' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a pill in the display face', () => {
    render(<Button>Заказать</Button>);

    expect(screen.getByRole('button')).toHaveClass('rounded-full', 'font-heading');
  });

  it.each([
    ['default', 'bg-primary'],
    ['destructive', 'bg-destructive'],
    ['outline', 'border-border'],
    ['secondary', 'bg-secondary'],
    ['ghost', 'hover:bg-accent'],
    ['link', 'text-brand-700'],
  ])('renders the %s variant', (variant, expected) => {
    render(<Button variant={variant as never}>Кнопка</Button>);

    expect(screen.getByRole('button').className).toContain(expected);
  });

  it.each([
    ['default', 'h-11'],
    ['sm', 'h-9'],
    ['lg', 'h-[52px]'],
    ['icon', 'h-11'],
  ])('renders the %s size', (size, expected) => {
    render(<Button size={size as never}>Кнопка</Button>);

    expect(screen.getByRole('button').className).toContain(expected);
  });

  it('shows a spinner and blocks input while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Оформить
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('stays disabled when asked', () => {
    render(<Button disabled>Оформить</Button>);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders as a link when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/menu">Меню</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Меню' });
    expect(link).toHaveAttribute('href', '/menu');
    expect(link).toHaveClass('rounded-full');
  });

  it('lets a caller override a conflicting utility', () => {
    render(<Button className="rounded-none">Кнопка</Button>);

    expect(screen.getByRole('button').className).not.toContain('rounded-full');
  });

  it('forwards its ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Кнопка</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

describe('Badge', () => {
  it.each([
    ['default', 'bg-brand-200'],
    ['secondary', 'bg-muted'],
    ['destructive', 'bg-destructive'],
    ['outline', 'border-primary'],
    ['success', 'bg-sage-200'],
    ['warning', 'bg-brand-300'],
  ])('renders the %s tag', (variant, expected) => {
    render(<Badge variant={variant as never}>Хит</Badge>);

    expect(screen.getByText('Хит').className).toContain(expected);
  });

  it('is a small pill', () => {
    render(<Badge>Новинка</Badge>);

    expect(screen.getByText('Новинка')).toHaveClass('rounded-full', 'text-[11px]');
  });
});

describe('Card', () => {
  it('renders the whole composition', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Пепперони</CardTitle>
          <CardDescription>Острая</CardDescription>
        </CardHeader>
        <CardContent>Состав</CardContent>
        <CardFooter>440 ₽</CardFooter>
      </Card>,
    );

    expect(screen.getByRole('heading', { name: 'Пепперони' })).toBeInTheDocument();
    expect(screen.getByText('Острая')).toBeInTheDocument();
    expect(screen.getByText('Состав')).toBeInTheDocument();
    expect(screen.getByText('440 ₽')).toBeInTheDocument();
  });

  it('is a borderless surface slab', () => {
    const { container } = render(<Card>Содержимое</Card>);

    expect(container.firstElementChild).toHaveClass('rounded-card', 'bg-card');
    expect(container.firstElementChild?.className).not.toContain('border ');
  });

  it('sets the title in the display face', () => {
    render(<CardTitle>Пепперони</CardTitle>);

    expect(screen.getByRole('heading', { name: 'Пепперони' })).toHaveClass('font-heading');
  });
});

describe('Input', () => {
  it('accepts typing and forwards the value', () => {
    const onChange = vi.fn();
    render(<Input aria-label="Email" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.ru' } });

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.ru');
  });

  it('is a pill on the surface tone', () => {
    render(<Input aria-label="Email" />);

    expect(screen.getByLabelText('Email')).toHaveClass('rounded-full', 'bg-card');
  });

  it('passes the type through', () => {
    render(<Input type="password" aria-label="Пароль" />);

    expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'password');
  });

  it('forwards its ref', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Email" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});

describe('Textarea', () => {
  it('takes multi-line input', () => {
    render(<Textarea aria-label="Комментарий" />);

    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Позвонить\nза 10 минут' } });

    expect(screen.getByLabelText('Комментарий')).toHaveValue('Позвонить\nза 10 минут');
  });

  it('is rounded but not a pill — a pill comment box is unreadable', () => {
    render(<Textarea aria-label="Комментарий" />);

    expect(screen.getByLabelText('Комментарий')).toHaveClass('rounded-2xl');
  });
});

describe('Checkbox', () => {
  it('renders its label and toggles', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Вегетарианское" onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Вегетарианское'));

    expect(onChange).toHaveBeenCalled();
  });

  it('reflects the controlled checked state', () => {
    render(<Checkbox label="Острое" checked readOnly />);

    expect(screen.getByLabelText('Острое')).toBeChecked();
  });

  it('can be disabled', () => {
    render(<Checkbox label="Острое" disabled />);

    expect(screen.getByLabelText('Острое')).toBeDisabled();
  });
});

describe('Label and FormField', () => {
  it('associates a label with its control', () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" />
      </>,
    );

    expect(screen.getByLabelText('Email')).toHaveAttribute('id', 'email');
  });

  it('shows a hint until there is an error', () => {
    const { rerender } = render(
      <FormField label="Email" htmlFor="email" hint="Например, guest@chicago.ru">
        <Input id="email" />
      </FormField>,
    );

    expect(screen.getByText('Например, guest@chicago.ru')).toBeInTheDocument();

    rerender(
      <FormField label="Email" htmlFor="email" hint="Например, guest@chicago.ru" error="Некорректный email">
        <Input id="email" />
      </FormField>,
    );

    expect(screen.queryByText('Например, guest@chicago.ru')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Некорректный email');
  });

  it('renders without a label at all', () => {
    render(
      <FormField>
        <Input aria-label="Поиск" />
      </FormField>,
    );

    expect(screen.getByLabelText('Поиск')).toBeInTheDocument();
  });
});

describe('RadioGroup', () => {
  it('selects one option at a time', () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup value="cash" onValueChange={onValueChange}>
        <label>
          <RadioGroupItem value="cash" /> Наличными
        </label>
        <label>
          <RadioGroupItem value="card" /> Картой
        </label>
      </RadioGroup>,
    );

    const [cash, card] = screen.getAllByRole('radio');
    expect(cash).toBeChecked();

    fireEvent.click(card);
    expect(onValueChange).toHaveBeenCalledWith('card');
  });
});

describe('Skeleton', () => {
  it('pulses on the muted tone with the card radius', () => {
    const { container } = render(<Skeleton className="h-8 w-40" />);

    expect(container.firstElementChild).toHaveClass('animate-pulse', 'bg-muted', 'rounded-card', 'h-8');
  });
});

describe('Dialog', () => {
  it('opens on the trigger and shows its content', () => {
    render(
      <Dialog>
        <DialogTrigger>Собрать</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Соберите свою пиццу</DialogTitle>
            <DialogDescription>Выберите размер</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByText('Собрать'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Соберите свою пиццу')).toBeInTheDocument();
    expect(screen.getByText('Выберите размер')).toBeInTheDocument();
  });

  it('closes from the built-in close button', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Заголовок</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByText('Close'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders the dialog on the page background with the card radius', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Заголовок</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog').className).toContain('bg-background');
    expect(screen.getByRole('dialog').className).toContain('rounded-t-card');
  });
});

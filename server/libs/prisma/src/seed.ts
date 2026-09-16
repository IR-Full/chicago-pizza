import { PrismaClient, ProductType, DiscountType, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DOUGH_TYPES = [
  { name: 'Тонкое', slug: 'thin', priceModifier: 0 },
  { name: 'Классическое', slug: 'classic', priceModifier: 5000 },
  { name: 'Сырное', slug: 'cheesy', priceModifier: 15000 },
];

const INGREDIENTS = [
  { name: 'Моцарелла', slug: 'mozzarella', price: 8000, isVegetarian: true, isSpicy: false },
  { name: 'Пармезан', slug: 'parmesan', price: 9000, isVegetarian: true, isSpicy: false },
  { name: 'Чеддер', slug: 'cheddar', price: 8000, isVegetarian: true, isSpicy: false },
  { name: 'Дор блю', slug: 'dor-blue', price: 12000, isVegetarian: true, isSpicy: false },
  { name: 'Пепперони', slug: 'pepperoni', price: 12000, isVegetarian: false, isSpicy: true },
  { name: 'Бекон', slug: 'bacon', price: 11000, isVegetarian: false, isSpicy: false },
  { name: 'Курица гриль', slug: 'grilled-chicken', price: 11000, isVegetarian: false, isSpicy: false },
  { name: 'Говядина', slug: 'beef', price: 13000, isVegetarian: false, isSpicy: false },
  { name: 'Ветчина', slug: 'ham', price: 10000, isVegetarian: false, isSpicy: false },
  { name: 'Шампиньоны', slug: 'mushrooms', price: 7000, isVegetarian: true, isSpicy: false },
  { name: 'Томаты', slug: 'tomatoes', price: 6000, isVegetarian: true, isSpicy: false },
  { name: 'Маринованные огурцы', slug: 'pickles', price: 6000, isVegetarian: true, isSpicy: false },
  { name: 'Красный лук', slug: 'red-onion', price: 5000, isVegetarian: true, isSpicy: false },
  { name: 'Болгарский перец', slug: 'bell-pepper', price: 6000, isVegetarian: true, isSpicy: false },
  { name: 'Оливки', slug: 'olives', price: 7000, isVegetarian: true, isSpicy: false },
  { name: 'Ананас', slug: 'pineapple', price: 7000, isVegetarian: true, isSpicy: false },
  { name: 'Соус барбекю', slug: 'bbq-sauce', price: 4000, isVegetarian: true, isSpicy: false },
  { name: 'Соус Цезарь', slug: 'caesar-sauce', price: 4000, isVegetarian: true, isSpicy: false },
  { name: 'Острый перец халапеньо', slug: 'jalapeno', price: 5000, isVegetarian: true, isSpicy: true },
  { name: 'Пикантная колбаса', slug: 'spicy-sausage', price: 12000, isVegetarian: false, isSpicy: true },
];

// price in kopecks per size: [30cm, 45cm, 60cm]
const PIZZAS: {
  name: string;
  slug: string;
  description: string;
  prices: [number, number, number];
  isVegetarian: boolean;
  isSpicy: boolean;
  isNew?: boolean;
  isPopular?: boolean;
  ingredients: string[]; // ingredient slugs, all default (part of recipe)
}[] = [
  {
    name: '4 сыра',
    slug: '4-cheese',
    description: 'Моцарелла, пармезан, чеддер и дор блю на нежном томатном соусе.',
    prices: [45000, 65000, 89000],
    isVegetarian: true,
    isSpicy: false,
    isPopular: true,
    ingredients: ['mozzarella', 'parmesan', 'cheddar', 'dor-blue'],
  },
  {
    name: 'Жюльен',
    slug: 'julienne',
    description: 'Курица, шампиньоны и сливочный соус под сырной шапкой.',
    prices: [43000, 62000, 85000],
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['grilled-chicken', 'mushrooms', 'mozzarella'],
  },
  {
    name: 'Барбекю',
    slug: 'bbq',
    description: 'Говядина, бекон и красный лук с фирменным соусом барбекю.',
    prices: [47000, 68000, 92000],
    isVegetarian: false,
    isSpicy: false,
    isPopular: true,
    ingredients: ['beef', 'bacon', 'red-onion', 'bbq-sauce', 'mozzarella'],
  },
  {
    name: 'Ассорти',
    slug: 'assorti',
    description: 'Пепперони, ветчина, курица гриль, шампиньоны и болгарский перец.',
    prices: [48000, 69000, 94000],
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['pepperoni', 'ham', 'grilled-chicken', 'mushrooms', 'bell-pepper'],
  },
  {
    name: 'Цезарь',
    slug: 'caesar',
    description: 'Курица гриль, пармезан, томаты черри и соус Цезарь.',
    prices: [45000, 65000, 88000],
    isVegetarian: false,
    isSpicy: false,
    isNew: true,
    ingredients: ['grilled-chicken', 'parmesan', 'tomatoes', 'caesar-sauce'],
  },
  {
    name: 'Пепперони',
    slug: 'pepperoni-pizza',
    description: 'Острая пепперони и моцарелла на пикантном томатном соусе.',
    prices: [44000, 63000, 86000],
    isVegetarian: false,
    isSpicy: true,
    isPopular: true,
    ingredients: ['pepperoni', 'mozzarella', 'jalapeno'],
  },
  {
    name: 'Грибная',
    slug: 'mushroom',
    description: 'Шампиньоны, моцарелла и сливочно-чесночный соус.',
    prices: [41000, 59000, 81000],
    isVegetarian: true,
    isSpicy: false,
    ingredients: ['mushrooms', 'mozzarella', 'parmesan'],
  },
  {
    name: 'Мясная',
    slug: 'meat',
    description: 'Говядина, бекон, ветчина и пикантная колбаса — для настоящих мясоедов.',
    prices: [49000, 71000, 96000],
    isVegetarian: false,
    isSpicy: true,
    ingredients: ['beef', 'bacon', 'ham', 'spicy-sausage', 'mozzarella'],
  },
  {
    name: 'Куриная',
    slug: 'chicken',
    description: 'Курица гриль, кукуруза, томаты и моцарелла.',
    prices: [42000, 60000, 82000],
    isVegetarian: false,
    isSpicy: false,
    isNew: true,
    ingredients: ['grilled-chicken', 'tomatoes', 'mozzarella'],
  },
];

const SNACKS = [
  { name: 'Картофель по-деревенски', slug: 'potato-wedges', price: 19000, isVegetarian: true, isSpicy: false },
  { name: 'Куриные крылья BBQ', slug: 'chicken-wings-bbq', price: 29000, isVegetarian: false, isSpicy: false },
  { name: 'Сырные палочки', slug: 'cheese-sticks', price: 24000, isVegetarian: true, isSpicy: false },
  { name: 'Брускетты', slug: 'bruschetta', price: 21000, isVegetarian: true, isSpicy: false },
];

const DRINKS = [
  { name: 'Coca-Cola 0.5л', slug: 'cola-05', price: 9000, isVegetarian: true, isSpicy: false },
  { name: 'Морс клюквенный 0.5л', slug: 'cranberry-drink-05', price: 9000, isVegetarian: true, isSpicy: false },
  { name: 'Вода негазированная 0.5л', slug: 'still-water-05', price: 6000, isVegetarian: true, isSpicy: false },
];

const DESSERTS = [
  { name: 'Чизкейк Нью-Йорк', slug: 'cheesecake-ny', price: 25000, isVegetarian: true, isSpicy: false },
  { name: 'Шоколадный фондан', slug: 'chocolate-fondant', price: 23000, isVegetarian: true, isSpicy: false },
];

const COMBOS = [
  { name: 'Комбо на двоих', slug: 'combo-for-two', price: 129000, isVegetarian: false, isSpicy: false },
  { name: 'Семейное комбо', slug: 'combo-family', price: 219000, isVegetarian: false, isSpicy: false },
];

async function main() {
  console.log('Seeding database...');

  // ── Dough types ─────────────────────────────────────────────
  const doughBySlug = new Map<string, string>();
  for (const d of DOUGH_TYPES) {
    const row = await prisma.doughType.upsert({
      where: { slug: d.slug },
      update: {},
      create: d,
    });
    doughBySlug.set(d.slug, row.id);
  }

  // ── Ingredients ──────────────────────────────────────────────
  const ingredientBySlug = new Map<string, string>();
  for (const i of INGREDIENTS) {
    const row = await prisma.ingredient.upsert({
      where: { slug: i.slug },
      update: {},
      create: i,
    });
    ingredientBySlug.set(i.slug, row.id);
  }

  // ── Categories ───────────────────────────────────────────────
  const categories = await Promise.all([
    prisma.category.upsert({ where: { slug: 'pizza' }, update: {}, create: { name: 'Пиццы', slug: 'pizza', sortOrder: 1 } }),
    prisma.category.upsert({ where: { slug: 'snacks' }, update: {}, create: { name: 'Закуски', slug: 'snacks', sortOrder: 2 } }),
    prisma.category.upsert({ where: { slug: 'drinks' }, update: {}, create: { name: 'Напитки', slug: 'drinks', sortOrder: 3 } }),
    prisma.category.upsert({ where: { slug: 'desserts' }, update: {}, create: { name: 'Десерты', slug: 'desserts', sortOrder: 4 } }),
    prisma.category.upsert({ where: { slug: 'combo' }, update: {}, create: { name: 'Комбо', slug: 'combo', sortOrder: 5 } }),
  ]);
  const catId = (slug: string) => categories.find((c) => c.slug === slug)!.id;

  const sizeLabels: Array<[number, string]> = [
    [30, '30 см'],
    [45, '45 см'],
    [60, '60 см'],
  ];

  for (const pizza of PIZZAS) {
    const product = await prisma.product.upsert({
      where: { slug: pizza.slug },
      update: {},
      create: {
        categoryId: catId('pizza'),
        type: ProductType.PIZZA,
        name: pizza.name,
        slug: pizza.slug,
        description: pizza.description,
        isVegetarian: pizza.isVegetarian,
        isSpicy: pizza.isSpicy,
        isNew: !!pizza.isNew,
        isPopular: !!pizza.isPopular,
      },
    });

    for (let idx = 0; idx < sizeLabels.length; idx++) {
      const [sizeCm, label] = sizeLabels[idx];
      await prisma.productSize.upsert({
        where: { productId_sizeCm: { productId: product.id, sizeCm } },
        update: { price: pizza.prices[idx], label },
        create: { productId: product.id, sizeCm, label, price: pizza.prices[idx] },
      });
    }

    for (const ingSlug of pizza.ingredients) {
      const ingredientId = ingredientBySlug.get(ingSlug);
      if (!ingredientId) continue;
      await prisma.productIngredient.upsert({
        where: { productId_ingredientId: { productId: product.id, ingredientId } },
        update: {},
        create: { productId: product.id, ingredientId, isDefault: true },
      });
    }
  }

  // Products without sizes or a recipe — a flat basePrice is all they need.
  const simpleGroups: Array<[typeof SNACKS, ProductType, string]> = [
    [SNACKS, ProductType.SNACK, 'snacks'],
    [DRINKS, ProductType.DRINK, 'drinks'],
    [DESSERTS, ProductType.DESSERT, 'desserts'],
    [COMBOS, ProductType.COMBO, 'combo'],
  ];

  for (const [items, type, categorySlug] of simpleGroups) {
    for (const item of items) {
      await prisma.product.upsert({
        where: { slug: item.slug },
        update: {},
        create: {
          categoryId: catId(categorySlug),
          type,
          name: item.name,
          slug: item.slug,
          basePrice: item.price,
          isVegetarian: item.isVegetarian,
          isSpicy: item.isSpicy,
        },
      });
    }
  }

  // ── Admin user ───────────────────────────────────────────────
  const adminPasswordHash = await bcrypt.hash('Admin123!', 12);
  await prisma.user.upsert({
    where: { email: 'admin@chicago-pizza.ru' },
    update: {},
    create: {
      email: 'admin@chicago-pizza.ru',
      passwordHash: adminPasswordHash,
      firstName: 'Admin',
      role: Role.ADMIN,
      isEmailVerified: true,
      referralCode: randomUUID().slice(0, 8).toUpperCase(),
    },
  });

  // ── Sample promocode ─────────────────────────────────────────
  await prisma.promocode.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: {
      code: 'WELCOME10',
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      minOrderAmount: 50000,
      maxUses: 1000,
      isActive: true,
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

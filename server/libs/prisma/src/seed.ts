import { PrismaClient, ProductType, DiscountType, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DOUGH_TYPES = [
  { name: 'Тонкое', slug: 'thin', priceModifier: 0 },
  { name: 'Классическое', slug: 'classic', priceModifier: 5000 },
  { name: 'Сырное', slug: 'cheesy', priceModifier: 15000 },
];

/**
 * The diameters the pizzeria actually bakes, smallest first.
 *
 * It used to be 30/45/60. The real menu has no 30 — it starts at 45 and the
 * middle size is 50. Anything that mentions a diameter (the home page's size
 * comparison, the footer strapline) has to agree with this list, or the site
 * advertises a pizza the kitchen will refuse to make.
 */
const SIZES: Array<[number, string]> = [
  [45, '45 см'],
  [50, '50 см'],
  [60, '60 см'],
];

/**
 * Toppings the constructor can add to a pizza, and the vocabulary the
 * recipes below are written in.
 *
 * **The prices here are the app's own, not the pizzeria's.** The printed
 * menu quotes whole pizzas and says nothing about what an extra topping
 * costs, so every number in this list is a placeholder waiting for a real
 * one. The recipe compositions, by contrast, are transcribed from the menu
 * and are accurate.
 */
const INGREDIENTS = [
  // ── Cheese ─────────────────────────────────────────────────
  { name: 'Моцарелла', slug: 'mozzarella', price: 8000, isVegetarian: true, isSpicy: false },
  { name: 'Пармезан', slug: 'parmesan', price: 9000, isVegetarian: true, isSpicy: false },
  { name: 'Чеддер', slug: 'cheddar', price: 8000, isVegetarian: true, isSpicy: false },
  { name: 'Творожный сыр', slug: 'cream-cheese', price: 9000, isVegetarian: true, isSpicy: false },
  { name: 'Домашний сыр', slug: 'house-cheese', price: 9000, isVegetarian: true, isSpicy: false },
  { name: 'Дор блю', slug: 'dor-blue', price: 12000, isVegetarian: true, isSpicy: false },
  { name: 'Сливки', slug: 'cream', price: 4000, isVegetarian: true, isSpicy: false },

  // ── Meat ───────────────────────────────────────────────────
  { name: 'Курица', slug: 'grilled-chicken', price: 11000, isVegetarian: false, isSpicy: false },
  { name: 'Индейка', slug: 'turkey', price: 12000, isVegetarian: false, isSpicy: false },
  { name: 'Говяжий фарш', slug: 'beef', price: 13000, isVegetarian: false, isSpicy: false },
  { name: 'Колбасы', slug: 'sausage', price: 12000, isVegetarian: false, isSpicy: false },
  { name: 'Колбаски', slug: 'spicy-sausage', price: 12000, isVegetarian: false, isSpicy: false },
  { name: 'Колбаса чорризо', slug: 'chorizo', price: 14000, isVegetarian: false, isSpicy: false },
  { name: 'Пепперони', slug: 'pepperoni', price: 12000, isVegetarian: false, isSpicy: true },
  { name: 'Бекон', slug: 'bacon', price: 11000, isVegetarian: false, isSpicy: false },
  { name: 'Ветчина', slug: 'ham', price: 10000, isVegetarian: false, isSpicy: false },

  // ── Fish and seafood ───────────────────────────────────────
  { name: 'Лосось', slug: 'salmon', price: 25000, isVegetarian: false, isSpicy: false },
  { name: 'Тигровые креветки', slug: 'tiger-prawns', price: 28000, isVegetarian: false, isSpicy: false },
  { name: 'Кальмар', slug: 'squid', price: 22000, isVegetarian: false, isSpicy: false },
  { name: 'Икра', slug: 'caviar', price: 30000, isVegetarian: false, isSpicy: false },

  // ── Vegetables and the rest ────────────────────────────────
  { name: 'Шампиньоны', slug: 'mushrooms', price: 7000, isVegetarian: true, isSpicy: false },
  { name: 'Помидоры', slug: 'tomatoes', price: 6000, isVegetarian: true, isSpicy: false },
  { name: 'Солёные огурцы', slug: 'pickles', price: 6000, isVegetarian: true, isSpicy: false },
  { name: 'Лук', slug: 'red-onion', price: 5000, isVegetarian: true, isSpicy: false },
  { name: 'Болгарский перец', slug: 'bell-pepper', price: 6000, isVegetarian: true, isSpicy: false },
  { name: 'Листья салата', slug: 'lettuce', price: 4000, isVegetarian: true, isSpicy: false },
  { name: 'Оливки', slug: 'olives', price: 7000, isVegetarian: true, isSpicy: false },
  { name: 'Ананас', slug: 'pineapple', price: 7000, isVegetarian: true, isSpicy: false },
  { name: 'Орехи', slug: 'nuts', price: 7000, isVegetarian: true, isSpicy: false },
  { name: 'Лайм', slug: 'lime', price: 3000, isVegetarian: true, isSpicy: false },
  { name: 'Халапеньо', slug: 'jalapeno', price: 5000, isVegetarian: true, isSpicy: true },

  // ── Sauces ─────────────────────────────────────────────────
  { name: 'Соус BARBQ', slug: 'bbq-sauce', price: 4000, isVegetarian: true, isSpicy: false },
  { name: 'Соус цезарь', slug: 'caesar-sauce', price: 4000, isVegetarian: true, isSpicy: false },
  { name: 'Сливочный соус', slug: 'cream-sauce', price: 4000, isVegetarian: true, isSpicy: false },
  { name: 'Соус спайси', slug: 'spicy-sauce', price: 4000, isVegetarian: true, isSpicy: true },
  { name: 'Соус том-ям', slug: 'tom-yam-sauce', price: 6000, isVegetarian: true, isSpicy: true },
  { name: 'Соус унаги', slug: 'unagi-sauce', price: 5000, isVegetarian: true, isSpicy: false },
  { name: 'Острый соус', slug: 'hot-sauce', price: 4000, isVegetarian: true, isSpicy: true },
  { name: 'Майонез', slug: 'mayo', price: 3000, isVegetarian: true, isSpicy: false },
];

interface PizzaSeed {
  name: string;
  slug: string;
  description: string;
  /** Kopecks per size, in the order of `SIZES`: 45, 50, 60 cm. */
  prices: [number, number, number];
  isVegetarian: boolean;
  isSpicy: boolean;
  isNew?: boolean;
  isPopular?: boolean;
  /** Ingredient slugs making up the recipe, all shown as "В составе". */
  ingredients: string[];
}

/** Ordinary pizza, every size. The menu charges one price for all but two. */
const STANDARD: [number, number, number] = [75000, 95000, 135000];
/** The two seafood pizzas, which the menu prices above the rest. */
const SEAFOOD: [number, number, number] = [105000, 125000, 165000];

/**
 * Every pizza on the menu.
 *
 * Names, descriptions and prices are transcribed from the pizzeria's own
 * menu (`asserts/info_and_prices/pizza/`). Where a pizza already existed
 * under a different name its slug is kept, so that links and search results
 * still resolve: "Барбекю" is now "БарбQ" but stays at `/menu/bbq`, and
 * Пепперони stays at `/menu/pepperoni-pizza`.
 *
 * The photo each one uses is derived from the slug — see `imageFor` below.
 */
const PIZZAS: PizzaSeed[] = [
  {
    name: 'Домашняя',
    slug: 'home',
    description: 'Фирменный соус, сыр, фарш говяжий, помидоры, лук, болгарский перец.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    isPopular: true,
    ingredients: ['mozzarella', 'beef', 'tomatoes', 'red-onion', 'bell-pepper'],
  },
  {
    name: 'Пепперони',
    slug: 'pepperoni-pizza',
    description: 'Фирменный соус, сыр, колбасы.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    isPopular: true,
    ingredients: ['mozzarella', 'pepperoni', 'sausage'],
  },
  {
    name: 'Маргарита',
    slug: 'margarita',
    description: 'Фирменный соус, моцарелла 2 вида, пармезан.',
    prices: STANDARD,
    isVegetarian: true,
    isSpicy: false,
    ingredients: ['mozzarella', 'parmesan'],
  },
  {
    name: '5 Сыров',
    slug: '5-cheese',
    description: 'Сыр моцарелла 2 вида, сливки, сыр чеддер, домашний сыр.',
    prices: STANDARD,
    isVegetarian: true,
    isSpicy: false,
    ingredients: ['mozzarella', 'cream', 'cheddar', 'house-cheese'],
  },
  {
    name: 'Мясная',
    slug: 'meat',
    description: 'Фирменный соус, сыр, фарш говяжий, помидоры.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['mozzarella', 'beef', 'tomatoes'],
  },
  {
    name: 'Куриная',
    slug: 'chicken',
    description: 'Фирменный соус, сыр, куриное филе.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['mozzarella', 'grilled-chicken'],
  },
  {
    name: 'Сицилия',
    slug: 'sicily',
    description: 'Фирменный соус, халапеньо, острый соус, курица, помидоры, колбасы.',
    prices: STANDARD,
    isVegetarian: false,
    // Marked with a chilli on the menu itself — the pizzeria's own warning,
    // not something inferred from the ingredient list.
    isSpicy: true,
    ingredients: ['mozzarella', 'jalapeno', 'hot-sauce', 'grilled-chicken', 'tomatoes', 'sausage'],
  },
  {
    name: 'Грибная',
    slug: 'mushroom',
    description: 'Фирменный соус, сыр, грибы.',
    prices: STANDARD,
    isVegetarian: true,
    isSpicy: false,
    ingredients: ['mozzarella', 'mushrooms'],
  },
  {
    name: 'Спайси',
    slug: 'spicy',
    description: 'Сыр, соус спайси, курица, индейка, листья салата.',
    prices: STANDARD,
    isVegetarian: false,
    // The menu prints no chilli against this one, but the kitchen says it is
    // hot — and the name and the sauce agree. Owner's correction.
    isSpicy: true,
    ingredients: ['mozzarella', 'spicy-sauce', 'grilled-chicken', 'turkey', 'lettuce'],
  },
  {
    name: '4 Сыра',
    slug: '4-cheese',
    description: 'Фирменный соус, моцарелла 2 вида, творожный сыр, пармезан.',
    prices: STANDARD,
    isVegetarian: true,
    isSpicy: false,
    isPopular: true,
    ingredients: ['mozzarella', 'cream-cheese', 'parmesan'],
  },
  {
    name: 'Жульен',
    slug: 'julienne',
    description: 'Сливочный соус, сыр, грибы, курица.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['cream-sauce', 'mozzarella', 'mushrooms', 'grilled-chicken'],
  },
  {
    name: 'Цезарь',
    slug: 'caesar',
    description: 'Сыр, соус цезарь, курица, листья салата, помидоры, пармезан.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['mozzarella', 'caesar-sauce', 'grilled-chicken', 'lettuce', 'tomatoes', 'parmesan'],
  },
  {
    name: 'Охотничья',
    slug: 'hunter',
    description: 'Фирменный соус, сыр, курица, лук, соленый огурец, колбаски, халапеньо.',
    prices: STANDARD,
    isVegetarian: false,
    // Chilli on the menu.
    isSpicy: true,
    ingredients: ['mozzarella', 'grilled-chicken', 'red-onion', 'pickles', 'spicy-sausage', 'jalapeno'],
  },
  {
    name: 'Тропическая',
    slug: 'tropic',
    description: 'Майонез, сыр, курица, ананас, листья салата, орехи, грибы.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['mayo', 'mozzarella', 'grilled-chicken', 'pineapple', 'lettuce', 'nuts', 'mushrooms'],
  },
  {
    name: 'Чорризо',
    slug: 'chorizo-pizza',
    description: 'Домашний соус, сыр, фарш говяжий, колбаса чорризо, оливки.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['mozzarella', 'beef', 'chorizo', 'olives'],
  },
  {
    name: 'Ассорти',
    slug: 'assorti',
    description: 'Фирменный соус, сыр, колбасы, курица, фарш, грибы, помидоры.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['mozzarella', 'sausage', 'grilled-chicken', 'beef', 'mushrooms', 'tomatoes'],
  },
  {
    name: 'Курица с грибами',
    slug: 'chicken-mushrooms',
    description: 'Фирменный соус, сыр, курица, грибы шампиньоны.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['mozzarella', 'grilled-chicken', 'mushrooms'],
  },
  {
    name: 'БарбQ',
    slug: 'bbq',
    description: 'Фирменный соус, сыр, соус BARBQ, курица.',
    prices: STANDARD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['mozzarella', 'bbq-sauce', 'grilled-chicken'],
  },
  {
    name: 'Ойси',
    slug: 'oisi',
    description:
      'Фирменный соус, лосось, сыр, тигровые креветки, творожный сыр, икра, соус унаги, соус спайси.',
    prices: SEAFOOD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: [
      'salmon',
      'mozzarella',
      'tiger-prawns',
      'cream-cheese',
      'caviar',
      'unagi-sauce',
      'spicy-sauce',
    ],
  },
  {
    name: 'Том-ям',
    slug: 'tom-yam',
    description: 'Соус том ям, лосось, сыр, креветки тигровые, кальмар, грибы, лайм.',
    prices: SEAFOOD,
    isVegetarian: false,
    isSpicy: false,
    ingredients: ['tom-yam-sauce', 'salmon', 'mozzarella', 'tiger-prawns', 'squid', 'mushrooms', 'lime'],
  },
];

/**
 * Photo slug for a pizza, or null when there is no photograph of it.
 *
 * The files come from `scripts/prepare-menu-images.mjs`, which writes three
 * widths per pizza named after the product slug. The `-340` variant is what
 * goes in the database: it is a real, working URL on its own, and the client
 * derives the other widths from it for `srcset` (see `ProductImage`).
 */
const PHOTOGRAPHED = new Set(PIZZAS.map((p) => p.slug));
const imageFor = (slug: string) => (PHOTOGRAPHED.has(slug) ? `/menu/${slug}-340.webp` : null);

interface SimpleSeed {
  name: string;
  slug: string;
  /** Kopecks. */
  price: number;
  description?: string;
  isVegetarian: boolean;
  isSpicy: boolean;
  isNew?: boolean;
  /**
   * Flavours the customer picks between, in menu order. All at the same
   * price — the menu quotes one number for the line.
   */
  variants?: { name: string; slug: string }[];
}

/**
 * Snacks and sauces, from the menu's "СНЕКИ" page. The sauces are printed on
 * that same page rather than under a heading of their own, so they live in
 * the same category here.
 */
const SNACKS: SimpleSeed[] = [
  { name: 'Стрипсы', slug: 'strips', price: 30000, description: '150 гр', isVegetarian: false, isSpicy: false },
  { name: 'Фри', slug: 'fries', price: 20000, description: '150 гр', isVegetarian: true, isSpicy: false },
  {
    name: 'По-деревенски',
    slug: 'potato-wedges',
    price: 20000,
    description: '150 гр',
    isVegetarian: true,
    isSpicy: false,
  },
  { name: 'Кетчуп', slug: 'ketchup', price: 7000, isVegetarian: true, isSpicy: false },
  { name: 'Сырный соус', slug: 'cheese-sauce', price: 7000, isVegetarian: true, isSpicy: false },
];

/** Drinks, from the menu's "НАПИТКИ" page. */
const DRINKS: SimpleSeed[] = [
  { name: 'Вико', slug: 'viko', price: 25000, isVegetarian: true, isSpicy: false },
  { name: 'Royal', slug: 'royal', price: 11000, isVegetarian: true, isSpicy: false },
  { name: 'Кола Добрый', slug: 'cola-dobry-1l', price: 17000, description: '1 л', isVegetarian: true, isSpicy: false },
  { name: 'Кола', slug: 'cola-05', price: 13000, description: 'ж/б', isVegetarian: true, isSpicy: false },
  {
    name: 'Kinza',
    slug: 'kinza',
    price: 13000,
    // The flavours are the `variants` below; this line is what the catalogue
    // card says before anyone opens the picker.
    description: 'Шесть вкусов на выбор',
    isVegetarian: true,
    isSpicy: false,
    variants: [
      { name: 'Кола', slug: 'cola' },
      { name: 'Апельсин', slug: 'orange' },
      { name: 'Лайм-мята', slug: 'lime-mint' },
      { name: 'Черника', slug: 'blueberry' },
      { name: 'Гранат', slug: 'pomegranate' },
      { name: 'Лимон', slug: 'lemon' },
    ],
  },
  {
    name: 'Компот Курага',
    slug: 'compote-apricot',
    price: 17000,
    description: 'Домашний, 500 мл',
    isVegetarian: true,
    isSpicy: false,
    isNew: true,
  },
  {
    name: 'Морс Ягодный',
    slug: 'berry-mors',
    price: 17000,
    description: 'Натуральный, 500 мл',
    isVegetarian: true,
    isSpicy: false,
    isNew: true,
  },
];

/**
 * Demo products from before the real menu was transcribed, and the two
 * categories that are left empty once they go.
 *
 * They are named one by one rather than swept up by "anything not in this
 * file": a product an administrator adds through the API is not this seed's
 * to delete. Deleting is safe — an order line is a snapshot and holds no
 * foreign key to the product it was made from (see `OrderItem` in the
 * schema), so order history survives intact.
 */
const RETIRED_PRODUCT_SLUGS = [
  'chicken-wings-bbq',
  'cheese-sticks',
  'bruschetta',
  'cranberry-drink-05',
  'still-water-05',
  'cheesecake-ny',
  'chocolate-fondant',
  'combo-for-two',
  'combo-family',
];
const RETIRED_CATEGORY_SLUGS = ['desserts', 'combo'];

/** 11:30, as minutes from midnight — every branch opens then. */
const OPENS = 11 * 60 + 30;
/** 23:30. */
const CLOSES_LATE_EVENING = 23 * 60 + 30;
/** 06:00 the next morning — lower than `OPENS`, which is how the model spells
 *  "works past midnight". */
const CLOSES_AT_DAWN = 6 * 60;

/**
 * The chain's six kitchens, transcribed from the menu's "ВЫБЕРИТЕ РЕСТОРАН"
 * page (`asserts/addresses/`).
 *
 * Four are in Makhachkala, one in Kizilyurt and one in Khasavyurt. The one on
 * Нурадилова works until six in the morning; the rest close at 23:30.
 *
 * No coordinates: the menu prints a street and a number, not a pin, and
 * nothing on the site plots a branch today — delivery picks one by zone
 * polygon. Filling these in with guesses would put six markers on the wrong
 * buildings the moment someone adds a map.
 *
 * One phone number across the chain, because the menu gives one.
 */
const CHAIN_PHONE = '+7 8722 55-55-55';

/*
 * Coordinates are geocoded from the printed address against OpenStreetMap,
 * and only kept where the match was unambiguous and at house level. They
 * locate the *building*, not the shop's door.
 *
 * Two are deliberately null rather than guessed — see the notes on those
 * entries. Nothing plots a branch today (delivery picks one by zone polygon,
 * not by distance), so a null costs nothing now and a wrong pin would cost a
 * misplaced marker on the day someone adds a map.
 *
 * The business itself is not in OpenStreetMap, so none of this is confirmation
 * that the pizzeria is at the pin — only that the address is.
 */
const BRANCHES = [
  {
    name: 'Chicago Pizza на проспекте Петра I',
    slug: 'petra-1',
    address: 'Махачкала, проспект Петра I, 14',
    floor: 'Цокольный этаж',
    // Two different buildings on this street are both numbered 14, 1.5 km
    // apart, and nothing in the address distinguishes them. Left for someone
    // who knows which one it is.
    lat: null,
    lng: null,
    openMinute: OPENS,
    closeMinute: CLOSES_LATE_EVENING,
  },
  {
    name: 'Chicago Pizza на Нурадилова',
    slug: 'nuradilova',
    address: 'Махачкала, улица Нурадилова, 93',
    floor: 'Цокольный этаж',
    lat: 42.9737889,
    lng: 47.5103387,
    openMinute: OPENS,
    // The all-nighter.
    closeMinute: CLOSES_AT_DAWN,
  },
  {
    name: 'Chicago Pizza на Абубакарова',
    slug: 'abubakarova',
    address: 'Махачкала, улица Абубакарова, 18а',
    floor: '1 этаж',
    lat: 42.9763654,
    lng: 47.4982294,
    openMinute: OPENS,
    closeMinute: CLOSES_LATE_EVENING,
  },
  {
    name: 'Chicago Pizza на Гайдара Гаджиева',
    slug: 'gaydara-gadzhieva',
    address: 'Махачкала, улица Гайдара Гаджиева, 22Б',
    floor: '1 этаж',
    lat: 42.9849567,
    lng: 47.4761733,
    openMinute: OPENS,
    closeMinute: CLOSES_LATE_EVENING,
  },
  {
    name: 'Chicago Pizza в Кизилюрте',
    slug: 'kizilyurt',
    address: 'Кизилюрт, улица Полежаева, 16',
    floor: '1 этаж',
    // The only building OpenStreetMap has at this number is tagged as an
    // aerodrome hangar, which is not a pizzeria. Either the house numbering
    // there is wrong or the building is mis-tagged; either way it is not a
    // pin worth keeping.
    lat: null,
    lng: null,
    openMinute: OPENS,
    closeMinute: CLOSES_LATE_EVENING,
  },
  {
    name: 'Chicago Pizza в Хасавюрте',
    slug: 'khasavyurt',
    address: 'Хасавюрт, улица Щорса, 46',
    floor: '1 этаж',
    lat: 43.2364893,
    lng: 46.6009998,
    openMinute: OPENS,
    closeMinute: CLOSES_LATE_EVENING,
  },
].map((branch, index) => ({ ...branch, phone: CHAIN_PHONE, sortOrder: index }));

/**
 * The two invented branches this seed used to create.
 *
 * Deleted by slug, like the retired products: a branch an administrator added
 * through the API is not this seed's to remove. Orders that named one keep
 * working — `Order.branchId` is nullable and set null on delete.
 */
const RETIRED_BRANCH_SLUGS = ['gamzatova', 'akushinskogo'];

async function main() {
  console.log('Seeding database...');

  // ── Branches ────────────────────────────────────────────────
  // Updated, not just created: these came from the printed menu, and hours
  // that moved there have to move here. `isActive` is left alone — closing a
  // branch for the evening is the owner's call, not the seed's.
  for (const branch of BRANCHES) {
    await prisma.branch.upsert({
      where: { slug: branch.slug },
      update: branch,
      create: branch,
    });
  }
  await prisma.branch.deleteMany({ where: { slug: { in: RETIRED_BRANCH_SLUGS } } });

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
      // Updated, not left alone: several were renamed to the words the menu
      // actually uses ("Курица гриль" → "Курица", "Томаты" → "Помидоры"), and
      // a seed that only ever creates would leave the old names in place on
      // every database that had already been seeded once.
      update: { name: i.name, price: i.price, isVegetarian: i.isVegetarian, isSpicy: i.isSpicy },
      create: i,
    });
    ingredientBySlug.set(i.slug, row.id);
  }

  // ── Categories ───────────────────────────────────────────────
  const categories = await Promise.all([
    prisma.category.upsert({ where: { slug: 'pizza' }, update: {}, create: { name: 'Пиццы', slug: 'pizza', sortOrder: 1 } }),
    prisma.category.upsert({ where: { slug: 'snacks' }, update: { name: 'Снеки' }, create: { name: 'Снеки', slug: 'snacks', sortOrder: 2 } }),
    prisma.category.upsert({ where: { slug: 'drinks' }, update: {}, create: { name: 'Напитки', slug: 'drinks', sortOrder: 3 } }),
  ]);
  const catId = (slug: string) => categories.find((c) => c.slug === slug)!.id;

  // ── Pizzas ───────────────────────────────────────────────────
  for (const pizza of PIZZAS) {
    // What the seed owns is the menu: the name, the words, the price, the
    // photograph. What it must not own is availability — `isActive` and
    // `stoppedUntil` are the kitchen's, set from the stop-list screen, and a
    // re-seed that quietly put a sold-out pizza back on sale would be worse
    // than one that never updated anything.
    const fields = {
      categoryId: catId('pizza'),
      type: ProductType.PIZZA,
      name: pizza.name,
      description: pizza.description,
      imageUrl: imageFor(pizza.slug),
      isVegetarian: pizza.isVegetarian,
      isSpicy: pizza.isSpicy,
      // Stated by the owner, which is the only way this flag can honestly
      // be set: it is a claim about the supplier and the kitchen, not
      // something derivable from an ingredient list (an earlier version of
      // this seed tried to derive it, and was guessing).
      isHalal: true,
      isNew: !!pizza.isNew,
      isPopular: !!pizza.isPopular,
    };

    const product = await prisma.product.upsert({
      where: { slug: pizza.slug },
      update: fields,
      create: { ...fields, slug: pizza.slug },
    });

    for (const [index, [sizeCm, label]] of SIZES.entries()) {
      await prisma.productSize.upsert({
        where: { productId_sizeCm: { productId: product.id, sizeCm } },
        update: { price: pizza.prices[index], label },
        create: { productId: product.id, sizeCm, label, price: pizza.prices[index] },
      });
    }

    // The menu used to start at 30 cm. Upserting the three real sizes leaves
    // that row untouched and still purchasable at its old price, so it has to
    // go explicitly.
    await prisma.productSize.deleteMany({
      where: { productId: product.id, sizeCm: { notIn: SIZES.map(([cm]) => cm) } },
    });

    const recipeIds: string[] = [];
    for (const ingSlug of pizza.ingredients) {
      const ingredientId = ingredientBySlug.get(ingSlug);
      if (!ingredientId) throw new Error(`Unknown ingredient "${ingSlug}" in pizza "${pizza.slug}"`);
      recipeIds.push(ingredientId);
      await prisma.productIngredient.upsert({
        where: { productId_ingredientId: { productId: product.id, ingredientId } },
        update: { isDefault: true },
        create: { productId: product.id, ingredientId, isDefault: true },
      });
    }

    // Same reason as the sizes: a recipe that lost an ingredient would
    // otherwise keep showing it under "В составе".
    await prisma.productIngredient.deleteMany({
      where: { productId: product.id, ingredientId: { notIn: recipeIds } },
    });
  }

  // ── Snacks, sauces and drinks ────────────────────────────────
  // No sizes and no recipe — a flat basePrice is all these need.
  const simpleGroups: Array<[SimpleSeed[], ProductType, string]> = [
    [SNACKS, ProductType.SNACK, 'snacks'],
    [DRINKS, ProductType.DRINK, 'drinks'],
  ];

  for (const [items, type, categorySlug] of simpleGroups) {
    for (const item of items) {
      const fields = {
        categoryId: catId(categorySlug),
        type,
        name: item.name,
        description: item.description ?? null,
        basePrice: item.price,
        isVegetarian: item.isVegetarian,
        isSpicy: item.isSpicy,
        // Same owner statement as the pizzas above.
        isHalal: true,
        isNew: !!item.isNew,
      };

      const product = await prisma.product.upsert({
        where: { slug: item.slug },
        update: fields,
        create: { ...fields, slug: item.slug },
      });

      const variants = item.variants ?? [];
      for (const [sortOrder, variant] of variants.entries()) {
        await prisma.productVariant.upsert({
          where: { productId_slug: { productId: product.id, slug: variant.slug } },
          update: { name: variant.name, sortOrder },
          create: { productId: product.id, slug: variant.slug, name: variant.name, sortOrder },
        });
      }

      // A flavour dropped from the menu has to go, or the picker keeps
      // offering something the kitchen no longer pours.
      await prisma.productVariant.deleteMany({
        where: { productId: product.id, slug: { notIn: variants.map((v) => v.slug) } },
      });
    }
  }

  // ── Retire what the real menu does not sell ──────────────────
  await prisma.product.deleteMany({ where: { slug: { in: RETIRED_PRODUCT_SLUGS } } });
  // Only once they are empty; a category still holding products is one this
  // seed does not understand and must leave alone.
  for (const slug of RETIRED_CATEGORY_SLUGS) {
    const remaining = await prisma.product.count({ where: { category: { slug } } });
    if (remaining === 0) await prisma.category.deleteMany({ where: { slug } });
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

  // ── Demo customer ────────────────────────────────────────────
  //
  // Exists so the end-to-end checkout run has an account it can sign into.
  // Verified, because checkout refuses an unverified address and the mail
  // catcher that would carry the code is a dev-profile container the CI stack
  // does not start.
  //
  // Only ever created by this seed, which is off by default (`SEED_ON_START`)
  // and never run against a real deployment — the same footing as the admin
  // above. Nothing grants it a role.
  const customerPasswordHash = await bcrypt.hash('Customer123!', 12);
  await prisma.user.upsert({
    where: { email: 'customer@chicago-pizza.ru' },
    update: {},
    create: {
      email: 'customer@chicago-pizza.ru',
      passwordHash: customerPasswordHash,
      firstName: 'Тест',
      lastName: 'Покупатель',
      phone: '+79280000000',
      role: Role.USER,
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

  // ── Repeatable promocode for the end-to-end run ──────────────
  //
  // `WELCOME10` is a welcome offer, so `perUserLimit` defaults to 1 and it is
  // right that it does. That makes it useless to a test that has to place a
  // discounted order more than once: against a database that persists between
  // runs the second run is refused, and the failure looks like a broken
  // promocode rather than a spent one.
  //
  // Hence a code with no per-user limit, on the same footing as the demo
  // customer above — created only by this seed, which is off by default
  // (`SEED_ON_START`) and never run against a real deployment.
  await prisma.promocode.upsert({
    where: { code: 'E2EALWAYS10' },
    update: {},
    create: {
      code: 'E2EALWAYS10',
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      // Deliberately no minimum: the test should not have to know what the
      // menu costs to pick a basket that clears a threshold.
      minOrderAmount: 0,
      maxUses: null,
      perUserLimit: null,
      isActive: true,
    },
  });

  console.log(
    `Seed complete: ${PIZZAS.length} pizzas, ${SNACKS.length} snacks/sauces, ${DRINKS.length} drinks.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

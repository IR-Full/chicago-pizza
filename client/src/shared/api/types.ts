/** Mirrors the gateway's response shapes. Kept hand-written and small rather
 *  than generated, so the client only depends on the fields it actually uses. */

export type Role = 'USER' | 'ADMIN' | 'COURIER' | 'SUPPORT';
export type ProductType = 'PIZZA' | 'SNACK' | 'DRINK' | 'DESSERT' | 'COMBO';
export type OrderStatus = 'CREATED' | 'ACCEPTED' | 'PREPARING' | 'ON_DELIVERY' | 'DELIVERED' | 'CANCELLED';
export type DeliveryType = 'ASAP' | 'SCHEDULED';
export type FulfillmentType = 'DELIVERY' | 'PICKUP';
export type PaymentMethod = 'CASH_ON_DELIVERY' | 'CARD_ON_DELIVERY' | 'ONLINE';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'CANCELLED' | 'REFUNDED';
export type LoyaltyLevel = 'BRONZE' | 'SILVER' | 'GOLD';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
export type DiscountType = 'PERCENT' | 'FIXED';

export interface User {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  role: Role;
  isEmailVerified: boolean;
  isBlocked: boolean;
  loyaltyPoints: number;
  loyaltyLevel: LoyaltyLevel;
  referralCode: string;
  darkThemeEnabled: boolean;
  locale: string;
  /** True when the stored consent predates the current policy text. */
  needsPrivacyConsent: boolean;
  createdAt: string;
}

/** One live sign-in, as shown in the profile. */
export interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** The session viewing the page; the UI marks it and will not end it. */
  isCurrent: boolean;
}

/** A kitchen: where an order is made, and where it can be collected from. */
export interface Branch {
  id: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  /**
   * Minutes from midnight, in the pizzeria's timezone. `closeMinute` may be
   * lower than `openMinute`, which means the kitchen works past midnight —
   * the branch on Нурадилова runs 11:30 → 6:00. Render with
   * `formatOpeningMinute`; compare with `isWithinOpeningHours`.
   */
  openMinute: number;
  closeMinute: number;
  /** "Цокольный этаж", "1 этаж" — null when the menu says nothing. */
  floor: string | null;
  /** Null unless someone has filled in a real pin; nothing plots these yet. */
  lat: number | null;
  lng: number | null;
}

/**
 * What delivery to a point costs.
 *
 * `configured: false` means the shop never drew a zone and the flat tariff
 * applies. `configured: true` with `zone: null` means we do not deliver there
 * at all — a different answer, and the only one that is a refusal.
 */
export interface DeliveryQuote {
  configured: boolean;
  zone: {
    id: string;
    name: string;
    branchId: string;
    deliveryFee: number;
    minOrderAmount: number;
  } | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
}

export interface DoughType {
  id: string;
  name: string;
  slug: string;
  priceModifier: number;
}

export interface Ingredient {
  id: string;
  name: string;
  slug: string;
  price: number;
  isVegetarian: boolean;
  isSpicy: boolean;
  imageUrl: string | null;
}

export interface ProductSize {
  id: string;
  sizeCm: number;
  label: string;
  price: number;
}

/** One interchangeable choice of the same product — a drink's flavour. */
export interface ProductVariant {
  id: string;
  name: string;
  slug: string;
}

/**
 * A product as staff edit it.
 *
 * The public shape deliberately hides the stored values behind derived ones —
 * `isAvailable` folds `isActive` together with the stop list, `priceFrom` hides
 * `basePrice` behind the cheapest size. A form has to show what is stored, so
 * the admin payload carries both.
 */
export interface AdminProduct extends Product {
  categoryId: string;
  /** False for a delisted item, which the editor still lists so it can return. */
  isActive: boolean;
  /** Kopecks. What a product with no sizes costs. */
  basePrice: number;
}

export interface ProductIngredient {
  id: string;
  name: string;
  price: number;
  isDefault: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  type: ProductType;
  isVegetarian: boolean;
  isSpicy: boolean;
  /** Certified halal — a supplier claim, not something inferred from the recipe. */
  isHalal: boolean;
  /** False while the kitchen has run out. Still listed, just not orderable. */
  isAvailable: boolean;
  /** When it comes back, if it is currently on the stop list. */
  stoppedUntil: string | null;
  isNew: boolean;
  isPopular: boolean;
  category: Category | null;
  sizes: ProductSize[];
  /**
   * Flavours the customer picks between — Kinza comes as six, all at one
   * price. Empty for everything else, so "has a choice to make" is just
   * `variants.length > 0`.
   */
  variants: ProductVariant[];
  priceFrom: number;
  ingredients: ProductIngredient[];
}

/** A review rates a delivered order, so it names the items, not one product. */
export interface RecentReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  authorName: string;
  items: string[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** The shape sent to the API when adding a configured item to the cart. */
export interface PizzaConfig {
  productId: string;
  secondHalfProductId?: string;
  sizeCm?: number;
  doughTypeId?: string;
  /** Required when the product has variants; the server refuses without it. */
  variantId?: string;
  // No `addedIngredientIds`: the pizzeria sells no paid extras, so the
  // server's DTO does not declare one either.
  removedIngredientIds?: string[];
}

export interface PricedItem {
  /** Which request line this price belongs to; see the server's `PricedItem`. */
  index: number;
  productId: string;
  productName: string;
  sizeLabel: string | null;
  doughTypeId: string | null;
  doughTypeName: string | null;
  secondHalfProductId: string | null;
  secondHalfName: string | null;
  /** The chosen flavour, or null for a product sold only one way. */
  variantName: string | null;
  removedIngredients: { id: string; name: string }[];
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  imageUrl: string | null;
}

export interface CartLine extends PricedItem {
  lineId: string;
}

export interface Cart {
  lines: CartLine[];
  subtotal: number;
  itemCount: number;
  /** Delivery tariff comes from the server so the UI never hardcodes it. */
  deliveryFee: number;
  freeDeliveryThreshold: number;
  total: number;
  /**
   * Lines dropped because the product went off sale while the cart sat idle.
   * `productName` is null once the product has left the catalogue entirely —
   * there is nothing left to read a name off.
   */
  removed: { productId: string; productName: string | null; reason: string }[];
}

export interface Address {
  id: string;
  title: string;
  city: string;
  street: string;
  house: string;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  comment: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  sizeLabel: string | null;
  /** The flavour as sold, snapshotted at order time beside the name. */
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  config: PizzaConfig | null;
}

export interface OrderStatusHistoryEntry {
  id: string;
  status: OrderStatus;
  changedAt: string;
}

export interface Order {
  id: string;
  userId: string;
  /** Whose delivery this is. The board uses it to offer a courier only the
   *  moves the server would actually accept from them. */
  courierId?: string | null;
  branchId?: string | null;
  fulfillment: FulfillmentType;
  status: OrderStatus;
  deliveryType: DeliveryType;
  scheduledAt: string | null;
  comment: string | null;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  paymentMethod: PaymentMethod;
  loyaltyPointsEarned: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  address: Address | null;
  statusHistory?: OrderStatusHistoryEntry[];
  review?: { rating: number; comment: string | null } | null;
  promocode?: { code: string } | null;
  user?: { id: string; firstName: string; lastName: string | null; phone: string | null; email: string };
}

/** Whether this order still owes money, and where to go and pay it. */
export interface OrderPayment {
  required: boolean;
  status: PaymentStatus | null;
  confirmationUrl: string | null;
}

export interface LoyaltySummary {
  points: number;
  level: LoyaltyLevel;
  cashbackPercent: number;
  lifetimeSpend: number;
  nextLevel: { level: LoyaltyLevel; remaining: number } | null;
  transactions: { id: string; points: number; type: string; createdAt: string }[];
}

export interface ReferralInfo {
  referralCode: string;
  bonusPerReferral: number;
  invited: number;
  rewarded: number;
  referrals: { firstName: string; joinedAt: string; rewardGranted: boolean }[];
}

export interface AppliedPromocode {
  promocodeId: string;
  code: string;
  discount: number;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: Role;
  message: string;
  createdAt: string;
  sender?: { id: string; firstName: string; role: Role };
}

export interface SupportTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  channel: 'CHAT' | 'TICKET';
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
  user?: { id: string; firstName: string; lastName: string | null; email: string };
}

export interface Notification {
  id: string;
  type: 'ORDER_STATUS' | 'SUPPORT_REPLY' | 'PROMO' | 'SYSTEM';
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

/** The owner's report. Every figure counts delivered orders only. */
export interface AnalyticsSummary {
  revenue: number;
  orders: number;
  averageCheque: number;
  /** Share of finished orders that were cancelled, 0–1. */
  cancellationRate: number;
  fulfillment: { delivery: number; pickup: number };
  revenueByDay: { date: string; revenue: number; orders: number }[];
  topProducts: { productName: string; quantity: number; revenue: number }[];
  promocodes: { code: string; uses: number; discount: number }[];
}

export interface Promocode {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderAmount: number;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
}

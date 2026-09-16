/** Mirrors the gateway's response shapes. Kept hand-written and small rather
 *  than generated, so the client only depends on the fields it actually uses. */

export type Role = 'USER' | 'ADMIN' | 'COURIER' | 'SUPPORT';
export type ProductType = 'PIZZA' | 'SNACK' | 'DRINK' | 'DESSERT' | 'COMBO';
export type OrderStatus = 'CREATED' | 'ACCEPTED' | 'PREPARING' | 'ON_DELIVERY' | 'DELIVERED' | 'CANCELLED';
export type DeliveryType = 'ASAP' | 'SCHEDULED';
export type PaymentMethod = 'CASH_ON_DELIVERY' | 'CARD_ON_DELIVERY';
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
  createdAt: string;
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
  isNew: boolean;
  isPopular: boolean;
  category: Category | null;
  sizes: ProductSize[];
  priceFrom: number;
  ingredients: ProductIngredient[];
  reviews?: { rating: number; comment: string | null; createdAt: string }[];
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
  addedIngredientIds?: string[];
  removedIngredientIds?: string[];
}

export interface PricedItem {
  productId: string;
  productName: string;
  sizeLabel: string | null;
  doughTypeId: string | null;
  doughTypeName: string | null;
  secondHalfProductId: string | null;
  secondHalfName: string | null;
  addedIngredients: { id: string; name: string; price: number }[];
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

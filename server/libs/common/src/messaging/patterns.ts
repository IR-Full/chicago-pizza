/**
 * RabbitMQ message-pattern contract shared between the gateway (the only
 * public HTTP/WS entrypoint) and the internal microservices. Request/response
 * calls use `client.send(pattern, payload)`; fire-and-forget notifications
 * between services use the EVENTS below with `client.emit(event, payload)`.
 */

export const AUTH_PATTERNS = {
  REGISTER: 'auth.register',
  LOGIN: 'auth.login',
  REFRESH: 'auth.refresh',
  LOGOUT: 'auth.logout',
  VERIFY_EMAIL: 'auth.verify_email',
  RESEND_VERIFICATION: 'auth.resend_verification',
  REQUEST_PASSWORD_RESET: 'auth.request_password_reset',
  RESET_PASSWORD: 'auth.reset_password',
  GET_PROFILE: 'auth.get_profile',
  UPDATE_PROFILE: 'auth.update_profile',
  LIST_ADDRESSES: 'auth.list_addresses',
  CREATE_ADDRESS: 'auth.create_address',
  UPDATE_ADDRESS: 'auth.update_address',
  DELETE_ADDRESS: 'auth.delete_address',
  GET_USER_BY_ID: 'auth.get_user_by_id',
  LIST_SESSIONS: 'auth.list_sessions',
  REVOKE_SESSION: 'auth.revoke_session',
  EXPORT_DATA: 'auth.export_data',
  DELETE_ACCOUNT: 'auth.delete_account',
  ADMIN_LIST_USERS: 'auth.admin_list_users',
  ADMIN_SET_ROLE: 'auth.admin_set_role',
  ADMIN_SET_BLOCKED: 'auth.admin_set_blocked',
} as const;

export const PRODUCTS_PATTERNS = {
  LIST_BRANCHES: 'products.list_branches',
  GET_ORDERABLE_BRANCH: 'products.get_orderable_branch',
  DEFAULT_DELIVERY_BRANCH: 'products.default_delivery_branch',
  ADMIN_LIST_BRANCHES: 'products.admin_list_branches',
  ADMIN_CREATE_BRANCH: 'products.admin_create_branch',
  ADMIN_UPDATE_BRANCH: 'products.admin_update_branch',
  RESOLVE_DELIVERY_ZONE: 'products.resolve_delivery_zone',
  ADMIN_LIST_ZONES: 'products.admin_list_zones',
  ADMIN_CREATE_ZONE: 'products.admin_create_zone',
  ADMIN_UPDATE_ZONE: 'products.admin_update_zone',
  LIST_CATEGORIES: 'products.list_categories',
  LIST_PRODUCTS: 'products.list_products',
  GET_PRODUCT: 'products.get_product',
  LIST_INGREDIENTS: 'products.list_ingredients',
  LIST_DOUGH_TYPES: 'products.list_dough_types',
  PRICE_PIZZA: 'products.price_pizza',
  LIST_FAVORITES: 'products.list_favorites',
  ADD_FAVORITE: 'products.add_favorite',
  REMOVE_FAVORITE: 'products.remove_favorite',
  RECOMMENDATIONS: 'products.recommendations',
  ADMIN_CREATE_CATEGORY: 'products.admin_create_category',
  /**
   * The menu as the shop's own staff see it: delisted items included.
   *
   * Distinct from `LIST_PRODUCTS`, which exists to answer a customer and
   * therefore filters `isActive` and is cached for five minutes. An editor
   * needs the opposite of both — it has to show the item that was taken off
   * the menu (so it can be put back) and it has to show the edit that was
   * saved a second ago.
   */
  ADMIN_LIST_PRODUCTS: 'products.admin_list_products',
  ADMIN_CREATE_PRODUCT: 'products.admin_create_product',
  ADMIN_UPDATE_PRODUCT: 'products.admin_update_product',
  ADMIN_SET_PRODUCT_STOPPED: 'products.admin_set_stopped',
  ADMIN_LIST_STOPPED: 'products.admin_list_stopped',
  ADMIN_DELETE_PRODUCT: 'products.admin_delete_product',
  VALIDATE_ORDER_ITEMS: 'products.validate_order_items',
} as const;

export const ORDERS_PATTERNS = {
  GET_CART: 'orders.get_cart',
  ADD_CART_ITEM: 'orders.add_cart_item',
  UPDATE_CART_ITEM: 'orders.update_cart_item',
  REMOVE_CART_ITEM: 'orders.remove_cart_item',
  CLEAR_CART: 'orders.clear_cart',
  /** Prices a guest's browser cart — no account, nothing stored. */
  PREVIEW_CART: 'orders.preview_cart',
  /** Folds that browser cart into the account's one at sign-in. */
  MERGE_CART: 'orders.merge_cart',
  APPLY_PROMOCODE: 'orders.apply_promocode',
  CHECKOUT: 'orders.checkout',
  LIST_ORDERS: 'orders.list_orders',
  GET_ORDER: 'orders.get_order',
  REPEAT_ORDER: 'orders.repeat_order',
  CANCEL_ORDER: 'orders.cancel_order',
  PAYMENT_ENABLED: 'orders.payment_enabled',
  START_PAYMENT: 'orders.start_payment',
  PAYMENT_STATUS: 'orders.payment_status',
  PAYMENT_NOTIFICATION: 'orders.payment_notification',
  SUBMIT_REVIEW: 'orders.submit_review',
  LIST_RECENT_REVIEWS: 'orders.list_recent_reviews',
  GET_LOYALTY: 'orders.get_loyalty',
  EXPORT_DATA: 'orders.export_data',
  ANONYMIZE_USER: 'orders.anonymize_user',
  GET_REFERRAL_INFO: 'orders.get_referral_info',
  /** Ids of products a customer has ordered before — the catalog asks, to stop recommending them. */
  LIST_ORDERED_PRODUCT_IDS: 'orders.list_ordered_product_ids',
  ADMIN_LIST_ORDERS: 'orders.admin_list_orders',
  ADMIN_UPDATE_STATUS: 'orders.admin_update_status',
  ADMIN_CREATE_PROMOCODE: 'orders.admin_create_promocode',
  ADMIN_ANALYTICS: 'orders.admin_analytics',
  ADMIN_LIST_PROMOCODES: 'orders.admin_list_promocodes',
} as const;

export const SUPPORT_PATTERNS = {
  CREATE_TICKET: 'support.create_ticket',
  LIST_TICKETS: 'support.list_tickets',
  GET_TICKET: 'support.get_ticket',
  ADD_MESSAGE: 'support.add_message',
  CLOSE_TICKET: 'support.close_ticket',
  ADMIN_LIST_TICKETS: 'support.admin_list_tickets',
  ADMIN_ASSIGN_TICKET: 'support.admin_assign_ticket',
  EXPORT_DATA: 'support.export_data',
  ANONYMIZE_USER: 'support.anonymize_user',
} as const;

export const NOTIFICATIONS_PATTERNS = {
  LIST_NOTIFICATIONS: 'notifications.list',
  MARK_READ: 'notifications.mark_read',
  VAPID_PUBLIC_KEY: 'notifications.vapid_public_key',
  SUBSCRIBE_PUSH: 'notifications.subscribe_push',
} as const;

/** Fire-and-forget domain events, published via `client.emit(...)`. */
export const RMQ_EVENTS = {
  USER_REGISTERED: 'user.registered',
  EMAIL_VERIFICATION_REQUESTED: 'auth.email_verification_requested',
  /** Someone tried to sign up with an address that already has an account. */
  REGISTRATION_ATTEMPTED: 'auth.registration_attempted',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status.changed',
  TICKET_MESSAGE_CREATED: 'ticket.message.created',
  REFERRAL_COMPLETED: 'referral.completed',
} as const;

export const RMQ_QUEUES = {
  AUTH: 'auth_queue',
  PRODUCTS: 'products_queue',
  ORDERS: 'orders_queue',
  SUPPORT: 'support_queue',
  NOTIFICATIONS: 'notifications_queue',
  /**
   * The gateway's own event queue.
   *
   * A RabbitMQ queue delivers each message to exactly one consumer, so the
   * gateway cannot simply listen on `notifications_queue` — it would steal
   * the emails. Domain events that need both a stored notification and a live
   * push are published to both queues.
   */
  REALTIME: 'realtime_queue',
} as const;

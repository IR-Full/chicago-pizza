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
  ADMIN_CREATE_PRODUCT: 'products.admin_create_product',
  ADMIN_UPDATE_PRODUCT: 'products.admin_update_product',
  ADMIN_DELETE_PRODUCT: 'products.admin_delete_product',
  VALIDATE_ORDER_ITEMS: 'products.validate_order_items',
} as const;

export const ORDERS_PATTERNS = {
  GET_CART: 'orders.get_cart',
  ADD_CART_ITEM: 'orders.add_cart_item',
  UPDATE_CART_ITEM: 'orders.update_cart_item',
  REMOVE_CART_ITEM: 'orders.remove_cart_item',
  CLEAR_CART: 'orders.clear_cart',
  APPLY_PROMOCODE: 'orders.apply_promocode',
  CHECKOUT: 'orders.checkout',
  LIST_ORDERS: 'orders.list_orders',
  GET_ORDER: 'orders.get_order',
  REPEAT_ORDER: 'orders.repeat_order',
  SUBMIT_REVIEW: 'orders.submit_review',
  LIST_RECENT_REVIEWS: 'orders.list_recent_reviews',
  GET_LOYALTY: 'orders.get_loyalty',
  EXPORT_DATA: 'orders.export_data',
  ANONYMIZE_USER: 'orders.anonymize_user',
  GET_REFERRAL_INFO: 'orders.get_referral_info',
  ADMIN_LIST_ORDERS: 'orders.admin_list_orders',
  ADMIN_UPDATE_STATUS: 'orders.admin_update_status',
  ADMIN_CREATE_PROMOCODE: 'orders.admin_create_promocode',
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
} as const;

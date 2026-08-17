import { OrderStatus } from '@prisma/client';

/**
 * The shipping-relevant subset of OrderStatus, in the order the admin
 * stepper displays them. PLACED/ACCEPTED/PAYMENT_RECEIVED/READY_TO_SHIP
 * happen before or outside Shiprocket's visibility and are intentionally
 * excluded — this project's poller never sources those from Shiprocket.
 */
const FORWARD_SEQUENCE: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PAYMENT_RECEIVED,
  OrderStatus.READY_TO_SHIP,
  OrderStatus.DISPATCHED_FROM_SELLER,
  OrderStatus.RECEIVED_AT_WAREHOUSE,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

const SHIPROCKET_STATUS_MAP: Record<string, OrderStatus> = {
  'PICKUP GENERATED': OrderStatus.DISPATCHED_FROM_SELLER,
  'PICKUP SCHEDULED': OrderStatus.DISPATCHED_FROM_SELLER,
  'PICKED UP': OrderStatus.DISPATCHED_FROM_SELLER,
  'IN TRANSIT': OrderStatus.DISPATCHED_FROM_SELLER,
  SHIPPED: OrderStatus.SHIPPED,
  'OUT FOR DELIVERY': OrderStatus.OUT_FOR_DELIVERY,
  DELIVERED: OrderStatus.DELIVERED,
  'RTO INITIATED': OrderStatus.RETURNED,
  'RTO DELIVERED': OrderStatus.RETURNED,
  LOST: OrderStatus.RETURNED,
  DAMAGED: OrderStatus.RETURNED,
  CANCELLED: OrderStatus.CANCELLED,
};

/**
 * Maps a raw Shiprocket `current_status` string to our OrderStatus enum.
 * Returns null for anything not in the table above rather than guessing —
 * the caller is expected to log unrecognized statuses instead of applying
 * them, since the live Shiprocket status vocabulary hasn't been exhaustively
 * verified against this table.
 */
export function mapShiprocketStatus(
  raw: string | null | undefined,
): OrderStatus | null {
  if (!raw) return null;
  return SHIPROCKET_STATUS_MAP[raw.trim().toUpperCase()] ?? null;
}

/**
 * True if moving an order from `current` to `next` is a forward (allowed)
 * move. RETURNED/CANCELLED are terminal overrides and are always allowed —
 * they aren't part of the shipping sequence, so there's no "later stage" to
 * compare against.
 */
export function isForwardStatusMove(
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  if (next === OrderStatus.RETURNED || next === OrderStatus.CANCELLED) {
    return true;
  }

  const currentIndex = FORWARD_SEQUENCE.indexOf(current);
  const nextIndex = FORWARD_SEQUENCE.indexOf(next);

  if (currentIndex === -1 || nextIndex === -1) {
    return false;
  }

  return nextIndex > currentIndex;
}

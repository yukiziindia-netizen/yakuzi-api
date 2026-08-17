import { OrderStatus } from '@prisma/client';
import { mapShiprocketStatus, isForwardStatusMove } from './shiprocket-status-map';

describe('mapShiprocketStatus', () => {
  it('maps in-transit variants to DISPATCHED_FROM_SELLER', () => {
    expect(mapShiprocketStatus('Pickup Generated')).toBe(OrderStatus.DISPATCHED_FROM_SELLER);
    expect(mapShiprocketStatus('Pickup Scheduled')).toBe(OrderStatus.DISPATCHED_FROM_SELLER);
    expect(mapShiprocketStatus('Picked Up')).toBe(OrderStatus.DISPATCHED_FROM_SELLER);
    expect(mapShiprocketStatus('In Transit')).toBe(OrderStatus.DISPATCHED_FROM_SELLER);
  });

  it('maps Shipped to SHIPPED', () => {
    expect(mapShiprocketStatus('Shipped')).toBe(OrderStatus.SHIPPED);
  });

  it('maps Out For Delivery to OUT_FOR_DELIVERY', () => {
    expect(mapShiprocketStatus('Out For Delivery')).toBe(OrderStatus.OUT_FOR_DELIVERY);
  });

  it('maps Delivered to DELIVERED', () => {
    expect(mapShiprocketStatus('Delivered')).toBe(OrderStatus.DELIVERED);
  });

  it('maps RTO and loss/damage variants to RETURNED', () => {
    expect(mapShiprocketStatus('RTO Initiated')).toBe(OrderStatus.RETURNED);
    expect(mapShiprocketStatus('RTO Delivered')).toBe(OrderStatus.RETURNED);
    expect(mapShiprocketStatus('Lost')).toBe(OrderStatus.RETURNED);
    expect(mapShiprocketStatus('Damaged')).toBe(OrderStatus.RETURNED);
  });

  it('maps Cancelled to CANCELLED', () => {
    expect(mapShiprocketStatus('Cancelled')).toBe(OrderStatus.CANCELLED);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(mapShiprocketStatus('  shipped  ')).toBe(OrderStatus.SHIPPED);
    expect(mapShiprocketStatus('OUT for DELIVERY')).toBe(OrderStatus.OUT_FOR_DELIVERY);
  });

  it('returns null for an unrecognized status', () => {
    expect(mapShiprocketStatus('Some New Courier Status')).toBeNull();
  });

  it('returns null for empty or missing input', () => {
    expect(mapShiprocketStatus(null)).toBeNull();
    expect(mapShiprocketStatus(undefined)).toBeNull();
    expect(mapShiprocketStatus('')).toBeNull();
  });
});

describe('isForwardStatusMove', () => {
  it('allows a move to a later stage in the sequence', () => {
    expect(isForwardStatusMove(OrderStatus.READY_TO_SHIP, OrderStatus.SHIPPED)).toBe(true);
    expect(isForwardStatusMove(OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY)).toBe(true);
  });

  it('rejects a move to an earlier stage in the sequence', () => {
    expect(isForwardStatusMove(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.SHIPPED)).toBe(false);
  });

  it('rejects a move to the same stage', () => {
    expect(isForwardStatusMove(OrderStatus.SHIPPED, OrderStatus.SHIPPED)).toBe(false);
  });

  it('always allows a move to RETURNED regardless of the current stage', () => {
    expect(isForwardStatusMove(OrderStatus.DISPATCHED_FROM_SELLER, OrderStatus.RETURNED)).toBe(true);
    expect(isForwardStatusMove(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RETURNED)).toBe(true);
  });

  it('always allows a move to CANCELLED regardless of the current stage', () => {
    expect(isForwardStatusMove(OrderStatus.SHIPPED, OrderStatus.CANCELLED)).toBe(true);
  });
});

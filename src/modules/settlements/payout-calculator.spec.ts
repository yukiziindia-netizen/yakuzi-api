import { calculateSellerPayout, PayoutInput } from './payout-calculator';

function input(overrides: Partial<PayoutInput> = {}): PayoutInput {
  return {
    baseSellingPrice: 500,
    quantity: 1,
    finalShippingPrice: 50,
    commissionPercent: 10,
    commissionGstPercent: 18,
    ...overrides,
  };
}

describe('calculateSellerPayout', () => {
  // Test 1: Standard Calculation
  it('should correctly calculate payout for a standard order', () => {
    // Gross = (500 × 1) + 50 = 550
    // Commission = 550 × 10% = 55
    // CommissionGST = 55 × 18% = 9.90
    // Total Deductions = 55 + 9.90 + 50 = 114.90
    // Net Payout = 550 - 114.90 = 435.10

    const result = calculateSellerPayout(input());

    expect(result.grossAmount.toFixed(2)).toBe('550.00');
    expect(result.commission.toFixed(2)).toBe('55.00');
    expect(result.commissionGst.toFixed(2)).toBe('9.90');
    expect(result.finalShippingPrice.toFixed(2)).toBe('50.00');
    expect(result.netPayout.toFixed(2)).toBe('435.10');
    expect(result.status).toBe('PENDING');
  });

  // Test 2: Multi-Quantity Order
  it('should scale gross correctly for multi-quantity orders', () => {
    // Gross = (200 × 3) + 30 = 630
    // Commission = 630 × 5% = 31.50
    // CommissionGST = 31.50 × 18% = 5.67
    // Total Deductions = 31.50 + 5.67 + 30 = 67.17
    // Net Payout = 630 - 67.17 = 562.83

    const result = calculateSellerPayout(
      input({
        baseSellingPrice: 200,
        quantity: 3,
        finalShippingPrice: 30,
        commissionPercent: 5,
      }),
    );

    expect(result.grossAmount.toFixed(2)).toBe('630.00');
    expect(result.commission.toFixed(2)).toBe('31.50');
    expect(result.netPayout.toFixed(2)).toBe('562.83');
    expect(result.status).toBe('PENDING');
  });

  // Test 3: Deficit / Zero-Payout Safety
  it('should set status to DEFICIT_ESCALATED and clamp payout to 0 when fees exceed gross', () => {
    // Very low price, high commission, high shipping => deficit
    // Gross = (10 × 1) + 50 = 60
    // Commission = 60 × 95% = 57
    // CommissionGST = 57 × 18% = 10.26
    // Total Deductions = 57 + 10.26 + 50 = 117.26
    // Net Payout (raw) = 60 - 117.26 = -57.26 → clamped to 0

    const result = calculateSellerPayout(
      input({
        baseSellingPrice: 10,
        quantity: 1,
        finalShippingPrice: 50,
        commissionPercent: 95,
      }),
    );

    expect(result.netPayout.toFixed(2)).toBe('0.00');
    expect(result.status).toBe('DEFICIT_ESCALATED');
  });

  // Test 4: Rounding Edge-Case
  it('should correctly round fractional Decimal results to 2 decimal places', () => {
    // Gross = (333.33 × 1) + 0 = 333.33
    // Commission = 333.33 × 7% = 23.3331 → rounds to 23.33
    // CommissionGST = 23.33 × 18% = 4.1994 → rounds to 4.20
    // Total Deductions = 23.33 + 4.20 + 0 = 27.53
    // Net = 333.33 - 27.53 = 305.80

    const result = calculateSellerPayout(
      input({
        baseSellingPrice: 333.33,
        quantity: 1,
        finalShippingPrice: 0,
        commissionPercent: 7,
      }),
    );

    expect(result.commission.toFixed(2)).toBe('23.33');
    expect(result.commissionGst.toFixed(2)).toBe('4.20');
    expect(result.netPayout.toFixed(2)).toBe('305.80');
    expect(result.status).toBe('PENDING');
  });

  // Test 5: Zero-rate Catalog Product
  it('should work correctly when all catalog rates are zero', () => {
    // Gross = (1000 × 1) + 100 = 1100
    // Commission = 0, GST = 0
    // Net Payout = 1100 - (0 + 0 + 100) = 1000

    const result = calculateSellerPayout(
      input({
        baseSellingPrice: 1000,
        finalShippingPrice: 100,
        commissionPercent: 0,
        commissionGstPercent: 0,
      }),
    );

    expect(result.grossAmount.toFixed(2)).toBe('1100.00');
    expect(result.commission.toFixed(2)).toBe('0.00');
    expect(result.netPayout.toFixed(2)).toBe('1000.00');
    expect(result.status).toBe('PENDING');
  });
});

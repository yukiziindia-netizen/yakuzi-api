import Decimal from 'decimal.js';

/**
 * All monetary inputs and outputs use Decimal for precision.
 * Rates are in percentage form (e.g., 10 = 10%).
 */
export interface PayoutInput {
  /** From SellerOffer.mrp minus discounts, already calculated */
  baseSellingPrice: number;
  /** From OrderItem.quantity */
  quantity: number;
  /** From SellerOffer.finalShippingPrice ?? SellerOffer.shippingCharges */
  finalShippingPrice: number;
  /** From CatalogProduct.commissionPercent ?? 0 */
  commissionPercent: number;
  /** From CatalogProduct.commissionGstPercent ?? 18 */
  commissionGstPercent: number;
}

export interface PayoutBreakdown {
  grossAmount: Decimal;
  commission: Decimal;
  commissionGst: Decimal;
  finalShippingPrice: Decimal;
  totalDeductions: Decimal;
  netPayout: Decimal;
  /** PENDING | DEFICIT_ESCALATED */
  status: string;
}

/**
 * Core payout calculation engine.
 *
 * Mathematical flow:
 *  1. Gross Order Amount = (Base Selling Price × Qty) + finalShippingPrice
 *  2. Platform Commission = Gross × commissionPercent
 *  3. GST on Commission   = Commission × commissionGstPercent
 *  4. Net Seller Payout   = Gross - (Commission + CommGST + finalShippingPrice)
 */
export function calculateSellerPayout(input: PayoutInput): PayoutBreakdown {
  Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

  const qty = new Decimal(input.quantity);
  const basePrice = new Decimal(input.baseSellingPrice);
  const shipping = new Decimal(input.finalShippingPrice ?? 0);

  // Step 1: Gross Order Amount = Base Item Price + Final Shipping Price
  const grossAmount = basePrice.times(qty).plus(shipping).toDecimalPlaces(2);

  // Step 2: Platform Commission = Gross * Commission Rate
  const commissionRate = new Decimal(input.commissionPercent ?? 0).dividedBy(100);
  const commission = grossAmount.times(commissionRate).toDecimalPlaces(2);

  // Step 3: GST on Commission = Commission * Commission GST Rate
  const commissionGstRate = new Decimal(input.commissionGstPercent ?? 18).dividedBy(100);
  const commissionGst = commission.times(commissionGstRate).toDecimalPlaces(2);

  // Step 4: Net Seller Payout = Gross - (Commission + GST on Commission + final shipping)
  const totalDeductions = commission
    .plus(commissionGst)
    .plus(shipping);

  const rawNetPayout = grossAmount.minus(totalDeductions);

  const isDeficit = rawNetPayout.lessThan(0);
  const netPayout = isDeficit ? new Decimal(0) : rawNetPayout.toDecimalPlaces(2);

  return {
    grossAmount,
    commission,
    commissionGst,
    finalShippingPrice: shipping,
    totalDeductions: totalDeductions.toDecimalPlaces(2),
    netPayout,
    status: isDeficit ? 'DEFICIT_ESCALATED' : 'PENDING',
  };
}


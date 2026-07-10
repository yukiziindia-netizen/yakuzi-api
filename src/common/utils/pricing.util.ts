// ─── Yukizi Centralized Pricing Engine ──────────────
// All pricing calculations are done here. NO pricing logic in frontend components.
// Updated to Marketplace Pricing Engine

export const VALID_GST_PERCENTAGES = [0, 5, 12, 18] as const;
export type ValidGST = (typeof VALID_GST_PERCENTAGES)[number];

/** Round to 2 decimal places */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Discount Types (Legacy Compat) ─────────────────────────────────
export type PricingDiscountType =
  | 'none'
  | 'ptr_discount'
  | 'same_product_bonus'
  | 'ptr_discount_and_same_product_bonus'
  | 'different_product_bonus'
  | 'ptr_discount_and_different_product_bonus'
  | 'special_price';

export interface DiscountFormInput {
  type: PricingDiscountType;
  discountPercent?: number;
  buy?: number;
  get?: number;
  bonusProductName?: string;
  specialPrice?: number;
  shippingCharges?: number;
  shippingGstPercent?: number;
  isTaxIncluded?: boolean;
}

export interface CategoryPlatformFees {
  commissionPercent?: number;
  fixedFee?: number;
  commissionGstPercent?: number;
  fixedFeeGstPercent?: number;
  shippingGstPercent?: number;
}

export interface PricingOutput {
  // --- New Marketplace Fields ---
  basePrice: number; // P (formerly MRP)
  discountPercent: number; // D%
  discountAmount: number; // P * D%
  discountedPrice: number; // P - Discount
  
  productGstPercent: number; // G%
  productGstAmount: number; // Discounted Price * G%
  
  shippingCharge: number; // S
  shippingGstPercent: number; // Gs%
  shippingGstAmount: number; // S * Gs%
  shippingTotal: number; // S + S * Gs%

  grossTotal: number; // Base Price + Shipping Total

  commissionPercent: number; // C%
  commissionAmount: number; // Discounted Price * C%
  commissionGstPercent: number; // Gc%
  commissionGstAmount: number; // Commission * Gc%
  
  fixedFee: number; // F
  fixedFeeGstAmount: number; // F * Gc%

  totalPlatformFees: number; // Commission + CommGST + FixedFee + FixedGST

  finalCustomerPayable: number; // Discounted Price + Product GST + Shipping Total
  sellerPayout: number; // Discounted Price - TotalPlatformFees
  
  // --- Legacy Aliases for minimal breakage in UI/Cart ---
  mrp: number; // alias for basePrice
  gstPercent: number; // alias for productGstPercent
  retailMarginPercent: number; // hardcoded 0
  ptr: number; // alias for basePrice
  finalPtr: number; // alias for discountedPrice
  discountValue: number; // alias for discountAmount
  gstValue: number; // alias for productGstAmount
  shippingCharges: number; // alias for shippingCharge
  perPtrWithGst: number; // alias for finalCustomerPayable
  itemsToPayFor: number;
  totalUnits: number;
  finalUserBuy: number; // alias for finalCustomerPayable * buy
  finalOrderValue: number; // alias for finalCustomerPayable * buy
  buy: number;
  get: number;
  bonusProductName: string;
  discountType: PricingDiscountType;
}

/**
 * Main pricing calculation function.
 * Calculates exactly according to the marketplace cost breakdown.
 */
export function calculatePricing(
  mrp: number,
  gstPercent: number,
  discountInput: DiscountFormInput,
  platformFees?: CategoryPlatformFees
): PricingOutput {
  const basePrice = mrp;
  let discountPercent = 0;
  let buy = discountInput.buy ?? 1;
  let get = discountInput.get ?? 0;
  const type = String(discountInput.type || 'none').toLowerCase() as PricingDiscountType;
  let bonusProductName = discountInput.bonusProductName ?? '';

  const isTaxIncluded = discountInput.isTaxIncluded ?? false;

  // 1. Calculate Shipping
  const shippingCharge = discountInput.shippingCharges ?? 0;
  const shippingGstPercent = discountInput.shippingGstPercent ?? platformFees?.shippingGstPercent ?? 18;
  let shippingTotal = shippingCharge;
  let shippingGstAmount = 0;
  
  if (isTaxIncluded) {
     shippingGstAmount = round2(shippingCharge - (shippingCharge / (1 + shippingGstPercent / 100)));
     shippingTotal = shippingCharge;
  } else {
     shippingGstAmount = round2(shippingCharge * (shippingGstPercent / 100));
     shippingTotal = round2(shippingCharge + shippingGstAmount);
  }

  // 2. Gross Product (Base + GST)
  const grossProduct = isTaxIncluded ? basePrice : round2(basePrice + (basePrice * gstPercent / 100));
  const grossTotal = round2(grossProduct + shippingTotal);

  // 3. Discount Amount on Gross Total
  let discountAmount = 0;
  const normalizedType = type ? type.toLowerCase() : 'none';
  switch (normalizedType) {
    case 'ptr_discount':
    case 'ptr_discount_and_same_product_bonus':
    case 'ptr_discount_and_different_product_bonus':
      discountPercent = discountInput.discountPercent ?? 0;
      discountAmount = round2(grossTotal * (discountPercent / 100));
      break;
    default:
      discountPercent = 0;
      discountAmount = 0;
      break;
  }

  // 4. Discounted Gross Product & Shipping
  const discountedGrossProduct = round2(grossProduct - (grossProduct * (discountPercent / 100)));
  const discountedShipping = round2(shippingTotal - (shippingTotal * (discountPercent / 100)));

  // 5. Product GST Amount based on discounted gross
  const productGstAmount = round2(discountedGrossProduct - (discountedGrossProduct / (1 + gstPercent / 100)));

  // 6. Discounted Base Price (excluding GST)
  const discountedPrice = round2(discountedGrossProduct - productGstAmount);

  // 7. Final Customer Payable
  const finalCustomerPayable = round2(discountedGrossProduct + discountedShipping);

  // 8. Platform Fees (on discounted base price)
  const commissionPercent = platformFees?.commissionPercent ?? 0;
  const commissionAmount = round2(discountedPrice * (commissionPercent / 100));
  const commissionGstPercent = platformFees?.commissionGstPercent ?? 18;
  const commissionGstAmount = round2(commissionAmount * (commissionGstPercent / 100));

  const fixedFee = platformFees?.fixedFee ?? 0;
  const fixedFeeGstPercent = platformFees?.fixedFeeGstPercent ?? 18;
  const fixedFeeGstAmount = round2(fixedFee * (fixedFeeGstPercent / 100));

  const totalPlatformFees = round2(commissionAmount + commissionGstAmount + fixedFee + fixedFeeGstAmount);

  // 9. Seller Payout
  // Seller receives Final Customer Payable minus Shipping (deduction), Product GST (to remit), and Platform Fees.
  const sellerPayout = round2(finalCustomerPayable - shippingTotal - productGstAmount - totalPlatformFees);

  const itemsToPayFor = buy;
  const finalUserBuy = round2(finalCustomerPayable * itemsToPayFor);

  const totalUnits = (normalizedType === 'same_product_bonus' || normalizedType === 'ptr_discount_and_same_product_bonus') ? (buy + get) : buy;

  return {
    basePrice,
    discountPercent,
    discountAmount,
    discountedPrice,
    productGstPercent: gstPercent,
    productGstAmount,
    shippingCharge,
    shippingGstPercent,
    shippingGstAmount,
    shippingTotal,
    commissionPercent,
    commissionAmount,
    commissionGstPercent,
    commissionGstAmount,
    fixedFee,
    fixedFeeGstAmount,
    totalPlatformFees,
    finalCustomerPayable,
    grossTotal,
    sellerPayout,

    mrp: basePrice,
    gstPercent,
    retailMarginPercent: 0,
    ptr: basePrice,
    finalPtr: discountedPrice,
    discountValue: discountAmount,
    gstValue: productGstAmount,
    shippingCharges: shippingCharge,
    perPtrWithGst: finalCustomerPayable,
    itemsToPayFor,
    totalUnits,
    finalUserBuy,
    finalOrderValue: finalUserBuy,
    buy,
    get,
    bonusProductName,
    discountType: type,
  };
}

// ─── Helpers ────────────────────────────────────────

/** Format a pricing output into a human-readable summary for display */
export function formatPricingSummary(p: PricingOutput): string {
  const lines = [
    `Base Price: ₹${p.basePrice}`,
  ];

  if (p.discountPercent > 0) {
    lines.push(`Discount: ${p.discountPercent}% (₹${p.discountAmount})`);
  }

  lines.push(`Discounted Price: ₹${p.discountedPrice}`);
  lines.push(`Product GST: ₹${p.productGstAmount} (${p.productGstPercent}%)`);
  
  if (p.shippingCharge > 0) {
    lines.push(`Shipping: ₹${p.shippingCharge} + ₹${p.shippingGstAmount} GST = ₹${p.shippingTotal}`);
  }

  lines.push(`Customer Payable (per unit): ₹${p.finalCustomerPayable}`);
  lines.push(`Platform Fees: ₹${p.totalPlatformFees}`);
  lines.push(`Estimated Seller Payout (per unit): ₹${p.sellerPayout}`);

  if (p.get > 0) {
    lines.push(`Bonus: Buy ${p.buy} Get ${p.get} (${p.bonusProductName || 'same product'})`);
  }

  lines.push(`Items to Pay For: ${p.itemsToPayFor}`);
  lines.push(`Final Order Value: ₹${p.finalOrderValue}`);

  return lines.join('\n');
}

export function requiresDiscountPercent(type: PricingDiscountType): boolean {
  return type === 'ptr_discount'
    || type === 'ptr_discount_and_same_product_bonus'
    || type === 'ptr_discount_and_different_product_bonus';
}

export function requiresBuyGet(type: PricingDiscountType): boolean {
  return type === 'same_product_bonus'
    || type === 'ptr_discount_and_same_product_bonus'
    || type === 'different_product_bonus'
    || type === 'ptr_discount_and_different_product_bonus';
}

export function requiresBonusProductName(type: PricingDiscountType): boolean {
  return type === 'different_product_bonus'
    || type === 'ptr_discount_and_different_product_bonus';
}

export function isSpecialPriceType(type: PricingDiscountType): boolean {
  return type === 'special_price';
}

/** Get effective selling price for buyer display (final payable per unit) */
export function getSellingPrice(p: PricingOutput): number {
  return p.finalCustomerPayable;
}

export function getEffectiveDiscountPercent(mrp: number, sellingPrice: number): number {
  if (mrp <= 0 || sellingPrice <= 0 || sellingPrice >= mrp) return 0;
  const pct = round2(((mrp - sellingPrice) / mrp) * 100);
  return pct > 0 && pct < 100 ? pct : 0;
}



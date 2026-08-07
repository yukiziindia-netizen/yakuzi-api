import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';

const order = {
  id: '00323711-1111-2222-3333-444444444444',
  buyerId: 'buyer-1',
  createdAt: new Date('2026-08-06T10:00:00.000Z'),
  address: {
    name: 'Arko',
    phone: '9008336683',
    address: 'sss',
    city: 'ss',
    state: 'West Bengal',
    pincode: '711303',
  },
  buyer: {
    id: 'buyer-1',
    email: 'buyer@example.com',
    phone: '9008336683',
    buyerProfile: { gstNumber: null },
  },
  items: [
    {
      sellerId: 'seller-1',
      quantity: 1,
      totalPrice: 185.58,
      seller: {
        companyName: 'Galazy Enterprises',
        gstNumber: null,
        address: '7th floor',
        city: 'Kolkata',
        state: 'West Bengal',
        pincode: '700048',
        email: null,
      },
      sellerOffer: { name: 'Testing', gstPercent: 10, isTaxIncluded: true },
    },
  ],
};

const prismaWith = (found: unknown) =>
  ({ order: { findUnique: jest.fn().mockResolvedValue(found) } }) as never;

describe('InvoiceService', () => {
  describe('getInvoicesForOrder (guarded)', () => {
    it('refuses an order belonging to another account', async () => {
      const service = new InvoiceService(prismaWith(order));
      await expect(
        service.getInvoicesForOrder('someone-else', order.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws when the order does not exist', async () => {
      const service = new InvoiceService(prismaWith(null));
      await expect(
        service.getInvoicesForOrder('buyer-1', order.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns invoices to the owner', async () => {
      const service = new InvoiceService(prismaWith(order));
      const invoices = await service.getInvoicesForOrder('buyer-1', order.id);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].totalAmount).toBe(185.58);
      // Pinned against the real order this was verified on: 185.58 = 168.71 +
      // 8.44 + 8.43. totalAmount alone does not exercise round() — it is
      // algebraically taxableValue + (stored - taxableValue), which cancels
      // back to `stored` regardless of rounding. These do.
      expect(invoices[0].subtotal).toBe(168.71);
      expect(invoices[0].cgst).toBe(8.44);
      expect(invoices[0].sgst).toBe(8.43);
    });
  });

  describe('buildInvoicesForOrder (system path)', () => {
    it('builds without any ownership check', async () => {
      const service = new InvoiceService(prismaWith(order));
      const invoices = await service.buildInvoicesForOrder(order.id);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].seller.name).toBe('Galazy Enterprises');
    });

    it('returns an empty list for a missing order instead of throwing', async () => {
      const service = new InvoiceService(prismaWith(null));
      await expect(service.buildInvoicesForOrder(order.id)).resolves.toEqual(
        [],
      );
    });
  });
});

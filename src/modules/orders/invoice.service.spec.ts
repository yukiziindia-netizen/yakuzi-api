import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
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

const prismaWith = (found: unknown, user: unknown = null) =>
  ({
    order: { findUnique: jest.fn().mockResolvedValue(found) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
  }) as never;

describe('InvoiceService', () => {
  describe('getInvoicesForOrder (guarded)', () => {
    it('refuses an order belonging to another account with no matching role', async () => {
      const service = new InvoiceService(prismaWith(order, null));
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

    it('returns invoices to the owning buyer', async () => {
      const service = new InvoiceService(prismaWith(order));
      const invoices = await service.getInvoicesForOrder('buyer-1', order.id);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].totalAmount).toBe(185.58);
      expect(invoices[0].subtotal).toBe(168.71);
      expect(invoices[0].cgst).toBe(8.44);
      expect(invoices[0].sgst).toBe(8.43);
    });

    it('returns the invoice to the seller who supplied the items on this order', async () => {
      const service = new InvoiceService(
        prismaWith(order, {
          role: Role.SELLER,
          sellerProfile: { id: 'seller-1' },
        }),
      );
      const invoices = await service.getInvoicesForOrder(
        'seller-user-1',
        order.id,
      );
      expect(invoices).toHaveLength(1);
      expect(invoices[0].seller.name).toBe('Galazy Enterprises');
    });

    it('refuses a seller who has no items on this order', async () => {
      const service = new InvoiceService(
        prismaWith(order, {
          role: Role.SELLER,
          sellerProfile: { id: 'some-other-seller' },
        }),
      );
      await expect(
        service.getInvoicesForOrder('seller-user-2', order.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns the invoice to an admin', async () => {
      const service = new InvoiceService(
        prismaWith(order, { role: Role.ADMIN, sellerProfile: null }),
      );
      const invoices = await service.getInvoicesForOrder('admin-1', order.id);
      expect(invoices).toHaveLength(1);
    });

    it('returns every invoice on a multi-seller order to an admin, unfiltered', async () => {
      const multiSellerOrder = {
        ...order,
        items: [
          ...order.items,
          {
            sellerId: 'seller-2',
            quantity: 1,
            totalPrice: 50,
            seller: {
              companyName: 'Other Seller',
              gstNumber: null,
              address: 'X',
              city: 'Kolkata',
              state: 'West Bengal',
              pincode: '700001',
              email: null,
            },
            sellerOffer: {
              name: 'Other Item',
              gstPercent: 10,
              isTaxIncluded: true,
            },
          },
        ],
      };
      const service = new InvoiceService(
        prismaWith(multiSellerOrder, { role: Role.ADMIN, sellerProfile: null }),
      );
      const invoices = await service.getInvoicesForOrder(
        'admin-1',
        multiSellerOrder.id,
      );
      expect(invoices).toHaveLength(2);
    });

    it('only shows a seller their own items on a multi-seller order', async () => {
      const multiSellerOrder = {
        ...order,
        items: [
          ...order.items,
          {
            sellerId: 'seller-2',
            quantity: 1,
            totalPrice: 50,
            seller: {
              companyName: 'Other Seller',
              gstNumber: null,
              address: 'X',
              city: 'Kolkata',
              state: 'West Bengal',
              pincode: '700001',
              email: null,
            },
            sellerOffer: {
              name: 'Other Item',
              gstPercent: 10,
              isTaxIncluded: true,
            },
          },
        ],
      };
      const service = new InvoiceService(
        prismaWith(multiSellerOrder, {
          role: Role.SELLER,
          sellerProfile: { id: 'seller-1' },
        }),
      );
      const invoices = await service.getInvoicesForOrder(
        'seller-user-1',
        multiSellerOrder.id,
      );
      expect(invoices).toHaveLength(1);
      expect(invoices[0].seller.name).toBe('Galazy Enterprises');
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

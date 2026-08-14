import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Real seller cities for the buyer Filters panel's Location section — only
  // sellers with at least one active listing, so no option filters to zero
  // results.
  async getCities() {
    const rows = await this.prisma.sellerProfile.findMany({
      where: { sellerOffers: { some: { isActive: true, deletedAt: null } } },
      select: { city: true },
      distinct: ['city'],
      orderBy: { city: 'asc' },
    });
    return rows.map((r) => r.city).filter(Boolean);
  }
}

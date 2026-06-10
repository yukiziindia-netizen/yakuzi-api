import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export class CreateBrandDto {
  name: string;
  imageUrl: string;
  order?: number;
}

export class UpdateBrandDto {
  name?: string;
  imageUrl?: string;
  isActive?: boolean;
  order?: number;
}

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBrandDto) {
    return this.prisma.brand.create({
      data: {
        name: dto.name,
        imageUrl: dto.imageUrl,
        order: dto.order || 0,
      },
    });
  }

  async findAll(admin = false) {
    return this.prisma.brand.findMany({
      where: admin ? undefined : { isActive: true },
      orderBy: { order: 'asc' },
    });
  }

  async update(id: string, dto: UpdateBrandDto) {
    const existing = await this.prisma.brand.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Brand not found');

    return this.prisma.brand.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.brand.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Brand not found');

    return this.prisma.brand.delete({ where: { id } });
  }
}

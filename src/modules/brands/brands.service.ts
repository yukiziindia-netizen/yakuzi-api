import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IsString, IsOptional, IsBoolean, IsInt } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  name: string;

  @IsString()
  imageUrl: string;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
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
    try {
      if ((this.prisma as any).brand) {
        const brands = await (this.prisma as any).brand.findMany({
          where: admin ? undefined : { isActive: true },
          orderBy: { order: 'asc' },
        });
        return brands || [];
      }
    } catch (error) {
      // Return empty array on database error
    }
    return [];
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

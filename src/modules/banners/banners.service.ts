import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IsString, IsOptional, IsBoolean, IsInt } from 'class-validator';

export class CreateBannerDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  link?: string;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  link?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  order?: number;
}

@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { title?: string; link?: string; imageUrl: string; order: number }) {
    return this.prisma.banner.create({
      data: {
        title: data.title,
        link: data.link,
        imageUrl: data.imageUrl,
        order: data.order || 0,
      },
    });
  }

  async findAll(admin = false) {
    return this.prisma.banner.findMany({
      where: admin ? undefined : { isActive: true },
      orderBy: { order: 'asc' },
    });
  }

  async update(id: string, data: { title?: string; link?: string; imageUrl?: string; isActive?: boolean; order?: number }) {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner not found');

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.link !== undefined) updateData.link = data.link;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.order !== undefined) updateData.order = data.order;

    return this.prisma.banner.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner not found');

    return this.prisma.banner.delete({ where: { id } });
  }
}

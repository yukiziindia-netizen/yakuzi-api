import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  BannersService,
  CreateBannerDto,
  UpdateBannerDto,
} from './banners.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { StorageService } from '../storage/storage.service';

@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAllPublic() {
    const data = await this.bannersService.findAll(false);
    return { message: 'Banners retrieved successfully', data };
  }
}

@Controller('admin/banners')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminBannersController {
  constructor(
    private readonly bannersService: BannersService,
    private readonly storageService: StorageService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  @HttpCode(HttpStatus.CREATED)
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateBannerDto,
  ) {
    if (!file) throw new BadRequestException('Image file is required');
    const imageUrl = await this.storageService.uploadBannerImage(file);
    const data = await this.bannersService.create({
      title: dto.title,
      link: dto.link,
      imageUrl,
      order: dto.order ? Number(dto.order) : 0,
    });
    return { message: 'Banner created successfully', data };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll() {
    const data = await this.bannersService.findAll(true);
    return { message: 'Banners retrieved successfully', data };
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('image'))
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UpdateBannerDto,
  ) {
    let imageUrl: string | undefined;
    if (file) {
      imageUrl = await this.storageService.uploadBannerImage(file);
    }
    const data = await this.bannersService.update(id, {
      title: dto.title,
      link: dto.link,
      imageUrl,
      isActive:
        dto.isActive !== undefined
          ? String(dto.isActive) === 'true'
          : undefined,
      order: dto.order ? Number(dto.order) : undefined,
    });
    return { message: 'Banner updated successfully', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.bannersService.remove(id);
    return { message: 'Banner deleted successfully', data };
  }
}

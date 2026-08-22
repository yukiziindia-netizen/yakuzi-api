import { Module } from '@nestjs/common';
import { BlogController } from './blog.controller';
import { BlogAdminController } from './blog-admin.controller';
import { BlogService } from './blog.service';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [BlogController, BlogAdminController],
  providers: [BlogService, PrismaService],
  exports: [BlogService],
})
export class BlogModule {}

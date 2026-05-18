import { PartialType } from '@nestjs/swagger';
import { CreateBlogAuthorDto } from './create-blog-author.dto';

export class UpdateBlogAuthorDto extends PartialType(CreateBlogAuthorDto) {}

import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateBlogPostDto } from './create-blog-post.dto';

export class UpdateBlogPostDto extends PartialType(CreateBlogPostDto) {
  /**
   * When the slug changes, also 301 the old URL to the new one so shared
   * links and indexed results keep working. Default true; false skips only
   * the redirect creation. Not a BlogPost column — stripped before persist.
   */
  @IsOptional()
  @IsBoolean()
  createRedirect?: boolean;
}

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Submit a product review' })
  @ApiResponse({ status: 201, description: 'Review created' })
  createReview(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.createReview(userId, dto);
  }

  @Get('product/:id')
  @ApiOperation({ summary: 'Get all reviews for a product' })
  @ApiResponse({ status: 200, description: 'Product reviews returned' })
  getProductReviews(@Param('id') productId: string) {
    return this.reviewsService.getProductReviews(productId);
  }

  @Get('eligibility/:productId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Whether the current buyer may review this product' })
  @ApiResponse({ status: 200, description: 'Eligibility returned' })
  getEligibility(
    @CurrentUser('id') userId: string,
    @Param('productId') productId: string,
  ) {
    return this.reviewsService.getEligibility(userId, productId);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all reviews (admin)' })
  @ApiResponse({ status: 200, description: 'All reviews returned' })
  getAdminReviews() {
    return this.reviewsService.getAdminReviews();
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a review (admin)' })
  @ApiResponse({ status: 200, description: 'Review deleted' })
  deleteAdminReview(@Param('id', ParseUUIDPipe) reviewId: string) {
    return this.reviewsService.deleteReview(reviewId);
  }
}

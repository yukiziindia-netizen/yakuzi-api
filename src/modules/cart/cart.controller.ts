import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@ApiTags('Cart')
@ApiBearerAuth('JWT-auth')
@Controller('cart')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUYER)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Post('add')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a product to cart' })
  @ApiResponse({ status: 201, description: 'Product added to cart' })
  async addToCart(
    @CurrentUser('id') userId: string,
    @Body() dto: AddToCartDto,
  ) {
    const data = await this.cartService.addToCart(userId, dto);
    return { message: 'Product added to cart', data };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current cart with items' })
  @ApiResponse({ status: 200, description: 'Cart returned' })
  async getCart(@CurrentUser('id') userId: string) {
    const data = await this.cartService.getCart(userId);
    return { message: 'Cart retrieved successfully', data };
  }

  @Patch('item/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiResponse({ status: 200, description: 'Cart item updated' })
  async updateCartItem(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) cartItemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const data = await this.cartService.updateCartItem(userId, cartItemId, dto);
    return { message: 'Cart item updated', data };
  }

  @Delete('item/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove single item from cart' })
  @ApiResponse({ status: 200, description: 'Cart item removed' })
  async removeCartItem(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) cartItemId: string,
  ) {
    return this.cartService.removeCartItem(userId, cartItemId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear entire cart' })
  @ApiResponse({ status: 200, description: 'Cart cleared' })
  async clearCart(@CurrentUser('id') userId: string) {
    return this.cartService.clearCart(userId);
  }
}

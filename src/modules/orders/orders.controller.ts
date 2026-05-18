import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ──────────────────────────────────────────────
  // BUYER ENDPOINTS
  // ──────────────────────────────────────────────

  @Post()
  @Roles(Role.BUYER)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Checkout — create order from cart' })
  @ApiResponse({ status: 201, description: 'Order placed' })
  @ApiResponse({ status: 400, description: 'Cart is empty or validation error' })
  async checkout(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const data = await this.ordersService.checkout(userId, dto);
    return { message: 'Order placed successfully', data };
  }

  @Get()
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List buyer orders' })
  @ApiResponse({ status: 200, description: 'Buyer orders returned' })
  async getBuyerOrders(@CurrentUser('id') userId: string) {
    const data = await this.ordersService.getBuyerOrders(userId);
    return { message: 'Orders retrieved successfully', data };
  }

  @Get('seller')
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List orders for current seller' })
  @ApiResponse({ status: 200, description: 'Seller orders returned' })
  async getSellerOrders(
    @CurrentUser('id') userId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const data = await this.ordersService.getSellerOrders(userId, dateFrom, dateTo);
    return { message: 'Seller orders retrieved successfully', data };
  }

  @Get(':id')
  @Roles(Role.BUYER, Role.SELLER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get full order detail' })
  @ApiResponse({ status: 200, description: 'Order details returned' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrderDetail(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    const data = await this.ordersService.getOrderDetail(userId, orderId);
    return { message: 'Order details retrieved successfully', data };
  }

  @Patch(':id/cancel')
  @Roles(Role.BUYER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel order & restore stock' })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  async cancelOrder(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    const data = await this.ordersService.cancelOrder(userId, orderId, role);
    return { message: 'Order cancelled successfully', data };
  }

  // ──────────────────────────────────────────────
  // SELLER ENDPOINTS
  // ──────────────────────────────────────────────

  @Patch(':id/status')
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update order status (seller)' })
  @ApiResponse({ status: 200, description: 'Order status updated' })
  async updateOrderStatus(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const data = await this.ordersService.updateOrderStatus(userId, orderId, dto);
    return { message: 'Order status updated successfully', data };
  }
}

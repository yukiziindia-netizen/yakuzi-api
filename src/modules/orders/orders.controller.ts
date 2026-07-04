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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { ShiprocketService } from './shiprocket.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateShippingDetailsDto } from './dto/update-shipping-details.dto';

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly shiprocketService: ShiprocketService,
  ) {}

  // ──────────────────────────────────────────────
  // BUYER ENDPOINTS
  // ──────────────────────────────────────────────

  @Post()
  @Roles(Role.BUYER)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Checkout — create order from cart' })
  @ApiResponse({ status: 201, description: 'Order placed' })
  @ApiResponse({
    status: 400,
    description: 'Cart is empty or validation error',
  })
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
    const data = await this.ordersService.getSellerOrders(
      userId,
      dateFrom,
      dateTo,
    );
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
    const data = await this.ordersService.updateOrderStatus(
      userId,
      orderId,
      dto,
    );
    return { message: 'Order status updated successfully', data };
  }

  @Patch(':id/shipping-details')
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update shipping dimensions and documents (seller)' })
  @ApiResponse({ status: 200, description: 'Shipping details updated' })
  async updateShippingDetails(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateShippingDetailsDto,
  ) {
    const data = await this.ordersService.updateShippingDetails(
      userId,
      orderId,
      dto,
    );
    return { message: 'Shipping details updated successfully', data };
  }
  // ──────────────────────────────────────────────
  // ADMIN UPDATE SHIPPING DOCS
  // ──────────────────────────────────────────────
  @Patch(':id/admin-shipping-docs')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload shipping documents by admin' })
  @ApiResponse({ status: 200, description: 'Documents uploaded' })
  async updateAdminShippingDocs(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: { adminShippingLabelUrl?: string; adminInvoiceUrl?: string },
  ) {
    const data = await this.ordersService.updateAdminShippingDocs(orderId, dto);
    return { message: 'Documents uploaded successfully', data };
  }

  // ──────────────────────────────────────────────
  // TRACKING ENDPOINT
  // ──────────────────────────────────────────────

  @Get(':id/tracking')
  @Roles(Role.BUYER, Role.SELLER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get order tracking timeline from Shiprocket' })
  @ApiResponse({ status: 200, description: 'Tracking info returned' })
  async getOrderTracking(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    // Basic check to ensure order exists and user has access
    const order = await this.ordersService.getOrderDetail(userId, orderId);

    if (!order.shiprocketOrderId) {
      return {
        message: 'Tracking not available yet (not pushed to Shiprocket)',
        data: null,
      };
    }

    const data = await this.shiprocketService.trackOrder(
      order.shiprocketOrderId,
    );
    return { message: 'Tracking details retrieved successfully', data };
  }
}

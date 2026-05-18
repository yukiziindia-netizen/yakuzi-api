import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
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
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UploadProofDto } from './dto/upload-proof.dto';

@ApiTags('Payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ──────────────────────────────────────────────
  // BUYER: Record a payment attempt
  // ──────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a manual payment (buyer)' })
  @ApiResponse({ status: 201, description: 'Payment recorded' })
  @ApiResponse({ status: 400, description: 'Invalid payment data' })
  async createPayment(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    const data = await this.paymentsService.createPayment(userId, dto);
    return { message: 'Payment recorded', data };
  }

  // ──────────────────────────────────────────────
  // BUYER: Upload payment proof
  // ──────────────────────────────────────────────

  @Post(':id/proof')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload payment proof screenshot/receipt' })
  @ApiResponse({ status: 200, description: 'Proof uploaded' })
  async uploadProof(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Body() dto: UploadProofDto,
  ) {
    const data = await this.paymentsService.uploadProof(userId, paymentId, dto);
    return { message: 'Payment proof uploaded', data };
  }

  @Post('order/:orderId/proof')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload payment proof by order ID' })
  @ApiResponse({ status: 200, description: 'Proof uploaded' })
  async uploadProofByOrder(
    @CurrentUser('id') userId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UploadProofDto,
  ) {
    const data = await this.paymentsService.uploadProofByOrder(userId, orderId, dto);
    return { message: 'Payment proof uploaded', data };
  }

  // ──────────────────────────────────────────────
  // BUYER: Get all payments for an order
  // ──────────────────────────────────────────────

  @Get('order/:orderId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get payment history for an order' })
  @ApiResponse({ status: 200, description: 'Payment history returned' })
  async getOrderPayments(
    @CurrentUser('id') userId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const data = await this.paymentsService.getOrderPayments(userId, orderId);
    return { message: 'Payment history retrieved', data };
  }

  // ──────────────────────────────────────────────
  // ADMIN: Confirm a payment
  // ──────────────────────────────────────────────

  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a payment (admin)' })
  @ApiResponse({ status: 200, description: 'Payment confirmed' })
  async confirmPayment(@Param('id', ParseUUIDPipe) paymentId: string) {
    const data = await this.paymentsService.confirmPayment(paymentId);
    return { message: 'Payment confirmed', data };
  }

  // ──────────────────────────────────────────────
  // ADMIN: Reject a payment
  // ──────────────────────────────────────────────

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a payment (admin)' })
  @ApiResponse({ status: 200, description: 'Payment rejected' })
  async rejectPayment(@Param('id', ParseUUIDPipe) paymentId: string) {
    const data = await this.paymentsService.rejectPayment(paymentId);
    return { message: 'Payment rejected', data };
  }
}

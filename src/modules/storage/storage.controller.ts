import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminAccessGuard } from '../../common/admin-access';
import { Roles } from '../../common/decorators/roles.decorator';
import { StorageService } from './storage.service';
import { memoryStorage } from 'multer';

const multerOptions = {
  storage: memoryStorage(),
  // The outer bound only. StorageService.validateFile applies the real,
  // per-type ceiling — 5 MB for a picture or a document, 40 MB for a banner
  // video. Leaving this at 5 MB would reject a banner video here, before the
  // service ever saw what type it was.
  limits: { fileSize: 40 * 1024 * 1024 },
};

const fileUploadBody = {
  schema: {
    type: 'object' as const,
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

@ApiTags('Storage')
@ApiBearerAuth('JWT-auth')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('product-image')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.SELLER, Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload product image (seller)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({ status: 201, description: 'Image uploaded, URL returned' })
  async uploadProductImage(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadProductImage(file);
    return { message: 'Product image uploaded', data: { url } };
  }

  @Post('review-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload review image (buyer)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({ status: 201, description: 'Image uploaded, URL returned' })
  async uploadReviewImage(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadProductImage(file);
    return { message: 'Review image uploaded', data: { url } };
  }

  @Post('drug-license')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.SELLER, Role.BUYER, Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload drug license image (seller onboarding)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({
    status: 201,
    description: 'Drug license uploaded, secure KEY returned',
  })
  async uploadDrugLicense(@UploadedFile() file: Express.Multer.File) {
    const key = await this.storageService.uploadDrugLicense(file);
    return { message: 'Drug license uploaded securely', data: { key } };
  }

  @Post('payment-proof')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.BUYER)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload payment proof (buyer)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({
    status: 201,
    description: 'Proof uploaded, secure KEY returned',
  })
  async uploadPaymentProof(@UploadedFile() file: Express.Multer.File) {
    const key = await this.storageService.uploadPaymentProof(file);
    return { message: 'Payment proof uploaded securely', data: { key } };
  }

  @Post('kyc')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.BUYER, Role.SELLER)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload KYC document (buyer/seller)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({
    status: 201,
    description: 'KYC document uploaded, secure KEY returned',
  })
  async uploadKycDocument(@UploadedFile() file: Express.Multer.File) {
    const key = await this.storageService.uploadKycDocument(file);
    return {
      message: 'KYC document uploaded securely',
      data: {
        key,
        explanation:
          'This is a private key. Use the /storage/view endpoint to get a temporary access link.',
      },
    };
  }

  @Post('blog-image')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload blog image (admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({ status: 201, description: 'Image uploaded, URL returned' })
  async uploadBlogImage(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadBlogImage(file);
    return { message: 'Blog image uploaded', data: { url } };
  }

  @Post('settlement-proof')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload settlement payout proof (admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({ status: 201, description: 'Image uploaded, URL returned' })
  async uploadSettlementProof(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadSettlementProof(file);
    return { message: 'Settlement proof uploaded', data: { url } };
  }

  @Post('order-document')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.SELLER, Role.ADMIN)
  // multerOptions (5 MB cap) — this was the only upload route on the
  // controller without it, so it accepted files of unbounded size.
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload order document/image (seller)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({ status: 201, description: 'File uploaded, URL returned' })
  async uploadOrderDocument(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadOrderDocument(file);
    return { message: 'Order document uploaded', data: { url } };
  }

  /**
   * Presigned URL for a private file. ADMIN only.
   *
   * This takes a storage key from the caller and hands back a URL for it,
   * and performs NO ownership check on that key. While BUYER and SELLER were
   * allowed, any logged-in customer who knew or guessed a key could pull
   * somebody else's KYC document, cancelled cheque or payment proof — a
   * personal-data breach, and a reportable one under the DPDP Act.
   *
   * Narrowing to ADMIN closes it completely rather than partially, and costs
   * nothing: every caller across all three front-ends is in the admin app
   * (orders, payments, users, users/[id]). Neither the buyer storefront nor
   * the seller portal references `getPresignedUrl` or `/storage/view` at all
   * — verified across both codebases before changing this.
   *
   * Admin behaviour is unchanged. AdminAccessGuard already engaged here,
   * because it keys off whether ADMIN appears in @Roles and ADMIN was
   * already listed; the /storage route mapping (anyWrite) applied before this
   * change and applies identically after it.
   *
   * If a buyer or seller ever needs to see their own documents, the fix is a
   * per-record ownership check in this handler — not widening @Roles again.
   */
  @Post('view')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a temporary presigned URL for a private file (admin)',
  })
  @ApiResponse({ status: 200, description: 'Temporary URL generated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getPresignedUrl(@Body('key') key: string) {
    const url = await this.storageService.getPresignedUrl(key);
    return { data: { url } };
  }

  @Post('upload-url')
  @UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
  @Roles(Role.SELLER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate S3 presigned URL for direct upload' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', nullable: true },
        filename: { type: 'string' },
        content_type: { type: 'string' },
      },
      required: ['filename', 'content_type'],
    },
  })
  async generateUploadUrl(
    @Body('product_id') productId: string,
    @Body('filename') filename: string,
    @Body('content_type') contentType: string,
  ) {
    const data = await this.storageService.generateUploadUrl(
      productId,
      filename,
      contentType,
    );
    return { data };
  }
}

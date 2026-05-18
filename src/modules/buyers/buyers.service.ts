import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IdfyService } from '../verification/idfy.service';
import { CreateBuyerProfileDto } from './dto/create-buyer-profile.dto';
import { UpdateBuyerProfileDto } from './dto/update-buyer-profile.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class BuyersService {
  private readonly logger = new Logger(BuyersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idfyService: IdfyService,
  ) {}

  /**
   * Create a new buyer profile for an authenticated BUYER user.
   * Verifies GST or PAN via IDFY; blocks creation on verification failure.
   */
  async createProfile(userId: string, dto: CreateBuyerProfileDto) {
    const existing = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });

    // Auth auto-creates an empty BuyerProfile on registration.
    // If that stub exists (legalName is empty), treat this as the real onboarding
    // and update it instead of throwing a conflict.
    const isEmptyStub = existing && !existing.legalName;

    if (existing && !isEmptyStub) {
      throw new ConflictException('Buyer profile already exists');
    }

    if (!dto.gstNumber && !dto.panNumber) {
      throw new BadRequestException('Either GST number or PAN number is required');
    }

    // Use pre-verified response if provided, otherwise verify via IDFY
    let gstPanResponse: any = dto.gstPanResponse ?? null;

    if (!gstPanResponse && this.idfyService.isConfigured()) {
      if (dto.gstNumber) {
        const result = await this.idfyService.verifyGst(dto.gstNumber);
        if (!result.status) {
          throw new BadRequestException(result.message || 'GST verification failed');
        }
        gstPanResponse = result;
      } else if (dto.panNumber) {
        const result = await this.idfyService.verifyPan(dto.panNumber);
        if (!result.status) {
          throw new BadRequestException(result.message || 'PAN verification failed');
        }
        gstPanResponse = result;
      }
    }

    if (!gstPanResponse || !gstPanResponse.status) {
      throw new BadRequestException(
        'IDFY verification is required. Please verify GST or PAN before submitting.',
      );
    }

    // Extract address fields from the structured address object
    const addr = dto.address as any;
    const city = addr?.city ?? dto.address?.['city'] ?? '';
    const state = addr?.state ?? dto.address?.['state'] ?? '';
    const pincode = addr?.pincode ?? dto.address?.['pincode'] ?? '';

    // Resolve referral code if provided (trimmed & case-insensitive)
    let referralCodeId: string | null = null;
    if (dto.inviteCode) {
      const cleanCode = dto.inviteCode.trim().toUpperCase();
      const ref = await (this.prisma as any).referralCode.findUnique({
        where: { code: cleanCode },
      });
      
      if (!ref) {
        throw new BadRequestException('Invalid referral code');
      }
      
      referralCodeId = ref.id;
    }

    const profileData = {
      legalName: dto.legalName,
      gstNumber: dto.gstNumber ?? null,
      panNumber: dto.panNumber ?? null,
      drugLicenseNumber: dto.drugLicenseNumber ?? null,
      drugLicenseUrl: dto.drugLicenseUrl ?? null,
      drugLicenseExpiry: dto.drugLicenseExpiry ? new Date(dto.drugLicenseExpiry) : null,
      drugLicenseNumber2: dto.drugLicenseNumber2 ?? null,
      drugLicenseUrl2: dto.drugLicenseUrl2 ?? null,
      drugLicenseExpiry2: dto.drugLicenseExpiry2 ? new Date(dto.drugLicenseExpiry2) : null,
      address: dto.address,
      city: city || null,
      state: state || null,
      pincode: pincode || null,
      latitude: dto.latitude,
      longitude: dto.longitude,
      gstPanResponse,
      licence: dto.licence,
      bankAccount: dto.bankAccount,
      cancelCheck: dto.cancelCheck ?? null,
      document: dto.document ?? null,
      inviteCode: dto.inviteCode ?? null,
      referralCodeId,
      verificationStatus: 'PENDING' as const, // Always pending — admin must verify
      creditTier: null, // status 0 — no tier until admin approves
    };

    const profile = isEmptyStub
      ? await this.prisma.buyerProfile.update({
          where: { userId },
          data: profileData,
        })
      : await this.prisma.buyerProfile.create({
          data: { userId, ...profileData },
        });

    // Update user status to PENDING
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'PENDING' },
    });

    this.logger.log(`Buyer profile created for user ${userId}`);
    return profile;
  }

  /**
   * Seller-initiated buyer onboarding.
   * Creates a BUYER user + profile in one step.
   * Returns the created buyer profile.
   */
  async onboardBuyer(sellerId: string, dto: CreateBuyerProfileDto) {
    if (!dto.gstNumber && !dto.panNumber) {
      throw new BadRequestException('Either GST number or PAN number is required');
    }

    if (!dto.gstPanResponse || !dto.gstPanResponse.status) {
      throw new BadRequestException(
        'IDFY verification is required. Verify GST or PAN before submitting.',
      );
    }

    // Check if buyer user already exists by phone
    const existingUser = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      include: { buyerProfile: true },
    });

    if (existingUser?.buyerProfile) {
      throw new ConflictException('A buyer with this phone number already has a profile');
    }

    // Extract address fields
    const addr = dto.address as any;
    const city = addr?.city ?? '';
    const state = addr?.state ?? '';
    const pincode = addr?.pincode ?? '';

    let userId: string;

    if (existingUser) {

      // User exists but no buyer profile — reuse
      userId = existingUser.id;
    } else {
      // Create new buyer user with default password (they'll reset via OTP)
      const hashedPassword = await bcrypt.hash('default_buyer_123', 10);
      const newUser = await this.prisma.user.create({
        data: {
          phone: dto.phone,
          email: dto.email ?? null,
          password: hashedPassword,
          role: 'BUYER',
          status: 'PENDING',
        },
      });
      userId = newUser.id;
    }

    // Resolve referral code if provided (trimmed & case-insensitive)
    let referralCodeId: string | null = null;
    if (dto.inviteCode) {
      const cleanCode = dto.inviteCode.trim().toUpperCase();
      const ref = await (this.prisma as any).referralCode.findUnique({
        where: { code: cleanCode },
      });

      if (!ref) {
        throw new BadRequestException('Invalid referral code');
      }

      referralCodeId = ref.id;
    }


    const profile = await this.prisma.buyerProfile.create({
      data: {
        userId,
        legalName: dto.legalName,
        gstNumber: dto.gstNumber ?? null,
        panNumber: dto.panNumber ?? null,
        drugLicenseNumber: dto.drugLicenseNumber ?? null,
        drugLicenseUrl: dto.drugLicenseUrl ?? null,
        drugLicenseExpiry: dto.drugLicenseExpiry ? new Date(dto.drugLicenseExpiry) : null,
        drugLicenseNumber2: dto.drugLicenseNumber2 ?? null,
        drugLicenseUrl2: dto.drugLicenseUrl2 ?? null,
        drugLicenseExpiry2: dto.drugLicenseExpiry2 ? new Date(dto.drugLicenseExpiry2) : null,
        address: dto.address,
        city: city || null,
        state: state || null,
        pincode: pincode || null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        gstPanResponse: dto.gstPanResponse,
        licence: dto.licence,
        bankAccount: dto.bankAccount,
        cancelCheck: dto.cancelCheck ?? null,
        document: dto.document ?? null,
        inviteCode: dto.inviteCode ?? null,
        referralCodeId,
        verificationStatus: 'PENDING',
        creditTier: null,
      },
    });


    // Set user status to PENDING
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'PENDING' },
    });

    this.logger.log(`Buyer onboarded by seller ${sellerId} — user ${userId}`);
    return { ...profile, phone: dto.phone, name: dto.name, email: dto.email };
  }

  /**
   * Get all buyer profiles (for admin).
   */
  async getAllBuyers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.buyerProfile.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, phone: true, email: true, status: true, createdAt: true },
          },
        },
      }),
      this.prisma.buyerProfile.count(),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Get the buyer profile for an authenticated user.
   */
  async getProfile(userId: string) {
    const profile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, phone: true, email: true, status: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException('Buyer profile not found');
    }

    return profile;
  }

  /**
   * Partially update the buyer profile.
   */
  async updateProfile(userId: string, dto: UpdateBuyerProfileDto) {
    const existing = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundException(
        'Buyer profile not found. Create a profile first.',
      );
    }

    const updateData: any = { ...dto };

    if (dto.inviteCode) {
      const cleanCode = dto.inviteCode.trim().toUpperCase();
      const ref = await (this.prisma as any).referralCode.findUnique({
        where: { code: cleanCode },
      });

      if (!ref) {
        throw new BadRequestException('Invalid referral code');
      }

      updateData.referralCodeId = ref.id;
    }

    // Extract city/state/pincode from address if provided
    if (dto.address) {
      const addr = dto.address as any;
      if (addr.city) updateData.city = addr.city;
      if (addr.state) updateData.state = addr.state;
      if (addr.pincode) updateData.pincode = addr.pincode;
    }

    // If the profile was UNVERIFIED (empty stub from registration) and the buyer
    // is now submitting KYC fields, transition to PENDING so admin sees it.
    if (
      existing.verificationStatus === 'UNVERIFIED' &&
      (dto.legalName ||
        dto.gstNumber ||
        dto.panNumber ||
        dto.drugLicenseNumber ||
        dto.drugLicenseUrl ||
        dto.drugLicenseExpiry ||
        dto.drugLicenseNumber2 ||
        dto.drugLicenseUrl2 ||
        dto.drugLicenseExpiry2)
    ) {
      updateData.verificationStatus = 'PENDING';
    }

    if (dto.drugLicenseExpiry) updateData.drugLicenseExpiry = new Date(dto.drugLicenseExpiry);
    if (dto.drugLicenseExpiry2) updateData.drugLicenseExpiry2 = new Date(dto.drugLicenseExpiry2);

    const profile = await this.prisma.buyerProfile.update({
      where: { userId },
      data: updateData,
    });

    // If we just moved to PENDING, also update User.status so admin sees it in pending queue
    if (updateData.verificationStatus === 'PENDING') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'PENDING' },
      });
    }

    this.logger.log(`Buyer profile updated for user ${userId}`);
    return profile;
  }
}

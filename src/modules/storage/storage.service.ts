import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.region = this.config.get<string>('AWS_REGION', 'ap-south-1');
    this.bucket = this.config.get<string>('AWS_BUCKET', 'pharmabag03');

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY', ''),
        secretAccessKey: this.config.get<string>('AWS_SECRET_KEY', ''),
      },
    });
  }

  private readonly ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
  ];

  private readonly ALLOWED_DOC_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

  async uploadProductImage(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const key = await this.upload(file, 'product-images');
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async uploadDrugLicense(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    // For sensitive docs, return the Key, which will be used with /storage/view to get a presigned URL
    return this.upload(file, 'drug-licenses');
  }

  async uploadPaymentProof(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    // For sensitive docs, return the Key
    return this.upload(file, 'payment-proofs');
  }

  async uploadKycDocument(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    // For KYC, return the Key, not the public URL
    return this.upload(file, 'kyc-documents');
  }

  /**
   * Generate a temporary (presigned) URL for a private file
   * @param key S3 key (e.g. kyc-documents/uuid.pdf)
   * @param expiresIn Seconds until the link expires (default 1 hour)
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    // Robust key extraction: If the 'key' is accidentally a full S3 URL, extract the actual key part
    let actualKey = key;
    if (key.startsWith('http')) {
      const parts = key.split('.amazonaws.com/');
      if (parts.length > 1) {
        actualKey = parts[1];
      }
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: actualKey,
    });

    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async uploadBlogImage(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const key = await this.upload(file, 'blog-images');
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async uploadSettlementProof(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    const key = await this.upload(file, 'settlement-proofs');
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private validateFile(
    file: Express.Multer.File,
    allowedTypes: string[],
  ): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed: ${allowedTypes.join(', ')}`,
      );
    }

    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size is ${this.MAX_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }
  }

  private async upload(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const ext = file.originalname.split('.').pop() || 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await this.s3.send(command);
    this.logger.log(`File uploaded to S3: ${key}`);
    return key;
  }
}

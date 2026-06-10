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
  private readonly cdnDomain: string;

  constructor(private readonly config: ConfigService) {
    this.region = this.config.get<string>('AWS_REGION', 'ap-south-1');
    this.bucket = this.config.get<string>('AWS_BUCKET', 'pharmabag03');

    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID') || this.config.get<string>('AWS_ACCESS_KEY', '');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY') || this.config.get<string>('AWS_ACCESS_SECRET_KEY') || this.config.get<string>('AWS_SECRET_KEY', '');

    const s3Config: any = { 
      region: this.region,
      requestChecksumCalculation: 'WHEN_REQUIRED'
    };
    
    // Only pass credentials if they actually exist in the .env, 
    // otherwise let AWS SDK fallback to ~/.aws/credentials or IAM Role
    if (accessKeyId && secretAccessKey) {
      s3Config.credentials = { accessKeyId, secretAccessKey };
    }

    this.s3 = new S3Client(s3Config);

    this.cdnDomain = this.config.get<string>('CDN_DOMAIN', 'https://dqvwqfh95x9be.cloudfront.net');
  }

  private readonly ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ];

  private readonly ALLOWED_DOC_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
  ];

  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

  async uploadProductImage(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const key = await this.upload(file, 'product-images');
    return `${this.cdnDomain}/${key}`;
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

  /**
   * Generate a presigned PUT URL for direct browser uploads to S3
   */
  async generateUploadUrl(productId: string | undefined, filename: string, contentType: string) {
    const id = productId || `tmp-${randomUUID()}`;
    const folder = contentType.startsWith('video/') ? 'videos' : 'images';
    
    // Clean filename
    const cleanName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `media/${folder}/${id}/${cleanName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(this.s3, command, { 
      expiresIn: 600,
      signableHeaders: new Set(['content-type', 'host']),
      unhoistableHeaders: new Set(['x-amz-sdk-checksum-algorithm', 'x-amz-checksum-crc32'])
    });
    const cdnUrl = `${this.cdnDomain}/${key}`;

    return {
      presigned_url: presignedUrl,
      key,
      cdn_url: cdnUrl,
    };
  }

  async uploadBlogImage(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const key = await this.upload(file, 'blog-images');
    return `${this.cdnDomain}/${key}`;
  }

  async uploadSettlementProof(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    const key = await this.upload(file, 'settlement-proofs');
    return `${this.cdnDomain}/${key}`;
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

    try {
      await this.s3.send(command);
      this.logger.log(`File uploaded to S3: ${key}`);
      return key;
    } catch (error: any) {
      this.logger.error(`S3 Upload Error: ${error.message}`, error.stack);
      if (error.name === 'InvalidAccessKeyId' || error.message.includes('InvalidAccessKeyId')) {
        throw new BadRequestException('AWS Credentials invalid or expired. Please update your .env file with a valid AWS_ACCESS_KEY.');
      }
      throw new BadRequestException(`Failed to upload file: ${error.message}`);
    }
  }
}

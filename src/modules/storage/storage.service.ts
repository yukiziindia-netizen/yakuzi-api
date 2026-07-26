import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Storage as GCSStorage } from '@google-cloud/storage';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: string; // 'gcs' | 's3'
  private readonly s3?: S3Client;
  private readonly gcs?: GCSStorage;

  private readonly bucket: string;
  private readonly region: string;
  private readonly cdnDomain: string;

  private readonly gcsProjectId: string;
  private readonly gcsProductImagesBucket: string;
  private readonly gcsStaticAssetsBucket: string;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.get<string>('STORAGE_PROVIDER', 'gcs').toLowerCase();

    // GCS Configuration
    this.gcsProjectId = this.config.get<string>('GCS_PROJECT_ID', 'yuzkizi-chat');
    this.gcsProductImagesBucket = this.config.get<string>('GCS_PRODUCT_IMAGES_BUCKET', 'yukiz-bucket');
    this.gcsStaticAssetsBucket = this.config.get<string>('GCS_STATIC_ASSETS_BUCKET', 'yukiz-bucket');

    const keyFilename =
      this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS') ||
      this.config.get<string>('GCS_KEY_FILE');

    try {
      const gcsOpts: any = { projectId: this.gcsProjectId };
      if (keyFilename) {
        gcsOpts.keyFilename = keyFilename;
      }
      this.gcs = new GCSStorage(gcsOpts);
      this.logger.log(`Initialized Google Cloud Storage for project ${this.gcsProjectId} (bucket: ${this.gcsProductImagesBucket})`);
    } catch (gcsErr: any) {
      this.logger.warn(`GCS initialization notice: ${gcsErr.message}`);
    }


    // AWS S3 Fallback Configuration (only used if STORAGE_PROVIDER=s3)
    this.region = this.config.get<string>('AWS_REGION', 'ap-south-1');
    this.bucket = this.config.get<string>('AWS_BUCKET', 'yukizi03');

    const accessKeyId =
      this.config.get<string>('AWS_ACCESS_KEY_ID') ||
      this.config.get<string>('AWS_ACCESS_KEY', '');
    const secretAccessKey =
      this.config.get<string>('AWS_SECRET_ACCESS_KEY') ||
      this.config.get<string>('AWS_ACCESS_SECRET_KEY') ||
      this.config.get<string>('AWS_SECRET_KEY', '');

    const s3Config: any = {
      region: this.region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    };

    if (accessKeyId && secretAccessKey) {
      s3Config.credentials = { accessKeyId, secretAccessKey };
    }

    this.s3 = new S3Client(s3Config);

    this.cdnDomain = this.config.get<string>(
      'CDN_DOMAIN',
      `https://storage.googleapis.com/${this.gcsProductImagesBucket}`,
    );
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
    return this.getFileUrl(key);
  }

  async uploadDrugLicense(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    return this.upload(file, 'drug-licenses');
  }

  async uploadPaymentProof(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    return this.upload(file, 'payment-proofs');
  }

  async uploadKycDocument(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    return this.upload(file, 'kyc-documents');
  }

  async getPresignedUrl(
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    let actualKey = key;
    if (key.startsWith('http')) {
      const parts = key.split('storage.googleapis.com/').concat(key.split('.amazonaws.com/'));
      if (parts.length > 1) {
        actualKey = parts[1].replace(`${this.gcsProductImagesBucket}/`, '');
      }
    }

    if (this.provider === 'gcs' && this.gcs) {
      try {
        const [url] = await this.gcs
          .bucket(this.gcsProductImagesBucket)
          .file(actualKey)
          .getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + expiresIn * 1000,
          });
        return url;
      } catch (err: any) {
        this.logger.warn(`GCS signed URL notice: ${err.message}`);
        return `https://storage.googleapis.com/${this.gcsProductImagesBucket}/${actualKey}`;
      }
    }

    if (this.provider === 'gcs') {
      return `https://storage.googleapis.com/${this.gcsProductImagesBucket}/${actualKey}`;
    }

    if (this.s3) {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: actualKey,
      });
      return getSignedUrl(this.s3, command, { expiresIn });
    }

    return `https://storage.googleapis.com/${this.gcsProductImagesBucket}/${actualKey}`;
  }

  async generateUploadUrl(
    productId: string | undefined,
    filename: string,
    contentType: string,
  ) {
    const id = productId || `tmp-${randomUUID()}`;
    const folder = contentType.startsWith('video/') ? 'videos' : 'images';
    const cleanName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `media/${folder}/${id}/${cleanName}`;

    const isGcs = this.provider === 'gcs';

    if (isGcs && this.gcs) {
      try {
        const [presignedUrl] = await this.gcs
          .bucket(this.gcsProductImagesBucket)
          .file(key)
          .getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 10 * 60 * 1000,
            contentType,
          });
        const cdnUrl = `https://storage.googleapis.com/${this.gcsProductImagesBucket}/${key}`;
        return { presigned_url: presignedUrl, key, cdn_url: cdnUrl };
      } catch (err: any) {
        this.logger.warn(`GCS presigned write URL notice: ${err.message}`);
      }
    }

    if (isGcs) {
      const directGcsUploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${this.gcsProductImagesBucket}/o?uploadType=media&name=${encodeURIComponent(key)}`;
      const cdnUrl = `https://storage.googleapis.com/${this.gcsProductImagesBucket}/${key}`;
      return {
        presigned_url: directGcsUploadUrl,
        key,
        cdn_url: cdnUrl,
      };
    }

    if (this.s3) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      });
      const presignedUrl = await getSignedUrl(this.s3, command, {
        expiresIn: 600,
        signableHeaders: new Set(['content-type', 'host']),
      });
      const cdnUrl = `${this.cdnDomain}/${key}`;
      return { presigned_url: presignedUrl, key, cdn_url: cdnUrl };
    }

    const cdnUrl = `https://storage.googleapis.com/${this.gcsProductImagesBucket}/${key}`;
    return { presigned_url: cdnUrl, key, cdn_url: cdnUrl };
  }

  async uploadBlogImage(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const key = await this.upload(file, 'blog-images');
    return this.getFileUrl(key);
  }

  async uploadBannerImage(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const key = await this.upload(file, 'banners');
    return this.getFileUrl(key);
  }

  async uploadSettlementProof(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    const key = await this.upload(file, 'settlement-proofs');
    return this.getFileUrl(key);
  }

  async uploadOrderDocument(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    const key = await this.upload(file, 'order-documents');
    return this.getFileUrl(key);
  }

  private getFileUrl(key: string): string {
    if (this.provider === 'gcs') {
      return `https://storage.googleapis.com/${this.gcsProductImagesBucket}/${key}`;
    }
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

    if (this.provider === 'gcs' && this.gcs) {
      try {
        const bucket = this.gcs.bucket(this.gcsProductImagesBucket);
        const gcsFile = bucket.file(key);

        await gcsFile.save(file.buffer, {
          contentType: file.mimetype,
          resumable: false,
        });

        this.logger.log(`File uploaded to Google Cloud Storage (bucket: ${this.gcsProductImagesBucket}): ${key}`);
        return key;
      } catch (gcsError: any) {
        this.logger.error(`GCS Upload Error: ${gcsError.message}`, gcsError.stack);
        throw new BadRequestException(`Failed to upload file to Google Cloud Storage: ${gcsError.message}`);
      }
    }

    if (this.provider === 'gcs') {
      throw new BadRequestException('Google Cloud Storage client not initialized');
    }

    return this.uploadToS3(file, key);
  }

  private async uploadToS3(file: Express.Multer.File, key: string): Promise<string> {
    if (!this.s3) {
      throw new BadRequestException('Storage service not configured properly');
    }

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
      throw new BadRequestException(`Failed to upload file: ${error.message}`);
    }
  }
}

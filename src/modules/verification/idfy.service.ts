import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { IdfyVerificationResponseDto } from './dto/idfy-pan.dto';
import { IdfyGstVerificationResponseDto } from './dto/idfy-gst.dto';

interface MastersIndiaConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  oauthUrl: string;
  apiBaseUrl: string;
}

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10_000;

@Injectable()
export class IdfyService {
  private readonly logger = new Logger(IdfyService.name);
  private readonly config: MastersIndiaConfig | null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('MASTERS_INDIA_CLIENT_ID');
    const clientSecret = this.configService.get<string>('MASTERS_INDIA_CLIENT_SECRET');
    const username = this.configService.get<string>('MASTERS_INDIA_USERNAME');
    const password = this.configService.get<string>('MASTERS_INDIA_PASSWORD');

    if (clientId && clientSecret && username && password) {
      this.config = {
        clientId,
        clientSecret,
        username,
        password,
        oauthUrl: 'https://commonapi.mastersindia.co/oauth/access_token',
        apiBaseUrl: 'https://commonapi.mastersindia.co/commonapis',
      };
      this.logger.log('Masters India service initialized (credentials configured)');
    } else {
      this.config = null;
      this.logger.warn(
        'Masters India service NOT configured — Missing credentials. Verification will be skipped.',
      );
    }
  }

  /** Returns true when Masters India credentials are present */
  isConfigured(): boolean {
    return this.config !== null;
  }

  // ─────────────────────────────────────────────────
  // PAN VERIFICATION
  // ─────────────────────────────────────────────────

  async verifyPan(panNumber: string): Promise<IdfyVerificationResponseDto> {
    if (!this.config) {
      return {
        status: false,
        message: 'Verification service not configured',
        verifiedDocumentType: null
      };
    }

    try {
      // Step 1: Get/refresh access token
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        return {
          status: false,
          message: 'Failed to obtain access token',
          verifiedDocumentType: null
        };
      }

      // Step 2: Call PAN search API
      const url = `${this.config.apiBaseUrl}/searchpan?pan=${panNumber}`;
      this.logger.log(`Calling PAN API: ${url}`);
      const response = await this.makeGetRequest(url, accessToken);
      this.logger.log(`PAN API Response: ${JSON.stringify(response)}`);
      return this.parsePanResponse(response, panNumber);
    } catch (err: any) {
      this.logger.error(`PAN verification failed: ${err.message}`);
      return {
        status: false,
        message: 'Pan Number is invalid',
        verifiedDocumentType: null
      };
    }
  }

  // ─────────────────────────────────────────────────
  // GST VERIFICATION
  // ─────────────────────────────────────────────────

  async verifyGst(
    gstNumber: string,
  ): Promise<IdfyGstVerificationResponseDto> {
    if (!this.config) {
      return {
        status: false,
        message: 'Verification service not configured',
        gstNumber,
        verifiedDocumentType: null,
      };
    }

    try {
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        return {
          status: false,
          message: 'Failed to obtain access token',
          gstNumber,
          verifiedDocumentType: null,
        };
      }

      // Functional GST search API for Masters India
      const url = `${this.config.apiBaseUrl}/searchgstin?gstin=${gstNumber}`;
      this.logger.log(`Calling GST API: ${url}`);
      const response = await this.makeGetRequest(url, accessToken);
      this.logger.log(`GST API Response: ${JSON.stringify(response)}`);
      return this.parseGstResponse(response, gstNumber);
    } catch (err: any) {
      this.logger.error(`GST verification failed: ${err.message}`);
      return {
        status: false,
        message: 'GST Number is invalid',
        gstNumber,
        verifiedDocumentType: null,
      };
    }
  }

  // ─────────────────────────────────────────────────
  // OAUTH: GET/REFRESH ACCESS TOKEN
  // ─────────────────────────────────────────────────

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const payload = {
        username: this.config!.username,
        password: this.config!.password,
        client_id: this.config!.clientId,
        client_secret: this.config!.clientSecret,
        grant_type: 'password',

      };

      this.logger.log('Requesting OAuth access token from Masters India...');
      const response = await this.makePostRequest(this.config!.oauthUrl, payload);

      if (response.access_token) {
        this.accessToken = response.access_token;
        const expiresIn = (response.expires_in || 3600) - 300;
        this.tokenExpiresAt = Date.now() + expiresIn * 1000;
        this.logger.log('Successfully obtained new OAuth token from Masters India');
        return this.accessToken;
      }

      this.logger.error(
        `OAuth Success but no token found in response. Status: ${response.error ? 'Error' : 'OK'
        }, Body: ${JSON.stringify(response)}`,
      );
      return null;
    } catch (err: any) {
      this.logger.error(`Masters India OAuth request failed: ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────
  // HTTP REQUESTS
  // ─────────────────────────────────────────────────

  private makePostRequest(
    url: string,
    payload: Record<string, any>,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const parsedUrl = new URL(url);

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'PharmaBag/1.0.1',
          'Accept': 'application/json',
          'client_id': this.config?.clientId || '',
        },
        timeout: TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(new Error(`Masters India API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response: ${raw.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private makeGetRequest(
    url: string,
    accessToken: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'client_id': this.config!.clientId,
          'User-Agent': 'PharmaBag/1.0.0',
          'Accept': 'application/json',
        },
        timeout: TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(new Error(`Masters India API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response: ${raw.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  // ─────────────────────────────────────────────────
  // RESPONSE PARSERS
  // ─────────────────────────────────────────────────

  private parsePanResponse(
    response: any,
    panNumber: string,
  ): IdfyVerificationResponseDto {
    if (!response || response.error === true || !Array.isArray(response.data) || response.data.length === 0) {
      return { status: false, message: 'Pan Number is invalid', verifiedDocumentType: null };
    }

    const data = response.data[0];
    const legalName = data.lgnm ?? data.name ?? data.legal_name ?? data.fullName ?? 'N/A';
    const gstNumber = data.gstin || null;

    return {
      status: true,
      legalName,
      gstNumber: gstNumber || undefined,
      message: 'Pan Number is valid',
      verifiedDocumentType: 'ind_pan',
    };
  }

  private parseGstResponse(
    response: any,
    gstNumber: string,
  ): IdfyGstVerificationResponseDto {
    if (!response || response.error === true || !response.data) {
      return {
        status: false,
        message: 'GST Number is invalid',
        gstNumber,
        verifiedDocumentType: null
      };
    }

    // Handle both array and object responses from Masters India API
    let data;
    if (Array.isArray(response.data)) {
      if (response.data.length === 0) {
        return {
          status: false,
          message: 'GST Number is invalid',
          gstNumber,
          verifiedDocumentType: null
        };
      }
      data = response.data[0];
    } else {
      data = response.data;
    }

    const legalName = data.tradeNam ?? data.lgnm ?? data.name ?? data.legal_name ?? 'N/A';
    
    // Masters India uses either 'nature_of_business_activity' or 'nba' (array)
    let businessActivity = 'N/A';
    if (data.nature_of_business_activity) {
      businessActivity = data.nature_of_business_activity;
    } else if (Array.isArray(data.nba) && data.nba.length > 0) {
      businessActivity = data.nba.join(', ');
    }

    // Masters India uses either 'principal_place_of_business_address', 'address', or 'pradr.addr'
    let address = 'N/A';
    if (data.principal_place_of_business_address) {
      address = data.principal_place_of_business_address;
    } else if (data.address) {
      address = data.address;
    } else if (data.pradr && data.pradr.addr) {
      const addrObj = data.pradr.addr;
      // Build a string from the nested address fields (bnm, st, loc, city, dst, stcd, pncd)
      const parts = [addrObj.bno, addrObj.bnm, addrObj.flno, addrObj.st, addrObj.loc, addrObj.city, addrObj.dst, addrObj.stcd, addrObj.pncd]
        .filter(p => p && p.trim() !== '');
      address = parts.join(', ');
    }

    return {
      status: true,
      legalName,
      gstNumber,
      natureOfBusinessActivity: businessActivity,
      address,
      message: 'GST Number is valid',
      verifiedDocumentType: 'ind_gst_certificate',
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { v4 as uuidv4 } from 'uuid';

interface IdfyConfig {
  accountId: string;
  apiKey: string;
  apiBaseUrl: string;
}

const TIMEOUT_MS = 10_000;
const MAX_POLL_RETRIES = 10;
const POLL_INTERVAL_MS = 1_000;

@Injectable()
export class IdfyService {
  private readonly logger = new Logger(IdfyService.name);
  private readonly config: IdfyConfig | null = null;
  private readonly isMockMode: boolean = false;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('IDFY_ACCOUNT_ID');
    const apiKey = this.configService.get<string>('IDFY_API_KEY');
    const mockModeEnv = this.configService.get<string>('IDFY_MOCK_MODE');

    if (
      accountId &&
      apiKey &&
      mockModeEnv !== 'true' &&
      !apiKey.startsWith('dummy') &&
      !apiKey.startsWith('mock')
    ) {
      this.config = {
        accountId,
        apiKey,
        apiBaseUrl: 'https://eve.idfy.com/v3',
      };
      this.logger.log(
        'IDFY service initialized with production/sandbox API credentials',
      );
    } else {
      this.config = null;
      this.isMockMode = true;
      this.logger.warn(
        'IDFY credentials missing, mock, or IDFY_MOCK_MODE is enabled. Running IDFY service in SIMULATED SANDBOX mode.',
      );
    }
  }

  isConfigured(): boolean {
    return this.config !== null || this.isMockMode;
  }

  // ─────────────────────────────────────────────────
  // GST VERIFICATION
  // ─────────────────────────────────────────────────

  async verifyGst(gstNumber: string): Promise<any> {
    if (this.isMockMode) {
      this.logger.log(`[IDFY Mock] Verifying GST: ${gstNumber}`);
      if (gstNumber.length !== 15) {
        return {
          status: false,
          message: 'GST Number must be exactly 15 characters',
          gstNumber,
          verifiedDocumentType: null,
        };
      }
      return {
        status: true,
        legalName: 'Simulated Pharma Distributor Private Limited',
        gstNumber,
        natureOfBusinessActivity: 'Wholesale, Distribution',
        address:
          'Plot No. 42, GIDC Industrial Estate, Sector-2, Gandhinagar, Gujarat, 382010',
        message: 'GST Number is valid',
        verifiedDocumentType: 'ind_gst_certificate',
      };
    }

    try {
      const url = `${this.config!.apiBaseUrl}/tasks/sync/verify_with_source/ind_gst_certificate`;
      const taskId = uuidv4();
      const groupId = uuidv4();

      const payload = {
        task_id: taskId,
        group_id: groupId,
        data: {
          gstin: gstNumber,
        },
      };

      this.logger.log(`[IDFY] Calling GST Sync API for: ${gstNumber}`);
      const response = await this.makePostRequest(url, payload);
      this.logger.log(`[IDFY] GST API Response: ${JSON.stringify(response)}`);

      if (response.status === 'completed' && response.result?.source_output) {
        const sourceOut = response.result.source_output;
        const legalName = sourceOut.trade_name || sourceOut.legal_name || 'N/A';

        let businessActivity = 'N/A';
        if (sourceOut.nba && Array.isArray(sourceOut.nba)) {
          businessActivity = sourceOut.nba.join(', ');
        } else if (sourceOut.nature_of_business_activity) {
          businessActivity = sourceOut.nature_of_business_activity;
        }

        let address = 'N/A';
        if (sourceOut.pradr?.addr) {
          const addrObj = sourceOut.pradr.addr;
          const parts = [
            addrObj.bno,
            addrObj.bnm,
            addrObj.flno,
            addrObj.st,
            addrObj.loc,
            addrObj.city,
            addrObj.dst,
            addrObj.stcd,
            addrObj.pncd,
          ].filter((p) => p && p.trim() !== '');
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

      return {
        status: false,
        message: response.result?.reason || 'GST Number is invalid',
        gstNumber,
        verifiedDocumentType: null,
      };
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

  // Aadhaar verification API has been deprecated. Buyers and sellers submit Aadhaar number directly as a text field.

  // ─────────────────────────────────────────────────
  // LEGACY STUB FOR PAN
  // ─────────────────────────────────────────────────

  async verifyPan(panNumber: string): Promise<any> {
    this.logger.warn(
      'PAN verification requested but has been deprecated in favor of Aadhaar verification.',
    );
    return {
      status: false,
      message:
        'PAN verification is deprecated. Please verify using Aadhaar OTP instead.',
      verifiedDocumentType: null,
    };
  }

  // ─────────────────────────────────────────────────
  // POLLING WORKFLOW FOR ASYNC TASKS
  // ─────────────────────────────────────────────────

  private async pollTaskStatus(taskId: string): Promise<any> {
    let retries = 0;
    while (retries < MAX_POLL_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const url = `${this.config!.apiBaseUrl}/tasks/${taskId}`;
        this.logger.debug(
          `[IDFY] Polling task status for: ${taskId} (Attempt ${retries + 1})`,
        );

        const task = await this.makeGetRequest(url);
        if (task.status === 'completed' || task.status === 'failed') {
          return task;
        }
      } catch (err: any) {
        this.logger.warn(`Error polling task status: ${err.message}`);
      }

      retries++;
    }
    throw new Error('Task polling timed out or failed to complete.');
  }

  // ─────────────────────────────────────────────────
  // HTTP METHODS
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
          'account-id': this.config!.accountId,
          'api-key': this.config!.apiKey,
          'User-Agent': 'Yukizi/1.0.0',
          Accept: 'application/json',
        },
        timeout: TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (
            res.statusCode &&
            (res.statusCode < 200 || res.statusCode >= 300)
          ) {
            return reject(
              new Error(
                `IDFY API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`,
              ),
            );
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

  private makeGetRequest(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'account-id': this.config!.accountId,
          'api-key': this.config!.apiKey,
          'User-Agent': 'Yukizi/1.0.0',
          Accept: 'application/json',
        },
        timeout: TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (
            res.statusCode &&
            (res.statusCode < 200 || res.statusCode >= 300)
          ) {
            return reject(
              new Error(
                `IDFY API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`,
              ),
            );
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
}

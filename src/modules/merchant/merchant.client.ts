import { Injectable, Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import axios, { AxiosError } from 'axios';
import { MerchantConfig } from './merchant.config';
import { MerchantProductInput } from './merchant-product.mapper';

/**
 * Thin wrapper over the Google Merchant API Products sub-API.
 *
 * REST over axios rather than a generated client on purpose: the Merchant API
 * is versioned in its URL, so keeping the endpoint in one constant lets the
 * version move without a dependency bump, and the request bodies stay exactly
 * the shapes the mapper produces (easy to inspect in a dry run).
 *
 * Auth is a service-account JWT (google-auth-library). The account must be
 * added as a user on the Merchant Center account; no OAuth screen, no refresh
 * tokens to store.
 */

const API_BASE = 'https://merchantapi.googleapis.com/products/v1beta';
const SCOPE = 'https://www.googleapis.com/auth/content';

@Injectable()
export class MerchantClient {
  private readonly logger = new Logger(MerchantClient.name);
  private jwt: JWT | null = null;
  private jwtEmail: string | null = null;

  private auth(cfg: MerchantConfig): JWT {
    if (!cfg.credentials) throw new Error('Merchant credentials are not configured');
    // Rebuild only if the key changed, so a token can be cached across calls.
    if (!this.jwt || this.jwtEmail !== cfg.credentials.client_email) {
      this.jwt = new JWT({
        email: cfg.credentials.client_email,
        key: cfg.credentials.private_key,
        scopes: [SCOPE],
      });
      this.jwtEmail = cfg.credentials.client_email;
    }
    return this.jwt;
  }

  private async token(cfg: MerchantConfig): Promise<string> {
    const { token } = await this.auth(cfg).getAccessToken();
    if (!token) throw new Error('Could not obtain a Google access token');
    return token;
  }

  /** Insert or update one product input. */
  async upsertProduct(cfg: MerchantConfig, product: MerchantProductInput): Promise<void> {
    const account = `accounts/${cfg.accountId}`;
    const dataSource = `${account}/dataSources/${cfg.dataSourceId}`;
    const url = `${API_BASE}/${account}/productInputs:insert?dataSource=${encodeURIComponent(dataSource)}`;
    await this.post(cfg, url, product);
  }

  /**
   * Delete one product input by offerId. Used to pull a product that is no
   * longer sellable, so the listing does not outlive the offer.
   */
  async deleteProduct(cfg: MerchantConfig, offerId: string, contentLanguage: string, feedLabel: string): Promise<void> {
    const account = `accounts/${cfg.accountId}`;
    const dataSource = `${account}/dataSources/${cfg.dataSourceId}`;
    // The productInput name encodes channel~language~feedLabel~offerId.
    const name = `${account}/productInputs/online~${contentLanguage}~${feedLabel}~${offerId}`;
    const url = `${API_BASE}/${name}?dataSource=${encodeURIComponent(dataSource)}`;
    try {
      const token = await this.token(cfg);
      await axios.delete(url, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });
    } catch (e) {
      // A 404 means it was already gone — that is the desired end state.
      const status = (e as AxiosError).response?.status;
      if (status === 404) return;
      throw this.explain(e as AxiosError);
    }
  }

  private async post(cfg: MerchantConfig, url: string, body: unknown): Promise<void> {
    const token = await this.token(cfg);
    try {
      await axios.post(url, body, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
    } catch (e) {
      throw this.explain(e as AxiosError);
    }
  }

  /** Turn Google's error body into a one-line message worth logging. */
  private explain(e: AxiosError): Error {
    const status = e.response?.status;
    const data = e.response?.data as { error?: { message?: string } } | undefined;
    const msg = data?.error?.message || e.message;
    return new Error(`Merchant API ${status ?? ''}: ${msg}`.trim());
  }
}

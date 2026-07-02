import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ShiprocketService {
  private readonly logger = new Logger(ShiprocketService.name);
  private readonly SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';

  private tokenCache: { token: string | null; expiresAt: number } = {
    token: null,
    expiresAt: 0,
  };

  private getCredentials() {
    // Ideally use ConfigService, using process.env here for simplicity based on provided python script
    return {
      email: process.env.SHIPROCKET_EMAIL || 'server@theeraofmarketing.com',
      password: process.env.SHIPROCKET_PASSWORD || '',
    };
  }

  async getAuthToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache.token && now < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    const { email, password } = this.getCredentials();

    if (!password) {
      this.logger.warn(
        'Shiprocket password is not set in environment variables',
      );
      // Throw error or handle gracefully
    }

    try {
      const response = await axios.post(
        `${this.SHIPROCKET_BASE}/auth/local/login`,
        {
          email,
          password,
        },
      );

      this.tokenCache.token = response.data.token;
      // Valid for 24h, expire in 23h
      this.tokenCache.expiresAt = now + 82800 * 1000;

      this.logger.log('Successfully retrieved Shiprocket auth token');
      return this.tokenCache.token as string;
    } catch (error: any) {
      this.logger.error(
        `Shiprocket auth failed: ${error?.response?.data?.message || error.message}`,
      );
      throw new HttpException('Shiprocket auth failed', HttpStatus.BAD_GATEWAY);
    }
  }

  async createOrder(payload: any) {
    const token = await this.getAuthToken();

    try {
      const response = await axios.post(
        `${this.SHIPROCKET_BASE}/orders/create/adhoc`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Shiprocket create order failed: ${JSON.stringify(error?.response?.data || error.message)}`,
      );
      throw new HttpException(
        `Shiprocket error: ${error?.response?.data?.message || 'Unknown error'}`,
        error?.response?.status || HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async trackOrder(orderId: string) {
    const token = await this.getAuthToken();

    try {
      const response = await axios.get(
        `${this.SHIPROCKET_BASE}/courier/track`,
        {
          params: { order_id: orderId },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const trackingData = response.data?.tracking_data || {};
      const shipmentTrack = trackingData.shipment_track?.[0] || {};

      return {
        order_id: orderId,
        awb_code: shipmentTrack.awb_code,
        courier: shipmentTrack.courier_name,
        current_status: shipmentTrack.current_status,
        delivered_date: shipmentTrack.delivered_date,
        estimated_delivery: shipmentTrack.etd,
        activities: trackingData.shipment_track_activities || [],
      };
    } catch (error: any) {
      this.logger.error(
        `Shiprocket tracking failed: ${error?.response?.data?.message || error.message}`,
      );
      throw new HttpException(
        `Shiprocket tracking error`,
        error?.response?.status || HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async trackByShipment(shipmentId: string) {
    const token = await this.getAuthToken();

    try {
      const response = await axios.get(
        `${this.SHIPROCKET_BASE}/courier/track/shipment/${shipmentId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Shiprocket tracking by shipment failed: ${error?.response?.data?.message || error.message}`,
      );
      throw new HttpException(
        `Shiprocket tracking error`,
        error?.response?.status || HttpStatus.BAD_GATEWAY,
      );
    }
  }
}

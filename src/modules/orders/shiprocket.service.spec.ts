import axios from 'axios';
import { ShiprocketService } from './shiprocket.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ShiprocketService.getAuthToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SHIPROCKET_EMAIL = 'test@example.com';
    process.env.SHIPROCKET_PASSWORD = 'secret';
  });

  it('posts to /auth/login, not the old non-existent /auth/local/login', async () => {
    mockedAxios.post.mockResolvedValue({ data: { token: 'sr-token' } });
    const service = new ShiprocketService();

    await service.getAuthToken();

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://apiv2.shiprocket.in/v1/external/auth/login',
      { email: 'test@example.com', password: 'secret' },
    );
  });

  it('returns the token from a successful login', async () => {
    mockedAxios.post.mockResolvedValue({ data: { token: 'sr-token' } });
    const service = new ShiprocketService();

    await expect(service.getAuthToken()).resolves.toBe('sr-token');
  });
});

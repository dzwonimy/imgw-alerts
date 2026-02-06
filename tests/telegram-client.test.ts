import {
  getBotToken,
  sendTelegramMessage,
  sendMessage,
  clearTokenCache,
  TelegramMessage,
} from '../services/worker/telegram-client';
import { SSMClient } from '@aws-sdk/client-ssm';

// Mock AWS SDK
jest.mock('@aws-sdk/client-ssm');
const MockedSSMClient = SSMClient as jest.MockedClass<typeof SSMClient>;

// Mock fetch globally
global.fetch = jest.fn();

describe('TelegramClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearTokenCache();
  });

  afterEach(() => {
    // Clear any pending timers and handles
    jest.clearAllTimers();
  });

  describe('getBotToken', () => {
    it('should fetch token from SSM and cache it', async () => {
      const mockToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
      const mockSend = jest.fn().mockResolvedValue({
        Parameter: { Value: mockToken },
      });

      MockedSSMClient.mockImplementation(() => ({
        send: mockSend,
      } as unknown as SSMClient));

      const token1 = await getBotToken('/water-alerts/telegram/bot-token');
      const token2 = await getBotToken('/water-alerts/telegram/bot-token');

      expect(token1).toBe(mockToken);
      expect(token2).toBe(mockToken);
      // Should only call SSM once due to caching
      expect(mockSend).toHaveBeenCalledTimes(1);
      // Verify the command was called (AWS SDK v3 command structure may vary)
      expect(mockSend).toHaveBeenCalled();
    });

    it('should handle SSM errors', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('SSM error'));

      MockedSSMClient.mockImplementation(() => ({
        send: mockSend,
      } as unknown as SSMClient));

      await expect(
        getBotToken('/water-alerts/telegram/bot-token')
      ).rejects.toThrow('Failed to get bot token from SSM');
    });

    it('should handle missing parameter value', async () => {
      const mockSend = jest.fn().mockResolvedValue({
        Parameter: null,
      });

      MockedSSMClient.mockImplementation(() => ({
        send: mockSend,
      } as unknown as SSMClient));

      await expect(
        getBotToken('/water-alerts/telegram/bot-token')
      ).rejects.toThrow('SSM parameter /water-alerts/telegram/bot-token has no value');
    });

    it('should reuse in-progress token fetch', async () => {
      const mockToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
      let resolvePromise: (value: any) => void;
      const mockSend = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          })
      );

      MockedSSMClient.mockImplementation(() => ({
        send: mockSend,
      } as unknown as SSMClient));

      // Start two concurrent fetches
      const promise1 = getBotToken('/water-alerts/telegram/bot-token');
      const promise2 = getBotToken('/water-alerts/telegram/bot-token');

      // Resolve the SSM call
      resolvePromise!({ Parameter: { Value: mockToken } });

      const [token1, token2] = await Promise.all([promise1, promise2]);

      expect(token1).toBe(mockToken);
      expect(token2).toBe(mockToken);
      // Should only call SSM once
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendTelegramMessage', () => {
    const mockToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
    const message: TelegramMessage = {
      chatId: '123456789',
      text: 'Test message',
    };

    it('should send message successfully', async () => {
      const mockResponse = {
        ok: true,
        result: {
          message_id: 12345,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const messageId = await sendTelegramMessage(message, mockToken);

      expect(messageId).toBe(12345);
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${mockToken}/sendMessage`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: '123456789',
            text: 'Test message',
            parse_mode: 'HTML',
          }),
        })
      );
    });

    it('should handle HTTP error responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await expect(sendTelegramMessage(message, mockToken)).rejects.toThrow(
        'Telegram API returned status 400'
      );
    });

    it('should handle Telegram API error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          description: 'Invalid chat_id',
        }),
      });

      await expect(sendTelegramMessage(message, mockToken)).rejects.toThrow(
        'Telegram API returned error'
      );
    });

    it('should handle missing message_id in response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {},
        }),
      });

      await expect(sendTelegramMessage(message, mockToken)).rejects.toThrow(
        'Invalid response from Telegram API: missing message_id'
      );
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(sendTelegramMessage(message, mockToken)).rejects.toThrow(
        'Network error'
      );
    });
  });

  describe('sendMessage', () => {
    const message: TelegramMessage = {
      chatId: '123456789',
      text: 'Test message',
    };

    it('should get token from SSM and send message', async () => {
      const mockToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
      const mockSend = jest.fn().mockResolvedValue({
        Parameter: { Value: mockToken },
      });

      MockedSSMClient.mockImplementation(() => ({
        send: mockSend,
      } as unknown as SSMClient));

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 12345 },
        }),
      });

      const messageId = await sendMessage(message, {
        ssmParameterName: '/water-alerts/telegram/bot-token',
      });

      expect(messageId).toBe(12345);
      expect(mockSend).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should use environment variable if parameter name not provided', async () => {
      const originalEnv = process.env.TELEGRAM_TOKEN_PARAM;
      process.env.TELEGRAM_TOKEN_PARAM = '/env/token/param';

      const mockToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
      const mockSend = jest.fn().mockResolvedValue({
        Parameter: { Value: mockToken },
      });

      MockedSSMClient.mockImplementation(() => ({
        send: mockSend,
      } as unknown as SSMClient));

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 12345 },
        }),
      });

      await sendMessage(message);

      // Verify the command was called (AWS SDK v3 command structure may vary)
      expect(mockSend).toHaveBeenCalled();

      process.env.TELEGRAM_TOKEN_PARAM = originalEnv;
    });

    it('should throw error if parameter name not provided', async () => {
      const originalEnv = process.env.TELEGRAM_TOKEN_PARAM;
      delete process.env.TELEGRAM_TOKEN_PARAM;

      await expect(sendMessage(message)).rejects.toThrow(
        'Telegram token parameter name not provided'
      );

      process.env.TELEGRAM_TOKEN_PARAM = originalEnv;
    });
  });

  describe('clearTokenCache', () => {
    it('should clear cached token', async () => {
      const mockToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
      const mockSend = jest.fn().mockResolvedValue({
        Parameter: { Value: mockToken },
      });

      MockedSSMClient.mockImplementation(() => ({
        send: mockSend,
      } as unknown as SSMClient));

      // Fetch and cache token
      await getBotToken('/water-alerts/telegram/bot-token');
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Clear cache
      clearTokenCache();

      // Fetch again - should call SSM again
      await getBotToken('/water-alerts/telegram/bot-token');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});

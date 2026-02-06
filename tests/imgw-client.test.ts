import { fetchStationData, parseMeasurement, convertToNumber } from '../services/worker/imgw-client';

// Mock fetch globally
global.fetch = jest.fn();

describe('ImgwClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('convertToNumber', () => {
    it('should convert valid numbers', () => {
      expect(convertToNumber(123)).toBe(123);
      expect(convertToNumber(123.45)).toBe(123.45);
      expect(convertToNumber(-50)).toBe(-50);
      expect(convertToNumber(0)).toBe(0);
    });

    it('should convert valid number strings', () => {
      expect(convertToNumber('123')).toBe(123);
      expect(convertToNumber('123.45')).toBe(123.45);
      expect(convertToNumber('-50')).toBe(-50);
      expect(convertToNumber('0')).toBe(0);
      expect(convertToNumber('  123  ')).toBe(123); // Trims whitespace
    });

    it('should return null for invalid values', () => {
      expect(convertToNumber(null)).toBeNull();
      expect(convertToNumber(undefined)).toBeNull();
      expect(convertToNumber('')).toBeNull();
      expect(convertToNumber('   ')).toBeNull();
      expect(convertToNumber('abc')).toBeNull();
      expect(convertToNumber('123abc')).toBeNull();
      expect(convertToNumber(NaN)).toBeNull();
      expect(convertToNumber(Infinity)).toBeNull();
      expect(convertToNumber(-Infinity)).toBeNull();
    });

    it('should handle boolean values', () => {
      expect(convertToNumber(true)).toBe(1);
      expect(convertToNumber(false)).toBe(0);
    });
  });

  describe('parseMeasurement', () => {
    it('should parse valid measurement with stan_wody', () => {
      const measurement = {
        stan_wody: 245.5,
        data_pomiaru: '2026-02-06T10:00:00Z',
        station_id: '149200090',
      };

      const result = parseMeasurement(measurement);
      expect(result).not.toBeNull();
      expect(result?.level).toBe(245.5);
      expect(result?.measurementTime).toBe('2026-02-06T10:00:00Z');
      expect(result?.rawData).toBe(measurement);
    });

    it('should parse measurement with string stan_wody', () => {
      const measurement = {
        stan_wody: '245.5',
        data_pomiaru: '2026-02-06T10:00:00Z',
      };

      const result = parseMeasurement(measurement);
      expect(result).not.toBeNull();
      expect(result?.level).toBe(245.5);
    });

    it('should handle missing stan_wody', () => {
      const measurement = {
        data_pomiaru: '2026-02-06T10:00:00Z',
      };

      const result = parseMeasurement(measurement);
      expect(result).toBeNull();
    });

    it('should handle null stan_wody', () => {
      const measurement = {
        stan_wody: null,
        data_pomiaru: '2026-02-06T10:00:00Z',
      };

      const result = parseMeasurement(measurement);
      expect(result).toBeNull();
    });

    it('should handle invalid stan_wody', () => {
      const measurement = {
        stan_wody: 'invalid',
        data_pomiaru: '2026-02-06T10:00:00Z',
      };

      const result = parseMeasurement(measurement);
      expect(result).toBeNull();
    });

    it('should handle missing timestamp fields', () => {
      const measurement = {
        stan_wody: 245.5,
      };

      const result = parseMeasurement(measurement);
      expect(result).not.toBeNull();
      expect(result?.level).toBe(245.5);
      // Should use current time as fallback
      expect(result?.measurementTime).toBeTruthy();
      expect(new Date(result!.measurementTime).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should handle different timestamp field names', () => {
      const measurement1 = {
        stan_wody: 245.5,
        timestamp: '2026-02-06T10:00:00Z',
      };
      const result1 = parseMeasurement(measurement1);
      expect(result1?.measurementTime).toBe('2026-02-06T10:00:00Z');

      const measurement2 = {
        stan_wody: 245.5,
        date: '2026-02-06T10:00:00Z',
      };
      const result2 = parseMeasurement(measurement2);
      expect(result2?.measurementTime).toBe('2026-02-06T10:00:00Z');
    });

    it('should return null for non-object input', () => {
      expect(parseMeasurement(null)).toBeNull();
      expect(parseMeasurement(undefined)).toBeNull();
      expect(parseMeasurement('string')).toBeNull();
      expect(parseMeasurement(123)).toBeNull();
      expect(parseMeasurement([])).toBeNull();
    });
  });

  describe('fetchStationData', () => {
    const mockBaseUrl = 'https://danepubliczne.imgw.pl/api/data/hydro/id/';

    it('should fetch and parse valid station data', async () => {
      const mockResponse = [
        {
          stan_wody: 245.5,
          data_pomiaru: '2026-02-06T10:00:00Z',
          station_id: '149200090',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchStationData('149200090', { baseUrl: mockBaseUrl });

      expect(result).not.toBeNull();
      expect(result?.level).toBe(245.5);
      expect(result?.measurementTime).toBe('2026-02-06T10:00:00Z');
      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}149200090`,
        expect.objectContaining({
          headers: { Accept: 'application/json' },
        })
      );
    });

    it('should return null for empty array response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await fetchStationData('149200090', { baseUrl: mockBaseUrl });
      expect(result).toBeNull();
    });

    it('should handle non-array response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'Not found' }),
      });

      await expect(fetchStationData('149200090', { baseUrl: mockBaseUrl })).rejects.toThrow(
        'Expected array response'
      );
    });

    it('should handle HTTP error responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(fetchStationData('149200090', { baseUrl: mockBaseUrl })).rejects.toThrow(
        'IMGW API returned status 404'
      );
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchStationData('149200090', { baseUrl: mockBaseUrl })).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle timeout', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, options?: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            // Listen for abort signal
            if (options?.signal) {
              const abortHandler = () => {
                const error = new Error('AbortError');
                error.name = 'AbortError';
                reject(error);
              };
              if (options.signal.aborted) {
                // Already aborted
                abortHandler();
              } else {
                options.signal.addEventListener('abort', abortHandler);
              }
            } else {
              // If no signal, resolve after delay (shouldn't happen in this test)
              setTimeout(() => {
                reject(new Error('No abort signal provided'));
              }, 2000);
            }
          });
        }
      );

      await expect(
        fetchStationData('149200090', { baseUrl: mockBaseUrl, timeout: 100 })
      ).rejects.toThrow('Request timeout');
    }, 10000); // Increase timeout for this test

    it('should handle invalid measurement in array', async () => {
      const mockResponse = [
        {
          stan_wody: null,
          data_pomiaru: '2026-02-06T10:00:00Z',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchStationData('149200090', { baseUrl: mockBaseUrl });
      expect(result).toBeNull();
    });

    it('should use default baseUrl if not provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            stan_wody: 245.5,
            data_pomiaru: '2026-02-06T10:00:00Z',
          },
        ],
      });

      await fetchStationData('149200090');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://danepubliczne.imgw.pl/api/data/hydro/id/149200090',
        expect.any(Object)
      );
    });
  });
});

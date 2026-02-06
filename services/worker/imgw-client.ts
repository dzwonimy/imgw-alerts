/**
 * IMGW API client for fetching water level data
 */

export interface ImgwMeasurement {
  level: number; // stan_wody converted to number
  measurementTime: string; // ISO timestamp from IMGW
  rawData: unknown; // Original measurement object for debugging
}

export interface ImgwClientOptions {
  baseUrl?: string;
  timeout?: number; // Request timeout in milliseconds
}

/**
 * Fetches water level data from IMGW API for a given station
 * @param stationId IMGW station ID
 * @param options Optional client configuration
 * @returns Latest measurement or null if not available/invalid
 */
export async function fetchStationData(
  stationId: string,
  options: ImgwClientOptions = {}
): Promise<ImgwMeasurement | null> {
  const baseUrl = options.baseUrl || 'https://danepubliczne.imgw.pl/api/data/hydro/id/';
  const timeout = options.timeout || 10000; // 10 seconds default
  const url = `${baseUrl}${stationId}`;

  try {
    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`IMGW API returned status ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Validate response is an array
    if (!Array.isArray(data)) {
      throw new Error(`Expected array response, got ${typeof data}`);
    }

    if (data.length === 0) {
      return null; // No measurements available
    }

    // Take the first (latest) measurement
    const measurement = data[0];
    return parseMeasurement(measurement);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
    throw new Error(`Unknown error: ${String(error)}`);
  }
}

/**
 * Parses a single IMGW measurement object
 * @param measurement Raw measurement object from IMGW API
 * @returns Parsed measurement or null if invalid
 */
export function parseMeasurement(measurement: unknown): ImgwMeasurement | null {
  if (!measurement || typeof measurement !== 'object') {
    return null;
  }

  const obj = measurement as Record<string, unknown>;

  // Extract stan_wody (water level)
  const stanWody = obj.stan_wody;
  if (stanWody === null || stanWody === undefined) {
    return null; // Missing water level data
  }

  // Convert to number with validation
  const level = convertToNumber(stanWody);
  if (level === null) {
    return null; // Invalid number
  }

  // Extract measurement timestamp
  // IMGW typically provides timestamp in various formats, try common fields
  let measurementTime = '';
  if (obj.data_pomiaru) {
    measurementTime = String(obj.data_pomiaru);
  } else if (obj.timestamp) {
    measurementTime = String(obj.timestamp);
  } else if (obj.date) {
    measurementTime = String(obj.date);
  } else {
    // If no timestamp found, use current time as fallback
    measurementTime = new Date().toISOString();
  }

  return {
    level,
    measurementTime,
    rawData: measurement,
  };
}

/**
 * Converts a value to a number with validation
 * Handles strings, numbers, and null/undefined gracefully
 * @param value Value to convert
 * @returns Number or null if conversion fails
 */
export function convertToNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    // Check for NaN or Infinity
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return null;
    }
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }

    // Try parsing as number
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  // Try coercion for other types
  const coerced = Number(value);
  if (Number.isNaN(coerced) || !Number.isFinite(coerced)) {
    return null;
  }
  return coerced;
}

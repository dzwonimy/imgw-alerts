/**
 * Alert evaluation logic for water level alerts
 */

export interface AlertConfig {
  stationId: string;
  minLevel: number;
  maxLevel: number;
  enabled: boolean;
  telegramChatId: string;
  name?: string;
  // Other fields like pk, sk, createdAt, updatedAt are not needed for evaluation
}

export interface Measurement {
  level: number;
  measurementTime: string;
}

/**
 * Checks if a water level measurement matches an alert's configured range
 * @param alert Alert configuration
 * @param measurement Water level measurement
 * @returns true if level is within range (minLevel <= level <= maxLevel), false otherwise
 */
export function isLevelInRange(alert: AlertConfig, measurement: Measurement): boolean {
  if (!alert.enabled) {
    return false; // Disabled alerts never match
  }

  const { level } = measurement;
  const { minLevel, maxLevel } = alert;

  // Check if level is within range (inclusive boundaries)
  return minLevel <= level && level <= maxLevel;
}

/**
 * Filters out disabled alerts from an array
 * @param alerts Array of alert configurations
 * @returns Array of enabled alerts only
 */
export function filterEnabledAlerts(alerts: AlertConfig[]): AlertConfig[] {
  return alerts.filter((alert) => alert.enabled === true);
}

/**
 * Evaluates a measurement against an alert configuration
 * @param alert Alert configuration
 * @param measurement Water level measurement
 * @returns true if alert is enabled AND level is in range, false otherwise
 */
export function evaluateAlert(alert: AlertConfig, measurement: Measurement): boolean {
  // Skip disabled alerts
  if (!alert.enabled) {
    return false;
  }

  // Check range match
  return isLevelInRange(alert, measurement);
}

import {
  isLevelInRange,
  filterEnabledAlerts,
  evaluateAlert,
  AlertConfig,
} from '../services/worker/alert-evaluator';

describe('AlertEvaluator', () => {
  const sampleAlert: AlertConfig = {
    stationId: '149200090',
    minLevel: 235,
    maxLevel: 260,
    enabled: true,
    telegramChatId: '123456789',
    name: 'Dobczyce (Raba)',
  };

  describe('isLevelInRange', () => {
    it('should return true when level is within range', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
      };
      expect(isLevelInRange(alert, { level: 245.5, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 240, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 250, measurementTime: '' })).toBe(true);
    });

    it('should return true at lower boundary (minLevel)', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
      };
      expect(isLevelInRange(alert, { level: 235, measurementTime: '' })).toBe(true);
    });

    it('should return true at upper boundary (maxLevel)', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
      };
      expect(isLevelInRange(alert, { level: 260, measurementTime: '' })).toBe(true);
    });

    it('should return false when level is below minLevel', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
      };
      expect(isLevelInRange(alert, { level: 234.9, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 200, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 0, measurementTime: '' })).toBe(false);
    });

    it('should return false when level is above maxLevel', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
      };
      expect(isLevelInRange(alert, { level: 260.1, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 300, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 1000, measurementTime: '' })).toBe(false);
    });

    it('should return false for disabled alerts regardless of level', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
        enabled: false,
      };
      // Even if level is in range, disabled alerts should not match
      expect(isLevelInRange(alert, { level: 245.5, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 235, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 260, measurementTime: '' })).toBe(false);
    });

    it('should handle zero as minLevel', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 0,
        maxLevel: 100,
      };
      expect(isLevelInRange(alert, { level: 0, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 50, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: -1, measurementTime: '' })).toBe(false);
    });

    it('should handle negative minLevel', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: -10,
        maxLevel: 100,
      };
      expect(isLevelInRange(alert, { level: -10, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 0, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: -11, measurementTime: '' })).toBe(false);
    });

    it('should handle very small ranges', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 245,
        maxLevel: 246,
      };
      expect(isLevelInRange(alert, { level: 245, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 245.5, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 246, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 244.9, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 246.1, measurementTime: '' })).toBe(false);
    });

    it('should handle equal minLevel and maxLevel', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 245,
        maxLevel: 245,
      };
      expect(isLevelInRange(alert, { level: 245, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 244.9, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 245.1, measurementTime: '' })).toBe(false);
    });

    it('should handle decimal values', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235.5,
        maxLevel: 260.75,
      };
      expect(isLevelInRange(alert, { level: 235.5, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 260.75, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 248.123, measurementTime: '' })).toBe(true);
      expect(isLevelInRange(alert, { level: 235.49, measurementTime: '' })).toBe(false);
      expect(isLevelInRange(alert, { level: 260.76, measurementTime: '' })).toBe(false);
    });
  });

  describe('filterEnabledAlerts', () => {
    it('should return only enabled alerts', () => {
      const alerts: AlertConfig[] = [
        { ...sampleAlert, enabled: true },
        { ...sampleAlert, stationId: '2', enabled: false },
        { ...sampleAlert, stationId: '3', enabled: true },
        { ...sampleAlert, stationId: '4', enabled: false },
      ];

      const enabled = filterEnabledAlerts(alerts);
      expect(enabled).toHaveLength(2);
      expect(enabled.every((alert) => alert.enabled === true)).toBe(true);
      expect(enabled[0].stationId).toBe('149200090');
      expect(enabled[1].stationId).toBe('3');
    });

    it('should return empty array if all alerts are disabled', () => {
      const alerts: AlertConfig[] = [
        { ...sampleAlert, enabled: false },
        { ...sampleAlert, stationId: '2', enabled: false },
      ];

      const enabled = filterEnabledAlerts(alerts);
      expect(enabled).toHaveLength(0);
    });

    it('should return all alerts if all are enabled', () => {
      const alerts: AlertConfig[] = [
        { ...sampleAlert, enabled: true },
        { ...sampleAlert, stationId: '2', enabled: true },
      ];

      const enabled = filterEnabledAlerts(alerts);
      expect(enabled).toHaveLength(2);
    });

    it('should return empty array for empty input', () => {
      expect(filterEnabledAlerts([])).toHaveLength(0);
    });
  });

  describe('evaluateAlert', () => {
    it('should return true for enabled alert with level in range', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
        enabled: true,
      };
      expect(evaluateAlert(alert, { level: 245.5, measurementTime: '' })).toBe(true);
    });

    it('should return false for enabled alert with level out of range', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
        enabled: true,
      };
      expect(evaluateAlert(alert, { level: 300, measurementTime: '' })).toBe(false);
      expect(evaluateAlert(alert, { level: 200, measurementTime: '' })).toBe(false);
    });

    it('should return false for disabled alert even if level is in range', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
        enabled: false,
      };
      expect(evaluateAlert(alert, { level: 245.5, measurementTime: '' })).toBe(false);
      expect(evaluateAlert(alert, { level: 235, measurementTime: '' })).toBe(false);
      expect(evaluateAlert(alert, { level: 260, measurementTime: '' })).toBe(false);
    });

    it('should return false for disabled alert with level out of range', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
        enabled: false,
      };
      expect(evaluateAlert(alert, { level: 300, measurementTime: '' })).toBe(false);
    });

    it('should handle boundary values correctly', () => {
      const alert: AlertConfig = {
        ...sampleAlert,
        minLevel: 235,
        maxLevel: 260,
        enabled: true,
      };
      // At boundaries
      expect(evaluateAlert(alert, { level: 235, measurementTime: '' })).toBe(true);
      expect(evaluateAlert(alert, { level: 260, measurementTime: '' })).toBe(true);
      // Just outside boundaries
      expect(evaluateAlert(alert, { level: 234.999, measurementTime: '' })).toBe(false);
      expect(evaluateAlert(alert, { level: 260.001, measurementTime: '' })).toBe(false);
    });
  });
});

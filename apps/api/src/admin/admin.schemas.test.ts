import { describe, expect, it } from 'vitest';
import { accessAlertSettingsSchema } from './admin.schemas';

describe('accessAlertSettingsSchema', () => {
  it('accepts unique five-minute times in the organization timezone', () => {
    expect(
      accessAlertSettingsSchema.safeParse({ enabled: true, times: ['08:00', '13:15', '18:30'] })
        .success,
    ).toBe(true);
  });

  it('rejects duplicate times, off-cycle minutes and enabled schedules without a time', () => {
    expect(
      accessAlertSettingsSchema.safeParse({ enabled: true, times: ['09:00', '09:00'] }).success,
    ).toBe(false);
    expect(accessAlertSettingsSchema.safeParse({ enabled: true, times: ['09:02'] }).success).toBe(
      false,
    );
    expect(accessAlertSettingsSchema.safeParse({ enabled: true, times: [] }).success).toBe(false);
  });
});

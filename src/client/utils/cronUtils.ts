// Cron expression utilities

export const CRON_PRESETS = {
  hourly: '0 * * * *',
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
  sixhours: '0 */6 * * *',
} as const;

export type CronPreset = keyof typeof CRON_PRESETS;

export interface CronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export function parseCronExpression(cron: string): CronFields {
  const parts = cron.trim().split(/\s+/);
  return {
    minute: parts[0] || '*',
    hour: parts[1] || '*',
    dayOfMonth: parts[2] || '*',
    month: parts[3] || '*',
    dayOfWeek: parts[4] || '*',
  };
}

export function buildCronExpression(fields: CronFields): string {
  return `${fields.minute} ${fields.hour} ${fields.dayOfMonth} ${fields.month} ${fields.dayOfWeek}`;
}

export function cronToHuman(cron: string): string {
  const fields = parseCronExpression(cron);

  // Check for common patterns
  if (cron === CRON_PRESETS.hourly) {
    return 'Every hour at minute 0';
  }
  if (cron === CRON_PRESETS.daily) {
    return 'Every day at 9:00 AM';
  }
  if (cron === CRON_PRESETS.weekly) {
    return 'Every Monday at 9:00 AM';
  }
  if (cron === CRON_PRESETS.sixhours) {
    return 'Every 6 hours';
  }

  const parts: string[] = [];

  // Minute
  if (fields.minute === '*') {
    parts.push('every minute');
  } else if (fields.minute.startsWith('*/')) {
    parts.push(`every ${fields.minute.slice(2)} minutes`);
  } else {
    parts.push(`at minute ${fields.minute}`);
  }

  // Hour
  if (fields.hour === '*') {
    parts.push('of every hour');
  } else if (fields.hour.startsWith('*/')) {
    parts.push(`every ${fields.hour.slice(2)} hours`);
  } else {
    const hour = parseInt(fields.hour, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    parts.push(`at ${hour12}:${fields.minute.padStart(2, '0')} ${ampm}`);
  }

  // Day of month
  if (fields.dayOfMonth !== '*') {
    parts.push(`on day ${fields.dayOfMonth}`);
  }

  // Month
  if (fields.month !== '*') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = parseInt(fields.month, 10) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      parts.push(`in ${months[monthIndex]}`);
    }
  }

  // Day of week
  if (fields.dayOfWeek !== '*') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayIndex = parseInt(fields.dayOfWeek, 10);
    if (dayIndex >= 0 && dayIndex < 7) {
      parts.push(`on ${days[dayIndex]}`);
    }
  }

  return parts.join(' ') || cron;
}

export function isValidCronExpression(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const patterns = [
    /^(\*|[0-5]?\d)(-[0-5]?\d)?(\/\d+)?$/, // minute
    /^(\*|[01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?$/, // hour
    /^(\*|[1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?(\/\d+)?$/, // day of month
    /^(\*|[1-9]|1[0-2])(-([1-9]|1[0-2]))?(\/\d+)?$/, // month
    /^(\*|[0-6])(-[0-6])?(\/\d+)?$/, // day of week
  ];

  return parts.every((part, index) => patterns[index].test(part));
}

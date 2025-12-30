import { useMemo } from 'react';
import {
  cronToHuman,
  parseCronExpression,
  buildCronExpression,
  isValidCronExpression,
  CRON_PRESETS,
  type CronFields,
} from '../utils/cronUtils';

export function useCronParser(cronExpression: string) {
  const parsed = useMemo(() => parseCronExpression(cronExpression), [cronExpression]);
  const humanReadable = useMemo(() => cronToHuman(cronExpression), [cronExpression]);
  const isValid = useMemo(() => isValidCronExpression(cronExpression), [cronExpression]);

  return {
    fields: parsed,
    humanReadable,
    isValid,
  };
}

export function useCronBuilder() {
  const build = (fields: CronFields) => buildCronExpression(fields);
  const validate = (cron: string) => isValidCronExpression(cron);
  const toHuman = (cron: string) => cronToHuman(cron);

  return {
    build,
    validate,
    toHuman,
    presets: CRON_PRESETS,
  };
}

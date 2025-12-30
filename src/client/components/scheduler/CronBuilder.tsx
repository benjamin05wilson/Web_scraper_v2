import type { CronFields } from '../../utils/cronUtils';
import { CRON_PRESETS, parseCronExpression, buildCronExpression, cronToHuman } from '../../utils/cronUtils';

interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
}

export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const fields = parseCronExpression(value);

  const handleFieldChange = (field: keyof CronFields, newValue: string) => {
    const newFields = { ...fields, [field]: newValue };
    onChange(buildCronExpression(newFields));
  };

  const handlePreset = (preset: keyof typeof CRON_PRESETS) => {
    onChange(CRON_PRESETS[preset]);
  };

  return (
    <div className="cron-builder">
      <div className="cron-presets">
        <button
          type="button"
          className={`btn secondary preset-btn${value === CRON_PRESETS.hourly ? ' active' : ''}`}
          style={{ padding: '8px 16px', fontSize: '0.85em' }}
          onClick={() => handlePreset('hourly')}
        >
          Every Hour
        </button>
        <button
          type="button"
          className={`btn secondary preset-btn${value === CRON_PRESETS.daily ? ' active' : ''}`}
          style={{ padding: '8px 16px', fontSize: '0.85em' }}
          onClick={() => handlePreset('daily')}
        >
          Daily 9 AM
        </button>
        <button
          type="button"
          className={`btn secondary preset-btn${value === CRON_PRESETS.weekly ? ' active' : ''}`}
          style={{ padding: '8px 16px', fontSize: '0.85em' }}
          onClick={() => handlePreset('weekly')}
        >
          Weekly Mon
        </button>
        <button
          type="button"
          className={`btn secondary preset-btn${value === CRON_PRESETS.sixhours ? ' active' : ''}`}
          style={{ padding: '8px 16px', fontSize: '0.85em' }}
          onClick={() => handlePreset('sixhours')}
        >
          Every 6 Hours
        </button>
      </div>

      <div className="cron-fields">
        <div className="cron-field">
          <label className="cron-field-label">Minute</label>
          <input
            type="text"
            className="cron-field-input form-input"
            value={fields.minute}
            onChange={(e) => handleFieldChange('minute', e.target.value)}
          />
        </div>
        <div className="cron-field">
          <label className="cron-field-label">Hour</label>
          <input
            type="text"
            className="cron-field-input form-input"
            value={fields.hour}
            onChange={(e) => handleFieldChange('hour', e.target.value)}
          />
        </div>
        <div className="cron-field">
          <label className="cron-field-label">Day</label>
          <input
            type="text"
            className="cron-field-input form-input"
            value={fields.dayOfMonth}
            onChange={(e) => handleFieldChange('dayOfMonth', e.target.value)}
          />
        </div>
        <div className="cron-field">
          <label className="cron-field-label">Month</label>
          <input
            type="text"
            className="cron-field-input form-input"
            value={fields.month}
            onChange={(e) => handleFieldChange('month', e.target.value)}
          />
        </div>
        <div className="cron-field">
          <label className="cron-field-label">Weekday</label>
          <input
            type="text"
            className="cron-field-input form-input"
            value={fields.dayOfWeek}
            onChange={(e) => handleFieldChange('dayOfWeek', e.target.value)}
          />
        </div>
      </div>

      <div
        className="cron-preview"
        style={{
          padding: '15px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          fontSize: '0.9em',
          color: 'var(--text-secondary)',
        }}
      >
        {cronToHuman(value)}
      </div>
    </div>
  );
}

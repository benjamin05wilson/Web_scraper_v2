import type { Schedule } from '../../../shared/types';
import { cronToHuman } from '../../utils/cronUtils';
import { formatDateTime } from '../../utils/dateUtils';

interface ScheduleDetailsProps {
  schedule: Schedule;
  onRunNow: () => void;
  onDelete: () => void;
}

export function ScheduleDetails({ schedule, onRunNow, onDelete }: ScheduleDetailsProps) {
  return (
    <>
      <div className="detail-header">
        <div className="detail-header-info">
          <h2 className="detail-title">{schedule.name}</h2>
          <div className="detail-header-badges">
            <span className={`schedule-type-badge ${schedule.type}`}>{schedule.type}</span>
            <span
              className={`schedule-type-badge ${schedule.enabled ? 'enabled' : 'disabled'}`}
              style={{
                background: schedule.enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: schedule.enabled ? '#10b981' : '#ef4444',
              }}
            >
              {schedule.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12,6 12,12 16,14" />
          </svg>
          Schedule
        </div>
        <div className="detail-card">
          <div className="detail-card-label">Cron Expression</div>
          <div className="detail-card-value mono">{schedule.schedule}</div>
          <div className="detail-card-value" style={{ marginTop: '8px', color: 'var(--accent-color)' }}>
            {cronToHuman(schedule.schedule)}
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          Configuration
        </div>
        <div className="detail-card">
          {schedule.type === 'scraper' ? (
            <>
              <div className="detail-card-label">Config Name</div>
              <div className="detail-card-value">{schedule.config || 'Not specified'}</div>
            </>
          ) : (
            <>
              <div className="detail-card-label">CSV File Path</div>
              <div className="detail-card-value mono">{schedule.csv_path || 'Not specified'}</div>
            </>
          )}
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Timestamps
        </div>
        <div className="timestamps-grid">
          <div className="detail-card">
            <div className="detail-card-label">Last Run</div>
            <div className="detail-card-value">
              {schedule.last_run ? formatDateTime(schedule.last_run) : 'Never'}
            </div>
          </div>
          <div className="detail-card">
            <div className="detail-card-label">Created</div>
            <div className="detail-card-value">{formatDateTime(schedule.created_at)}</div>
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button className="btn btn-success" onClick={onRunNow}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5,3 19,12 5,21" />
          </svg>
          Run Now
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3,6 5,6 21,6" />
            <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" />
          </svg>
          Delete
        </button>
      </div>
    </>
  );
}

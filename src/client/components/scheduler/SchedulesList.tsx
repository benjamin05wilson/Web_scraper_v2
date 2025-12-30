import type { Schedule } from '../../../shared/types';
import { cronToHuman } from '../../utils/cronUtils';
import { formatRelativeTime } from '../../utils/dateUtils';

interface SchedulesListProps {
  schedules: Schedule[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onToggle: (id: number, enabled: boolean) => void;
  loading?: boolean;
}

export function SchedulesList({
  schedules,
  selectedId,
  onSelect,
  onToggle,
  loading = false,
}: SchedulesListProps) {
  if (loading) {
    return (
      <div className="schedule-list">
        <div className="loading">
          <span className="spinner" style={{ marginRight: '10px' }} />
          Loading schedules...
        </div>
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <div className="schedule-list">
        <div className="empty-state" style={{ padding: '40px 20px' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12,6 12,12 16,14" />
          </svg>
          <p style={{ marginTop: '16px' }}>No schedules yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="schedule-list">
      {schedules.map(schedule => (
        <div
          key={schedule.id}
          className={`schedule-item${selectedId === schedule.id ? ' selected' : ''}`}
          onClick={() => onSelect(schedule.id)}
        >
          <div className="schedule-item-header">
            <span className="schedule-item-name">{schedule.name}</span>
            <button
              className={`schedule-toggle${schedule.enabled ? ' enabled' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(schedule.id, !schedule.enabled);
              }}
              title={schedule.enabled ? 'Disable' : 'Enable'}
            />
          </div>
          <div className="schedule-item-meta">
            <span className="schedule-item-cron">{cronToHuman(schedule.schedule)}</span>
            <span className={`schedule-type-badge ${schedule.type}`}>{schedule.type}</span>
          </div>
          {schedule.last_run && (
            <div className="schedule-item-lastrun">
              Last run: {formatRelativeTime(schedule.last_run)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

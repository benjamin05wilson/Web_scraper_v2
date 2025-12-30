
interface ProgressBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  label?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
  indeterminate?: boolean;
  size?: 'small' | 'medium' | 'large';
}

export function ProgressBar({
  value,
  max = 100,
  showLabel = true,
  label,
  variant = 'default',
  indeterminate = false,
  size = 'medium',
}: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  const heightMap = {
    small: 2,
    medium: 4,
    large: 8,
  };

  const colorMap = {
    default: 'var(--text-primary)',
    success: 'var(--accent-success)',
    warning: 'var(--accent-warning)',
    error: 'var(--accent-danger)',
  };

  return (
    <div>
      <div
        className="progress-container"
        style={{ height: heightMap[size], margin: '10px 0' }}
      >
        <div
          className={`progress-bar${indeterminate ? ' indeterminate' : ''}`}
          style={{
            width: indeterminate ? undefined : `${percentage}%`,
            background: colorMap[variant],
          }}
        />
      </div>
      {showLabel && (
        <div className="progress-text">
          <span>{label || `${Math.round(percentage)}%`}</span>
          <span>{value} / {max}</span>
        </div>
      )}
    </div>
  );
}

interface ProgressStatsProps {
  completed: number;
  total: number;
  errors?: number;
  label?: string;
}

export function ProgressStats({
  completed,
  total,
  errors = 0,
  label = 'Progress',
}: ProgressStatsProps) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  const hasErrors = errors > 0;

  return (
    <div className="progress-tracker">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span className="stat-label">{label}</span>
        <span style={{ fontWeight: 600 }}>
          {completed}/{total}
          {hasErrors && (
            <span style={{ color: 'var(--accent-danger)', marginLeft: '10px' }}>
              ({errors} errors)
            </span>
          )}
        </span>
      </div>
      <ProgressBar
        value={completed}
        max={total}
        showLabel={false}
        variant={hasErrors ? 'warning' : percentage === 100 ? 'success' : 'default'}
      />
    </div>
  );
}


type StatusType = 'idle' | 'active' | 'success' | 'loading' | 'warning' | 'error' | 'running' | 'danger';

interface StatusIndicatorProps {
  status: StatusType;
  label?: string;
  size?: 'small' | 'medium' | 'large';
  showPulse?: boolean;
}

export function StatusIndicator({
  status,
  label,
  size = 'medium',
  showPulse = true,
}: StatusIndicatorProps) {
  const sizeMap = {
    small: 8,
    medium: 12,
    large: 16,
  };

  const dotSize = sizeMap[size];

  const shouldPulse = showPulse && (status === 'loading' || status === 'running' || status === 'warning');

  return (
    <div className="status-strip" style={{ padding: '10px 15px', display: 'inline-flex' }}>
      <span
        className={`status-indicator ${status}${shouldPulse ? '' : ''}`}
        style={{
          width: dotSize,
          height: dotSize,
          animation: shouldPulse ? 'pulse 1.5s infinite' : undefined,
        }}
      />
      {label && <span className="status-label">{label}</span>}
    </div>
  );
}

interface StatusBadgeProps {
  status: 'success' | 'error' | 'warning' | 'info' | 'pending';
  text: string;
}

export function StatusBadge({ status, text }: StatusBadgeProps) {
  const classMap = {
    success: 'status-success',
    error: 'status-error',
    warning: '',
    info: '',
    pending: '',
  };

  return (
    <span className={`status-badge ${classMap[status]}`}>
      {text}
    </span>
  );
}

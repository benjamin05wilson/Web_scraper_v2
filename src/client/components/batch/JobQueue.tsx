import type { BatchJob, BatchProgress } from '../../../shared/types';

interface JobQueueProps {
  jobs: BatchJob[];
  progress: BatchProgress;
  isRunning: boolean;
  isPaused: boolean;
  missingConfigsCount: number;
  onStart: () => void;
  onPauseResume: () => void;
  onStop: () => void;
  onDownloadResults: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--text-secondary)',
  running: 'var(--accent-warning)',
  completed: 'var(--accent-success)',
  error: 'var(--accent-danger)',
  skipped: 'var(--accent-warning)',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Done',
  error: 'Error',
  skipped: 'Skipped',
};

export function JobQueue({
  jobs,
  progress,
  isRunning,
  isPaused,
  missingConfigsCount,
  onStart,
  onPauseResume,
  onStop,
  onDownloadResults,
}: JobQueueProps) {
  const completedPercent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const hasResults = progress.completed > 0;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.25em', margin: 0 }}>4. Processing Queue</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9em', marginRight: '15px' }}>
            {progress.completed} / {progress.total} completed
          </span>

          {!isRunning && (
            <>
              {missingConfigsCount > 0 && (
                <span style={{ color: 'var(--accent-warning)', fontSize: '0.85em' }}>
                  {missingConfigsCount} will be skipped
                </span>
              )}
              <button
                className="btn"
                onClick={onStart}
                style={{
                  background: 'var(--accent-success)',
                  borderColor: 'var(--accent-success)',
                  minWidth: '120px',
                }}
                disabled={jobs.length === 0}
              >
                Start Batch
              </button>
            </>
          )}

          {isRunning && (
            <>
              <button
                className="btn"
                onClick={onPauseResume}
                style={{
                  background: 'var(--accent-warning)',
                  borderColor: 'var(--accent-warning)',
                  minWidth: '120px',
                }}
              >
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                className="btn"
                onClick={onStop}
                style={{
                  background: 'var(--accent-danger)',
                  borderColor: 'var(--accent-danger)',
                  minWidth: '120px',
                }}
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      {/* Overall Progress Bar */}
      <div style={{ marginBottom: '25px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span
            style={{
              fontSize: '0.75em',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              color: 'var(--text-secondary)',
            }}
          >
            Overall Progress
          </span>
          <span style={{ fontSize: '0.9em', fontWeight: 600 }}>{completedPercent}%</span>
        </div>
        <div
          style={{
            height: '4px',
            background: 'var(--bg-secondary)',
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${completedPercent}%`,
              background: 'var(--accent-primary)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '10px',
            fontSize: '0.75em',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}
        >
          <span>{progress.completed} completed</span>
          <span style={{ color: 'var(--accent-warning)' }}>{progress.skipped} skipped</span>
          <span style={{ color: 'var(--accent-danger)' }}>{progress.errors} errors</span>
          <span>{progress.pending} remaining</span>
        </div>
      </div>

      {/* Job Table */}
      <div className="table-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
        <table className="reports-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Country</th>
              <th>Domain</th>
              <th>Category</th>
              <th>Source URL</th>
              <th>Progress</th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.index}>
                <td>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: STATUS_COLORS[job.status],
                      marginRight: '8px',
                    }}
                  />
                  {STATUS_LABELS[job.status]}
                  {job.retryCount ? ` (R${job.retryCount})` : ''}
                </td>
                <td>{job.country}</td>
                <td>{job.domain}</td>
                <td style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.category}
                </td>
                <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.sourceUrl}
                </td>
                <td>
                  {job.status === 'running' && (
                    <div
                      style={{
                        width: '60px',
                        height: '4px',
                        background: 'var(--bg-secondary)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${job.progress || 0}%`,
                          background: 'var(--accent-warning)',
                        }}
                      />
                    </div>
                  )}
                  {job.status === 'completed' && '100%'}
                  {job.status === 'error' && '-'}
                  {job.status === 'skipped' && '-'}
                  {job.status === 'pending' && '-'}
                </td>
                <td>{job.itemCount !== undefined ? job.itemCount : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Download Results */}
      <div style={{ marginTop: '25px', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn secondary"
          onClick={onDownloadResults}
          disabled={!hasResults}
          style={{ minWidth: '150px' }}
        >
          Download Results
        </button>
      </div>
    </div>
  );
}

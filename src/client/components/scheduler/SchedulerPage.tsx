import React, { useState, useMemo } from 'react';
import { useSchedules } from '../../hooks/useSchedules';
import { SchedulesList } from './SchedulesList';
import { ScheduleDetails } from './ScheduleDetails';
import { CreateScheduleModal } from './CreateScheduleModal';
import { ConfirmModal } from '../common/Modal';
import type { Schedule } from '../../../shared/types';

export function SchedulerPage() {
  const {
    schedules,
    selectedSchedule,
    loading,
    error,
    loadSchedules,
    selectSchedule,
    createSchedule,
    toggleSchedule,
    runNow,
    deleteSchedule,
    searchSchedules,
  } = useSchedules();

  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);

  const filteredSchedules = useMemo(() => {
    if (!searchQuery) return schedules;
    return searchSchedules(searchQuery);
  }, [schedules, searchQuery, searchSchedules]);

  const handleRefresh = () => {
    loadSchedules(true);
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    await toggleSchedule(id, enabled);
  };

  const handleRunNow = async () => {
    if (!selectedSchedule) return;
    setRunningId(selectedSchedule.id);
    try {
      await runNow(selectedSchedule.id);
    } finally {
      setRunningId(null);
    }
  };

  const handleCreateSchedule = async (data: Omit<Schedule, 'id' | 'created_at' | 'last_run'>) => {
    await createSchedule(data);
    setIsCreateModalOpen(false);
  };

  const handleDelete = async () => {
    if (!selectedSchedule) return;
    setDeleteLoading(true);
    try {
      await deleteSchedule(selectedSchedule.id);
      setIsDeleteModalOpen(false);
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <>
      {/* Hero Header */}
      <div className="hero">
        <span className="hero-badge">Task Scheduler</span>
        <h1>Scheduled Jobs</h1>
        <p className="hero-subtitle">
          Automate your scraping tasks with cron-based scheduling
        </p>
      </div>

      {/* Main Grid */}
      <div className="scheduler-grid">
        {/* Status Bar */}
        <div className="configs-status-bar" style={{ gridColumn: '1 / -1' }}>
          <div className="storage-indicator">
            <span className="storage-badge bigquery">Scheduler Active</span>
            <span style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
              {schedules.length} schedule{schedules.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn-refresh btn secondary" onClick={handleRefresh} disabled={loading}>
              {loading ? <span className="spinner" /> : '↻ Refresh'}
            </button>
            <button className="btn" onClick={() => setIsCreateModalOpen(true)}>
              New Schedule
            </button>
          </div>
        </div>

        {/* Left Panel - Schedule List */}
        <div className="scheduler-list-panel">
          <div className="config-search-container">
            <input
              type="text"
              className="config-search form-input"
              placeholder="Search schedules..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <SchedulesList
            schedules={filteredSchedules}
            selectedId={selectedSchedule?.id || null}
            onSelect={selectSchedule}
            onToggle={handleToggle}
            loading={loading}
          />
        </div>

        {/* Right Panel - Schedule Details */}
        <div className="scheduler-detail-panel">
          {selectedSchedule ? (
            <ScheduleDetails
              schedule={selectedSchedule}
              onRunNow={handleRunNow}
              onDelete={() => setIsDeleteModalOpen(true)}
            />
          ) : (
            <div className="empty-state">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12,6 12,12 16,14" />
              </svg>
              <h3 className="empty-state-title">No Schedule Selected</h3>
              <p className="empty-state-description">
                Select a schedule from the list or create a new one
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      <CreateScheduleModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSave={handleCreateSchedule}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Schedule"
        message={`Are you sure you want to delete "${selectedSchedule?.name}"? This action cannot be undone.`}
        confirmText="Delete Schedule"
        variant="danger"
        loading={deleteLoading}
      />
    </>
  );
}

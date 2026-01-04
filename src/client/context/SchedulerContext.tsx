import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Schedule, CreateScheduleData } from '../../shared/types';

interface SchedulerContextValue {
  schedules: Schedule[];
  selectedSchedule: Schedule | null;
  loading: boolean;
  error: string | null;
  loadSchedules: () => Promise<void>;
  createSchedule: (data: CreateScheduleData) => Promise<void>;
  updateSchedule: (id: number, updates: Partial<Schedule>) => Promise<void>;
  toggleSchedule: (id: number, enabled: boolean) => Promise<void>;
  runNow: (id: number) => Promise<void>;
  deleteSchedule: (id: number) => Promise<void>;
  selectSchedule: (id: number | null) => void;
  searchSchedules: (query: string) => Schedule[];
}

const SchedulerContext = createContext<SchedulerContextValue | null>(null);

// Use relative URLs - works in both dev (via proxy) and production
const API_BASE = '';

interface SchedulerProviderProps {
  children: ReactNode;
}

export function SchedulerProvider({ children }: SchedulerProviderProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/schedules`);
      if (!response.ok) {
        throw new Error(`Failed to load schedules: ${response.statusText}`);
      }
      const data = await response.json();
      setSchedules(data.schedules || data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load schedules';
      setError(message);
      console.error('Failed to load schedules:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSchedule = useCallback(async (data: CreateScheduleData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`Failed to create schedule: ${response.statusText}`);
      }

      const newSchedule = await response.json();
      setSchedules(prev => [...prev, newSchedule]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create schedule';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSchedule = useCallback(async (id: number, updates: Partial<Schedule>) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to update schedule: ${response.statusText}`);
      }

      setSchedules(prev => prev.map(s =>
        s.id === id ? { ...s, ...updates } : s
      ));

      if (selectedSchedule?.id === id) {
        setSelectedSchedule(prev => prev ? { ...prev, ...updates } : null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update schedule';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [selectedSchedule]);

  const toggleSchedule = useCallback(async (id: number, enabled: boolean) => {
    try {
      const response = await fetch(`${API_BASE}/schedules/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });

      if (!response.ok) {
        throw new Error(`Failed to toggle schedule: ${response.statusText}`);
      }

      setSchedules(prev => prev.map(s =>
        s.id === id ? { ...s, enabled } : s
      ));

      if (selectedSchedule?.id === id) {
        setSelectedSchedule(prev => prev ? { ...prev, enabled } : null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle schedule';
      setError(message);
      throw err;
    }
  }, [selectedSchedule]);

  const runNow = useCallback(async (id: number) => {
    try {
      const response = await fetch(`${API_BASE}/schedules/${id}/run`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to run schedule: ${response.statusText}`);
      }

      // Update last_run
      const now = new Date().toISOString();
      setSchedules(prev => prev.map(s =>
        s.id === id ? { ...s, last_run: now } : s
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to run schedule';
      setError(message);
      throw err;
    }
  }, []);

  const deleteSchedule = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/schedules/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete schedule: ${response.statusText}`);
      }

      setSchedules(prev => prev.filter(s => s.id !== id));

      if (selectedSchedule?.id === id) {
        setSelectedSchedule(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete schedule';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [selectedSchedule]);

  const selectSchedule = useCallback((id: number | null) => {
    if (id === null) {
      setSelectedSchedule(null);
      return;
    }
    const schedule = schedules.find(s => s.id === id);
    setSelectedSchedule(schedule || null);
  }, [schedules]);

  const searchSchedules = useCallback((query: string): Schedule[] => {
    if (!query) return schedules;
    const lowerQuery = query.toLowerCase();
    return schedules.filter(s =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.schedule.includes(lowerQuery)
    );
  }, [schedules]);

  const value: SchedulerContextValue = {
    schedules,
    selectedSchedule,
    loading,
    error,
    loadSchedules,
    createSchedule,
    updateSchedule,
    toggleSchedule,
    runNow,
    deleteSchedule,
    selectSchedule,
    searchSchedules,
  };

  return (
    <SchedulerContext.Provider value={value}>
      {children}
    </SchedulerContext.Provider>
  );
}

export function useSchedulerContext(): SchedulerContextValue {
  const context = useContext(SchedulerContext);
  if (!context) {
    throw new Error('useSchedulerContext must be used within a SchedulerProvider');
  }
  return context;
}

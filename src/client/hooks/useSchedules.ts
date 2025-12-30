import { useEffect } from 'react';
import { useSchedulerContext } from '../context/SchedulerContext';

export function useSchedules(autoLoad = true) {
  const context = useSchedulerContext();

  useEffect(() => {
    if (autoLoad) {
      context.loadSchedules();
    }
  }, [autoLoad, context.loadSchedules]);

  return context;
}

export function useSelectedSchedule() {
  const {
    selectedSchedule,
    selectSchedule,
    updateSchedule,
    toggleSchedule,
    runNow,
    deleteSchedule,
  } = useSchedulerContext();

  return {
    schedule: selectedSchedule,
    select: selectSchedule,
    update: updateSchedule,
    toggle: toggleSchedule,
    run: runNow,
    remove: deleteSchedule,
  };
}

import { useEffect } from 'react';
import { useConfigsContext } from '../context/ConfigsContext';

export function useConfigs(autoLoad = true) {
  const context = useConfigsContext();

  useEffect(() => {
    if (autoLoad) {
      context.loadConfigs();
    }
  }, [autoLoad, context.loadConfigs]);

  return context;
}

export function useSelectedConfig() {
  const { selectedConfig, selectConfig, updateConfig, deleteConfig } = useConfigsContext();

  return {
    config: selectedConfig,
    select: selectConfig,
    update: updateConfig,
    remove: deleteConfig,
  };
}

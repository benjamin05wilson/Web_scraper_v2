import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Config } from '../../shared/types';

interface ConfigsContextValue {
  configs: Config[];
  selectedConfig: Config | null;
  loading: boolean;
  error: string | null;
  loadConfigs: (forceRefresh?: boolean) => Promise<void>;
  getConfig: (name: string) => Promise<Config | null>;
  updateConfig: (name: string, updates: Partial<Config>) => Promise<void>;
  deleteConfig: (name: string) => Promise<void>;
  selectConfig: (name: string | null) => void;
  searchConfigs: (query: string) => Config[];
}

const ConfigsContext = createContext<ConfigsContextValue | null>(null);

const API_BASE = 'http://localhost:3002';
const CACHE_TTL = 5000; // 5 seconds

interface ConfigsProviderProps {
  children: ReactNode;
}

export function ConfigsProvider({ children }: ConfigsProviderProps) {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const loadConfigs = useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && configs.length > 0 && now - lastFetch < CACHE_TTL) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/configs`);
      if (!response.ok) {
        throw new Error(`Failed to load configs: ${response.statusText}`);
      }
      const data = await response.json();
      setConfigs(data.configs || data || []);
      setLastFetch(now);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load configs';
      setError(message);
      console.error('Failed to load configs:', err);
    } finally {
      setLoading(false);
    }
  }, [configs.length, lastFetch]);

  const getConfig = useCallback(async (name: string): Promise<Config | null> => {
    // First check local cache
    const cached = configs.find(c => c.name === name);
    if (cached) return cached;

    try {
      const response = await fetch(`${API_BASE}/api/configs/${encodeURIComponent(name)}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to get config: ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      console.error(`Failed to get config ${name}:`, err);
      return null;
    }
  }, [configs]);

  const updateConfig = useCallback(async (name: string, updates: Partial<Config>) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/configs/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to update config: ${response.statusText}`);
      }

      // Update local state
      setConfigs(prev => prev.map(c =>
        c.name === name ? { ...c, ...updates, updated_at: new Date().toISOString() } : c
      ));

      // Update selected if it's the one being edited
      if (selectedConfig?.name === name) {
        setSelectedConfig(prev => prev ? { ...prev, ...updates } : null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update config';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [selectedConfig]);

  const deleteConfig = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/configs/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete config: ${response.statusText}`);
      }

      // Update local state
      setConfigs(prev => prev.filter(c => c.name !== name));

      // Clear selection if deleted config was selected
      if (selectedConfig?.name === name) {
        setSelectedConfig(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete config';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [selectedConfig]);

  const selectConfig = useCallback((name: string | null) => {
    if (!name) {
      setSelectedConfig(null);
      return;
    }
    const config = configs.find(c => c.name === name);
    setSelectedConfig(config || null);
  }, [configs]);

  const searchConfigs = useCallback((query: string): Config[] => {
    if (!query) return configs;
    const lowerQuery = query.toLowerCase();
    return configs.filter(c =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.url?.toLowerCase().includes(lowerQuery)
    );
  }, [configs]);

  const value: ConfigsContextValue = {
    configs,
    selectedConfig,
    loading,
    error,
    loadConfigs,
    getConfig,
    updateConfig,
    deleteConfig,
    selectConfig,
    searchConfigs,
  };

  return (
    <ConfigsContext.Provider value={value}>
      {children}
    </ConfigsContext.Provider>
  );
}

export function useConfigsContext(): ConfigsContextValue {
  const context = useContext(ConfigsContext);
  if (!context) {
    throw new Error('useConfigsContext must be used within a ConfigsProvider');
  }
  return context;
}

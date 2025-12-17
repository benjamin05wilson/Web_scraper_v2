// ============================================================================
// SCRAPER CONTEXT - Saved scrapers and results management
// ============================================================================

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { SavedScraper, SavedScrapeResult, ScraperConfig, ScrapeResult } from '../../shared/types';

// Activity types for timeline
export type ActivityType = 'scrape' | 'create' | 'export' | 'delete';

export interface Activity {
  id: string;
  type: ActivityType;
  message: string;
  timestamp: number;
}

interface ScraperContextValue {
  // Saved scrapers
  savedScrapers: SavedScraper[];
  saveScraper: (name: string, config: ScraperConfig, isTemplate?: boolean) => SavedScraper;
  updateScraper: (id: string, updates: Partial<Omit<SavedScraper, 'id' | 'createdAt'>>) => void;
  deleteScraper: (id: string) => void;
  getScraperById: (id: string) => SavedScraper | undefined;
  duplicateScraper: (id: string) => SavedScraper | null;
  saveAsTemplate: (id: string) => void;
  useTemplate: (id: string) => SavedScraper | null;

  // Templates (scrapers with isTemplate: true)
  templates: SavedScraper[];

  // Scrape results
  savedResults: SavedScrapeResult[];
  saveResult: (scraperId: string, scraperName: string, url: string, result: ScrapeResult) => SavedScrapeResult;
  deleteResult: (id: string) => void;
  deleteResults: (ids: string[]) => void;
  getResultById: (id: string) => SavedScrapeResult | undefined;
  getResultsByScraperId: (scraperId: string) => SavedScrapeResult[];
  clearAllResults: () => void;

  // Activity timeline
  activities: Activity[];
  addActivity: (type: ActivityType, message: string) => void;

  // Backup/restore
  exportBackup: () => string;
  importBackup: (data: string) => boolean;
  clearAllData: () => void;

  // Stats
  totalScrapedItems: number;
  lastRunDate: Date | null;
}

const ScraperContext = createContext<ScraperContextValue | null>(null);

const SCRAPERS_KEY = 'web-scraper-scrapers';
const RESULTS_KEY = 'web-scraper-results';
const ACTIVITIES_KEY = 'web-scraper-activities';

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const ScraperProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [savedScrapers, setSavedScrapers] = useState<SavedScraper[]>([]);
  const [savedResults, setSavedResults] = useState<SavedScrapeResult[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const storedScrapers = localStorage.getItem(SCRAPERS_KEY);
      if (storedScrapers) {
        const data = JSON.parse(storedScrapers);
        setSavedScrapers(data.items || []);
      }

      const storedResults = localStorage.getItem(RESULTS_KEY);
      if (storedResults) {
        const data = JSON.parse(storedResults);
        setSavedResults(data.items || []);
      }

      const storedActivities = localStorage.getItem(ACTIVITIES_KEY);
      if (storedActivities) {
        const data = JSON.parse(storedActivities);
        setActivities(data.items || []);
      }
    } catch (e) {
      console.error('[ScraperContext] Failed to load from storage:', e);
    }
  }, []);

  // Persist scrapers to localStorage
  const persistScrapers = useCallback((scrapers: SavedScraper[]) => {
    try {
      localStorage.setItem(SCRAPERS_KEY, JSON.stringify({ version: 1, items: scrapers }));
    } catch (e) {
      console.error('[ScraperContext] Failed to save scrapers:', e);
    }
  }, []);

  // Persist results to localStorage
  const persistResults = useCallback((results: SavedScrapeResult[]) => {
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify({ version: 1, items: results }));
    } catch (e) {
      console.error('[ScraperContext] Failed to save results:', e);
    }
  }, []);

  // Persist activities to localStorage
  const persistActivities = useCallback((acts: Activity[]) => {
    try {
      // Only keep last 50 activities
      const trimmed = acts.slice(-50);
      localStorage.setItem(ACTIVITIES_KEY, JSON.stringify({ version: 1, items: trimmed }));
    } catch (e) {
      console.error('[ScraperContext] Failed to save activities:', e);
    }
  }, []);

  // Add activity
  const addActivity = useCallback((type: ActivityType, message: string) => {
    const activity: Activity = {
      id: generateId(),
      type,
      message,
      timestamp: Date.now(),
    };
    setActivities(prev => {
      const updated = [...prev, activity];
      persistActivities(updated);
      return updated;
    });
  }, [persistActivities]);

  // Scraper CRUD operations
  const saveScraper = useCallback((name: string, config: ScraperConfig, isTemplate: boolean = false): SavedScraper => {
    const newScraper: SavedScraper = {
      id: generateId(),
      name,
      config,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isTemplate,
    };
    setSavedScrapers(prev => {
      const updated = [...prev, newScraper];
      persistScrapers(updated);
      return updated;
    });
    addActivity('create', `Created ${isTemplate ? 'template' : 'scraper'} "${name}"`);
    return newScraper;
  }, [persistScrapers, addActivity]);

  const updateScraper = useCallback((id: string, updates: Partial<Omit<SavedScraper, 'id' | 'createdAt'>>) => {
    setSavedScrapers(prev => {
      const updated = prev.map(s =>
        s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s
      );
      persistScrapers(updated);
      return updated;
    });
  }, [persistScrapers]);

  const deleteScraper = useCallback((id: string) => {
    const scraper = savedScrapers.find(s => s.id === id);
    setSavedScrapers(prev => {
      const updated = prev.filter(s => s.id !== id);
      persistScrapers(updated);
      return updated;
    });
    if (scraper) {
      addActivity('delete', `Deleted scraper "${scraper.name}"`);
    }
  }, [persistScrapers, savedScrapers, addActivity]);

  const getScraperById = useCallback((id: string) => {
    return savedScrapers.find(s => s.id === id);
  }, [savedScrapers]);

  // Duplicate a scraper
  const duplicateScraper = useCallback((id: string): SavedScraper | null => {
    const original = savedScrapers.find(s => s.id === id);
    if (!original) return null;

    const newScraper: SavedScraper = {
      id: generateId(),
      name: `${original.name} (Copy)`,
      config: JSON.parse(JSON.stringify(original.config)), // Deep clone
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isTemplate: false,
    };
    setSavedScrapers(prev => {
      const updated = [...prev, newScraper];
      persistScrapers(updated);
      return updated;
    });
    addActivity('create', `Duplicated scraper "${original.name}"`);
    return newScraper;
  }, [savedScrapers, persistScrapers, addActivity]);

  // Save existing scraper as template
  const saveAsTemplate = useCallback((id: string) => {
    const scraper = savedScrapers.find(s => s.id === id);
    if (!scraper) return;

    const template: SavedScraper = {
      id: generateId(),
      name: `${scraper.name} Template`,
      config: JSON.parse(JSON.stringify(scraper.config)),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isTemplate: true,
    };
    setSavedScrapers(prev => {
      const updated = [...prev, template];
      persistScrapers(updated);
      return updated;
    });
    addActivity('create', `Created template from "${scraper.name}"`);
  }, [savedScrapers, persistScrapers, addActivity]);

  // Create a new scraper from a template
  const useTemplate = useCallback((id: string): SavedScraper | null => {
    const template = savedScrapers.find(s => s.id === id && s.isTemplate);
    if (!template) return null;

    const newScraper: SavedScraper = {
      id: generateId(),
      name: template.name.replace(' Template', ''),
      config: JSON.parse(JSON.stringify(template.config)),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isTemplate: false,
    };
    setSavedScrapers(prev => {
      const updated = [...prev, newScraper];
      persistScrapers(updated);
      return updated;
    });
    addActivity('create', `Created scraper from template "${template.name}"`);
    return newScraper;
  }, [savedScrapers, persistScrapers, addActivity]);

  // Results CRUD operations
  const saveResult = useCallback((
    scraperId: string,
    scraperName: string,
    url: string,
    result: ScrapeResult
  ): SavedScrapeResult => {
    const newResult: SavedScrapeResult = {
      id: generateId(),
      scraperId,
      scraperName,
      url,
      result,
      createdAt: Date.now(),
    };
    setSavedResults(prev => {
      const updated = [...prev, newResult];
      persistResults(updated);
      return updated;
    });

    // Update scraper's lastRunAt
    updateScraper(scraperId, { lastRunAt: Date.now() });
    addActivity('scrape', `Scraped "${scraperName}" - ${result.items.length} items`);

    return newResult;
  }, [persistResults, updateScraper, addActivity]);

  const deleteResult = useCallback((id: string) => {
    setSavedResults(prev => {
      const updated = prev.filter(r => r.id !== id);
      persistResults(updated);
      return updated;
    });
  }, [persistResults]);

  // Delete multiple results at once
  const deleteResults = useCallback((ids: string[]) => {
    setSavedResults(prev => {
      const updated = prev.filter(r => !ids.includes(r.id));
      persistResults(updated);
      return updated;
    });
    addActivity('delete', `Deleted ${ids.length} result${ids.length > 1 ? 's' : ''}`);
  }, [persistResults, addActivity]);

  const getResultById = useCallback((id: string) => {
    return savedResults.find(r => r.id === id);
  }, [savedResults]);

  const getResultsByScraperId = useCallback((scraperId: string) => {
    return savedResults.filter(r => r.scraperId === scraperId);
  }, [savedResults]);

  const clearAllResults = useCallback(() => {
    setSavedResults([]);
    persistResults([]);
    addActivity('delete', 'Cleared all results');
  }, [persistResults, addActivity]);

  // Backup and restore
  const exportBackup = useCallback((): string => {
    const backup = {
      version: 1,
      exportedAt: Date.now(),
      scrapers: savedScrapers,
      results: savedResults,
      activities,
    };
    addActivity('export', 'Exported data backup');
    return JSON.stringify(backup, null, 2);
  }, [savedScrapers, savedResults, activities, addActivity]);

  const importBackup = useCallback((data: string): boolean => {
    try {
      const backup = JSON.parse(data);
      if (!backup.version || !backup.scrapers || !backup.results) {
        return false;
      }
      setSavedScrapers(backup.scrapers);
      setSavedResults(backup.results);
      if (backup.activities) {
        setActivities(backup.activities);
        persistActivities(backup.activities);
      }
      persistScrapers(backup.scrapers);
      persistResults(backup.results);
      addActivity('create', 'Imported data backup');
      return true;
    } catch {
      return false;
    }
  }, [persistScrapers, persistResults, persistActivities, addActivity]);

  const clearAllData = useCallback(() => {
    setSavedScrapers([]);
    setSavedResults([]);
    setActivities([]);
    localStorage.removeItem(SCRAPERS_KEY);
    localStorage.removeItem(RESULTS_KEY);
    localStorage.removeItem(ACTIVITIES_KEY);
  }, []);

  // Computed stats
  const totalScrapedItems = savedResults.reduce((sum, r) => sum + r.result.items.length, 0);
  const lastRunDate = savedResults.length > 0
    ? new Date(Math.max(...savedResults.map(r => r.createdAt)))
    : null;

  // Filter templates from scrapers
  const templates = savedScrapers.filter(s => s.isTemplate);
  const regularScrapers = savedScrapers.filter(s => !s.isTemplate);

  return (
    <ScraperContext.Provider
      value={{
        savedScrapers: regularScrapers,
        saveScraper,
        updateScraper,
        deleteScraper,
        getScraperById,
        duplicateScraper,
        saveAsTemplate,
        useTemplate,
        templates,
        savedResults,
        saveResult,
        deleteResult,
        deleteResults,
        getResultById,
        getResultsByScraperId,
        clearAllResults,
        activities,
        addActivity,
        exportBackup,
        importBackup,
        clearAllData,
        totalScrapedItems,
        lastRunDate,
      }}
    >
      {children}
    </ScraperContext.Provider>
  );
};

export const useScraperContext = (): ScraperContextValue => {
  const context = useContext(ScraperContext);
  if (!context) {
    throw new Error('useScraperContext must be used within a ScraperProvider');
  }
  return context;
};

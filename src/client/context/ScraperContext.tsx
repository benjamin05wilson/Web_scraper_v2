// ============================================================================
// SCRAPER CONTEXT - Saved scrapers and results management
// ============================================================================

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { SavedScraper, SavedScrapeResult, ScraperConfig, ScrapeResult } from '../../shared/types';

interface ScraperContextValue {
  // Saved scrapers
  savedScrapers: SavedScraper[];
  saveScraper: (name: string, config: ScraperConfig) => SavedScraper;
  updateScraper: (id: string, updates: Partial<Omit<SavedScraper, 'id' | 'createdAt'>>) => void;
  deleteScraper: (id: string) => void;
  getScraperById: (id: string) => SavedScraper | undefined;

  // Scrape results
  savedResults: SavedScrapeResult[];
  saveResult: (scraperId: string, scraperName: string, url: string, result: ScrapeResult) => SavedScrapeResult;
  deleteResult: (id: string) => void;
  getResultById: (id: string) => SavedScrapeResult | undefined;
  getResultsByScraperId: (scraperId: string) => SavedScrapeResult[];
  clearAllResults: () => void;

  // Stats
  totalScrapedItems: number;
  lastRunDate: Date | null;
}

const ScraperContext = createContext<ScraperContextValue | null>(null);

const SCRAPERS_KEY = 'web-scraper-scrapers';
const RESULTS_KEY = 'web-scraper-results';

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const ScraperProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [savedScrapers, setSavedScrapers] = useState<SavedScraper[]>([]);
  const [savedResults, setSavedResults] = useState<SavedScrapeResult[]>([]);

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

  // Scraper CRUD operations
  const saveScraper = useCallback((name: string, config: ScraperConfig): SavedScraper => {
    const newScraper: SavedScraper = {
      id: generateId(),
      name,
      config,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSavedScrapers(prev => {
      const updated = [...prev, newScraper];
      persistScrapers(updated);
      return updated;
    });
    return newScraper;
  }, [persistScrapers]);

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
    setSavedScrapers(prev => {
      const updated = prev.filter(s => s.id !== id);
      persistScrapers(updated);
      return updated;
    });
  }, [persistScrapers]);

  const getScraperById = useCallback((id: string) => {
    return savedScrapers.find(s => s.id === id);
  }, [savedScrapers]);

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

    return newResult;
  }, [persistResults, updateScraper]);

  const deleteResult = useCallback((id: string) => {
    setSavedResults(prev => {
      const updated = prev.filter(r => r.id !== id);
      persistResults(updated);
      return updated;
    });
  }, [persistResults]);

  const getResultById = useCallback((id: string) => {
    return savedResults.find(r => r.id === id);
  }, [savedResults]);

  const getResultsByScraperId = useCallback((scraperId: string) => {
    return savedResults.filter(r => r.scraperId === scraperId);
  }, [savedResults]);

  const clearAllResults = useCallback(() => {
    setSavedResults([]);
    persistResults([]);
  }, [persistResults]);

  // Computed stats
  const totalScrapedItems = savedResults.reduce((sum, r) => sum + r.result.items.length, 0);
  const lastRunDate = savedResults.length > 0
    ? new Date(Math.max(...savedResults.map(r => r.createdAt)))
    : null;

  return (
    <ScraperContext.Provider
      value={{
        savedScrapers,
        saveScraper,
        updateScraper,
        deleteScraper,
        getScraperById,
        savedResults,
        saveResult,
        deleteResult,
        getResultById,
        getResultsByScraperId,
        clearAllResults,
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

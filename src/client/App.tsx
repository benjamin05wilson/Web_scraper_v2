// ============================================================================
// APP - Router and provider wrapper
// ============================================================================

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ScraperProvider } from './context/ScraperContext';
import { MainLayout } from './layouts/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { ScraperBuilder } from './pages/ScraperBuilder';
import { ResultsViewer, ResultDetail } from './pages/ResultsViewer';
import { Settings } from './pages/Settings';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ScraperProvider>
          <Routes>
            <Route element={<MainLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/scraper" element={<ScraperBuilder />} />
              <Route path="/scraper/:id" element={<ScraperBuilder />} />
              <Route path="/results" element={<ResultsViewer />} />
              <Route path="/results/:id" element={<ResultDetail />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </ScraperProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
};

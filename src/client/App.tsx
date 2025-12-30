// ============================================================================
// APP - Router and provider wrapper
// ============================================================================

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { ConfigsProvider } from './context/ConfigsContext';
import { SchedulerProvider } from './context/SchedulerContext';
import { ReportsProvider } from './context/ReportsContext';
import { BatchProvider } from './context/BatchContext';
import { MainLayout } from './layouts/MainLayout';
import { BuilderPage } from './components/builder';
import { ScraperPage } from './components/scraper';
import { BatchPage } from './components/batch';
import { ConfigsPage } from './components/configs';
import { ReportsPage } from './components/reports';
import { SchedulerPage } from './components/scheduler';
import { ToastContainer } from './components/common';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <ConfigsProvider>
            <SchedulerProvider>
              <ReportsProvider>
                <BatchProvider>
                  <Routes>
                    <Route element={<MainLayout />}>
                      <Route path="/" element={<Navigate to="/builder" replace />} />
                      <Route path="/builder" element={<BuilderPage />} />
                      <Route path="/scraper" element={<ScraperPage />} />
                      <Route path="/batch" element={<BatchPage />} />
                      <Route path="/configs" element={<ConfigsPage />} />
                      <Route path="/reports" element={<ReportsPage />} />
                      <Route path="/scheduler" element={<SchedulerPage />} />
                    </Route>
                  </Routes>
                  <ToastContainer />
                </BatchProvider>
              </ReportsProvider>
            </SchedulerProvider>
          </ConfigsProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
};

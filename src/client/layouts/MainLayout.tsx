// ============================================================================
// MAIN LAYOUT - App shell with navigation
// ============================================================================

import React from 'react';
import { Outlet } from 'react-router-dom';
import { AppNavigation } from '../components/common/AppNavigation';

export const MainLayout: React.FC = () => {
  return (
    <div className="app-container" style={{ flexDirection: 'column' }}>
      <AppNavigation />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Outlet />
      </div>
    </div>
  );
};

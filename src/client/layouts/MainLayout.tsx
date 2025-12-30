// ============================================================================
// MAIN LAYOUT - App shell with navigation
// ============================================================================

import React from 'react';
import { Outlet } from 'react-router-dom';
import { AppNavigation } from '../components/common/AppNavigation';

export const MainLayout: React.FC = () => {
  return (
    <>
      <AppNavigation />
      <main>
        <Outlet />
      </main>
    </>
  );
};

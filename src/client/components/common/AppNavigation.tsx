// ============================================================================
// APP NAVIGATION - Top navigation bar with route links
// ============================================================================

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';

export const AppNavigation: React.FC = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  return (
    <nav>
      <div className="nav-container">
        <Link to="/builder" className="nav-logo">
          Web Scraper
        </Link>

        <div className="nav-menu">
          <Link
            to="/builder"
            className={`nav-item ${isActive('/builder') ? 'active' : ''}`}
          >
            Builder
          </Link>

          <Link
            to="/scraper"
            className={`nav-item ${isActive('/scraper') ? 'active' : ''}`}
          >
            Scraper
          </Link>

          <Link
            to="/batch"
            className={`nav-item ${isActive('/batch') ? 'active' : ''}`}
          >
            Batch
          </Link>

          <Link
            to="/configs"
            className={`nav-item ${isActive('/configs') ? 'active' : ''}`}
          >
            Configs
          </Link>

          <Link
            to="/reports"
            className={`nav-item ${isActive('/reports') ? 'active' : ''}`}
          >
            Reports
          </Link>

          <Link
            to="/scheduler"
            className={`nav-item ${isActive('/scheduler') ? 'active' : ''}`}
          >
            Scheduler
          </Link>

          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
};

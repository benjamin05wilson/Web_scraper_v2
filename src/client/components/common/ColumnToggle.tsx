// ============================================================================
// COLUMN TOGGLE - Toggle column visibility dropdown
// ============================================================================

import React, { useState, useRef, useEffect } from 'react';

interface Column {
  key: string;
  label: string;
  visible: boolean;
}

interface ColumnToggleProps {
  columns: Column[];
  onToggle: (key: string) => void;
}

export const ColumnToggle: React.FC<ColumnToggleProps> = ({ columns, onToggle }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const visibleCount = columns.filter((c) => c.visible).length;

  return (
    <div className="column-toggle" ref={dropdownRef}>
      <button
        className="column-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        Columns ({visibleCount}/{columns.length})
        <span>{isOpen ? '\u25B2' : '\u25BC'}</span>
      </button>

      {isOpen && (
        <div className="column-toggle-dropdown">
          {columns.map((column) => (
            <label key={column.key} className="column-toggle-item">
              <input
                type="checkbox"
                checked={column.visible}
                onChange={() => onToggle(column.key)}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

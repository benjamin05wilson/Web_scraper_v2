import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Config } from '../../../shared/types';

interface ConfigSelectProps {
  configs: Config[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}

export function ConfigSelect({
  configs = [],
  value,
  onChange,
  placeholder = 'Select configuration...',
  disabled = false,
  loading = false,
}: ConfigSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  // Ensure configs is always an array
  const safeConfigs = configs || [];

  const filteredConfigs = searchQuery
    ? safeConfigs.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.url?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : safeConfigs;

  const selectedConfig = safeConfigs.find(c => c.name === value);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (configName: string) => {
    onChange(configName);
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev < filteredConfigs.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredConfigs[highlightedIndex]) {
          handleSelect(filteredConfigs[highlightedIndex].name);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSearchQuery('');
        break;
    }
  };

  useEffect(() => {
    if (highlightedIndex >= 0 && optionsRef.current) {
      const option = optionsRef.current.children[highlightedIndex] as HTMLElement;
      if (option) {
        option.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex]);

  return (
    <div
      ref={containerRef}
      className={`searchable-dropdown${isOpen ? ' open' : ''}`}
      onKeyDown={handleKeyDown}
    >
      <div
        className="searchable-dropdown-selected"
        onClick={() => !disabled && !loading && setIsOpen(!isOpen)}
        tabIndex={disabled || loading ? -1 : 0}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {loading ? (
          <span className="searchable-dropdown-placeholder">
            <span className="spinner" style={{ marginRight: '8px' }} />
            Loading configs...
          </span>
        ) : selectedConfig ? (
          <span>{selectedConfig.name}</span>
        ) : (
          <span className="searchable-dropdown-placeholder">{placeholder}</span>
        )}
        <span className="searchable-dropdown-arrow">▼</span>
      </div>

      {isOpen && (
        <div className="searchable-dropdown-menu">
          <input
            ref={searchInputRef}
            type="text"
            className="searchable-dropdown-search"
            placeholder="Search configurations..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setHighlightedIndex(-1);
            }}
          />
          <div ref={optionsRef} className="searchable-dropdown-options" role="listbox">
            {filteredConfigs.length === 0 ? (
              <div className="searchable-dropdown-option" style={{ color: 'var(--text-secondary)' }}>
                No configurations found
              </div>
            ) : (
              filteredConfigs.map((config, index) => (
                <div
                  key={config.name}
                  className={`searchable-dropdown-option${
                    config.name === value ? ' selected' : ''
                  }${index === highlightedIndex ? ' highlighted' : ''}`}
                  style={{
                    background: index === highlightedIndex ? 'var(--bg-hover)' : undefined,
                  }}
                  onClick={() => handleSelect(config.name)}
                  role="option"
                  aria-selected={config.name === value}
                >
                  <div className="config-card-title">{config.name}</div>
                  {config.url && (
                    <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {new URL(config.url).hostname}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

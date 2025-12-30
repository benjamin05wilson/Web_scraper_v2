import React, { useState, useRef, useEffect, useCallback } from 'react';
import { COUNTRIES, searchCountries } from '../../utils/countries';

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CountrySelect({
  value,
  onChange,
  placeholder = 'Select country...',
  disabled = false,
}: CountrySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  const filteredCountries = searchCountries(searchQuery);

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

  const handleSelect = (country: string) => {
    onChange(country);
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
          prev < filteredCountries.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredCountries[highlightedIndex]) {
          handleSelect(filteredCountries[highlightedIndex]);
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
        onClick={() => !disabled && setIsOpen(!isOpen)}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {value ? (
          <span>{value}</span>
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
            placeholder="Search countries..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setHighlightedIndex(-1);
            }}
          />
          <div ref={optionsRef} className="searchable-dropdown-options" role="listbox">
            {filteredCountries.length === 0 ? (
              <div className="searchable-dropdown-option" style={{ color: 'var(--text-secondary)' }}>
                No countries found
              </div>
            ) : (
              filteredCountries.map((country, index) => (
                <div
                  key={country}
                  className={`searchable-dropdown-option${
                    country === value ? ' selected' : ''
                  }${index === highlightedIndex ? ' highlighted' : ''}`}
                  style={{
                    background: index === highlightedIndex ? 'var(--bg-hover)' : undefined,
                  }}
                  onClick={() => handleSelect(country)}
                  role="option"
                  aria-selected={country === value}
                >
                  {country}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

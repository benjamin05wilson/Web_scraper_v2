import { useState, useEffect } from 'react';
import type { LazyLoadConfig, ScrollTestResult, ScrollStrategy } from '../../../shared/types';

interface AdvancedSettingsPanelProps {
  settings: LazyLoadConfig;
  onChange: (settings: LazyLoadConfig) => void;
  recommendedSettings?: ScrollTestResult | null;
  targetItems: number;
  onTargetItemsChange: (value: number) => void;
}

export function AdvancedSettingsPanel({
  settings,
  onChange,
  recommendedSettings,
  targetItems,
  onTargetItemsChange,
}: AdvancedSettingsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [hasAppliedRecommendations, setHasAppliedRecommendations] = useState(false);

  // Apply recommended settings when they arrive
  useEffect(() => {
    if (recommendedSettings && !hasAppliedRecommendations) {
      onChange({
        ...settings,
        scrollStrategy: recommendedSettings.recommendedStrategy,
        scrollDelay: recommendedSettings.recommendedDelay,
        maxScrollIterations: recommendedSettings.recommendedMaxIterations,
        loadingIndicators: recommendedSettings.loadingIndicatorsFound,
      });
      setHasAppliedRecommendations(true);
      setExpanded(true); // Expand to show applied settings
    }
  }, [recommendedSettings, hasAppliedRecommendations, onChange, settings]);

  const updateSetting = <K extends keyof LazyLoadConfig>(key: K, value: LazyLoadConfig[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: '0.9em',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '0.85em',
    color: 'var(--text-secondary)',
    marginBottom: '5px',
  };

  const formGroupStyle = {
    marginBottom: '15px',
  };

  return (
    <div className="step-card">
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <h2 className="step-title" style={{ margin: 0 }}>
          Advanced Settings
        </h2>
        <span
          style={{
            fontSize: '1.2em',
            color: 'var(--text-secondary)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          ▼
        </span>
      </div>

      {recommendedSettings && hasAppliedRecommendations && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            background: 'var(--accent-success)',
            color: 'white',
            borderRadius: '6px',
            fontSize: '0.8em',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 0 8 8A8 8 0 0 0 8 0zm3.78 5.28-4.5 6a.75.75 0 0 1-1.18.03l-2.25-2.5a.75.75 0 1 1 1.11-1.01l1.62 1.8 3.95-5.27a.75.75 0 0 1 1.25.95z" />
          </svg>
          Recommended settings applied from scroll test
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '20px' }}>
          {/* Target Items */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Target Items (Total Across All Pages)</label>
            <input
              type="number"
              style={inputStyle}
              value={targetItems}
              onChange={(e) => onTargetItemsChange(parseInt(e.target.value) || 0)}
              min={0}
              placeholder="0 = unlimited"
            />
            <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Scraping stops when this total is reached (0 = no limit)
            </div>
          </div>

          {/* Scroll Strategy */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Scroll Strategy</label>
            <select
              style={inputStyle}
              value={settings.scrollStrategy || 'adaptive'}
              onChange={(e) => updateSetting('scrollStrategy', e.target.value as ScrollStrategy)}
            >
              <option value="adaptive">Adaptive (wait for DOM stability)</option>
              <option value="rapid">Rapid (fast scrolling for lazy sites)</option>
              <option value="fixed">Fixed (consistent delay)</option>
            </select>
          </div>

          {/* Scroll Delay */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Scroll Delay (ms)</label>
            <input
              type="number"
              style={inputStyle}
              value={settings.scrollDelay || 800}
              onChange={(e) => updateSetting('scrollDelay', parseInt(e.target.value) || 800)}
              min={50}
              max={5000}
            />
          </div>

          {/* Max Scroll Iterations */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Max Scroll Iterations</label>
            <input
              type="number"
              style={inputStyle}
              value={settings.maxScrollIterations || 100}
              onChange={(e) => updateSetting('maxScrollIterations', parseInt(e.target.value) || 100)}
              min={1}
              max={500}
            />
          </div>

          {/* Stability Timeout (for adaptive strategy) */}
          {(settings.scrollStrategy === 'adaptive' || !settings.scrollStrategy) && (
            <div style={formGroupStyle}>
              <label style={labelStyle}>Stability Timeout (ms)</label>
              <input
                type="number"
                style={inputStyle}
                value={settings.stabilityTimeout || 500}
                onChange={(e) => updateSetting('stabilityTimeout', parseInt(e.target.value) || 500)}
                min={100}
                max={5000}
              />
              <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Time to wait for DOM to stabilize before scrolling again
              </div>
            </div>
          )}

          {/* Rapid Scroll Settings */}
          {settings.scrollStrategy === 'rapid' && (
            <>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Rapid Scroll Step (px)</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={settings.rapidScrollStep || 500}
                  onChange={(e) => updateSetting('rapidScrollStep', parseInt(e.target.value) || 500)}
                  min={100}
                  max={2000}
                />
              </div>

              <div style={formGroupStyle}>
                <label style={labelStyle}>Rapid Scroll Delay (ms)</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={settings.rapidScrollDelay || 100}
                  onChange={(e) => updateSetting('rapidScrollDelay', parseInt(e.target.value) || 100)}
                  min={50}
                  max={1000}
                />
              </div>
            </>
          )}

          {/* Custom Loading Indicators */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Loading Indicators (CSS selectors, one per line)</label>
            <textarea
              style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'monospace' }}
              value={(settings.loadingIndicators || []).join('\n')}
              onChange={(e) =>
                updateSetting(
                  'loadingIndicators',
                  e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
              placeholder=".custom-spinner&#10;.my-loading-overlay"
            />
            <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Wait for these elements to disappear before extracting data
            </div>
          </div>

          {/* Presets */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '15px', marginTop: '15px' }}>
            <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              Quick Presets
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="btn secondary"
                style={{ padding: '6px 12px', fontSize: '0.8em' }}
                onClick={() =>
                  onChange({
                    scrollStrategy: 'rapid',
                    scrollDelay: 100,
                    maxScrollIterations: 100,
                    rapidScrollStep: 500,
                    rapidScrollDelay: 100,
                  })
                }
              >
                Fast
              </button>
              <button
                className="btn secondary"
                style={{ padding: '6px 12px', fontSize: '0.8em' }}
                onClick={() =>
                  onChange({
                    scrollStrategy: 'adaptive',
                    scrollDelay: 800,
                    maxScrollIterations: 50,
                    stabilityTimeout: 500,
                  })
                }
              >
                Balanced
              </button>
              <button
                className="btn secondary"
                style={{ padding: '6px 12px', fontSize: '0.8em' }}
                onClick={() =>
                  onChange({
                    scrollStrategy: 'adaptive',
                    scrollDelay: 1500,
                    maxScrollIterations: 30,
                    stabilityTimeout: 1000,
                  })
                }
              >
                Reliable
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

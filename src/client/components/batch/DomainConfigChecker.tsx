import { useNavigate } from 'react-router-dom';
import type { Config, BatchJob } from '../../../shared/types';

interface DomainConfigCheckerProps {
  domains: string[]; // Now these are "domain:country" pairs
  configs: Map<string, Config>;
  missingConfigs: string[];
  jobs: BatchJob[]; // Jobs to get source URLs from
  onRefresh: () => void;
}

// Check if a config exists for the domain:country pair
function findConfigForDomainCountry(domainCountry: string, configs: Map<string, Config>): Config | undefined {
  // domainCountry is in format "domain:country"
  const [domain, country] = domainCountry.split(':');

  // First try exact domain:country match
  if (configs.has(domainCountry)) {
    return configs.get(domainCountry);
  }

  // Try domain-only match ONLY if that config has no country set
  // (a country-specific config should NOT be used for other countries)
  const domainConfig = configs.get(domain);
  if (domainConfig && !domainConfig.country) {
    return domainConfig;
  }

  // Try fuzzy match by domain name - but only if no country or same country
  const domainBase = domain.replace(/^www\./i, '').split('.')[0].toLowerCase();
  for (const [key, cfg] of configs.entries()) {
    if ((cfg.name?.toLowerCase().includes(domainBase) ||
        key.toLowerCase().includes(domainBase)) &&
        (!cfg.country || cfg.country === country)) {
      return cfg;
    }
  }
  return undefined;
}

// Format domain:country for display
function formatDomainCountry(domainCountry: string): { domain: string; country: string } {
  const [domain, country] = domainCountry.split(':');
  return { domain, country: country || '' };
}

export function DomainConfigChecker({
  domains,
  configs,
  missingConfigs,
  jobs,
  onRefresh,
}: DomainConfigCheckerProps) {
  const navigate = useNavigate();

  if (domains.length === 0) return null;

  const allReady = missingConfigs.length === 0;

  // Get a source URL for a given domain:country pair
  const getSourceUrlForDomain = (domainCountry: string): string => {
    const [domain, country] = domainCountry.split(':');
    const job = jobs.find(j => j.domain === domain && j.country === country);
    return job?.sourceUrl || '';
  };

  // Handle Build button click - navigate to builder with URL and country
  const handleBuild = (domainCountry: string) => {
    const { domain, country } = formatDomainCountry(domainCountry);
    const sourceUrl = getSourceUrlForDomain(domainCountry);

    // Generate suggested config name: "domain.com - Country" format
    const suggestedName = country ? `${domain} - ${country}` : domain;

    // Navigate to builder with query params
    const params = new URLSearchParams();
    if (sourceUrl) params.set('url', sourceUrl);
    if (country) params.set('country', country);
    if (suggestedName) params.set('name', suggestedName);
    navigate(`/builder?${params.toString()}`);
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.25em', margin: 0 }}>2. Domain Configuration Check</h2>
        <button
          className="btn secondary"
          style={{ padding: '8px 16px', fontSize: '0.85em' }}
          onClick={onRefresh}
        >
          Refresh Configs
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '10px' }}>
        {domains.map((domainCountry) => {
          const config = findConfigForDomainCountry(domainCountry, configs);
          const hasConfig = !!config;
          const { domain, country } = formatDomainCountry(domainCountry);
          return (
            <div
              key={domainCountry}
              style={{
                padding: '12px 15px',
                background: 'var(--bg-secondary)',
                border: `1px solid ${hasConfig ? 'var(--accent-success)' : 'var(--accent-danger)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: hasConfig ? 'var(--accent-success)' : 'var(--accent-danger)',
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.9em' }}>{domain}</div>
                {country && (
                  <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)' }}>{country}</div>
                )}
              </div>
              {hasConfig ? (
                <span
                  style={{
                    fontSize: '0.75em',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--accent-success)',
                  }}
                >
                  Ready
                </span>
              ) : (
                <button
                  className="btn"
                  style={{
                    padding: '4px 12px',
                    fontSize: '0.75em',
                    background: 'var(--accent-primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleBuild(domainCountry)}
                >
                  Build
                </button>
              )}
            </div>
          );
        })}
      </div>

      {allReady && (
        <div style={{ color: 'var(--accent-success)', fontSize: '0.9em', marginTop: '15px' }}>
          All domains have configs - ready to scrape!
        </div>
      )}

      {!allReady && (
        <div style={{ color: 'var(--accent-danger)', fontSize: '0.9em', marginTop: '15px' }}>
          {missingConfigs.length} domain(s) missing configs. Click "Build" to create.
        </div>
      )}
    </div>
  );
}

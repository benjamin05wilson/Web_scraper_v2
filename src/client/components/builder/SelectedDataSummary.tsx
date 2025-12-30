
interface SelectedItem {
  text?: string;
  href?: string;
  src?: string;
  selector?: string;
  selection_id?: string;
}

interface SelectedData {
  Title: SelectedItem[];
  Price: SelectedItem[];
  URL: SelectedItem[];
  NextPage: SelectedItem[];
  Image?: SelectedItem[];
}

interface SelectedDataSummaryProps {
  data: SelectedData;
  onRemove: (field: keyof SelectedData, index: number) => void;
}

const FIELD_COLORS: Record<string, string> = {
  Title: '#0070f3',
  Price: '#28a745',
  URL: '#ffc107',
  NextPage: '#6f42c1',
  Image: '#17a2b8',
};

export function SelectedDataSummary({ data, onRemove }: SelectedDataSummaryProps) {
  const allSelections: { field: keyof SelectedData; item: SelectedItem; index: number }[] = [];

  (Object.entries(data) as [keyof SelectedData, SelectedItem[]][]).forEach(([field, items]) => {
    items.forEach((item, index) => {
      if (item) {
        allSelections.push({ field, item, index });
      }
    });
  });

  return (
    <div className="step-card">
      <h2 className="step-title">Selected Data</h2>

      {/* Count summary */}
      <div style={{ fontSize: '0.85em', marginBottom: '15px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
          <div style={{ padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Titles: </span>
            <span style={{ fontWeight: 700 }}>{data.Title.length}</span>
          </div>
          <div style={{ padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Prices: </span>
            <span style={{ fontWeight: 700 }}>{data.Price.length}</span>
          </div>
          <div style={{ padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>URLs: </span>
            <span style={{ fontWeight: 700 }}>{data.URL.length}</span>
          </div>
        </div>
        <p style={{ marginTop: '10px', fontSize: '0.85em', color: 'var(--text-secondary)' }}>
          Click products with URL field to capture product page URLs
        </p>
      </div>

      {/* Selection list */}
      <div style={{ maxHeight: '200px', overflowY: 'auto', fontSize: '0.85em' }}>
        {allSelections.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', padding: '10px', textAlign: 'center' }}>
            No elements selected yet
          </div>
        ) : (
          allSelections.map(({ field, item, index }) => {
            const color = FIELD_COLORS[field] || '#888';
            let displayText = 'Element';

            if (item.text?.trim()) {
              displayText = item.text.length > 30 ? item.text.substring(0, 30) + '...' : item.text;
            } else if (item.href) {
              displayText = item.href.length > 30 ? item.href.substring(0, 30) + '...' : item.href;
            } else if (item.selector) {
              displayText = item.selector.length > 30 ? item.selector.substring(0, 30) + '...' : item.selector;
            }

            return (
              <div
                key={`${field}-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                }}
              >
                <span
                  style={{
                    background: color,
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '0.7rem',
                    minWidth: '60px',
                    textAlign: 'center',
                  }}
                >
                  {field}
                </span>
                <span
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={item.text || item.href || item.src || item.selector || ''}
                >
                  {displayText}
                </span>
                <button
                  onClick={() => onRemove(field, index)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ff6b6b',
                    cursor: 'pointer',
                    padding: '2px 6px',
                    fontSize: '1rem',
                  }}
                  title="Remove this selection"
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

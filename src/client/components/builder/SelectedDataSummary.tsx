
interface SelectedItem {
  text?: string;
  href?: string;
  src?: string;
  selector?: string;
  selection_id?: string;
}

interface ProductSelectors {
  Title: SelectedItem[];
  Price: SelectedItem[];
  URL: SelectedItem[];
  Image: SelectedItem[];
}

interface SelectedData {
  saleProduct: ProductSelectors;
  nonSaleProduct: ProductSelectors;
  NextPage: SelectedItem[];
}

type ProductType = 'saleProduct' | 'nonSaleProduct';
type FieldName = keyof ProductSelectors | 'NextPage';

interface SelectedDataSummaryProps {
  data: SelectedData;
  onRemove: (productType: ProductType | null, field: FieldName, index: number) => void;
}

const FIELD_COLORS: Record<string, string> = {
  Title: '#0070f3',
  Price: '#28a745',
  URL: '#ffc107',
  Image: '#17a2b8',
  NextPage: '#6f42c1',
};

function ProductSection({
  title,
  icon,
  productType,
  data,
  onRemove,
  accentColor,
}: {
  title: string;
  icon: string;
  productType: ProductType;
  data: ProductSelectors;
  onRemove: (productType: ProductType, field: keyof ProductSelectors, index: number) => void;
  accentColor: string;
}) {
  const allSelections: { field: keyof ProductSelectors; item: SelectedItem; index: number }[] = [];

  (Object.entries(data) as [keyof ProductSelectors, SelectedItem[]][]).forEach(([field, items]) => {
    items.forEach((item, index) => {
      if (item) {
        allSelections.push({ field, item, index });
      }
    });
  });

  const hasData = allSelections.length > 0;

  return (
    <div
      style={{
        border: `1px solid ${hasData ? accentColor : 'var(--border-color)'}`,
        borderRadius: '8px',
        overflow: 'hidden',
        marginBottom: '12px',
      }}
    >
      {/* Section Header */}
      <div
        style={{
          background: hasData ? `${accentColor}15` : 'var(--bg-secondary)',
          padding: '10px 12px',
          borderBottom: `1px solid ${hasData ? accentColor : 'var(--border-color)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '1.1rem' }}>{icon}</span>
        <span style={{ fontWeight: 600, color: hasData ? accentColor : 'var(--text-secondary)' }}>
          {title}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            background: hasData ? accentColor : 'var(--bg-tertiary)',
            color: hasData ? 'white' : 'var(--text-secondary)',
            padding: '2px 8px',
            borderRadius: '10px',
          }}
        >
          {allSelections.length} field{allSelections.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Field Counts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr 1fr',
          gap: '1px',
          background: 'var(--border-color)',
          fontSize: '0.75rem',
        }}
      >
        {(['Title', 'Price', 'URL', 'Image'] as const).map((field) => (
          <div
            key={field}
            style={{
              padding: '6px 8px',
              background: 'var(--bg-primary)',
              textAlign: 'center',
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>{field}: </span>
            <span style={{ fontWeight: 600, color: FIELD_COLORS[field] }}>{data[field].length}</span>
          </div>
        ))}
      </div>

      {/* Selection list */}
      {allSelections.length > 0 && (
        <div style={{ maxHeight: '120px', overflowY: 'auto', fontSize: '0.8rem' }}>
          {allSelections.map(({ field, item, index }) => {
            const color = FIELD_COLORS[field] || '#888';
            let displayText = 'Element';

            if (item.text?.trim()) {
              displayText = item.text.length > 25 ? item.text.substring(0, 25) + '...' : item.text;
            } else if (item.href) {
              displayText = item.href.length > 25 ? item.href.substring(0, 25) + '...' : item.href;
            } else if (item.selector) {
              displayText = item.selector.length > 25 ? item.selector.substring(0, 25) + '...' : item.selector;
            }

            return (
              <div
                key={`${field}-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 8px',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                <span
                  style={{
                    background: color,
                    color: 'white',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    fontSize: '0.65rem',
                    minWidth: '45px',
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
                  onClick={() => onRemove(productType, field, index)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ff6b6b',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    fontSize: '0.9rem',
                    lineHeight: 1,
                  }}
                  title="Remove this selection"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {allSelections.length === 0 && (
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '12px',
            textAlign: 'center',
            fontSize: '0.8rem',
            fontStyle: 'italic',
          }}
        >
          No selectors configured yet
        </div>
      )}
    </div>
  );
}

export function SelectedDataSummary({ data, onRemove }: SelectedDataSummaryProps) {
  const handleRemove = (productType: ProductType, field: keyof ProductSelectors, index: number) => {
    onRemove(productType, field, index);
  };

  return (
    <div className="step-card">
      <h2 className="step-title">Selected Selectors</h2>

      {/* Sale Product Section */}
      <ProductSection
        title="Sale Product Selectors"
        icon="🏷️"
        productType="saleProduct"
        data={data.saleProduct}
        onRemove={handleRemove}
        accentColor="#17c653"
      />

      {/* Non-Sale Product Section */}
      <ProductSection
        title="Non-Sale Product Selectors"
        icon="📦"
        productType="nonSaleProduct"
        data={data.nonSaleProduct}
        onRemove={handleRemove}
        accentColor="#0070f3"
      />

      {/* Info text */}
      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '8px 0 0', textAlign: 'center' }}>
        Sale selectors are used for discounted products, Non-Sale for regular priced items
      </p>
    </div>
  );
}

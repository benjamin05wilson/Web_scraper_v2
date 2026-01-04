import { useState, useEffect } from 'react';

type FieldType = 'Title' | 'Price' | 'URL' | 'NextPage' | 'Image' | 'Skip';

interface ExtractedItem {
  type: 'text' | 'link' | 'image';
  value: string;
  selector: string;
  displayText: string;
  tagName?: string;
}

interface LabeledItem {
  field: FieldType;
  item: ExtractedItem;
}

// AI label from server
interface AILabel {
  index: number;
  field: string; // 'title' | 'price' | 'original_price' | 'url' | 'image' | 'skip'
  confidence: number;
  reason?: string;
}

interface ExtractedContentLabelerProps {
  items: ExtractedItem[];
  containerSelector: string;
  onSaveLabels: (labels: LabeledItem[], containerSelector: string) => void;
  onCancel: () => void;
  aiLabels?: AILabel[]; // AI-generated labels from server
}

const FIELD_OPTIONS: { field: FieldType; label: string; color: string }[] = [
  { field: 'Title', label: 'Title', color: '#0070f3' },
  { field: 'Price', label: 'Price', color: '#28a745' },
  { field: 'URL', label: 'URL', color: '#ffc107' },
  { field: 'Image', label: 'Image', color: '#17a2b8' },
  { field: 'Skip', label: 'Skip', color: '#6c757d' },
];

// Auto-detect field types based on content
function autoDetectAssignments(items: ExtractedItem[]): Record<number, FieldType> {
  const assignments: Record<number, FieldType> = {};
  let hasTitle = false;
  let hasPrice = false;
  let hasUrl = false;
  let hasImage = false;

  // Count links to determine if we should auto-assign URL
  const linkItems = items.filter(item => item.type === 'link');

  items.forEach((item, index) => {
    // Auto-detect URL: links containing product patterns OR the only link in container
    if (item.type === 'link' && !hasUrl) {
      const urlPatterns = ['/product/', '/p/', '/item/', '/dp/', '/pd/', '/products/', '/goods/', '/l/'];
      const isProductUrl = urlPatterns.some(pattern => item.value.toLowerCase().includes(pattern));

      // Also auto-detect if:
      // 1. It matches product URL patterns, OR
      // 2. The selector is empty or ':self' (container IS the link), OR
      // 3. The selector is ':parent-link' (container is inside a link), OR
      // 4. This is the ONLY link in the container
      const isContainerLink = item.selector === '' || item.selector === ':self' || item.selector === ':parent-link';
      const isOnlyLink = linkItems.length === 1;

      if (isProductUrl || isContainerLink || isOnlyLink) {
        assignments[index] = 'URL';
        hasUrl = true;
        return;
      }
    }

    // Auto-detect Image: first image in the container
    if (item.type === 'image' && !hasImage) {
      assignments[index] = 'Image';
      hasImage = true;
      return;
    }

    // Auto-detect Price: text containing currency symbols or price patterns
    if (item.type === 'text' && !hasPrice) {
      const pricePattern = /^[$£€¥₹]?\s*\d+([.,]\d{2,3})?(\s*[-–]\s*[$£€¥₹]?\s*\d+([.,]\d{2,3})?)?$|^\d+([.,]\d{2,3})?\s*[$£€¥₹MAD]?$/;
      if (pricePattern.test(item.value.trim())) {
        assignments[index] = 'Price';
        hasPrice = true;
        return;
      }
    }

    // Auto-detect Title: first longer text that's not a price (usually product name)
    if (item.type === 'text' && !hasTitle && item.tagName) {
      const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(item.tagName.toLowerCase());
      const isLongEnough = item.value.length >= 10 && item.value.length <= 200;
      const notPrice = !/^[$£€¥₹]?\s*\d+([.,]\d{2,3})?/.test(item.value.trim());

      if ((isHeading || isLongEnough) && notPrice) {
        assignments[index] = 'Title';
        hasTitle = true;
        return;
      }
    }
  });

  return assignments;
}

// Convert AI labels to field assignments
function convertAILabelsToAssignments(aiLabels: AILabel[]): Record<number, FieldType> {
  const assignments: Record<number, FieldType> = {};

  // Map AI field names to our FieldType (capitalize first letter)
  const fieldMap: Record<string, FieldType> = {
    'title': 'Title',
    'price': 'Price',
    'original_price': 'Price', // We treat original_price as Price (could be extended later)
    'sale_price': 'Price',
    'url': 'URL',
    'image': 'Image',
    'skip': 'Skip',
  };

  for (const label of aiLabels) {
    const mappedField = fieldMap[label.field.toLowerCase()];
    if (mappedField) {
      assignments[label.index] = mappedField;
    }
  }

  return assignments;
}

export function ExtractedContentLabeler({
  items,
  containerSelector,
  onSaveLabels,
  onCancel,
  aiLabels,
}: ExtractedContentLabelerProps) {
  // Track which field each item is assigned to - initialize with auto-detected assignments
  const [assignments, setAssignments] = useState<Record<number, FieldType>>({});
  // Whether to show items marked as skip
  const [showSkipItems, setShowSkipItems] = useState(false);
  // Whether AI labels have been applied (for confirmation UI)
  const [aiLabelsApplied, setAiLabelsApplied] = useState(false);

  // Use AI labels if provided, otherwise fall back to basic auto-detection
  useEffect(() => {
    if (aiLabels && aiLabels.length > 0) {
      // Use AI-generated labels
      console.log('[Labeler] Using AI labels:', aiLabels.length, 'labels');
      const aiAssigned = convertAILabelsToAssignments(aiLabels);
      setAssignments(aiAssigned);
      setAiLabelsApplied(true);
      setShowSkipItems(false); // Hide skip items by default when AI labels arrive
    } else {
      // Fall back to basic auto-detection
      console.log('[Labeler] No AI labels, using basic auto-detection');
      const autoAssigned = autoDetectAssignments(items);
      if (Object.keys(autoAssigned).length > 0) {
        setAssignments(autoAssigned);
      }
      setAiLabelsApplied(false);
      setShowSkipItems(true); // Show all items when no AI labels
    }
  }, [items, aiLabels]);

  const handleAssign = (index: number, field: FieldType) => {
    setAssignments((prev) => {
      const newAssignments = { ...prev };
      if (prev[index] === field) {
        // Toggle off if clicking same field
        delete newAssignments[index];
      } else {
        newAssignments[index] = field;
      }
      return newAssignments;
    });
  };

  const handleSave = () => {
    const labels: LabeledItem[] = [];
    Object.entries(assignments).forEach(([indexStr, field]) => {
      const index = parseInt(indexStr, 10);
      // Exclude Skip from saved labels
      if (field !== 'Skip' && items[index]) {
        labels.push({ field, item: items[index] });
      }
    });
    onSaveLabels(labels, containerSelector);
  };

  const assignedCount = Object.keys(assignments).filter(
    (k) => assignments[parseInt(k, 10)] !== 'Skip'
  ).length;

  const skippedCount = Object.keys(assignments).filter(
    (k) => assignments[parseInt(k, 10)] === 'Skip'
  ).length;

  // Group items by type for better organization, keeping track of original indices
  // Filter out skip items if showSkipItems is false
  const textItems: { item: ExtractedItem; originalIndex: number }[] = [];
  const linkItems: { item: ExtractedItem; originalIndex: number }[] = [];
  const imageItems: { item: ExtractedItem; originalIndex: number }[] = [];

  items.forEach((item, index) => {
    // Skip items marked as 'Skip' if we're hiding them
    if (!showSkipItems && assignments[index] === 'Skip') {
      return;
    }

    if (item.type === 'text') {
      textItems.push({ item, originalIndex: index });
    } else if (item.type === 'link') {
      linkItems.push({ item, originalIndex: index });
    } else if (item.type === 'image') {
      imageItems.push({ item, originalIndex: index });
    }
  });

  const renderItemRow = (item: ExtractedItem, globalIndex: number) => {
    const assigned = assignments[globalIndex];

    return (
      <div
        key={globalIndex}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 12px',
          background: assigned ? 'var(--bg-secondary)' : 'transparent',
          borderBottom: '1px solid var(--border-color)',
          borderLeft: assigned
            ? `3px solid ${FIELD_OPTIONS.find((f) => f.field === assigned)?.color || '#888'}`
            : '3px solid transparent',
        }}
      >
        {/* Item preview */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {item.type === 'image' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img
                src={item.value}
                alt=""
                style={{
                  width: '40px',
                  height: '40px',
                  objectFit: 'cover',
                  borderRadius: '4px',
                  background: '#333',
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.displayText}
              </span>
            </div>
          ) : (
            <div
              style={{
                fontSize: '0.85rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: item.type === 'link' ? '#ffc107' : 'var(--text-primary)',
              }}
              title={item.value}
            >
              {item.type === 'link' ? '🔗 ' : ''}
              {item.displayText}
            </div>
          )}
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-secondary)',
              marginTop: '2px',
              fontFamily: 'monospace',
            }}
          >
            {item.selector}
          </div>
        </div>

        {/* Field buttons */}
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {FIELD_OPTIONS.filter((opt) => {
            // Show relevant options based on item type
            if (item.type === 'image') return opt.field === 'Image' || opt.field === 'NextPage';
            if (item.type === 'link') return opt.field !== 'Image';
            return opt.field !== 'Image' && opt.field !== 'URL';
          }).map(({ field, label, color }) => (
            <button
              key={field}
              onClick={() => handleAssign(globalIndex, field)}
              style={{
                padding: '4px 8px',
                fontSize: '0.7rem',
                fontWeight: 600,
                background: assigned === field ? color : 'transparent',
                border: `1px solid ${color}`,
                color: assigned === field ? 'white' : color,
                cursor: 'pointer',
                borderRadius: '3px',
                transition: 'all 0.15s ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '2px solid var(--accent-primary)',
        marginBottom: '20px',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '15px 20px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>
              {aiLabelsApplied ? '✨ AI Labels Applied' : 'Label Product Data'}
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {aiLabelsApplied
                ? `AI detected ${assignedCount} field${assignedCount !== 1 ? 's' : ''} and skipped ${skippedCount} item${skippedCount !== 1 ? 's' : ''}. Review and confirm.`
                : `Found ${items.length} items in the selected container. Click buttons to assign each to a field.`
              }
            </p>
          </div>
          {aiLabelsApplied && skippedCount > 0 && (
            <button
              onClick={() => setShowSkipItems(!showSkipItems)}
              style={{
                padding: '6px 12px',
                fontSize: '0.75rem',
                background: showSkipItems ? 'var(--bg-primary)' : 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              {showSkipItems ? 'Hide' : 'Show'} {skippedCount} skipped
            </button>
          )}
        </div>
        <div
          style={{
            marginTop: '8px',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            color: 'var(--text-secondary)',
            background: 'var(--bg-primary)',
            padding: '6px 10px',
            borderRadius: '4px',
          }}
        >
          Container: {containerSelector}
        </div>
      </div>

      {/* Content sections */}
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {/* Text items */}
        {textItems.length > 0 && (
          <div>
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--bg-primary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              Text Content ({textItems.length})
            </div>
            {textItems.map(({ item, originalIndex }) => renderItemRow(item, originalIndex))}
          </div>
        )}

        {/* Link items */}
        {linkItems.length > 0 && (
          <div>
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--bg-primary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              Links ({linkItems.length})
            </div>
            {linkItems.map(({ item, originalIndex }) => renderItemRow(item, originalIndex))}
          </div>
        )}

        {/* Image items */}
        {imageItems.length > 0 && (
          <div>
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--bg-primary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              Images ({imageItems.length})
            </div>
            {imageItems.map(({ item, originalIndex }) => renderItemRow(item, originalIndex))}
          </div>
        )}
      </div>

      {/* Footer with actions */}
      <div
        style={{
          padding: '15px 20px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-secondary)',
        }}
      >
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {assignedCount} field{assignedCount !== 1 ? 's' : ''} to extract
          {aiLabelsApplied && ` (${skippedCount} skipped)`}
        </span>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={assignedCount === 0}
            style={{
              padding: '8px 16px',
              background: assignedCount > 0 ? 'var(--accent-success)' : 'var(--bg-secondary)',
              border: 'none',
              color: assignedCount > 0 ? 'white' : 'var(--text-secondary)',
              cursor: assignedCount > 0 ? 'pointer' : 'not-allowed',
              fontWeight: 600,
            }}
          >
            {aiLabelsApplied ? 'Confirm & Apply' : 'Apply Labels'}
          </button>
        </div>
      </div>
    </div>
  );
}

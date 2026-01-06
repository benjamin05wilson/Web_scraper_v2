import { useState, useCallback } from 'react';

type FieldType = 'Title' | 'RRP' | 'Sale Price' | 'URL' | 'Image';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WizardStep {
  field: FieldType;
  question: string;
  screenshot: string;         // Base64 image with element highlighted
  extractedValue: string;     // The text/href/src value
  selector: string;           // CSS selector
  elementBounds: BoundingBox;
  cardType: 'withSale' | 'withoutSale';  // Which example card this is from
}

export interface ConfirmedField {
  field: FieldType;
  selector: string;
  value: string;
  confirmed: boolean;
}

interface FieldConfirmationWizardProps {
  steps: WizardStep[];
  onComplete: (confirmedFields: ConfirmedField[]) => void;
  onCancel: () => void;
  onPickDifferent: (field: FieldType) => void;  // User wants to manually pick
}

const FIELD_COLORS: Record<FieldType, string> = {
  Title: '#0070f3',
  RRP: '#28a745',
  'Sale Price': '#17c653',
  URL: '#ffc107',
  Image: '#17a2b8',
};

const FIELD_DESCRIPTIONS: Record<FieldType, string> = {
  Title: 'The product name/title text',
  RRP: 'The original/regular price (before discount)',
  'Sale Price': 'The current/discounted price',
  URL: 'The link to the product page',
  Image: 'The main product image',
};

export function FieldConfirmationWizard({
  steps,
  onComplete,
  onCancel,
  onPickDifferent,
}: FieldConfirmationWizardProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [confirmedFields, setConfirmedFields] = useState<ConfirmedField[]>([]);

  const currentStep = steps[currentStepIndex];
  const isLastStep = currentStepIndex === steps.length - 1;
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const handleConfirm = useCallback(() => {
    const confirmed: ConfirmedField = {
      field: currentStep.field,
      selector: currentStep.selector,
      value: currentStep.extractedValue,
      confirmed: true,
    };

    const newConfirmedFields = [...confirmedFields, confirmed];
    setConfirmedFields(newConfirmedFields);

    if (isLastStep) {
      onComplete(newConfirmedFields);
    } else {
      setCurrentStepIndex(prev => prev + 1);
    }
  }, [currentStep, confirmedFields, isLastStep, onComplete]);

  const handleSkip = useCallback(() => {
    // Skip this field (don't add to confirmed)
    if (isLastStep) {
      onComplete(confirmedFields);
    } else {
      setCurrentStepIndex(prev => prev + 1);
    }
  }, [confirmedFields, isLastStep, onComplete]);

  const handlePickDifferent = useCallback(() => {
    onPickDifferent(currentStep.field);
  }, [currentStep, onPickDifferent]);

  const handleBack = useCallback(() => {
    if (currentStepIndex > 0) {
      // Remove last confirmed field if going back
      setConfirmedFields(prev => prev.slice(0, -1));
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  if (!currentStep) {
    return null;
  }

  const fieldColor = FIELD_COLORS[currentStep.field];
  const fieldDescription = FIELD_DESCRIPTIONS[currentStep.field];

  return (
    <div className="field-wizard-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}>
      <div className="field-wizard-container" style={{
        background: 'var(--bg-primary)',
        borderRadius: '12px',
        maxWidth: '700px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              Confirm Field Selection
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Step {currentStepIndex + 1} of {steps.length}
              {' • '}
              <span style={{
                color: currentStep.cardType === 'withSale' ? '#17c653' : '#0070f3',
                fontWeight: 500
              }}>
                {currentStep.cardType === 'withSale' ? '🏷️ Sale Product' : '📦 Regular Product'}
              </span>
            </p>
          </div>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '1.5rem',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            &times;
          </button>
        </div>

        {/* Progress Bar */}
        <div style={{
          height: '4px',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: fieldColor,
            transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Content */}
        <div style={{
          padding: '24px',
          overflowY: 'auto',
          flex: 1,
        }}>
          {/* Field Badge */}
          <div style={{
            display: 'inline-block',
            background: fieldColor,
            color: 'white',
            padding: '6px 12px',
            borderRadius: '4px',
            fontWeight: 600,
            fontSize: '0.875rem',
            marginBottom: '16px',
          }}>
            {currentStep.field}
          </div>

          {/* Question */}
          <h3 style={{
            margin: '0 0 8px',
            fontSize: '1.5rem',
            fontWeight: 600,
          }}>
            {currentStep.question}
          </h3>
          <p style={{
            color: 'var(--text-secondary)',
            margin: '0 0 20px',
            fontSize: '0.875rem',
          }}>
            {fieldDescription}
          </p>

          {/* Screenshot with Highlight */}
          <div style={{
            position: 'relative',
            border: '2px solid var(--border-color)',
            borderRadius: '8px',
            overflow: 'hidden',
            marginBottom: '20px',
          }}>
            {currentStep.screenshot && currentStep.screenshot.length > 100 ? (
              <img
                src={`data:image/png;base64,${currentStep.screenshot}`}
                alt="Product card with highlighted element"
                style={{
                  width: '100%',
                  display: 'block',
                  maxHeight: '400px',
                  objectFit: 'contain',
                  background: '#000',
                }}
                onError={(e) => {
                  console.error('[Wizard] Image failed to load, screenshot length:', currentStep.screenshot.length);
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                onLoad={() => {
                  console.log('[Wizard] Image loaded successfully');
                }}
              />
            ) : (
              <div style={{
                minHeight: '200px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                padding: '20px',
              }}>
                <div style={{ marginBottom: '8px' }}>
                  {currentStep.screenshot ? (
                    <>Screenshot data too short ({currentStep.screenshot.length} chars)</>
                  ) : (
                    <>No screenshot captured</>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                  Selector: {currentStep.selector}
                </div>
              </div>
            )}
          </div>

          {/* Extracted Value */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px',
          }}>
            <div style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Detected Value
            </div>
            <div style={{
              fontSize: '1.125rem',
              fontWeight: 500,
              wordBreak: 'break-all',
            }}>
              {currentStep.extractedValue || '(empty)'}
            </div>
            <div style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              marginTop: '8px',
              fontFamily: 'monospace',
            }}>
              {currentStep.selector}
            </div>
          </div>

          {/* Non-sale info banner */}
          {currentStep.cardType === 'withoutSale' && (
            <div style={{
              background: 'rgba(0, 112, 243, 0.1)',
              border: '1px solid rgba(0, 112, 243, 0.3)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '20px',
              fontSize: '0.875rem',
            }}>
              <strong>📦 Regular Product Check:</strong> This product is NOT on sale.
              {currentStep.field === 'RRP'
                ? ' We\'re verifying the price selector works for full-price items.'
                : ' Confirming the selector works for non-discounted products too.'}
            </div>
          )}

          {/* Sale product info banner */}
          {currentStep.cardType === 'withSale' && (currentStep.field === 'RRP' || currentStep.field === 'Sale Price') && (
            <div style={{
              background: 'rgba(23, 198, 83, 0.1)',
              border: '1px solid rgba(23, 198, 83, 0.3)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '20px',
              fontSize: '0.875rem',
            }}>
              <strong>🏷️ Sale Product:</strong> This product has both original and sale prices.
              {currentStep.field === 'RRP'
                ? ' The RRP is usually the crossed-out or "Was" price.'
                : ' The Sale Price is the current discounted price.'}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{
          padding: '20px 24px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          gap: '12px',
          justifyContent: 'space-between',
        }}>
          <div>
            {currentStepIndex > 0 && (
              <button
                onClick={handleBack}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                }}
              >
                Back
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleSkip}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              Skip
            </button>
            <button
              onClick={handlePickDifferent}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: '1px solid #ff6b6b',
                borderRadius: '6px',
                cursor: 'pointer',
                color: '#ff6b6b',
              }}
            >
              No, let me pick
            </button>
            <button
              onClick={handleConfirm}
              style={{
                padding: '10px 24px',
                background: fieldColor,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                color: 'white',
                fontWeight: 600,
              }}
            >
              {isLastStep ? 'Confirm & Finish' : 'Yes, Confirm'}
            </button>
          </div>
        </div>

        {/* Progress Dots */}
        <div style={{
          padding: '12px 24px 20px',
          display: 'flex',
          justifyContent: 'center',
          gap: '8px',
        }}>
          {steps.map((step, idx) => (
            <div
              key={idx}
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: idx < currentStepIndex
                  ? FIELD_COLORS[step.field]
                  : idx === currentStepIndex
                    ? fieldColor
                    : 'var(--bg-secondary)',
                border: idx === currentStepIndex ? `2px solid ${fieldColor}` : 'none',
                transition: 'all 0.3s ease',
              }}
              title={step.field}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

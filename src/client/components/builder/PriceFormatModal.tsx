import { useState } from 'react';
import { Modal } from '../common/Modal';

interface PriceFormat {
  multiplier: number;
  remove_decimals: boolean;
}

interface PriceFormatModalProps {
  isOpen: boolean;
  onClose: () => void;
  samplePrice: string;
  onConfirm: (priceFormat: PriceFormat | null) => void;
}

function cleanDuplicatedPrice(priceText: string): string {
  if (!priceText) return priceText;

  const currencies = [
    'BD', 'KWD', 'AED', 'SAR', 'QAR', 'OMR', 'BHD', 'USD', 'EUR', 'GBP', 'INR',
    '$', '€', '£', '¥', '₹',
    'دينار', 'ريال', 'درهم',
  ];

  for (const curr of currencies) {
    const escapedCurr = curr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(${escapedCurr}\\s*[\\d,.]+).*?(${escapedCurr}\\s*[\\d,.]+)`, 'i');
    const match = priceText.match(pattern);
    if (match) {
      return match[2].trim();
    }
  }

  const duplicateNumPattern = /(\d+[.,]\d+)[\s\S]*?(\d+[.,]\d+)/;
  const dupMatch = priceText.match(duplicateNumPattern);
  if (dupMatch) {
    const num1 = dupMatch[1].replace(/,/g, '');
    const num2 = dupMatch[2].replace(/,/g, '');
    if (num1 === num2) {
      const secondHalf = priceText.substring(priceText.indexOf(dupMatch[2]));
      const withCurrency = secondHalf.match(/([^\d]*\d+[.,]\d+[^\d]*)/);
      if (withCurrency) {
        return withCurrency[1].trim();
      }
      return dupMatch[2];
    }
  }

  return priceText;
}

function calculatePriceFormat(originalPrice: string, correctedPrice: string): PriceFormat {
  const originalMatch = originalPrice.match(/[\d,]+\.?\d*/);
  const originalNum = originalMatch ? parseFloat(originalMatch[0].replace(/,/g, '')) : 0;
  const correctedNum = parseFloat(correctedPrice.replace(/,/g, ''));

  if (originalNum === 0 || isNaN(correctedNum)) {
    return { multiplier: 1, remove_decimals: false };
  }

  const multiplier = Math.round((correctedNum / originalNum) * 1000) / 1000;
  const remove_decimals = Number.isInteger(correctedNum);

  return { multiplier, remove_decimals };
}

export function PriceFormatModal({ isOpen, onClose, samplePrice, onConfirm }: PriceFormatModalProps) {
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctedValue, setCorrectedValue] = useState('');

  const cleanedPrice = cleanDuplicatedPrice(samplePrice);

  const handleCorrect = () => {
    setShowCorrection(true);
  };

  const handleApplyCorrection = () => {
    if (!correctedValue.trim()) return;

    const priceFormat = calculatePriceFormat(cleanedPrice, correctedValue);
    onConfirm(priceFormat);
    onClose();
    setShowCorrection(false);
    setCorrectedValue('');
  };

  const handleConfirmCorrect = () => {
    onConfirm(null);
    onClose();
    setShowCorrection(false);
    setCorrectedValue('');
  };

  const handleCancel = () => {
    onClose();
    setShowCorrection(false);
    setCorrectedValue('');
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="Verify Price Format">
      <div style={{ background: 'var(--bg-secondary)', padding: '20px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
        <p style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)', fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Sample price extracted:
        </p>
        <div style={{ fontSize: '1.5em', fontWeight: 600 }}>{cleanedPrice}</div>
      </div>

      {!showCorrection ? (
        <>
          <p style={{ marginBottom: '10px', fontSize: '0.95em' }}>Is this price displayed correctly?</p>
          <p style={{ marginBottom: '20px', fontSize: '0.85em', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Some regions display prices in subunits (e.g., <strong>KWD 5.990</strong> means <strong>5990 fils</strong>).
            If the decimal looks wrong, click "No" to fix it.
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn"
              onClick={handleConfirmCorrect}
              style={{ background: 'var(--accent-success)', borderColor: 'var(--accent-success)' }}
            >
              Yes, Correct
            </button>
            <button className="btn secondary" onClick={handleCorrect}>
              No, Needs Fixing
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginBottom: '15px', fontSize: '0.85em', color: 'var(--text-secondary)' }}>
            Enter what the price <strong>should</strong> be (numbers only):
          </p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Extracted:</span>
            <span style={{ fontWeight: 600 }}>{cleanedPrice}</span>
            <span style={{ color: 'var(--text-secondary)' }}>→</span>
            <span style={{ color: 'var(--text-secondary)' }}>Should be:</span>
            <input
              type="text"
              className="form-input"
              style={{ width: '120px', padding: '8px', border: '1px solid var(--border-color)' }}
              value={correctedValue}
              onChange={(e) => setCorrectedValue(e.target.value)}
              placeholder="e.g. 5990"
            />
          </div>
          <p style={{ marginBottom: '20px', fontSize: '0.85em', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <strong>Example:</strong> If "KWD 5.990" should be "5990" (fils), enter "5990"
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn" onClick={handleApplyCorrection}>
              Apply Correction
            </button>
            <button className="btn secondary" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

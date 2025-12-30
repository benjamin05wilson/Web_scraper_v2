import { useRef } from 'react';
import { downloadCSV, BATCH_CSV_TEMPLATE } from '../../utils/csvUtils';

interface BatchUploaderProps {
  onFileUpload: (file: File) => void;
  disabled?: boolean;
}

export function BatchUploader({ onFileUpload, disabled }: BatchUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileUpload(file);
    }
  };

  const handleDownloadTemplate = () => {
    // BATCH_CSV_TEMPLATE is already a CSV string
    downloadCSV(BATCH_CSV_TEMPLATE, 'batch_template.csv');
  };

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.25em', marginBottom: '20px' }}>1. Upload Input CSV</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.9em' }}>
        Expected headers:{' '}
        <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px' }}>
          Country, Division, Category, Next URL, Source URL
        </code>
      </p>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          disabled={disabled}
          style={{ border: '1px solid var(--border-color)', padding: '12px', width: 'auto' }}
        />
        <button
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          Process File
        </button>
        <button className="btn secondary" onClick={handleDownloadTemplate}>
          Download Template
        </button>
      </div>
    </div>
  );
}

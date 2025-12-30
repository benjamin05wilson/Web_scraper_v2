import { Modal } from '../common/Modal';
import type { Product } from '../../../shared/types';
import { formatDateTime } from '../../utils/dateUtils';
import { formatPrice } from '../../utils/priceUtils';

interface ProductDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
}

export function ProductDetailModal({ isOpen, onClose, product }: ProductDetailModalProps) {
  if (!product) return null;

  const handleOpenUrl = () => {
    if (product.product_url) {
      window.open(product.product_url, '_blank');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Product Details"
      size="large"
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn" onClick={handleOpenUrl} disabled={!product.product_url}>
            Open Product URL
          </button>
        </>
      }
    >
      <div className="detail-grid">
        <DetailRow label="Product Name" value={product.item_name} />
        <DetailRow label="Brand" value={product.brand} />
        <DetailRow label="Price" value={product.price != null ? formatPrice(product.price, product.currency) : undefined} />
        <DetailRow label="Original Price" value={product.price_raw} />
        <DetailRow label="Domain" value={product.domain} />
        <DetailRow label="Category" value={product.category} />
        <DetailRow label="Country" value={product.country} />
        <DetailRow label="Competitor Type" value={product.competitor_type} />
        <DetailRow label="Product URL" value={product.product_url} wordBreak />
        <DetailRow label="Source URL" value={product.source_url} wordBreak />
        <DetailRow label="Scraped At" value={formatDateTime(product.scraped_at)} />
      </div>
    </Modal>
  );
}

function DetailRow({ label, value, wordBreak }: { label: string; value?: string | number | null; wordBreak?: boolean }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value" style={wordBreak ? { wordBreak: 'break-all' } : undefined}>
        {value ?? '-'}
      </span>
    </div>
  );
}

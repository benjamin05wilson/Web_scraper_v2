// ============================================================================
// TOAST - Individual toast notification component
// ============================================================================

import React from 'react';
import type { Toast as ToastType, ToastType as ToastVariant } from '../../context/ToastContext';

interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

const getIcon = (type: ToastVariant): string => {
  switch (type) {
    case 'success':
      return '\u2713'; // checkmark
    case 'error':
      return '\u2717'; // x mark
    case 'warning':
      return '\u26A0'; // warning triangle
    case 'info':
    default:
      return '\u2139'; // info circle
  }
};

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-icon">{getIcon(toast.type)}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-dismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  );
};

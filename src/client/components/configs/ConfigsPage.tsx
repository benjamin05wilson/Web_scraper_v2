import React, { useEffect, useState } from 'react';
import { useConfigs } from '../../hooks/useConfigs';
import { ConfigsList } from './ConfigsList';
import { ConfigDetails } from './ConfigDetails';
import { EditConfigModal } from './EditConfigModal';
import { ConfirmModal } from '../common/Modal';
import type { Config } from '../../../shared/types';

export function ConfigsPage() {
  const {
    configs,
    selectedConfig,
    loading,
    error,
    loadConfigs,
    selectConfig,
    updateConfig,
    deleteConfig,
    searchConfigs,
  } = useConfigs();

  const [searchQuery, setSearchQuery] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const filteredConfigs = searchQuery ? searchConfigs(searchQuery) : configs;

  const handleRefresh = () => {
    loadConfigs(true);
  };

  const handleEdit = () => {
    if (selectedConfig) {
      setIsEditModalOpen(true);
    }
  };

  const handleSaveEdit = async (updates: Partial<Config>) => {
    if (selectedConfig) {
      await updateConfig(selectedConfig.name, updates);
      setIsEditModalOpen(false);
    }
  };

  const handleDelete = async () => {
    if (selectedConfig) {
      setDeleteLoading(true);
      try {
        await deleteConfig(selectedConfig.name);
        setIsDeleteModalOpen(false);
      } catch (err) {
        console.error('Failed to delete config:', err);
      } finally {
        setDeleteLoading(false);
      }
    }
  };

  return (
    <>
      {/* Hero Header */}
      <div className="hero">
        <span className="hero-badge">Configuration Management</span>
        <h1>Scraper Configs</h1>
        <p className="hero-subtitle">
          View and manage your saved scraper configurations. Each config defines the selectors
          and pagination settings used to extract data from a specific website.
        </p>
      </div>

      {/* Main Grid */}
      <div className="configs-grid">
        {/* Left Panel - Config List */}
        <div className="configs-list-panel">
          <div className="configs-status-bar">
            <div className="storage-indicator">
              <span className="storage-badge bigquery">BigQuery</span>
              <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>
                {configs.length} configs
              </span>
            </div>
            <button className="btn-refresh btn secondary" onClick={handleRefresh} disabled={loading}>
              {loading ? <span className="spinner" /> : '↻ Refresh'}
            </button>
          </div>

          <div className="config-search-container">
            <input
              type="text"
              className="config-search form-input"
              placeholder="Search configs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <ConfigsList
            configs={filteredConfigs}
            selectedName={selectedConfig?.name || null}
            onSelect={selectConfig}
            loading={loading}
          />
        </div>

        {/* Right Panel - Config Details */}
        <div className="configs-detail-panel">
          {selectedConfig ? (
            <ConfigDetails
              config={selectedConfig}
              onEdit={handleEdit}
              onDelete={() => setIsDeleteModalOpen(true)}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3 className="empty-state-title">No Config Selected</h3>
              <p className="empty-state-description">
                Select a configuration from the list to view its details.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {selectedConfig && (
        <EditConfigModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          config={selectedConfig}
          onSave={handleSaveEdit}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Configuration"
        message={`Are you sure you want to delete "${selectedConfig?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        loading={deleteLoading}
      />
    </>
  );
}

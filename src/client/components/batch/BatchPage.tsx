import { useMemo, useCallback } from 'react';
import { useBatchContext } from '../../context/BatchContext';
import { BatchUploader } from './BatchUploader';
import { DomainConfigChecker } from './DomainConfigChecker';
import { BatchSettings } from './BatchSettings';
import { BrowserSlotsGrid } from './BrowserSlotsGrid';
import { JobQueue } from './JobQueue';
import { ExpandedBrowserModal } from './ExpandedBrowserModal';

export function BatchPage() {
  const {
    jobs,
    browserSlots,
    progress,
    isRunning,
    isPaused,
    fastMode,
    targetProducts,
    configs,
    missingConfigs,
    nextUrlsData,
    nextScrapeResults,
    nextScrapeStatus,
    nextScrapeProgress,
    processCSV,
    refreshConfigs,
    startBatch,
    pauseResumeBatch,
    stopBatch,
    setFastMode,
    setTargetProducts,
    expandSlot,
    closeExpandedSlot,
    expandedSlotId,
    sendSlotInput,
    sendCaptchaSolved,
    startNextScraping,
    downloadResults,
  } = useBatchContext();

  // Get unique domain:country pairs from jobs
  const domains = useMemo(() => [...new Set(jobs.map((j) => `${j.domain}:${j.country}`))], [jobs]);

  const hasJobs = jobs.length > 0;
  const showConfigChecker = hasJobs;
  const showSettings = hasJobs;
  const showBrowserGrid = isRunning;
  const showJobQueue = hasJobs;
  const showNextScraping = hasJobs && nextUrlsData.length > 0;
  const batchComplete = progress.completed + progress.errors + progress.skipped >= progress.total && progress.total > 0;

  // Get expanded slot data
  const expandedSlot = useMemo(
    () => (expandedSlotId !== null ? browserSlots.find((s) => s.id === expandedSlotId) || null : null),
    [browserSlots, expandedSlotId]
  );

  // Determine live status
  const liveStatus = useMemo(() => {
    if (!isRunning) return 'Waiting to start...';
    if (isPaused) return 'Paused';
    const runningCount = browserSlots.filter((s) => s.status === 'scraping' || s.status === 'loading').length;
    return `${runningCount} tab(s) active`;
  }, [isRunning, isPaused, browserSlots]);

  // Handle file upload
  const handleFileUpload = useCallback(
    async (file: File) => {
      await processCSV(file);
    },
    [processCSV]
  );

  // Handle download results - now downloads ZIP with all formats
  const handleDownloadResults = useCallback(async () => {
    await downloadResults();
  }, [downloadResults]);

  // Handle Next URL scraping
  const handleStartNextScraping = useCallback(async () => {
    await startNextScraping();
  }, [startNextScraping]);

  // Handle config refresh
  const handleRefreshConfigs = useCallback(() => {
    refreshConfigs();
  }, [refreshConfigs]);

  // Handle slot input for expanded browser
  const handleSlotInput = useCallback(
    (type: string, data: unknown) => {
      if (expandedSlotId !== null) {
        sendSlotInput(expandedSlotId, type, data);
      }
    },
    [expandedSlotId, sendSlotInput]
  );

  return (
    <>
      <div className="hero">
        <span className="hero-badge">Bulk Processing</span>
        <h1>Batch Scraper</h1>
        <p className="hero-subtitle">Upload a CSV to scrape multiple categories across different domains</p>
      </div>

      <div className="container">
        {/* Upload Section */}
        <BatchUploader onFileUpload={handleFileUpload} disabled={isRunning} />

        {/* Domain Config Section */}
        {showConfigChecker && (
          <DomainConfigChecker
            domains={domains}
            configs={configs}
            missingConfigs={missingConfigs}
            jobs={jobs}
            onRefresh={handleRefreshConfigs}
          />
        )}

        {/* Settings Section */}
        {showSettings && (
          <BatchSettings
            targetProducts={targetProducts}
            fastMode={fastMode}
            onTargetProductsChange={setTargetProducts}
            onFastModeChange={setFastMode}
          />
        )}

        {/* Live Browser Grid */}
        {showBrowserGrid && (
          <BrowserSlotsGrid slots={browserSlots} onSlotClick={expandSlot} status={liveStatus} />
        )}

        {/* Job Queue */}
        {showJobQueue && (
          <JobQueue
            jobs={jobs}
            progress={progress}
            isRunning={isRunning}
            isPaused={isPaused}
            missingConfigsCount={missingConfigs.length}
            onStart={startBatch}
            onPauseResume={pauseResumeBatch}
            onStop={stopBatch}
            onDownloadResults={handleDownloadResults}
          />
        )}

        {/* Next URL Scraping Section */}
        {showNextScraping && (
          <section className="section">
            <div className="section-header">
              <h2>Next URL Scraping</h2>
              <span className="badge">{nextUrlsData.length} URLs</span>
            </div>
            <div className="next-scraping-content">
              <div className="next-scraping-status">
                <span className="status-label">Status:</span>
                <span className={`status-value status-${nextScrapeStatus}`}>
                  {nextScrapeStatus === 'pending' && 'Ready to scrape'}
                  {nextScrapeStatus === 'running' && 'Scraping...'}
                  {nextScrapeStatus === 'completed' && `Complete (${nextScrapeResults.length} products)`}
                  {nextScrapeStatus === 'error' && 'Error'}
                </span>
              </div>
              {nextScrapeStatus === 'running' && (
                <div className="progress-bar-container">
                  <div
                    className="progress-bar"
                    style={{ width: `${nextScrapeProgress}%` }}
                  />
                </div>
              )}
              <div className="next-scraping-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleStartNextScraping}
                  disabled={nextScrapeStatus === 'running' || !batchComplete}
                >
                  {nextScrapeStatus === 'running' ? 'Scraping...' : 'Start Next Scraping'}
                </button>
                {nextScrapeStatus === 'completed' && (
                  <span className="success-text">
                    {nextScrapeResults.length} products scraped from Next URLs
                  </span>
                )}
              </div>
              {!batchComplete && nextScrapeStatus === 'pending' && (
                <p className="helper-text">
                  Complete the main batch scraping first to enable Next URL scraping.
                </p>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Expanded Browser Modal */}
      <ExpandedBrowserModal
        isOpen={expandedSlotId !== null}
        onClose={closeExpandedSlot}
        slot={expandedSlot}
        onInput={handleSlotInput}
        onCaptchaSolved={sendCaptchaSolved}
      />
    </>
  );
}

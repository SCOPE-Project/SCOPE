import { memo } from 'react'

const ExtractionProgress = memo(function ExtractionProgress({
  extractionMessages,
  extractionProgress,
}) {
  return (
      <div className="overview-progress">
        <div className="overview-progress-body">
          <div className="overview-progress-heading">
            <span className="overview-progress-title">Processing Log</span>
            <span className="overview-progress-percent">{extractionProgress}%</span>
          </div>
          <div className="overview-progress-log" role="log" aria-live="polite">
            {extractionMessages.length === 0 ? (
              <div className="overview-progress-entry overview-progress-entry--placeholder">
                Waiting for backend status updates.
              </div>
            ) : (
              extractionMessages.map((entry) => (
                <div key={entry.id} className="overview-progress-entry">
                  {entry.text}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="overview-progress-footer">
          <div
            className="overview-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={extractionProgress}
            aria-label="Overpass extraction progress"
          >
            <div
              className="overview-progress-bar-fill"
              style={{ width: `${Math.max(0, Math.min(100, extractionProgress))}%` }}
            ></div>
          </div>
        </div>
      </div>
  )
})

export default ExtractionProgress

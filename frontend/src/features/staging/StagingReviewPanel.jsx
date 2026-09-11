import { memo } from 'react'

import { formatDurationFromSeconds, formatUtcEventDateTime } from '../../domain/format.js'

// Stage 2: what the operator signs off before anything reaches SatOS.
//
// Every scheduled link has to be confirmed twice -- once from its satellite
// side and once from its ground station side -- before the commit button
// unlocks. The two sides are deliberately separate: an operator reviewing a
// satellite's data budget is answering a different question from one checking
// a ground station's contact list.
const StagingReviewPanel = memo(function StagingReviewPanel({
  allStagingLinksConfirmed,
  commitSummary,
  confirmedStagingLinks,
  confirmingSchedule,
  finalScheduleRows,
  handleBackToEdit,
  handleCommitToSatOS,
  scheduleCommitted,
  scheduleStagingReviewRef,
  sessionId,
  toggleStagingAssetConfirmation,
  toggleStagingLinkConfirmation,
  userName,
}) {
  return (
                    <div
                      ref={scheduleStagingReviewRef}
                      className="schedule-staging-review-panel"
                      role="region"
                      aria-label="Staged Schedule Review"
                    >
                      <div className="staging-review-header">
                        <span className="staging-review-badge">Stage 2 · Staged Review</span>
                        <h3 className="staging-review-title">Staged Communication Schedule & SatOS Commit Review</h3>
                        <p className="staging-review-description">
                          Review the aggregated link allocations and data volume profile per asset before pushing activities to SatOS.
                        </p>
                      </div>

                      {/* Summary KPI Banner */}
                      <div className="staging-metrics-banner">
                        <div className="staging-metric-card">
                          <span className="staging-metric-label">Total Scheduled Links</span>
                          <span className="staging-metric-value">{commitSummary.totalScheduledLinks}</span>
                          <span className="staging-metric-subtext">Active contact passes</span>
                        </div>
                        <div className="staging-metric-card">
                          <span className="staging-metric-label">Total Data Offload</span>
                          <span className="staging-metric-value">{commitSummary.totalOffloadedGb} GB</span>
                          <span className="staging-metric-subtext">{(commitSummary.totalOffloadedMb).toLocaleString()} MB</span>
                        </div>
                        <div className="staging-metric-card">
                          <span className="staging-metric-label">Total Contact Time</span>
                          <span className="staging-metric-value">{formatDurationFromSeconds(commitSummary.totalDurationSeconds)}</span>
                          <span className="staging-metric-subtext">{commitSummary.totalDurationSeconds} seconds total</span>
                        </div>
                        <div className="staging-metric-card">
                          <span className="staging-metric-label">Participating Assets</span>
                          <span className="staging-metric-value">
                            {commitSummary.satellites.length} Sat · {commitSummary.groundStations.length} GS
                          </span>
                          <span className="staging-metric-subtext">Coordinated resources</span>
                        </div>
                      </div>

                      {/* Per-Satellite Schedule Breakdown & Buffer Volumes */}
                      <div className="staging-asset-section">
                        <h4 className="staging-section-title">Satellite Allocations & Data Buffer Summaries</h4>
                        <div className="staging-asset-cards-grid">
                          {commitSummary.satellites.map((sat) => {
                            const satLinkIds = sat.links.map((link) => link.backendLinkId || link.linkId)
                            const satAssetConfirmed = satLinkIds.length > 0
                              && satLinkIds.every((linkId) => confirmedStagingLinks[`sat:${linkId}`])

                            return (
                            <div key={sat.satId} className="staging-asset-card">
                              <div className="staging-asset-header">
                                <div className="staging-asset-title-group">
                                  <span className="staging-asset-name">{sat.satId}</span>
                                  <span className="staging-chip">{sat.links.length} Link{sat.links.length === 1 ? '' : 's'}</span>
                                </div>
                                <div className="staging-asset-chips">
                                  <span className="staging-chip">
                                    Offload: <strong>{(sat.totalOffloadedMb / 1000).toFixed(2)} GB</strong>
                                  </span>
                                  <span className="staging-chip">
                                    Duration: <strong>{formatDurationFromSeconds(sat.totalDurationSeconds)}</strong>
                                  </span>
                                  {sat.capacityMb > 0 && (
                                    <span className="staging-chip">
                                      Peak Buffer: <strong>{(sat.peakBufferMb / 1000).toFixed(2)} / {(sat.capacityMb / 1000).toFixed(2)} GB</strong>
                                    </span>
                                  )}
                                  {sat.capacityMb > 0 && (
                                    <span className="staging-chip">
                                      Final Buffer: <strong>{(sat.finalBufferMb / 1000).toFixed(2)} GB</strong>
                                    </span>
                                  )}
                                  {sat.totalLostMb > 0 && (
                                    <span className="staging-chip staging-chip--warn">
                                      Overflow / Lost: <strong>{(sat.totalLostMb / 1000).toFixed(2)} GB</strong>
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="staging-links-table-container">
                                <table className="staging-links-table">
                                  <thead>
                                    <tr>
                                      <th>Link ID</th>
                                      <th>Activity Name</th>
                                      <th>Initiator</th>
                                      <th>Ground Station</th>
                                      <th>Start Event (UTC)</th>
                                      <th>End Event (UTC)</th>
                                      <th>Duration</th>
                                      <th>Expected Data Downlinked</th>
                                      <th className="staging-confirm-column">Confirm</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sat.links.map((link) => {
                                      const linkId = link.backendLinkId || link.linkId
                                      const actName = `DOWNLINK_${linkId}_${link.satId}-${link.gsId}`
                                      const linkConfirmed = Boolean(confirmedStagingLinks[`sat:${linkId}`])
                                      const linkInitiator = link.overrideState === 'pinned'
                                        ? `SCOPE_pinned-${userName.trim() || 'operator'}`
                                        : 'SCOPE_auto-scheduled'
                                      return (
                                        <tr key={linkId} className={linkConfirmed ? 'staging-link-row--confirmed' : ''}>
                                          <td><strong>{linkId}</strong></td>
                                          <td><code className="staging-code-cell">{actName}</code></td>
                                          <td><span className="staging-initiator-badge">{linkInitiator}</span></td>
                                          <td>{link.gsId}</td>
                                          <td>{formatUtcEventDateTime(link.startTime)}</td>
                                          <td>{formatUtcEventDateTime(link.endTime)}</td>
                                          <td>{link.duration || formatDurationFromSeconds(link.durationSeconds)}</td>
                                          <td>
                                            <strong>{(Number(link.usefulDataOffloadedMb ?? 0) / 1000).toFixed(2)} GB</strong>{' '}
                                            <span className="staging-table-subtext">({Number(link.usefulDataOffloadedMb ?? 0).toFixed(1)} MB)</span>
                                          </td>
                                          <td className="staging-confirm-cell">
                                            <input
                                              type="checkbox"
                                              className="staging-link-confirm-checkbox"
                                              checked={linkConfirmed}
                                              onChange={() => toggleStagingLinkConfirmation('sat', linkId)}
                                              disabled={confirmingSchedule}
                                              aria-label={`Confirm link ${linkId} on the satellite side`}
                                            />
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              <div className={`staging-asset-confirm-bar ${satAssetConfirmed ? 'staging-asset-confirm-bar--confirmed' : ''}`}>
                                <label className="staging-asset-confirm-label">
                                  <input
                                    type="checkbox"
                                    checked={satAssetConfirmed}
                                    onChange={() => toggleStagingAssetConfirmation('sat', sat.links)}
                                    disabled={confirmingSchedule}
                                  />
                                  <span>
                                    {satAssetConfirmed
                                      ? `${sat.satId} schedule reviewed and confirmed`
                                      : `Confirm ${sat.satId} schedule before commit`}
                                  </span>
                                </label>
                              </div>
                            </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Per-Ground Station Schedule Breakdown */}
                      <div className="staging-asset-section">
                        <h4 className="staging-section-title">Ground Station Allocations & Contact Passes</h4>
                        <div className="staging-asset-cards-grid">
                          {commitSummary.groundStations.map((gs) => {
                            const gsLinkIds = gs.links.map((link) => link.backendLinkId || link.linkId)
                            const gsAssetConfirmed = gsLinkIds.length > 0
                              && gsLinkIds.every((linkId) => confirmedStagingLinks[`gs:${linkId}`])

                            return (
                            <div key={gs.gsId} className="staging-asset-card">
                              <div className="staging-asset-header">
                                <div className="staging-asset-title-group">
                                  <span className="staging-asset-name">{gs.gsId}</span>
                                  <span className="staging-chip">{gs.links.length} Pass{gs.links.length === 1 ? '' : 'es'}</span>
                                </div>
                                <div className="staging-asset-chips">
                                  <span className="staging-chip">
                                    Data Received: <strong>{(gs.totalOffloadedMb / 1000).toFixed(2)} GB</strong>
                                  </span>
                                  <span className="staging-chip">
                                    Total Contact: <strong>{formatDurationFromSeconds(gs.totalDurationSeconds)}</strong>
                                  </span>
                                </div>
                              </div>
                              <div className="staging-links-table-container">
                                <table className="staging-links-table">
                                  <thead>
                                    <tr>
                                      <th>Link ID</th>
                                      <th>Activity Name</th>
                                      <th>Initiator</th>
                                      <th>Satellite</th>
                                      <th>Start Event (UTC)</th>
                                      <th>End Event (UTC)</th>
                                      <th>Duration</th>
                                      <th>Expected Data Received</th>
                                      <th className="staging-confirm-column">Confirm</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {gs.links.map((link) => {
                                      const linkId = link.backendLinkId || link.linkId
                                      const actName = `DOWNLINK_${linkId}_${link.satId}-${link.gsId}`
                                      const linkConfirmed = Boolean(confirmedStagingLinks[`gs:${linkId}`])
                                      const linkInitiator = link.overrideState === 'pinned'
                                        ? `SCOPE_pinned-${userName.trim() || 'operator'}`
                                        : 'SCOPE_auto-scheduled'
                                      return (
                                        <tr key={linkId} className={linkConfirmed ? 'staging-link-row--confirmed' : ''}>
                                          <td><strong>{linkId}</strong></td>
                                          <td><code className="staging-code-cell">{actName}</code></td>
                                          <td><span className="staging-initiator-badge">{linkInitiator}</span></td>
                                          <td>{link.satId}</td>
                                          <td>{formatUtcEventDateTime(link.startTime)}</td>
                                          <td>{formatUtcEventDateTime(link.endTime)}</td>
                                          <td>{link.duration || formatDurationFromSeconds(link.durationSeconds)}</td>
                                          <td>
                                            <strong>{(Number(link.usefulDataOffloadedMb ?? 0) / 1000).toFixed(2)} GB</strong>{' '}
                                            <span className="staging-table-subtext">({Number(link.usefulDataOffloadedMb ?? 0).toFixed(1)} MB)</span>
                                          </td>
                                          <td className="staging-confirm-cell">
                                            <input
                                              type="checkbox"
                                              className="staging-link-confirm-checkbox"
                                              checked={linkConfirmed}
                                              onChange={() => toggleStagingLinkConfirmation('gs', linkId)}
                                              disabled={confirmingSchedule}
                                              aria-label={`Confirm link ${linkId} on the ground station side`}
                                            />
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              <div className={`staging-asset-confirm-bar ${gsAssetConfirmed ? 'staging-asset-confirm-bar--confirmed' : ''}`}>
                                <label className="staging-asset-confirm-label">
                                  <input
                                    type="checkbox"
                                    checked={gsAssetConfirmed}
                                    onChange={() => toggleStagingAssetConfirmation('gs', gs.links)}
                                    disabled={confirmingSchedule}
                                  />
                                  <span>
                                    {gsAssetConfirmed
                                      ? `${gs.gsId} schedule reviewed and confirmed`
                                      : `Confirm ${gs.gsId} schedule before commit`}
                                  </span>
                                </label>
                              </div>
                            </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Action Bar for SatOS Commit */}
                      <div className="staging-commit-action-bar">
                        <button
                          type="button"
                          className="btn-modify-overrides"
                          onClick={handleBackToEdit}
                          disabled={confirmingSchedule}
                        >
                          Modify Overrides / Back
                        </button>
                        <button
                          type="button"
                          className="btn-fetch timeline-confirm-button btn-commit-satos"
                          disabled={
                            confirmingSchedule
                            || !sessionId
                            || finalScheduleRows.length === 0
                            || !allStagingLinksConfirmed
                            || scheduleCommitted
                          }
                          onClick={handleCommitToSatOS}
                        >
                          {confirmingSchedule
                            ? 'Committing Activities to SatOS...'
                            : scheduleCommitted
                            ? 'Schedule Already Committed to SatOS'
                            : 'Commit SCOPE Communication Activities to SatOS'}
                        </button>
                        {!confirmingSchedule && !scheduleCommitted && !allStagingLinksConfirmed && (
                          <span className="staging-commit-tooltip">
                            Every link needs to be confirmed on both its satellite side and its ground station side before committing to SatOS.
                          </span>
                        )}
                        {!confirmingSchedule && scheduleCommitted && (
                          <span className="staging-commit-tooltip">
                            This schedule was already committed to SatOS. Change an override or recalculate trade-offs to commit again.
                          </span>
                        )}
                      </div>
                    </div>
  )
})

export default StagingReviewPanel

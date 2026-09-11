import { Suspense, lazy, memo } from 'react'

import MapErrorBoundary from '../../components/MapErrorBoundary.jsx'

// The map is the heaviest thing on the page and is not needed for the landing
// view, so it stays a separate chunk.
const MissionMap = lazy(() => import('../../components/MissionMap.jsx'))

const MapPanel = memo(function MapPanel({
  activeMapAsset,
  activePlanningWindow,
  expandedSections,
  formatAltitude,
  formatCoordinate,
  formatTimelinePlayheadDateTime,
  getPanelDragClassName,
  getPanelDropZoneProps,
  getPanelHeadingDragProps,
  groundTrackWindowHours,
  handleSelectMapAsset,
  mapViewHeightPx,
  missionMapRef,
  planningTimeMode,
  preparedSatelliteTracks,
  renderPanelDragHandle,
  renderSectionChevron,
  schedulerLaunched,
  selectedAssetsWithoutLocation,
  setActiveMapAssetId,
  setGroundTrackWindowHours,
  setShowGroundStationVisibilityCircles,
  setShowGroundTracks,
  setShowSatelliteVisibilityCircles,
  showGroundStationVisibilityCircles,
  showGroundTracks,
  showSatelliteVisibilityCircles,
  toggleSection,
  visibleMapAssetListRef,
  visibleMapAssets,
}) {
  return (
            <section
              className={`panel map-panel${getPanelDragClassName('mapView')}`}
              {...getPanelDropZoneProps('mapView')}
            >
              <div
                className="panel-heading panel-heading--map"
                {...getPanelHeadingDragProps('mapView')}
              >
                <div className="panel-heading-lead">
                  {renderPanelDragHandle('mapView')}
                <div className="panel-heading-title">
                  <h2>Map View</h2>
                </div>
                </div>
                <div className="map-panel-controls">
                  <button
                    type="button"
                    className="map-panel-toggle"
                    onClick={() => toggleSection('mapView')}
                    aria-expanded={expandedSections.mapView}
                    aria-controls="map-panel-content"
                    aria-label={expandedSections.mapView ? 'Collapse map view' : 'Expand map view'}
                  >
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.mapView)}
                    </span>
                  </button>
                </div>
              </div>

              {expandedSections.mapView && (
                <div id="map-panel-content" className="map-layout">
                  <div className="map-canvas-shell">
                    <MapErrorBoundary>
                      <Suspense
                        fallback={(
                          <div className="mission-map-shell">
                            <div className="mission-map-state" role="status">Loading map...</div>
                          </div>
                        )}
                      >
                        <MissionMap
                          ref={missionMapRef}
                          heightPx={mapViewHeightPx}
                          assets={visibleMapAssets}
                          satelliteTracks={preparedSatelliteTracks}
                          activeAssetId={activeMapAsset?.id ?? null}
                          onSelectAsset={handleSelectMapAsset}
                          timeMode={activePlanningWindow?.timeMode ?? planningTimeMode}
                          showGroundStationVisibility={showGroundStationVisibilityCircles}
                          showSatelliteVisibility={showSatelliteVisibilityCircles}
                          showGroundTracks={showGroundTracks}
                          groundTrackWindowHours={groundTrackWindowHours}
                        />
                      </Suspense>
                    </MapErrorBoundary>
                  </div>

                  <aside className="map-sidebar" style={{ maxHeight: `${mapViewHeightPx}px` }}>
                    <div className="map-sidebar-section">
                      <h3>Map Layers</h3>
                      <div
                        className={`map-layer-controls-wrapper${
                          schedulerLaunched ? '' : ' map-layer-controls-wrapper--disabled'
                        }`}
                      >
                        <div className="map-layer-toggle-list">
                          <div className="map-layer-toggle">
                            <span className="map-layer-toggle-label">
                              <span
                                className="map-layer-toggle-swatch map-layer-toggle-swatch--ground-station"
                                aria-hidden="true"
                              ></span>
                              Ground station visibility circles
                            </span>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={showGroundStationVisibilityCircles}
                                disabled={!schedulerLaunched}
                                onChange={() => setShowGroundStationVisibilityCircles((current) => !current)}
                              />
                              <span className="toggle-switch-track" aria-hidden="true">
                                <span className="toggle-switch-thumb"></span>
                              </span>
                            </label>
                          </div>
                          <div className="map-layer-toggle">
                            <span className="map-layer-toggle-label">
                              <span
                                className="map-layer-toggle-swatch map-layer-toggle-swatch--satellite"
                                aria-hidden="true"
                              ></span>
                              Satellite visibility circles
                            </span>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={showSatelliteVisibilityCircles}
                                disabled={!schedulerLaunched}
                                onChange={() => setShowSatelliteVisibilityCircles((current) => !current)}
                              />
                              <span className="toggle-switch-track" aria-hidden="true">
                                <span className="toggle-switch-thumb"></span>
                              </span>
                            </label>
                          </div>
                          <div className="map-layer-toggle">
                            <span className="map-layer-toggle-label">
                              <span
                                className="map-layer-toggle-swatch map-layer-toggle-swatch--ground-track"
                                aria-hidden="true"
                              ></span>
                              Ground tracks
                            </span>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={showGroundTracks}
                                disabled={!schedulerLaunched}
                                onChange={() => setShowGroundTracks((current) => !current)}
                              />
                              <span className="toggle-switch-track" aria-hidden="true">
                                <span className="toggle-switch-thumb"></span>
                              </span>
                            </label>
                          </div>
                          <label className="time-window-field map-layer-window-field">
                            <span>Ground track window (hours)</span>
                            <input
                              className="time-window-input"
                              type="number"
                              min="0"
                              step="0.5"
                              value={groundTrackWindowHours}
                              disabled={!schedulerLaunched || !showGroundTracks}
                              onChange={(event) => {
                                const parsed = Number(event.target.value)
                                setGroundTrackWindowHours(Number.isFinite(parsed) ? Math.max(0, parsed) : 0)
                              }}
                            />
                          </label>
                        </div>
                        {!schedulerLaunched && (
                          <span className="map-layer-controls-tooltip">
                            Launch the communication scheduler to unlock map layer settings.
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="map-sidebar-section">
                      <h3>Visible Assets</h3>
                      {visibleMapAssets.length > 0 ? (
                        <div ref={visibleMapAssetListRef} className="map-asset-card-list">
                          {visibleMapAssets.map((asset) => (
                            <button
                              key={asset.id}
                              type="button"
                              data-map-asset-id={asset.id}
                              aria-pressed={activeMapAsset?.id === asset.id}
                              className={`map-asset-card ${
                                activeMapAsset?.id === asset.id ? 'map-asset-card--active' : ''
                              }`}
                              onClick={() => setActiveMapAssetId((current) => (
                                current === asset.id ? null : asset.id
                              ))}
                            >
                              <div className="map-asset-card-header">
                                <span className={`map-asset-dot map-asset-dot--${asset.markerType}`}></span>
                                <span className="map-asset-card-name">{asset.name.toUpperCase()}</span>
                              </div>
                              <div className="map-asset-card-type">{asset.type}</div>
                              <dl className="map-asset-card-grid">
                                <dt>Latitude</dt>
                                <dd>{formatCoordinate(asset.latitude, 'N', 'S')}</dd>
                                <dt>Longitude</dt>
                                <dd>{formatCoordinate(asset.longitude, 'E', 'W')}</dd>
                                {asset.markerType === 'ground-station' && (
                                  <>
                                    <dt>Min. Elevation</dt>
                                    <dd>
                                      {Number.isFinite(asset.minLinkElevation)
                                        ? `${asset.minLinkElevation.toFixed(1)}°`
                                        : '—'}
                                    </dd>
                                  </>
                                )}
                                {asset.markerType === 'satellite' && (
                                  <>
                                    <dt>Altitude</dt>
                                    <dd>{formatAltitude(asset.altitude)}</dd>
                                    <dt>Track Time</dt>
                                    <dd>{formatTimelinePlayheadDateTime(asset.timestamp)}</dd>
                                  </>
                                )}
                              </dl>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p>No selected assets with usable map coordinates yet.</p>
                      )}
                    </div>

                    {selectedAssetsWithoutLocation.length > 0 && (
                      <div className="map-sidebar-section">
                        <h3>Selected Without Location</h3>
                        <div className="map-missing-location-list">
                          {selectedAssetsWithoutLocation.map((asset) => (
                            <div key={asset.id} className="map-missing-location-card">
                              <span className="map-missing-location-name">{asset.name.toUpperCase()}</span>
                              <span className="map-missing-location-type">{asset.type}</span>
                              <span className="map-missing-location-copy">{asset.locationMessage}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </aside>
                </div>
              )}
            </section>
  )
})

export default MapPanel

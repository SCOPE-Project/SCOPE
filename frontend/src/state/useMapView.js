import { useState } from 'react'

// Map layer toggles and which asset the map is currently centred on.
//
// Purely presentational: nothing here reaches the backend, and none of it
// survives a reload.
export const useMapView = () => {
  const [activeMapAssetId, setActiveMapAssetId] = useState(null)
  const [showGroundStationVisibilityCircles, setShowGroundStationVisibilityCircles] = useState(true)
  const [showSatelliteVisibilityCircles, setShowSatelliteVisibilityCircles] = useState(true)
  const [showGroundTracks, setShowGroundTracks] = useState(true)
  const [groundTrackWindowHours, setGroundTrackWindowHours] = useState(6)

  const reset = () => {
    setActiveMapAssetId(null)
    setShowGroundStationVisibilityCircles(true)
    setShowSatelliteVisibilityCircles(true)
    setShowGroundTracks(true)
    setGroundTrackWindowHours(6)
  }

  return {
    activeMapAssetId,
    setActiveMapAssetId,
    showGroundStationVisibilityCircles,
    setShowGroundStationVisibilityCircles,
    showSatelliteVisibilityCircles,
    setShowSatelliteVisibilityCircles,
    showGroundTracks,
    setShowGroundTracks,
    groundTrackWindowHours,
    setGroundTrackWindowHours,
    resetMapView: reset,
  }
}

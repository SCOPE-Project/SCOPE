import { useEffect, useMemo, useRef, useState } from 'react'

import { BACKEND_BASE_URL, initializeAssets } from '../api/scopeApi.js'
import { normalizeAssetClassification } from '../domain/assets.js'

// The mission assets SatOS knows about, the operator's selection among them,
// and the health of the two services they depend on.
//
// The health check drives everything else: assets load automatically as soon
// as the backend answers, so the operator never has to trigger the first
// fetch by hand.
export const useMissionAssets = ({ view, onWorkspaceReset, onError }) => {
  const [assets, setAssets] = useState([])
  const [assetSchedules, setAssetSchedules] = useState([])
  const [assetsCached, setAssetsCached] = useState(null)
  const [loading, setLoading] = useState(false)
  const [backendAlive, setBackendAlive] = useState(null)
  const [satosAlive, setSatosAlive] = useState(null)
  const [selectedSatellites, setSelectedSatellites] = useState([])
  const [selectedGroundStations, setSelectedGroundStations] = useState([])
  useEffect(() => {
    let active = true
    let intervalId = null
    let checkInFlight = false

    const fetchWithTimeout = async (url, options = {}, timeoutMs = 1500) => {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

      try {
        return await fetch(url, {
          ...options,
          signal: controller.signal,
        })
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    const checkConnections = async () => {
      if (checkInFlight) {
        return
      }

      checkInFlight = true

      try {
        const backendResponse = await fetchWithTimeout(`${BACKEND_BASE_URL}/status`, {
          cache: 'no-store',
        })
        if (!active) {
          return
        }

        if (backendResponse.ok) {
          setBackendAlive(true)

          try {
            const satosResponse = await fetchWithTimeout(`${BACKEND_BASE_URL}/satos/asset/list`, {
              cache: 'no-store',
            }, 1500)
            if (active) {
              setSatosAlive(satosResponse.ok)
            }
          } catch {
            if (active) {
              setSatosAlive(false)
            }
          }
        } else {
          setBackendAlive(false)
          setSatosAlive(null)
        }
      } catch {
        if (active) {
          setBackendAlive(false)
          setSatosAlive(null)
        }
      } finally {
        checkInFlight = false
      }
    }

    const stopPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const startPolling = () => {
      if (
        intervalId !== null
        || view !== 'landing'
        || document.visibilityState !== 'visible'
      ) {
        return
      }

      intervalId = window.setInterval(checkConnections, 2000)
    }

    checkConnections()
    const handleVisibilityChange = () => {
      if (view !== 'landing') {
        stopPolling()
        return
      }

      if (document.visibilityState === 'visible') {
        checkConnections()
        startPolling()
      } else {
        stopPolling()
      }
    }

    startPolling()

    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      active = false
      stopPolling()
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [view])

  const fetchAssets = async ({ forceRefresh = false } = {}) => {
    setLoading(true)
    onError(null)
    setAssets([])
    setAssetSchedules([])
    setAssetsCached(null)
    onWorkspaceReset()
    try {
      const data = await initializeAssets({ forceRefresh })
      if (data && Array.isArray(data.assets)) {
        setSatosAlive(true)
        setAssets(data.assets)
        setAssetSchedules(Array.isArray(data.schedules) ? data.schedules : [])
        setAssetsCached(Boolean(data.cached))
      } else {
        throw new Error("Invalid response format from server")
      }
    } catch (err) {
      console.error(err)
      setSatosAlive(false)
      onError(err.message || 'Failed to fetch assets. Verify your backend or SatOS credentials.')
    } finally {
      setLoading(false)
    }
  }

  // Mission assets are loaded automatically as soon as the backend answers its
  // health check, so the operator never has to trigger the first fetch by hand.
  // The ref stops a successful load from repeating (fetchAssets resets the
  // workspace); a failed attempt is retried when the backend comes back, or
  // manually from the status strip on the landing page.
  const assetAutoLoadAttemptedRef = useRef(false)
  const fetchAssetsRef = useRef(fetchAssets)

  // Kept in an effect rather than assigned during render, so the auto-load
  // effect below can call the latest fetchAssets without taking a dependency
  // on its identity (which changes on every render).
  useEffect(() => {
    fetchAssetsRef.current = fetchAssets
  })

  useEffect(() => {
    if (backendAlive !== true) {
      if (backendAlive === false) {
        assetAutoLoadAttemptedRef.current = false
      }
      return
    }
    if (assetAutoLoadAttemptedRef.current || loading || assets.length > 0) {
      return
    }
    assetAutoLoadAttemptedRef.current = true
    fetchAssetsRef.current()
  }, [backendAlive, loading, assets.length])
  const toggleSatellite = (name) => {
    setSelectedSatellites((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
  }

  const toggleGroundStation = (name) => {
    setSelectedGroundStations((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
  }

  const satelliteAssets = useMemo(
    () => assets.filter((asset) => normalizeAssetClassification(asset) === 'satellite'),
    [assets],
  )
  const groundStationAssets = useMemo(
    () => assets.filter((asset) => normalizeAssetClassification(asset) === 'ground_station'),
    [assets],
  )
  const unavailableAssets = useMemo(
    () => assets.filter((asset) => normalizeAssetClassification(asset) === 'ineligible'),
    [assets],
  )
  const missionAssetsLoaded = assets.length > 0
  return {
    assets,
    setAssets,
    assetSchedules,
    setAssetSchedules,
    assetsCached,
    loading,
    backendAlive,
    satosAlive,
    selectedSatellites,
    setSelectedSatellites,
    selectedGroundStations,
    setSelectedGroundStations,
    toggleSatellite,
    toggleGroundStation,
    satelliteAssets,
    groundStationAssets,
    unavailableAssets,
    missionAssetsLoaded,
    fetchAssets,
  }
}

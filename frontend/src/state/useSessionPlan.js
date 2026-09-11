import { useState } from 'react'

// Everything the backend owns about the current run: the propagation result,
// the filtered links, and the scheduling session with its trade-off groups.
//
// The backend plan is authoritative. Nothing here is derived locally -- the
// frontend never invents a schedule decision, a score, or an offloaded
// volume; it only holds what the backend returned and hands it to the views.
export const useSessionPlan = () => {
  // Propagation output, kept so a rerun with an unchanged asset/window
  // selection can skip the orbit engine entirely.
  const [satelliteTracks, setSatelliteTracks] = useState({})
  const [orbitEngineRunId, setOrbitEngineRunId] = useState(null)
  const [propagationResult, setPropagationResult] = useState(null)
  const [propagationRequestKey, setPropagationRequestKey] = useState(null)

  // Filtering output.
  const [filterRunId, setFilterRunId] = useState(null)
  const [filteredLinks, setFilteredLinks] = useState([])
  const [overviewRows, setOverviewRows] = useState([])

  // Scheduling session.
  const [sessionId, setSessionId] = useState(null)
  const [sessionPlan, setSessionPlan] = useState(null)
  const [tradeOffCards, setTradeOffCards] = useState([])
  const [activeTradeOffCardIndex, setActiveTradeOffCardIndex] = useState(0)
  const [selectedTradeOffOption, setSelectedTradeOffOption] = useState({})

  // Set while an override request is in flight, so a second click cannot
  // race the first and adopt an older plan.
  const [overridingLinkId, setOverridingLinkId] = useState(null)

  /** Drops the scheduling session but keeps the propagation result. */
  const clearSession = () => {
    setFilterRunId(null)
    setFilteredLinks([])
    setOverviewRows([])
    setSessionId(null)
    setSessionPlan(null)
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption({})
  }

  /** Drops the propagation result too, forcing a full rerun. */
  const clearPropagation = () => {
    setSatelliteTracks({})
    setOrbitEngineRunId(null)
    setPropagationResult(null)
    setPropagationRequestKey(null)
  }

  const resetSessionPlan = () => {
    clearPropagation()
    clearSession()
    setOverridingLinkId(null)
  }

  return {
    satelliteTracks,
    setSatelliteTracks,
    orbitEngineRunId,
    setOrbitEngineRunId,
    propagationResult,
    setPropagationResult,
    propagationRequestKey,
    setPropagationRequestKey,
    filterRunId,
    setFilterRunId,
    filteredLinks,
    setFilteredLinks,
    overviewRows,
    setOverviewRows,
    sessionId,
    setSessionId,
    sessionPlan,
    setSessionPlan,
    tradeOffCards,
    setTradeOffCards,
    activeTradeOffCardIndex,
    setActiveTradeOffCardIndex,
    selectedTradeOffOption,
    setSelectedTradeOffOption,
    overridingLinkId,
    setOverridingLinkId,
    clearSession,
    clearPropagation,
    resetSessionPlan,
  }
}

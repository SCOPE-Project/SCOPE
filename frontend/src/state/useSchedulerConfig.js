import { useState } from 'react'

import {
  DEFAULT_DATA_CAPACITY_GB,
  DEFAULT_DATA_GENERATION_MBPS,
  DEFAULT_DATA_START_FILL_GB,
  DEFAULT_DOWNLINK_RATE_MBPS,
  DEFAULT_SCORING_ALPHA,
  DEFAULT_SCORING_EXPONENT,
  DEFAULT_TRADE_OFF_STRATEGY,
} from '../config/constants.js'
import { parseOptionalDegreeInput } from '../domain/assets.js'

// Everything the operator configures on the landing page before a run: the
// link filters, the satellite buffer model, and the scoring strategy.
//
// The fields are held as strings because they are text inputs; the parsed
// values and their validity are derived here so no consumer has to re-parse
// them, and so "empty" (no filter) stays distinguishable from "not a number".
export const useSchedulerConfig = () => {
  const [minimumLinkElevationFilterDeg, setMinimumLinkElevationFilterDeg] = useState('')
  const [minimumPeakElevationFilterDeg, setMinimumPeakElevationFilterDeg] = useState('')

  // Default buffer configuration sent to the backend session engine.
  const [dataStartFillGb, setDataStartFillGb] = useState(DEFAULT_DATA_START_FILL_GB)
  const [dataGenerationMbps, setDataGenerationMbps] = useState(DEFAULT_DATA_GENERATION_MBPS)
  const [dataCapacityGb, setDataCapacityGb] = useState(DEFAULT_DATA_CAPACITY_GB)
  const [dataDownlinkRateMbps, setDataDownlinkRateMbps] = useState(DEFAULT_DOWNLINK_RATE_MBPS)
  const [tradeOffStrategy, setTradeOffStrategy] = useState(DEFAULT_TRADE_OFF_STRATEGY)
  const [scoringAlpha, setScoringAlpha] = useState(DEFAULT_SCORING_ALPHA)
  const [scoringExponent, setScoringExponent] = useState(DEFAULT_SCORING_EXPONENT)

  const [clearExistingScopeActivities, setClearExistingScopeActivities] = useState(false)

  const reset = () => {
    setMinimumLinkElevationFilterDeg('')
    setMinimumPeakElevationFilterDeg('')
    setDataStartFillGb(DEFAULT_DATA_START_FILL_GB)
    setDataGenerationMbps(DEFAULT_DATA_GENERATION_MBPS)
    setDataCapacityGb(DEFAULT_DATA_CAPACITY_GB)
    setDataDownlinkRateMbps(DEFAULT_DOWNLINK_RATE_MBPS)
    setTradeOffStrategy(DEFAULT_TRADE_OFF_STRATEGY)
    setScoringAlpha(DEFAULT_SCORING_ALPHA)
    setScoringExponent(DEFAULT_SCORING_EXPONENT)
    setClearExistingScopeActivities(false)
  }

  const minimumLinkElevationFilterValue = parseOptionalDegreeInput(minimumLinkElevationFilterDeg)
  const minimumPeakElevationFilterValue = parseOptionalDegreeInput(minimumPeakElevationFilterDeg)
  const linkFiltersValid = [
    minimumLinkElevationFilterValue,
    minimumPeakElevationFilterValue,
  ].every((value) => value === null || (!Number.isNaN(value) && value >= 0 && value <= 90))

  return {
    minimumLinkElevationFilterDeg,
    setMinimumLinkElevationFilterDeg,
    minimumPeakElevationFilterDeg,
    setMinimumPeakElevationFilterDeg,
    minimumLinkElevationFilterValue,
    minimumPeakElevationFilterValue,
    linkFiltersValid,
    dataStartFillGb,
    setDataStartFillGb,
    dataGenerationMbps,
    setDataGenerationMbps,
    dataCapacityGb,
    setDataCapacityGb,
    dataDownlinkRateMbps,
    setDataDownlinkRateMbps,
    tradeOffStrategy,
    setTradeOffStrategy,
    scoringAlpha,
    setScoringAlpha,
    scoringExponent,
    setScoringExponent,
    clearExistingScopeActivities,
    setClearExistingScopeActivities,
    resetSchedulerConfig: reset,
  }
}

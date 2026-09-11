import { useState } from 'react'

// The staged-review step between "the backend has a plan" and "SatOS has the
// activities": which links the operator has signed off, and the progress of
// the commit itself.
//
// A link is reviewed once from its satellite side and, separately, once from
// its ground station side -- these keys must never collide, so each side gets
// its own namespaced slot.
export const stagingLinkConfirmKey = (side, linkId) => `${side}:${linkId}`

export const useStagingReview = () => {
  const [confirmingSchedule, setConfirmingSchedule] = useState(false)
  const [confirmationProgress, setConfirmationProgress] = useState(0)
  const [confirmationStep, setConfirmationStep] = useState('')
  const [isScheduleStaged, setIsScheduleStaged] = useState(false)
  // Per-asset "I reviewed this asset's staged links" checkbox, required
  // before the SatOS commit button unlocks. Reset every time staging is
  // (re)entered or abandoned so a stale confirmation can never carry over
  // to a schedule that has since changed.
  const [confirmedStagingLinks, setConfirmedStagingLinks] = useState({})
  const [confirmationSuccess, setConfirmationSuccess] = useState(false)
  const [scheduleCommitted, setScheduleCommitted] = useState(false)
  const [confirmedScheduleCount, setConfirmedScheduleCount] = useState(0)
  const [createdActivitiesCount, setCreatedActivitiesCount] = useState(0)

  const toggleStagingLinkConfirmation = (side, linkId) => {
    const key = stagingLinkConfirmKey(side, linkId)
    setConfirmedStagingLinks((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  // The alternative to checking each of this asset's links one by one:
  // confirms every link belonging to it, on this side only, in a single
  // click -- or, if they are all already confirmed, un-confirms them all
  // together. Never touches the other side's confirmations for those links.
  const toggleStagingAssetConfirmation = (side, links) => {
    const keys = links.map((link) => stagingLinkConfirmKey(side, link.backendLinkId || link.linkId))

    setConfirmedStagingLinks((current) => {
      const allConfirmed = keys.length > 0 && keys.every((key) => current[key])
      const next = { ...current }
      keys.forEach((key) => {
        next[key] = !allConfirmed
      })
      return next
    })
  }

  // Entering staging always starts from zero sign-offs, so a confirmation
  // made against an earlier version of the schedule can never carry over.
  const enterStagingReview = () => {
    setConfirmationSuccess(false)
    setIsScheduleStaged(true)
    setConfirmedStagingLinks({})
  }

  const leaveStagingReview = () => {
    setIsScheduleStaged(false)
    setConfirmedStagingLinks({})
  }

  // Abandoning or re-entering staging clears every sign-off: a confirmation
  // always refers to one specific version of the schedule.
  const resetStagingReview = () => {
    setIsScheduleStaged(false)
    setConfirmationSuccess(false)
    setScheduleCommitted(false)
    setConfirmedScheduleCount(0)
    setCreatedActivitiesCount(0)
    setConfirmedStagingLinks({})
  }

  /** True once every scheduled link is signed off on BOTH of its sides. */
  const areAllLinksConfirmed = (linkIds) => (
    linkIds.length > 0
    && linkIds.every((linkId) => (
      confirmedStagingLinks[stagingLinkConfirmKey('sat', linkId)]
      && confirmedStagingLinks[stagingLinkConfirmKey('gs', linkId)]
    ))
  )

  return {
    confirmingSchedule,
    setConfirmingSchedule,
    confirmationProgress,
    setConfirmationProgress,
    confirmationStep,
    setConfirmationStep,
    isScheduleStaged,
    setIsScheduleStaged,
    confirmedStagingLinks,
    setConfirmedStagingLinks,
    confirmationSuccess,
    setConfirmationSuccess,
    scheduleCommitted,
    setScheduleCommitted,
    confirmedScheduleCount,
    setConfirmedScheduleCount,
    createdActivitiesCount,
    setCreatedActivitiesCount,
    stagingLinkConfirmKey,
    enterStagingReview,
    leaveStagingReview,
    toggleStagingLinkConfirmation,
    toggleStagingAssetConfirmation,
    areAllLinksConfirmed,
    resetStagingReview,
  }
}

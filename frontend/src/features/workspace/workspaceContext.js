import { createContext, useContext } from 'react'

// Three narrow contexts rather than one bundle, so a component declares which
// concern it depends on and a change to one does not re-render consumers of
// the others.
//
//   Session   what the backend owns: the plan, the rows, the run, and the
//             actions that change any of them.
//   Timeline  how the timeline is being looked at: playhead, zoom, marking,
//             expansion, and the geometry derived from them.
//   Layout    panel geometry and collapse state.

const missing = (name) => {
  throw new Error(`${name} was used outside its provider.`)
}

export const SessionContext = createContext(null)
export const TimelineContext = createContext(null)
export const LayoutContext = createContext(null)

export const useSession = () => useContext(SessionContext) ?? missing('useSession')
export const useTimeline = () => useContext(TimelineContext) ?? missing('useTimeline')
export const useLayout = () => useContext(LayoutContext) ?? missing('useLayout')

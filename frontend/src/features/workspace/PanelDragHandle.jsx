import { memo } from 'react'

import { PANEL_LABELS } from '../../config/constants.js'

const PanelDragHandle = memo(function PanelDragHandle({
  panelId,
  handlePanelDragEnd,
  handlePanelDragStart,
}) {
  return (
      <button
        type="button"
        className="panel-drag-handle"
        draggable="true"
        onDragStart={handlePanelDragStart(panelId)}
        onDragEnd={handlePanelDragEnd}
        aria-label={`Drag to move the ${PANEL_LABELS[panelId]} panel`}
        title="Drag to move panel"
      >
        <span className="panel-drag-handle-icon" aria-hidden="true"></span>
      </button>
  )
})

export default PanelDragHandle

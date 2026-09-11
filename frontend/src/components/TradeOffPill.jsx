import { memo } from 'react'

const TradeOffPill = memo(function TradeOffPill({
  tradeOffId,
}) {
  return (
      <span className="tradeoff-id-pill">
        {tradeOffId}
      </span>
  )
})

export default TradeOffPill

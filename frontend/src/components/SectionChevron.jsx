import { memo } from 'react'

const SectionChevron = memo(function SectionChevron({
  expanded,
}) {
  return (
      <svg
        className={`section-toggle-chevron ${expanded ? 'section-toggle-chevron--expanded' : ''}`}
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M2.25 4.25 6 8l3.75-3.75" />
      </svg>
  )
})

export default SectionChevron

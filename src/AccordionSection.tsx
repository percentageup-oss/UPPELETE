import type { ReactNode } from 'react'

/** One collapsible section of the Effects tab. Open state is owned by the panel so only one
 * section is expanded at a time. The body always renders (just hidden while collapsed). */
export function AccordionSection({ id, title, count, open, onToggle, children }: {
  id: string
  title: string
  count?: number
  open: boolean
  onToggle: (id: string) => void
  children: ReactNode
}) {
  return <section className={`accordion-section ${open ? 'open' : ''}`}>
    <h3 className="accordion-heading">
      <button type="button" id={`accordion-${id}-header`} className="accordion-trigger" aria-expanded={open}
        aria-controls={`accordion-${id}-body`} onClick={() => onToggle(id)}>
        <span className="accordion-chevron" aria-hidden="true">▸</span>
        <span className="accordion-title">{title}</span>
        {count !== undefined ? <span className="accordion-count">{count}</span> : null}
      </button>
    </h3>
    <div id={`accordion-${id}-body`} role="region" aria-labelledby={`accordion-${id}-header`} className="accordion-body" hidden={!open}>{children}</div>
  </section>
}

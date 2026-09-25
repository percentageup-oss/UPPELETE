import { useEffect, useState } from 'react'
import type { Group } from './core/edit'
import type { GroupMember } from './core/groupCommands'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { ActionBar, Row, Section, TimeFields } from './style/controls'

const memberLabel = (member: GroupMember) => {
  if (member.kind === 'text') { const line = member.item.text.replace(/\s+/g, ' ').trim(); return line.length > 32 ? `${line.slice(0, 31)}…` : line || 'Title' }
  return member.item.name?.trim() || member.item.geometry.kind
}

/**
 * Edits one group (schema 22, docs/EDITING.md "Groups"): its name, where it starts (moves every
 * member together), and the actions that treat it as one item. Each member stays editable by
 * choosing it from the list (or the Layers tab, or double-clicking it on the stage).
 */
export function GroupInspector({ group, members, startUs, endUs, onRename, onMove, onSelectPart, onUngroup, onDuplicate, onDelete, onInvalid }: {
  group: Group; members: readonly GroupMember[]; startUs: number; endUs: number
  onRename: (name: string) => void; onMove: (startUs: number) => void
  onSelectPart: (member: GroupMember) => void
  onUngroup: () => void; onDuplicate: () => void; onDelete: () => void; onInvalid: (message: string) => void
}) {
  const [name, setName] = useState(group.name)
  const [start, setStart] = useState(formatTimestamp(startUs, ':'))
  useEffect(() => setName(group.name), [group.id, group.name])
  useEffect(() => setStart(formatTimestamp(startUs, ':')), [group.id, startUs])
  const commitStart = () => {
    const parsed = parseEditedTimestamp(start, startUs)
    if (parsed === null) { onInvalid('Use a valid HH:MM:SS:mmm timestamp.'); return }
    if (parsed !== startUs) onMove(parsed)
  }
  return <section className="editor-form group-inspector" aria-label="Group settings">
    <Row label="Name" htmlFor="group-name">
      <input id="group-name" type="text" value={name} maxLength={200} placeholder="Group" onChange={(event) => setName(event.target.value)}
        onBlur={() => { if (name !== group.name) onRename(name) }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    </Row>
    <TimeFields fields={[
      { id: 'group-start', label: 'Start', value: start, onChange: setStart, onBlur: commitStart },
      { id: 'group-length', label: 'Length', value: formatTimestamp(endUs - startUs, ':'), ariaLabel: 'Length (from the earliest start to the latest end)', onChange: () => {}, onBlur: () => {} },
    ]} />
    <p className="style-hint">Changing the start moves every item in the group by the same amount. Trim or retime a single item by selecting it below.</p>
    <Section id="group-members" title={`Items (${members.length})`}>
      <ul className="group-members">
        {members.map((member) => <li key={member.item.id}>
          <button type="button" onClick={() => onSelectPart(member)} title="Select this item to edit it on its own">
            <span className="layer-glyph" aria-hidden="true">{member.kind === 'text' ? 'T' : 'S'}</span> {memberLabel(member)}
          </button>
        </li>)}
      </ul>
    </Section>
    <ActionBar>
      <button type="button" onClick={onUngroup}>Ungroup</button>
      <button type="button" onClick={onDuplicate}>Duplicate</button>
      <button className="danger" type="button" onClick={onDelete}>Delete group</button>
    </ActionBar>
  </section>
}

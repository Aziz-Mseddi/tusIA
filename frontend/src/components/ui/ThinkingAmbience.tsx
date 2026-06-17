/**
 * Ambient response while the assistant is thinking:
 *  - .thinking-beam — a soft gold light column that breathes behind the UI (position: fixed)
 *  - .thinking-scan — a thin scanning light bar across the top of the chat panel (position: sticky)
 *
 * Usage: render as the FIRST child of the scrollable messages container:
 *
 *   <div className="... overflow-y-auto ...">
 *     <ThinkingAmbience active={loading} />
 *     {messages.map(...)}
 *   </div>
 *
 * The scan bar uses negative margins to span the panel's padding edge-to-edge —
 * tune the `--scan-inset` var in CSS if your panel padding isn't 16px.
 */
interface ThinkingAmbienceProps {
  active: boolean
}

export function ThinkingAmbience({ active }: ThinkingAmbienceProps) {
  if (!active) return null
  return (
    <>
      <span className="thinking-beam" aria-hidden />
      <span className="thinking-scan" aria-hidden>
        <span className="thinking-scan-bar" />
      </span>
    </>
  )
}

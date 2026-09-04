/** Compatibility helpers for DSH session API transitions. */
export function sessionEvents(session) {
  if (typeof session?.snapshotEvents === 'function') {
    return session.snapshotEvents()
  }
  return Array.isArray(session?.events) ? session.events : []
}

export const DAY_ABBR = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function toIso(d) { return d.toISOString().slice(0, 10) }
export function todayIso() { return toIso(new Date()) }

export function weekDays(offset = 0) {
  const now = new Date(), day = now.getDay()
  const mon = new Date(now)
  mon.setDate(now.getDate() - ((day + 6) % 7) + offset * 7)
  mon.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return toIso(d)
  })
}

export function weekLabel(offset) {
  const days = weekDays(offset)
  const fmt = s => new Date(s + 'T12:00:00').toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })
  return `${fmt(days[0])} — ${fmt(days[6])}`
}

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function fmtKr(n) { return n.toLocaleString('da-DK') }

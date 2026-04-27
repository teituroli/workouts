const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer ?? 'return=representation',
    },
    ...opts,
  })
  if (!res.ok) throw new Error(await res.text())
  const t = await res.text()
  return t ? JSON.parse(t) : []
}

export async function hashPw(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const DB = {
  async getPw() { const r = await sb('settings?key=eq.gymfine_password&select=value'); return r[0]?.value ?? null },
  async setPw(h) { await sb('settings', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: JSON.stringify({ key: 'gymfine_password', value: h }) }) },
  async getColleagues() { return sb('colleagues?select=*&deleted_at=is.null&order=name.asc') },
  async addColleague(d) { const r = await sb('colleagues', { method: 'POST', body: JSON.stringify(d) }); return r[0] },
  async patchColleague(id, d) { await sb(`colleagues?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(d) }) },
  async getCitations() { return sb('citations?select=*&order=created_at.desc') },
  async addCitation(cid, amount, note, weekStart) { const r = await sb('citations', { method: 'POST', body: JSON.stringify({ colleague_id: cid, amount, note: note || null, week_start: weekStart || null }) }); return r[0] },
  async delCitation(id) { await sb(`citations?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' }) },
  async getWorkouts() {
    const since = new Date(); since.setDate(since.getDate() - 60)
    return sb(`workout_logs?select=*&date=gte.${since.toISOString().slice(0, 10)}&order=date.desc`)
  },
  async addWorkout(cid, date) { const r = await sb('workout_logs', { method: 'POST', body: JSON.stringify({ colleague_id: cid, date }) }); return r[0] },
  async delWorkout(id) { await sb(`workout_logs?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' }) },
}
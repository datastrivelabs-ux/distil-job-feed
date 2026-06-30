import { extractSkillsFromText } from './skills.js'

// RemoteOK public API — no auth required
const BASE = 'https://remoteok.com/api'

export interface RemoteokJob {
  externalId: string; title: string; company: string; location: string
  city: string; type: string; salary: string | null
  description: string; requiredSkills: string[]; applyUrl: string
}

interface RemoteokResult {
  id: string
  company: string
  position: string
  location: string
  url: string
  description: string
  tags: string[]
  salary_min?: number
  salary_max?: number
  date: string
}

function buildSalary(r: RemoteokResult): string | null {
  if (!r.salary_min && !r.salary_max) return null
  const fmt = (n: number) => `$${Math.round(n / 1000)}k`
  return r.salary_min && r.salary_max ? `${fmt(r.salary_min)}–${fmt(r.salary_max)}` : null
}

export async function fetchRemoteokJobs(): Promise<RemoteokJob[]> {
  // RemoteOK requires a user-agent header — plain fetch gets 403
  const res = await fetch(BASE, {
    headers: { 'User-Agent': 'distil-job-feed/1.0 (job aggregator; contact: distil.dsl@gmail.com)' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const json = await res.json() as (RemoteokResult | { legal: string })[]
  // First element is a legal notice object — skip it
  const items = json.filter((item): item is RemoteokResult => 'id' in item && 'position' in item)

  return items.slice(0, 100).map((r) => {
    const desc = (r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const skills = r.tags?.length ? r.tags.slice(0, 10) : extractSkillsFromText(desc)
    return {
      externalId: `remoteok-${r.id}`,
      title: r.position,
      company: r.company || 'Unknown',
      location: r.location || 'Worldwide',
      city: 'Remote',
      type: 'Remote',
      salary: buildSalary(r),
      description: desc.slice(0, 1000),
      requiredSkills: skills,
      applyUrl: r.url,
    }
  })
}

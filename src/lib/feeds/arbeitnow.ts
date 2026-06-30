import { extractSkillsFromText } from './skills.js'

const BASE = 'https://arbeitnow.com/api/job-board-api'

export interface ArbeitnowJob {
  externalId: string; title: string; company: string; location: string
  city: string; type: string; salary: null
  description: string; requiredSkills: string[]; applyUrl: string
}

interface ArbeitnowResult {
  slug: string; company_name: string; title: string
  description: string; tags: string[]; job_types: string[]
  location: string; remote: boolean; url: string
}

function buildType(r: ArbeitnowResult): string {
  if (r.remote) return 'Remote'
  if (r.job_types.some((t) => t.toLowerCase().includes('part'))) return 'Part-time'
  if (r.job_types.some((t) => t.toLowerCase().includes('contract'))) return 'Contract'
  return 'Full-time'
}

export async function fetchArbeitnowJobs(): Promise<ArbeitnowJob[]> {
  const res = await fetch(`${BASE}?page=1`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json() as { data: ArbeitnowResult[] }
  return (json.data ?? []).slice(0, 100).map((r) => {
    const desc = r.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return {
      externalId: `arbeitnow-${r.slug}`,
      title: r.title,
      company: r.company_name,
      location: r.location || 'Remote',
      city: r.location || '',
      type: buildType(r),
      salary: null,
      description: desc.slice(0, 1000),
      requiredSkills: (r.tags.length > 0 ? r.tags : extractSkillsFromText(desc)).slice(0, 10),
      applyUrl: r.url,
    }
  })
}

import { extractSkillsFromText } from './skills.js'

const BASE = 'https://remotive.com/api/remote-jobs'

export interface RemotiveJob {
  externalId: string; title: string; company: string; location: string
  city: string; type: string; salary: string | null
  description: string; requiredSkills: string[]; applyUrl: string
}

interface RemotiveResult {
  id: number; url: string; title: string; company_name: string
  candidate_required_location: string; job_type: string
  salary: string; description: string; tags: string[]
}

function buildType(jobType: string): string {
  if (jobType === 'contract') return 'Contract'
  if (jobType === 'part_time') return 'Part-time'
  return 'Remote'
}

export async function fetchRemotiveJobs(): Promise<RemotiveJob[]> {
  const res = await fetch(`${BASE}?limit=100`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json() as { jobs: RemotiveResult[] }
  return (json.jobs ?? []).map((r) => {
    const desc = r.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return {
      externalId: `remotive-${r.id}`,
      title: r.title,
      company: r.company_name,
      location: r.candidate_required_location || 'Worldwide',
      city: 'Remote',
      type: buildType(r.job_type),
      salary: r.salary || null,
      description: desc.slice(0, 1000),
      requiredSkills: r.tags?.length ? r.tags : extractSkillsFromText(desc),
      applyUrl: r.url,
    }
  })
}

import { extractSkillsFromText } from './skills.js'

const BASE = 'https://jobicy.com/api/v2/remote-jobs'

export interface JobicyJob {
  externalId: string; title: string; company: string; location: string
  city: string; type: string; salary: string | null
  description: string; requiredSkills: string[]; applyUrl: string
}

interface JobicyResult {
  id: number; url: string; jobTitle: string; companyName: string
  jobGeo: string; jobType: string
  jobSalaryMin?: number; jobSalaryMax?: number; jobSalaryCurrency?: string
  jobExcerpt: string; jobDescription: string; pubDate: string
}

function buildSalary(r: JobicyResult): string | null {
  if (!r.jobSalaryMin && !r.jobSalaryMax) return null
  const sym = ({ USD: '$', EUR: '€', GBP: '£', INR: '₹' } as Record<string, string>)[r.jobSalaryCurrency ?? 'USD'] ?? '$'
  const fmt = (n: number) => `${sym}${Math.round(n / 1000)}k`
  return r.jobSalaryMin && r.jobSalaryMax ? `${fmt(r.jobSalaryMin)}–${fmt(r.jobSalaryMax)}` : null
}

function buildType(jobType: unknown): string {
  const t = (Array.isArray(jobType) ? jobType.join(' ') : String(jobType ?? '')).toLowerCase()
  if (t.includes('part')) return 'Part-time'
  if (t.includes('contract') || t.includes('freelance')) return 'Contract'
  return 'Remote'
}

export async function fetchJobicyJobs(): Promise<JobicyJob[]> {
  const res = await fetch(`${BASE}?count=50`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json() as { jobs: JobicyResult[] }
  return (json.jobs ?? []).map((r) => {
    const desc = (r.jobDescription || r.jobExcerpt || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return {
      externalId: `jobicy-${r.id}`,
      title: r.jobTitle,
      company: r.companyName,
      location: r.jobGeo || 'Remote',
      city: r.jobGeo || '',
      type: buildType(r.jobType),
      salary: buildSalary(r),
      description: desc.slice(0, 1000),
      requiredSkills: extractSkillsFromText(desc),
      applyUrl: r.url,
    }
  })
}

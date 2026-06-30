import { extractSkillsFromText } from './skills.js'

const BASE = 'https://api.adzuna.com/v1/api/jobs'
const APP_ID  = process.env.ADZUNA_APP_ID  ?? ''
const APP_KEY = process.env.ADZUNA_APP_KEY ?? ''
const PER_PAGE = 50

const COUNTRY_MAP: Record<string, string[]> = {
  IN: ['in'],
  US: ['us'],
  EU: ['gb', 'de', 'fr'],
}

export interface AdzunaJob {
  externalId: string; country: string; adzunaCountry: string
  title: string; company: string; location: string; city: string
  type: string; salary: string | null; description: string
  requiredSkills: string[]; applyUrl: string
}

interface AdzunaResult {
  id: string; title: string; company: { display_name: string }
  location: { display_name: string; area: string[] }
  contract_time?: string; contract_type?: string
  salary_min?: number; salary_max?: number
  description: string; redirect_url: string
}

function buildType(r: AdzunaResult): string {
  if (r.contract_time === 'part_time') return 'Part-time'
  if (r.contract_type === 'contract') return 'Contract'
  return 'Full-time'
}

function buildSalary(r: AdzunaResult, adzunaCountry: string): string | null {
  if (!r.salary_min && !r.salary_max) return null
  const min = r.salary_min ?? 0
  const max = r.salary_max ?? 0
  if (adzunaCountry === 'in') {
    const minLpa = Math.round(min / 100000)
    const maxLpa = Math.round(max / 100000)
    return minLpa && maxLpa ? `₹${minLpa}–${maxLpa} LPA` : null
  }
  const currency = adzunaCountry === 'us' ? '$' : '£'
  const fmt = (n: number) => `${currency}${Math.round(n / 1000)}k`
  return min && max ? `${fmt(min)}–${fmt(max)}` : null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchCountry(adzunaCountry: string, orgCountry: string): Promise<AdzunaJob[]> {
  if (!APP_ID || !APP_KEY) throw new Error('ADZUNA_APP_ID / ADZUNA_APP_KEY not set')
  const url = `${BASE}/${adzunaCountry}/search/1?app_id=${APP_ID}&app_key=${APP_KEY}&results_per_page=${PER_PAGE}&content-type=application/json`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json() as { results: AdzunaResult[] }
  return (json.results ?? []).map((r) => {
    const area = r.location?.area ?? []
    const city = area[area.length - 1] ?? r.location?.display_name ?? ''
    const desc = r.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return {
      externalId: `adzuna-${adzunaCountry}-${r.id}`,
      country: orgCountry,
      adzunaCountry,
      title: r.title,
      company: r.company?.display_name ?? 'Unknown',
      location: r.location?.display_name ?? '',
      city,
      type: buildType(r),
      salary: buildSalary(r, adzunaCountry),
      description: desc.slice(0, 1000),
      requiredSkills: extractSkillsFromText(desc),
      applyUrl: r.redirect_url,
    }
  })
}

export async function fetchAdzunaJobs(orgCountry: string): Promise<AdzunaJob[]> {
  const codes = COUNTRY_MAP[orgCountry] ?? COUNTRY_MAP['EU']
  const all: AdzunaJob[] = []
  for (const code of codes) {
    const jobs = await fetchCountry(code, orgCountry)
    all.push(...jobs)
    if (codes.length > 1) await sleep(1500)
  }
  return all
}

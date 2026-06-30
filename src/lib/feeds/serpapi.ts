/**
 * serpapi.ts
 * Fetches Google Jobs results via SerpAPI (100 searches/month free tier).
 * Each call to fetchGoogleJobs() costs 1 search credit.
 * Keep total daily calls <= 3 to stay within free quota.
 */

import { extractSkillsFromText } from './skills.js'

const BASE = 'https://serpapi.com/search.json'
const KEY  = process.env.SERPAPI_KEY ?? ''

export interface SerpJob {
  externalId: string
  title: string
  company: string
  location: string
  city: string
  type: string
  salary: string | null
  description: string
  requiredSkills: string[]
  applyUrl: string | null
}

interface SerpResult {
  job_id: string
  title: string
  company_name: string
  location: string
  description: string
  detected_extensions?: {
    posted_at?: string
    schedule_type?: string
    salary?: string
    work_from_home?: boolean
  }
  apply_options?: Array<{ title: string; link: string }>
  job_highlights?: Array<{ title: string; items: string[] }>
}

function buildType(r: SerpResult): string {
  const ext = r.detected_extensions ?? {}
  if (ext.work_from_home) return 'Remote'
  const s = (ext.schedule_type ?? '').toLowerCase()
  if (s.includes('part')) return 'Part-time'
  if (s.includes('contract')) return 'Contract'
  if (s.includes('intern')) return 'Internship'
  return 'Full-time'
}

function extractCity(location: string): string {
  // "Bengaluru, Karnataka, India" → "Bengaluru"
  return location.split(',')[0]?.trim() ?? location
}

/**
 * Fetch Google Jobs for a single query string.
 * @param query  e.g. "software engineer jobs India"
 * @param gl     country code for Google (e.g. "in", "us", "uk") — affects result ranking
 * @param hl     language (default "en")
 */
export async function fetchGoogleJobs(
  query: string,
  gl = 'us',
  hl = 'en',
): Promise<SerpJob[]> {
  if (!KEY) throw new Error('SERPAPI_KEY not set')

  const params = new URLSearchParams({
    engine:   'google_jobs',
    q:        query,
    gl,
    hl,
    api_key:  KEY,
    num:      '10',   // max per request on free tier
  })

  const res = await fetch(`${BASE}?${params}`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json() as { jobs_results?: SerpResult[]; error?: string }

  if (json.error) throw new Error(`SerpAPI error: ${json.error}`)

  return (json.jobs_results ?? []).map((r) => {
    // Merge description + qualifications from job_highlights for better skill extraction
    const highlights = (r.job_highlights ?? [])
      .flatMap((h) => h.items)
      .join(' ')
    const fullText = `${r.description} ${highlights}`.replace(/\s+/g, ' ').trim()

    return {
      externalId:    `serpapi-${r.job_id}`,
      title:         r.title,
      company:       r.company_name,
      location:      r.location,
      city:          extractCity(r.location),
      type:          buildType(r),
      salary:        r.detected_extensions?.salary ?? null,
      description:   fullText.slice(0, 1000),
      requiredSkills: extractSkillsFromText(fullText),
      applyUrl:      r.apply_options?.[0]?.link ?? null,
    }
  })
}

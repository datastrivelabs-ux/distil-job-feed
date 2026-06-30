/**
 * refresh-serpapi.ts
 * Fetches Google Jobs via SerpAPI and upserts into the Distil DB.
 *
 * Free tier: 100 searches/month ≈ 3/day.
 * Strategy: 1 query per active org country (max 3 queries per run).
 * Run once daily — DO NOT add to the every-30-min workflow.
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })
config({ path: resolve(__dirname, '../.env.local'), override: false })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { fetchGoogleJobs } from '../src/lib/feeds/serpapi.js'

const JOB_TTL_DAYS = 30
const MAX_QUERIES   = 3   // hard cap — never exceed free tier budget

// One query + Google country code per Distil country
const COUNTRY_CONFIG: Record<string, { query: string; gl: string }> = {
  IN:     { query: 'software engineer data analyst jobs India',      gl: 'in' },
  US:     { query: 'software engineer remote jobs United States',    gl: 'us' },
  EU:     { query: 'software developer jobs Europe remote',          gl: 'gb' },
  GLOBAL: { query: 'remote software engineer jobs worldwide',        gl: 'us' },
}

function makePrisma() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!process.env.SERPAPI_KEY) {
    console.error('SERPAPI_KEY not set — aborting')
    process.exit(1)
  }

  const prisma = makePrisma()
  let upserted = 0
  let queries   = 0
  const errors: string[] = []

  try {
    // Determine active countries from DB
    const configs = await prisma.orgConfig.findMany({ select: { country: true } })
    const activeCountries = [...new Set(configs.map((c) => c.country))]
    if (activeCountries.length === 0) activeCountries.push('IN')

    console.log(`Active countries: ${activeCountries.join(', ')}`)
    console.log(`Will run up to ${MAX_QUERIES} SerpAPI query/queries`)

    const expiresAt = new Date(Date.now() + JOB_TTL_DAYS * 24 * 60 * 60 * 1000)

    for (const country of activeCountries) {
      if (queries >= MAX_QUERIES) {
        console.log(`Reached query cap (${MAX_QUERIES}) — skipping remaining countries`)
        break
      }

      const cfg = COUNTRY_CONFIG[country] ?? COUNTRY_CONFIG['GLOBAL']
      console.log(`\n[${country}] Query: "${cfg.query}"`)

      const jobs = await fetchGoogleJobs(cfg.query, cfg.gl).catch((e) => {
        errors.push(`serpapi:${country}: ${e}`)
        return []
      })
      queries++
      console.log(`  → ${jobs.length} results`)

      for (const job of jobs) {
        try {
          await prisma.job.upsert({
            where: { source_externalId: { source: 'SERPAPI', externalId: job.externalId } },
            create: {
              source: 'SERPAPI', externalId: job.externalId, country,
              title: job.title, company: job.company,
              location: job.location, city: job.city,
              type: job.type, salary: job.salary,
              description: job.description, requiredSkills: job.requiredSkills,
              applyUrl: job.applyUrl, expiresAt, active: true,
            },
            update: { expiresAt, title: job.title, salary: job.salary, active: true },
          })
          upserted++
        } catch (e) {
          errors.push(`upsert ${job.externalId}: ${e}`)
        }
      }

      // Polite delay between SerpAPI calls
      if (queries < Math.min(activeCountries.length, MAX_QUERIES)) await sleep(2000)
    }

    console.log(`\nDone: ${upserted} upserted across ${queries} SerpAPI quer${queries === 1 ? 'y' : 'ies'}`)
    if (errors.length) { console.warn('Errors:', errors); process.exitCode = 1 }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })

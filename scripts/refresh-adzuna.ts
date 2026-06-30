/**
 * refresh-adzuna.ts
 * Fetches from Adzuna (rate-limited: ~250 req/month free tier).
 * Runs once daily via GitHub Actions — do NOT run more frequently.
 * Connects directly to Neon DB (bypasses Vercel Deployment Protection).
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
import { fetchAdzunaJobs } from '../src/lib/feeds/adzuna.js'

const JOB_TTL_DAYS = 30

function makePrisma() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

async function main() {
  const prisma = makePrisma()
  let upserted = 0
  const errors: string[] = []

  try {
    // Determine which countries to fetch for (based on active org configs)
    const configs = await prisma.orgConfig.findMany({ select: { country: true } })
    const activeCountries = [...new Set(configs.map((c) => c.country))]
    if (activeCountries.length === 0) activeCountries.push('IN')

    console.log(`Active countries: ${activeCountries.join(', ')}`)

    const expiresAt = new Date(Date.now() + JOB_TTL_DAYS * 24 * 60 * 60 * 1000)

    for (const country of activeCountries) {
      console.log(`Fetching Adzuna for ${country}…`)
      const jobs = await fetchAdzunaJobs(country).catch((e) => {
        errors.push(`adzuna:${country}: ${e}`)
        return []
      })
      console.log(`  ${country}: ${jobs.length} jobs`)

      for (const job of jobs) {
        try {
          await prisma.job.upsert({
            where: { source_externalId: { source: 'ADZUNA', externalId: job.externalId } },
            create: {
              source: 'ADZUNA', externalId: job.externalId, country,
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
    }

    console.log(`\nDone: ${upserted} upserted`)
    if (errors.length) { console.warn('Errors:', errors); process.exitCode = 1 }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })

/**
 * refresh-global.ts
 * Fetches from all free/global job sources: Remotive, Arbeitnow, Jobicy, RemoteOK.
 * Designed to run every 30 minutes via GitHub Actions.
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
import { fetchRemotiveJobs } from '../src/lib/feeds/remotive.js'
import { fetchArbeitnowJobs } from '../src/lib/feeds/arbeitnow.js'
import { fetchJobicyJobs } from '../src/lib/feeds/jobicy.js'
import { fetchRemoteokJobs } from '../src/lib/feeds/remoteok.js'

const JOB_TTL_DAYS = 30
const INACTIVE_GRACE_DAYS = 7  // mark inactive before deleting

function makePrisma() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

type SourceName = 'REMOTIVE' | 'ARBEITNOW' | 'JOBICY' | 'REMOTEOK'

interface FeedJob {
  externalId: string; title: string; company: string; location: string
  city: string; type: string; salary: string | null
  description: string; requiredSkills: string[]; applyUrl: string
}

async function upsertJobs(
  prisma: PrismaClient,
  source: SourceName,
  jobs: FeedJob[],
  expiresAt: Date,
): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0
  const errors: string[] = []

  for (const job of jobs) {
    try {
      await prisma.job.upsert({
        where: { source_externalId: { source, externalId: job.externalId } },
        create: {
          source, externalId: job.externalId, country: 'GLOBAL',
          title: job.title, company: job.company,
          location: job.location, city: job.city,
          type: job.type, salary: job.salary,
          description: job.description, requiredSkills: job.requiredSkills,
          applyUrl: job.applyUrl, expiresAt, active: true,
        },
        update: {
          expiresAt,
          title: job.title,
          salary: job.salary,
          active: true,
        },
      })
      upserted++
    } catch (e) {
      errors.push(`${source} upsert ${job.externalId}: ${e}`)
    }
  }

  return { upserted, errors }
}

async function main() {
  const prisma = makePrisma()
  const summary: Record<SourceName, { fetched: number; upserted: number }> = {
    REMOTIVE:  { fetched: 0, upserted: 0 },
    ARBEITNOW: { fetched: 0, upserted: 0 },
    JOBICY:    { fetched: 0, upserted: 0 },
    REMOTEOK:  { fetched: 0, upserted: 0 },
  }
  const allErrors: string[] = []

  try {
    const expiresAt = new Date(Date.now() + JOB_TTL_DAYS * 24 * 60 * 60 * 1000)

    // ── Fetch all sources in parallel ─────────────────────────────────────────
    console.log('Fetching all global sources in parallel…')
    const [remotive, arbeitnow, jobicy, remoteok] = await Promise.allSettled([
      fetchRemotiveJobs(),
      fetchArbeitnowJobs(),
      fetchJobicyJobs(),
      fetchRemoteokJobs(),
    ])

    const resolved = {
      REMOTIVE:  remotive.status  === 'fulfilled' ? remotive.value  : (allErrors.push(`remotive: ${remotive.reason}`),  []),
      ARBEITNOW: arbeitnow.status === 'fulfilled' ? arbeitnow.value : (allErrors.push(`arbeitnow: ${arbeitnow.reason}`), []),
      JOBICY:    jobicy.status    === 'fulfilled' ? jobicy.value    : (allErrors.push(`jobicy: ${jobicy.reason}`),    []),
      REMOTEOK:  remoteok.status  === 'fulfilled' ? remoteok.value  : (allErrors.push(`remoteok: ${remoteok.reason}`),  []),
    } as Record<SourceName, FeedJob[]>

    for (const [src, jobs] of Object.entries(resolved) as [SourceName, FeedJob[]][]) {
      console.log(`  ${src}: ${jobs.length} jobs fetched`)
      summary[src].fetched = jobs.length
      const { upserted, errors } = await upsertJobs(prisma, src, jobs, expiresAt)
      summary[src].upserted = upserted
      allErrors.push(...errors)
    }

    // ── Soft-expire: mark stale as inactive before grace period deletion ───────
    const graceCutoff = new Date(Date.now() - INACTIVE_GRACE_DAYS * 24 * 60 * 60 * 1000)
    const softExpired = await prisma.job.updateMany({
      where: {
        orgId: null,
        active: true,
        expiresAt: { lt: new Date() },
      },
      data: { active: false },
    })
    console.log(`Marked ${softExpired.count} expired jobs as inactive`)

    // ── Hard-delete: remove inactive jobs past the grace period (no active apps) ──
    const hardCutoff = new Date(Date.now() - (JOB_TTL_DAYS + INACTIVE_GRACE_DAYS) * 24 * 60 * 60 * 1000)
    const toDelete = await prisma.job.findMany({
      where: { orgId: null, active: false, updatedAt: { lt: graceCutoff }, expiresAt: { lt: hardCutoff } },
      select: { id: true },
    })

    let deleted = 0
    for (const { id } of toDelete) {
      const activeApps = await prisma.application.count({
        where: { linkedJobId: id, status: { in: ['PENDING_APPROVAL', 'SENT'] } },
      })
      if (activeApps === 0) {
        await prisma.job.delete({ where: { id } })
        deleted++
      }
    }
    console.log(`Hard-deleted ${deleted} stale jobs`)

    // ── No-decision sweep ─────────────────────────────────────────────────────
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const noDecision = await prisma.application.updateMany({
      where: {
        status: 'SENT',
        linkedJobId: { not: null },
        sentAt: { lt: twoMonthsAgo },
        linkedJob: { expiresAt: { lt: new Date() } },
      },
      data: { status: 'NO_DECISION' },
    })
    console.log(`Marked ${noDecision.count} stale applications as NO_DECISION`)

    console.log('\n=== Summary ===')
    for (const [src, s] of Object.entries(summary)) {
      console.log(`  ${src}: fetched=${s.fetched} upserted=${s.upserted}`)
    }
    if (allErrors.length) {
      console.warn('\nErrors:', allErrors)
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })

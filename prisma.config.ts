import path from 'path'
import { defineConfig } from 'prisma/config'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env') })
config({ path: path.join(process.cwd(), '.env.local'), override: false })

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: { url: process.env.DATABASE_URL },
})

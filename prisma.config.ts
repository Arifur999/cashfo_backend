import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Local dev uses `prisma db push` (see package.json), not `prisma migrate
// dev` -- this local `prisma dev` Postgres server replicates schema across
// every database on it via its own WAL layer, which breaks the
// shadow-database diffing that `migrate dev` needs. Real file-based
// migrations (`prisma migrate dev`/`deploy`) work normally against a real,
// persistent Postgres instance (staging/production) -- swap DATABASE_URL to
// one of those and this config needs no changes.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
});

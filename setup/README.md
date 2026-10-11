# Windows dev setup (one script)

`windows-dev-setup.ps1` sets up the full coding environment on a separate drive
(default `D:`):

| What | Where |
|---|---|
| Git, Node.js LTS, VS Code | `D:\dev\tools\...` |
| GitHub CLI | default location |
| WSL2 + Docker Desktop | app in `D:\dev\tools\Docker`, images/containers in `D:\dev\docker-data` |
| npm cache + global packages | `D:\dev\tools\npm-cache`, `D:\dev\tools\npm-global` |
| This repo | `D:\dev\projects\cashfo_backend` |
| Postgres 17 + pgAdmin | Docker (`docker-compose.yml` in repo root) |
| Prisma | `npm install` → `prisma generate`, then `prisma db push` + seed |

## Run it

1. Start menu → type **PowerShell** → right-click → **Run as administrator**
2. Download the script and run it:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
cd $env:USERPROFILE\Downloads
iwr https://raw.githubusercontent.com/arifur999/cashfo_backend/main/setup/windows-dev-setup.ps1 -OutFile windows-dev-setup.ps1
.\windows-dev-setup.ps1 -Drive D
```

(Use `-Drive E` etc. for another drive. If the repo is private, download the
file from GitHub manually, or run `gh auth login` once and the clone step will
work.)

3. On a first install Docker/WSL usually need a **reboot**. After rebooting,
   open Docker Desktop once, then finish with:

```powershell
.\windows-dev-setup.ps1 -Drive D -SkipApps
```

4. Fill `IMGBB_API_KEY` and `RESEND_API_KEY` in `.env` (other secrets are
   generated for you), then:

```powershell
cd D:\dev\projects\cashfo_backend
code .
npm run start:dev    # http://localhost:5000
```

## Daily use

```powershell
docker compose up -d      # start DB
docker compose down       # stop DB
npx prisma studio         # browse data in the browser
npx prisma db push        # after editing prisma/schema.prisma
npm run seed              # reseed
```

Seeded admin login: `admin@example.com` / `ChangeMe123!` (local dev only).
pgAdmin: http://localhost:5050 (`admin@local.dev` / `admin`).

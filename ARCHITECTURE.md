# Davinci Sign - Architecture Documentation

**Last Updated:** 2026-02-02
**Version:** 2.6.0
**Base Project:** [Documenso](https://github.com/documenso/documenso) (open-source)

---

## System Context

**VERIFIED:** Davinci Sign is an electronic document signing platform rebranded from the open-source Documenso project. It enables users to create, send, and sign legally binding documents digitally.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Users                                    │
│    (Document Owners, Signers, Team Members, Admins)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Davinci Sign                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Remix App (React Router 7)              │   │
│  │              + Hono Server + tRPC API                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │              │              │              │           │
│         ▼              ▼              ▼              ▼           │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐     │
│  │PostgreSQL│   │  SMTP    │   │   S3     │   │Certificate│     │
│  │ Database │   │  Server  │   │ Storage  │   │  Signing  │     │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
     ┌──────────┐      ┌──────────┐      ┌──────────┐
     │  Stripe  │      │ PostHog  │      │  Webhooks │
     │ (Billing)│      │(Analytics│      │(External) │
     └──────────┘      └──────────┘      └──────────┘
```

---

## Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| **Language** | TypeScript 5.6.2 | Full-stack TypeScript |
| **Framework** | React Router 7 (Remix) | Server-side rendering + client hydration |
| **Server** | Hono 4.11 | Fast HTTP server with middleware |
| **API** | tRPC 11.8 + ts-rest | Type-safe API with OpenAPI generation |
| **Database** | PostgreSQL 15 | Via Prisma ORM with Kysely query builder |
| **ORM** | Prisma 6.19 | Schema-first with generated types |
| **UI Components** | shadcn/ui + Radix | Tailwind CSS-based component library |
| **Styling** | Tailwind CSS 3.4 | Utility-first CSS |
| **Email** | react-email | Template-based transactional emails |
| **PDF** | pdf-lib + React-PDF | PDF manipulation and viewing |
| **Signing** | @libpdf/core | Digital signature creation |
| **Auth** | Custom + SimpleWebAuthn | Session-based with passkey support |
| **Build** | Turborepo + Vite | Monorepo build orchestration |
| **Package Manager** | npm 10.7+ | Workspace-based monorepo |
| **Runtime** | Node.js 22+ | Alpine-based Docker images |

---

## Repo Structure

**VERIFIED:** Turborepo monorepo with workspace organization.

```
documenso/
├── apps/
│   ├── remix/              # Main application (React Router 7 + Hono)
│   ├── documentation/      # Nextra-based docs site
│   └── openpage-api/       # Public API service
├── packages/
│   ├── api/                # ts-rest API definitions
│   ├── app-tests/          # Playwright E2E tests
│   ├── assets/             # Logo, favicon, brand images
│   ├── auth/               # Authentication utilities
│   ├── ee/                 # Enterprise Edition features
│   ├── email/              # react-email templates
│   ├── eslint-config/      # Shared ESLint configuration
│   ├── lib/                # Shared business logic & utilities
│   ├── prettier-config/    # Shared Prettier configuration
│   ├── prisma/             # Database schema & migrations
│   ├── signing/            # PDF signing transports (local, GCloud HSM)
│   ├── tailwind-config/    # Shared Tailwind configuration
│   ├── trpc/               # tRPC router definitions
│   ├── tsconfig/           # Shared TypeScript configurations
│   └── ui/                 # shadcn/ui component library
├── docker/
│   ├── development/        # Dev compose with local services
│   ├── production/         # Production compose template
│   ├── testing/            # Testing compose with Inbucket
│   └── Dockerfile          # Multi-stage build
├── scripts/                # Build and utility scripts
└── .github/workflows/      # GitHub Actions CI/CD
```

## Request Flow

```
Browser
   │
   ▼
Hono Server (apps/remix/server/)
   │
   ├──▶ /api/v1/* ──▶ ts-rest handlers (packages/api/)
   │
   ├──▶ /api/v2/* ──▶ tRPC OpenAPI handlers (packages/trpc/)
   │
   ├──▶ /api/trpc/* ──▶ tRPC handlers (packages/trpc/)
   │
   ├──▶ /api/jobs/* ──▶ Job handlers (packages/lib/jobs/)
   │
   └──▶ /* ──▶ React Router (apps/remix/app/routes/)
                    │
                    ▼
              React Components (packages/ui/)
```

---

## Local Development

### Prerequisites
- Node.js 22+
- npm 10.7+
- Docker & Docker Compose

### Quick Start (Recommended)
```bash
# Clone and enter directory
git clone <repo-url> && cd documenso

# Copy environment defaults
cp .env.example .env

# Start services, install deps, migrate, seed, and run app
npm run d
```

**Services started by `npm run dx`:**
| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 54320 | Database |
| Inbucket | 9000 (web), 2500 (SMTP) | Email testing |
| MinIO | 9001 (console), 9002 (API) | S3-compatible storage |

### Manual Setup
```bash
npm ci
npm run prisma:migrate-dev
npm run translate:compile
npm run dev
```

---

## CI/CD Pipeline

**VERIFIED:** GitHub Actions for CI, with Docker image publishing to DockerHub and GHCR.

### Workflows
| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push/PR to main | Build app + Docker image |
| `e2e-tests.yml` | Push/PR to main | Playwright E2E tests |
| `publish.yml` | Push to `release` branch | Build & publish Docker images |
| `translations-*.yml` | Various | Crowdin i18n sync |

### Pipeline Flow
```
Developer Push → GitHub Actions CI
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   Build App                  Build Docker
   (npm run build)            (docker build)
        │                           │
        └─────────────┬─────────────┘
                      ▼
              E2E Tests (Playwright)
                      │
                      ▼
        [On release branch push]
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   DockerHub                      GHCR
   davinci/davinci-sign        ghcr.io/davinci/davinci-sign
```

---

## Infrastructure

### Container Architecture
**VERIFIED:** Multi-stage Docker build produces minimal production image.

```dockerfile
# Dockerfile stages:
base        → node:22-alpine3.22 + openssl + fonts
builder     → Turbo prune for remix app
installer   → npm ci + turbo build
runner      → Production runtime (non-root user)
```

### Deployment Options
1. **Docker Compose** - Single host deployment
2. **Koyeb / Railway / Render** - Container deployment
3. **Manual** - systemd service

### Production Services Required
| Service | Requirement | Notes |
|---------|-------------|-------|
| PostgreSQL | Required | 15+ recommended |
| SMTP Server | Required | Multiple transport options |
| S3 Storage | Optional | Default stores in database |
| PDF Certificate | Required | /opt/davinci-sign/cert.p12 for signing |

---

## Configuration

### Environment Variables (Key Categories)

**Secrets (REDACTED):**
| Variable | Purpose |
|----------|---------|
| `NEXTAUTH_SECRET` | Session encryption |
| `NEXT_PRIVATE_ENCRYPTION_KEY` | Primary data encryption |
| `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` | Secondary encryption |
| `NEXT_PRIVATE_SIGNING_PASSPHRASE` | Certificate password |
| `NEXT_PRIVATE_DATABASE_URL` | PostgreSQL connection |
| `NEXT_PRIVATE_SMTP_PASSWORD` | SMTP auth |

**Public Configuration:**
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_WEBAPP_URL` | Application base URL |
| `NEXT_PUBLIC_UPLOAD_TRANSPORT` | `database` or `s3` |
| `NEXT_PUBLIC_DISABLE_SIGNUP` | Disable public registration |

---

## Open Questions

1. **UNKNOWN:** Production deployment infrastructure for Davinci (AKS? Railway? Self-hosted?)
2. **UNKNOWN:** Integration with other Davinci platform services
3. **INFERRED:** Billing may be disabled for internal use (based on branding suggesting enterprise focus)

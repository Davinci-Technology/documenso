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

### Available Commands
| Command | Description |
|---------|-------------|
| `npm run d` | Full dev setup (dx + compile + dev) |
| `npm run dx` | Docker services + migrate + seed |
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run prisma:migrate-dev` | Create/apply migrations |
| `npm run translate` | Extract + compile i18n |

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
   documenso/documenso     ghcr.io/documenso/documenso
```

### Docker Image Tags
- `latest` - Stable releases (vX.Y.Z)
- `rc` - Release candidates (vX.Y.Z-rc.N)
- `vX.Y.Z` - Version tags
- `<git-sha>` - Commit-specific builds

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
2. **Railway** - One-click deploy template
3. **Render** - One-click deploy template
4. **Koyeb** - Container deployment
5. **Elestio** - Managed hosting
6. **Manual** - systemd service

### Production Services Required
| Service | Requirement | Notes |
|---------|-------------|-------|
| PostgreSQL | Required | 15+ recommended |
| SMTP Server | Required | Multiple transport options |
| S3 Storage | Optional | Default stores in database |
| PDF Certificate | Required | .p12 file for signing |

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
| `NEXT_PRIVATE_STRIPE_API_KEY` | Billing (optional) |

**Public Configuration:**
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_WEBAPP_URL` | Application base URL |
| `NEXT_PUBLIC_UPLOAD_TRANSPORT` | `database` or `s3` |
| `NEXT_PUBLIC_DISABLE_SIGNUP` | Disable public registration |
| `NEXT_PUBLIC_FEATURE_BILLING_ENABLED` | Enable Stripe billing |

**Full list:** See `.env.example` (185 lines of documentation)

---

## Key Components

### Apps

#### `apps/remix` (Main Application)
- **Framework:** React Router 7 with Hono server
- **Entry:** `app/routes/` (file-based routing with flat-routes)
- **Server:** Custom Hono server in `server/main.ts`
- **Build:** Rollup for server, Vite for client

#### `apps/documentation`
- **Framework:** Nextra (Next.js documentation)
- **Purpose:** Developer documentation site

#### `apps/openpage-api`
- **Purpose:** Public REST API service

### Core Packages

#### `packages/prisma`
**VERIFIED:** 150+ migrations, comprehensive schema.

Key models:
- `User` - Account with roles, 2FA, passkeys
- `Organisation` - Multi-tenant container
- `Team` - Workspace within organisation
- `Envelope` - Document container
- `Document` - PDF document with metadata
- `Recipient` - Signing participant
- `Field` - Signature/form field placement
- `Webhook` - Event notification

#### `packages/lib`
Business logic organized by:
- `server-only/` - Server-side operations
- `client-only/` - Browser utilities
- `constants/` - Application constants
- `jobs/` - Background job definitions (Inngest/local)
- `utils/` - Shared utilities

#### `packages/signing`
Two transport modes:
1. **Local** - File-based .p12 certificate
2. **GCloud HSM** - Google Cloud HSM key management

#### `packages/trpc`
- tRPC router with OpenAPI generation
- Organized by domain (auth, documents, teams, etc.)

#### `packages/email`
- react-email template components
- Templates for: confirmation, signing requests, completion, etc.

---

## Data Stores

### PostgreSQL (Primary)
**VERIFIED:** Prisma schema at `packages/prisma/schema.prisma`

Key entity relationships:
```
User (1) ──< OrganisationMember >── (1) Organisation
                                           │
                                           ▼
                                    Team (workspace)
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
               Envelope               Template               Webhook
                    │                      │
                    ▼                      ▼
               Document               Document
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   Recipient     Field    DocumentData
```

### File Storage
- **Default:** `database` - Documents stored as base64 in PostgreSQL
- **Optional:** `s3` - S3-compatible object storage (MinIO, AWS S3, etc.)

---

## API Surface

### tRPC API (Internal)
- Server: `/api/trpc/*`
- Used by: Remix app for data fetching
- Transport: SuperJSON

### REST API v2
- Endpoint: `/api/v2/*`
- OpenAPI: `/api/v2/openapi`
- Authentication: API tokens

### Webhook Events
| Event | Trigger |
|-------|---------|
| `DOCUMENT_CREATED` | New document created |
| `DOCUMENT_SENT` | Document sent for signing |
| `DOCUMENT_OPENED` | Recipient opened document |
| `DOCUMENT_SIGNED` | Recipient signed |
| `DOCUMENT_COMPLETED` | All signatures collected |
| `DOCUMENT_REJECTED` | Recipient rejected |
| `DOCUMENT_CANCELLED` | Owner cancelled |

---

## Auth Flow

**VERIFIED:** Custom session-based authentication with multiple providers.

### Authentication Methods
1. **Email/Password** - Traditional login with email verification
2. **Google OAuth** - Via `NEXT_PRIVATE_GOOGLE_CLIENT_*`
3. **OIDC** - Generic OpenID Connect provider
4. **Passkeys** - WebAuthn/FIDO2 (SimpleWebAuthn)

### Session Management
- Session tokens stored in database
- 2FA support (TOTP + backup codes)
- Security audit logging

### Authorization
- **Roles:** `ADMIN`, `USER`
- **Organisation Roles:** Owner, Admin, Manager, Member
- **Team Roles:** Owner, Manager, Member

---

## Background Jobs

**VERIFIED:** Pluggable job provider system.

### Providers
- **Local** (default) - In-process execution
- **Inngest** - Serverless job orchestration

### Job Types
| Job | Purpose |
|-----|---------|
| `seal-document` | Apply signatures and seal PDF |
| `send-signing-email` | Email signing requests |
| `send-confirmation-email` | Email confirmations |
| `execute-webhook` | Trigger webhook deliveries |
| `bulk-send-template` | Mass template sending |

---

## Observability

### Logging
- Pino logger with pretty-print in development
- Optional file output via `NEXT_PRIVATE_LOGGER_FILE_PATH`

### Analytics
- PostHog integration (optional)
- Anonymous telemetry (opt-out available)

### Health Checks
- `GET /api/health` - Database + certificate status
- `GET /api/certificate-status` - Detailed cert info

---

## Open Questions

1. **UNKNOWN:** Production deployment infrastructure for Davinci (AKS? Railway? Self-hosted?)
2. **UNKNOWN:** Integration with other Davinci platform services
3. **INFERRED:** Billing may be disabled for internal use (based on branding suggesting enterprise focus)

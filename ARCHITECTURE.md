# Davinci Sign - Architecture Documentation

**Last Updated:** 2026-02-02
**Version:** 2.6.0
**Base Project:** [Documenso](https://github.com/documenso/documenso) (open-source)

---

## Overview

**VERIFIED:** Davinci Sign is an electronic document signing platform rebranded from the open-source Documenso project. It enables users to create, send, and sign legally binding documents digitally. Built as a **monorepo** using npm workspaces and Turborepo.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Remix App (Hono Server)                        │
│                                 apps/remix                                  │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────────┤
│  /api/v1/*  │  /api/v2/*  │ /api/trpc/* │ /api/jobs/* │   React Router UI   │
│  (ts-rest)  │   (tRPC)    │   (tRPC)    │  (Jobs API) │                     │
├─────────────┴─────────────┴─────────────┴─────────────┴─────────────────────┤
│                                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐    │
│  │  @api   │  │  @trpc  │  │  @lib   │  │  @email │  │    @signing     │    │
│  │ (REST)  │  │  (RPC)  │  │  (CORE) │  │         │  │                 │    │
│  └─────────┘  └─────────┘  └────┬────┘  └─────────┘  └─────────────────┘    │
│                                 │                                           │
│              ┌──────────────────┼──────────────────┐                        │
│              │                  │                  │                        │
│         ┌────▼────┐       ┌─────▼─────┐      ┌─────▼─────┐                  │
│         │ Storage │       │   Jobs    │      │    PDF    │                  │
│         │Provider │       │  Provider │      │  Signing  │                  │
│         └────┬────┘       └─────┬─────┘      └─────┬─────┘                  │
│              │                  │                  │                        │
└──────────────┼──────────────────┼──────────────────┼────────────────────────┘
               │                  │                  │
        ┌──────┴──────┐    ┌──────┴──────┐    ┌──────┴──────┐
        │  Database   │    │   Inngest/  │    │ Google KMS/ │
        │     S3      │    │    Local    │    │    Local    │
        └─────────────┘    └─────────────┘    └─────────────┘
```

---

## Monorepo Structure

### Applications (`apps/`)

| Package                    | Description                                              | Port |
| -------------------------- | -------------------------------------------------------- | ---- |
| `@documenso/remix`         | Main application - React Router 7 (Remix) with Hono server| 3000 |
| `@documenso/documentation` | Documentation site (Next.js + Nextra)                    | 3002 |
| `@documenso/openpage-api`  | Public analytics API                                     | 3003 |

### Core Packages (`packages/`)

| Package              | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `@documenso/lib`     | Core business logic (server-only, client-only, universal) |
| `@documenso/trpc`    | tRPC API layer with OpenAPI support (API V2)              |
| `@documenso/api`     | REST API layer using ts-rest (API V1)                     |
| `@documenso/prisma`  | Database layer (Prisma ORM + Kysely)                      |
| `@documenso/ui`      | UI component library (Shadcn + Radix + Tailwind)          |
| `@documenso/email`   | Email templates and mailer (React Email)                  |
| `@documenso/auth`    | Authentication (OAuth via Arctic, WebAuthn/Passkeys)      |
| `@documenso/signing` | PDF signing (Local P12, Google Cloud KMS)                 |
| `@documenso/ee`      | Enterprise Edition features                               |
| `@documenso/assets`  | Static assets                                             |

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

## API Architecture

### API V1 (Deprecated)
- **Location**: `packages/api/v1/`
- **Framework**: ts-rest (contract-based REST)
- **Status**: Deprecated but maintained

### API V2 (Current)
- **Location**: `packages/trpc/server/`
- **Framework**: tRPC with trpc-to-openapi
- **Mount**: `/api/v2/*`, `/api/v2-beta/*`
- **Status**: Active

---

## Swappable Providers

The codebase uses a **strategy pattern** for provider selection via environment variables.

### Storage Provider
**Config**: `NEXT_PUBLIC_UPLOAD_TRANSPORT`
| Provider | Description                          | Env Value  |
| -------- | ------------------------------------ | ---------- |
| Database | Store files as Base64 in DB          | `database` |
| S3       | S3-compatible storage (+ CloudFront) | `s3`       |

### PDF Signing Provider
**Config**: `NEXT_PRIVATE_SIGNING_TRANSPORT`
| Provider         | Description          | Env Value    |
| ---------------- | -------------------- | ------------ |
| Local            | P12 certificate file | `local`      |
| Google Cloud HSM | Google Cloud KMS     | `gcloud-hsm` |

---

## Local Development

### Quick Start (Recommended)
```bash
# Clone and enter directory
git clone <repo-url> && cd davinci-sign

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

---

## CI/CD Pipeline

**VERIFIED:** GitHub Actions for CI, with Docker image publishing to DockerHub and GHCR.

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
   davinci/davinci-sign    ghcr.io/davinci/davinci-sign
```

---

## Infrastructure

### Required Services
| Service | Requirement | Notes |
|---------|-------------|-------|
| PostgreSQL | Required | 15+ recommended |
| SMTP Server | Required | Multiple transport options |
| S3 Storage | Optional | Default stores in database |
| PDF Certificate | Required | /opt/davinci-sign/cert.p12 for signing |

---

## Open Questions

1. **UNKNOWN:** Production deployment infrastructure for Davinci (AKS? Railway? Self-hosted?)
2. **UNKNOWN:** Integration with other Davinci platform services
3. **INFERRED:** Billing may be disabled for internal use (based on branding suggesting enterprise focus)

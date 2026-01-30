# Davinci ESign Branding Guide

This document details all branding-related locations in the codebase for future reference and maintenance.

## Brand Assets

### Source Files
- **Full Logo**: `packages/assets/logo.png` (~200px wide)
- **Icon SVG**: `davinci-icon.svg` (Vitruvian man icon)
- **Brand Color**: `#1A98CF` (Davinci Blue)

### Generated Assets Locations

#### Primary Assets (`packages/assets/`)
- `logo.png` - Main logo with text
- `logo_icon.png` - 50x50 icon only
- `favicon.ico` - Multi-size favicon (16/32/48)
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png` - 180x180
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`
- `opengraph-image.jpg` - 1200x630 social preview
- `static/logo.png` - Email logo

#### Remix App (`apps/remix/public/`)
- All favicon variants
- `opengraph-image.jpg`
- `static/logo.png`

#### Documentation (`apps/documentation/public/`)
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png`

#### Email Assets (`packages/email/static/`)
- `logo.png`

## Text Reference Locations

### Core Constants
| File | What to Change |
|------|----------------|
| `packages/lib/constants/email.ts` | FROM_NAME, FROM_ADDRESS, SERVICE_USER_EMAIL |
| `packages/lib/constants/auth.ts` | IDENTITY_PROVIDER_NAME |
| `packages/lib/constants/app.ts` | SUPPORT_EMAIL |

### Meta Tags & SEO
| File | What to Change |
|------|----------------|
| `apps/remix/app/utils/meta.ts` | Page titles, descriptions, OG tags, keywords, author, Twitter handle |

### Documentation
| File | What to Change |
|------|----------------|
| `apps/documentation/theme.config.tsx` | Logo text, title pattern, footer, color hue |

### API Documentation
| File | What to Change |
|------|----------------|
| `packages/api/v1/openapi.ts` | API title, description |
| `packages/trpc/server/open-api.ts` | API title, description |

### Email Templates
| Location | What to Change |
|----------|----------------|
| `packages/email/template-components/template-footer.tsx` | Company name, link, color |
| `packages/email/template-components/template-confirmation-email.tsx` | Welcome text |
| `packages/email/templates/*.tsx` | Alt text on logo images, preview text |

### Server-Side References
| File | What to Change |
|------|----------------|
| `packages/lib/server-only/2fa/setup-2fa.ts` | ISSUER constant |
| `packages/lib/utils/authenticator.ts` | rpName |
| `packages/lib/jobs/definitions/internal/execute-webhook.handler.ts` | X-*-Secret header |

### UI Components
| File | What to Change |
|------|----------------|
| `apps/remix/app/components/general/branding-logo.tsx` | Main app logo component (uses logo.png) |
| `apps/remix/app/routes/_unauthenticated+/verify-email.$token.tsx` | Email verified confirmation text |

### Configuration Files
| File | What to Change |
|------|----------------|
| `.env.example` | SMTP defaults |
| `.devcontainer/devcontainer.json` | Container name |
| `README.md` | Project description |
| `docker/README.md` | Docker documentation |

## Color Configuration

### Tailwind Config (`packages/tailwind-config/index.cjs`)
The `documenso` color palette (internal name kept for compatibility):
```javascript
documenso: {
  DEFAULT: '#1A98CF',  // Davinci Blue
  50: '#f0f9ff',
  100: '#e0f2fe',
  200: '#bae6fd',
  300: '#7dd3fc',
  400: '#38bdf8',
  500: '#1A98CF',      // Primary
  600: '#0284c7',
  700: '#0369a1',
  800: '#075985',
  900: '#0c4a6e',
  950: '#082f49',
}
```

### CSS Variables (`packages/ui/styles/theme.css`)
Primary HSL values:
- Primary: `197 79% 46%` (Davinci Blue)
- Primary foreground: `197 79% 10%` (Dark blue for text contrast)

## Docker Configuration

### Image Names
| File | Image Name |
|------|------------|
| `docker/production/compose.yml` | `davinci/davinci-esign:latest` |
| `docker/build.sh` | `davinci/davinci-esign` |
| `docker/buildx.sh` | `davinci/davinci-esign` |
| `docker/buildx-and-push.sh` | `davinci/davinci-esign` |
| `docker/Dockerfile.chromium` | `davinci/davinci-esign` |

### Container Names
| File | Container Name |
|------|----------------|
| `docker/development/compose.yml` | `davinci-esign-development` |
| `docker/production/compose.yml` | `davinci-esign-production` |
| `docker/testing/compose.yml` | `davinci-esign-test` |

### Certificate Paths
Default certificate path: `/opt/davinci-esign/cert.p12`

Files referencing certificate path:
- `docker/production/compose.yml`
- `docker/testing/compose.yml`
- `docker/README.md`
- `docker/start.sh`
- `packages/lib/server-only/cert/cert-status.ts`

## Email Domain
- System emails: `@davincisolutions.ai`
- Support email: `support@davincisolutions.ai`
- No-reply: `noreply@davincisolutions.ai`

## Notes

### Package Names
Internal package names (`@documenso/*`) are kept unchanged to avoid breaking hundreds of imports. These are not user-facing.

### External Links
Links to documenso.com and the upstream GitHub repository are kept as credits to the original open-source project.

### Regenerating Assets
To regenerate logo assets from source files:
1. Install sharp-cli globally: `npm install -g sharp-cli`
2. Use the Davinci-Logo.png and davinci-icon.svg as sources
3. Generate required sizes for each location listed above

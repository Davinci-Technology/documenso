# Davinci Sign Branding Guide

This document details all branding-related locations in the codebase for future reference and maintenance.

## Brand Source of Truth

All values below come from the company guideline in the Marketing SharePoint
library (`Marketing - Documents/General/Branding Guidelines/Guidelines/`):

- `Davinci_Visual Identity_2025.docx` (May 2025) - colours, logo rules, typography
- `Davinci_Brand_Voice_2025.docx` (Sept 2025) - tone and lexicon for copy
- Logo pack: `Marketing - Documents/General/Logo/Sign/` (SVG + PNG, four variants)
- Fonts: `Marketing - Documents/General/Branding Guidelines/Open_Sans/` (SIL OFL 1.1)

When the guideline changes, update the values here, in `packages/ui/styles/theme.css`,
`packages/tailwind-config/index.cjs`, and `tools/upstream-sync/config.yaml`
(`branding_replacements`) together, and add a marker to
`tools/upstream-sync/critical_markers.yaml` so the upstream sync cannot revert it.

## Brand Assets

### Source Files
- **Full Logo (colour)**: `packages/assets/logo.svg` - copied verbatim from the Sign logo pack
- **Full Logo (white, dark surfaces)**: `packages/assets/logo-white.svg`
- **Emblem**: `packages/assets/emblem.svg`, `emblem-white.svg` (square 1148 viewBox cut from the logo SVG); `davinci-icon.svg` at the repo root is the same emblem
- **Brand Colour**: `#0B98CE` (Davinci Blue); lettering `#494949` (Davinci Grey)

### Generated Assets Locations

#### Primary Assets (`packages/assets/`)
- `logo.png` - 800x238 raster of the colour lockup (used by email templates)
- `logo_icon.png` - 100x100 emblem
- `favicon.ico` - Multi-size favicon (16/32/48), emblem
- `favicon-16x16.png`, `favicon-32x32.png` - emblem
- `apple-touch-icon.png` - 180x180, emblem on white
- `android-chrome-192x192.png`, `android-chrome-512x512.png` - emblem on white
- `opengraph-image.jpg` - 1200x630 social preview, colour lockup on white
- `static/logo.png` - Email logo
- `site.webmanifest` - name `Davinci Sign`, theme colour `#0B98CE`

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
| `packages/trpc/server/webhook-router/resend-webhook-call.ts` | X-*-Secret header |
| `apps/documentation/pages/developers/webhooks.mdx` | X-*-Secret header reference in docs |

### UI Components
| File | What to Change |
|------|----------------|
| `apps/remix/app/components/general/branding-logo.tsx` | Main app logo (logo.svg, logo-white.svg in dark mode) |
| `apps/remix/app/components/general/branding-logo-icon.tsx` | Emblem as an inline `currentColor` SVG (replaces the Documenso mark) |
| `apps/remix/app/components/general/settings-upsell/*.tsx` | Accent colour `#0B98CE` (upstream uses `#A2E771`) |
| `apps/remix/app/routes/_unauthenticated+/verify-email.$token.tsx` | Email verified confirmation text |

### Configuration Files
| File | What to Change |
|------|----------------|
| `.env.example` | SMTP defaults |
| `.devcontainer/devcontainer.json` | Container name |
| `README.md` | Project description |
| `docker/README.md` | Docker documentation |

## Colour Configuration

### Palette (Visual Identity guideline, May 2025)
| Name | Hex | HSL | Used for |
|------|-----|-----|----------|
| Davinci Blue | `#0B98CE` | `197 90% 43%` | primary, ring, links, field borders |
| Davinci Grey | `#494949` | `0 0% 29%` | body text (`--foreground`) |
| Davinci Cloud | `#DDDDDD` | `0 0% 87%` | `documenso-100` |
| Davinci Stone | `#7A879C` | `217 15% 55%` | muted text |
| Davinci Midnight | `#143562` | `215 66% 23%` | text on blue (`--primary-foreground`), `documenso-800/900` |
| Davinci Denim | `#316EA8` | `209 55% 43%` | `documenso-600/700` (readable blue text on white) |
| Davinci Beach | `#8FD7E5` | `190 62% 73%` | field cards, `documenso-200/300` |
| Davinci Steam | `#F0F0F0` | `0 0% 94%` | `documenso-50` |

The guideline forbids colours outside this palette, and tints only alongside
Davinci Blue itself. The old `#1A98CF` and the Tailwind "sky" scale are retired;
`tools/upstream-sync/config.yaml` rewrites any reappearance to `#0B98CE`.

Contrast notes (WCAG): Midnight on Davinci Blue is 3.7:1 (white would be 3.3:1),
so button text uses Midnight. Stone on white is 3.6:1, which is below AA for
small text; it is limited to muted captions as the guideline intends.

### Tailwind Config (`packages/tailwind-config/index.cjs`)
The `documenso` colour key is kept for upstream class compatibility but maps to
the palette above (see the file for the full scale).

### CSS Variables (`packages/ui/styles/theme.css`)
- `--primary: 197 90% 43%`, `--primary-foreground: 215 66% 23%`
- `--foreground: 0 0% 29%`, `--muted-foreground: 217 15% 55%`
- `--field-card: 190 62% 73%`, `--field-card-border: 197 90% 43%`
- `body` gets `font-medium` (Open Sans Medium is the guideline default weight)

## Typography
- Primary font: **Open Sans** (variable TTFs in `apps/remix/public/fonts/`,
  `@font-face` in `apps/remix/app/app.css`, `--font-sans: "Open Sans", Arial`).
- Fallback: Arial (guideline hierarchy). Emails use `Open Sans, Arial, sans-serif`
  via `packages/email/tailwind.config.js` because email clients cannot read the
  app's CSS variable.
- Static `open-sans-regular.ttf` / `open-sans-semibold.ttf` feed the Open Graph
  image route, which renders with satori and needs non-variable fonts.
- Signature font stays Caveat; Noto Sans stays for CJK field rendering.
- Inter (upstream default) has been removed.

## Copy and Voice
Meta description and titles follow `Davinci_Brand_Voice_2025`: outcome-focused,
"we/you" stance, no hyperbole ("easy", "powerful", "revolutionary").

## Docker Configuration

### Image Names
| File | Image Name |
|------|------------|
| `docker/production/compose.yml` | `davinci/davinci-sign:latest` |
| `docker/build.sh` | `davinci/davinci-sign` |
| `docker/buildx.sh` | `davinci/davinci-sign` |
| `docker/buildx-and-push.sh` | `davinci/davinci-sign` |
| `docker/Dockerfile.chromium` | `davinci/davinci-sign` |

### Container Names
| File | Container Name |
|------|----------------|
| `docker/development/compose.yml` | `davinci-sign-development` |
| `docker/production/compose.yml` | `davinci-sign-production` |
| `docker/testing/compose.yml` | `davinci-sign-test` |

### Certificate Paths
Default certificate path: `/opt/davinci-sign/cert.p12`

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
Sources are the SVGs in the Marketing logo pack (`Logo/Sign/`). With
`rsvg-convert` and ImageMagick:

```bash
rsvg-convert -w 800 logo.svg -o logo.png
rsvg-convert -w 16 -h 16 emblem.svg -o favicon-16x16.png   # same for 32, 48
magick favicon-16x16.png favicon-32x32.png favicon-48.png favicon.ico
rsvg-convert -w 148 -h 148 emblem.svg -o e.png && magick -size 180x180 xc:white e.png -gravity center -composite apple-touch-icon.png
rsvg-convert -w 840 logo.svg -o og.png && magick -size 1200x630 xc:white og.png -gravity center -composite -quality 92 opengraph-image.jpg
```

Copy the results to `packages/assets/`, `apps/remix/public/`,
`apps/remix/public/static/logo.png` and `packages/email/static/logo.png`.

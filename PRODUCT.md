# Davinci Sign - Product Documentation

**Last Updated:** 2026-02-02
**Version:** 2.6.0

---

## Elevator Pitch

**VERIFIED:** Davinci Sign is a professional electronic signature platform that enables businesses to create, send, and sign legally binding documents digitally. Built on the open-source Documenso platform, it provides full control over document signing infrastructure with self-hosting capability and enterprise features.

---

## Users

### Primary Users

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| **Document Owner** | Creates and sends documents for signature | Easy document upload, recipient management, status tracking |
| **Signer** | Receives and signs documents | Simple signing experience, mobile-friendly |
| **Team Admin** | Manages team settings and members | User management, branding customization |
| **Organisation Admin** | Oversees multiple teams | Cross-team visibility, SSO configuration |
| **Platform Admin** | System administrator | User management, system configuration |

### Access Levels

1. **Anonymous Signer** - Can sign documents via direct link (no account required)
2. **Registered User** - Personal workspace for documents
3. **Team Member** - Access to shared team documents
4. **Organisation Member** - Access across organisation teams
5. **Admin** - Full platform administration

---

## Problems Solved

1. **Legal Compliance** - Legally binding electronic signatures with audit trails
2. **Document Security** - Encrypted documents with tamper-evident digital certificates
3. **Workflow Efficiency** - Eliminates paper-based signing delays
4. **Self-Hosting** - Full control over sensitive document infrastructure
5. **Multi-Tenant** - Organisation and team hierarchy for enterprise use
6. **Branding** - White-label capability for customer-facing documents
7. **Integration** - Webhooks and API for workflow automation

---

## Core Workflows

### 1. Document Signing (Simple)

**Actor:** Document Owner → Signer

```
Owner uploads PDF
     │
     ▼
Owner adds recipients (name, email)
     │
     ▼
Owner places signature fields on document
     │
     ▼
Owner sends for signature
     │
     ▼
System emails signing link to recipient
     │
     ▼
Recipient clicks link → views document
     │
     ▼
Recipient draws/types/uploads signature
     │
     ▼
Recipient clicks "Complete"
     │
     ▼
System seals document with digital certificate
     │
     ▼
Both parties receive completed PDF
```

### 2. Template-Based Signing (Recurring)

**Actor:** Team Member → Multiple Signers

```
Create template from PDF
     │
     ▼
Define placeholder fields (signature, date, name, etc.)
     │
     ▼
Set recipient roles (Signer 1, Signer 2, etc.)
     │
     ▼
Save template
     │
     ─────────────────────────────────────
     │           (Future use)            │
     ▼                                   │
Fill template with actual recipients    │
     │                                   │
     ▼                                   │
Send document for signatures ◄──────────┘
```

### 3. Team Document Management

**Actor:** Team Admin

```
Create team within organisation
     │
     ▼
Invite team members (by email)
     │
     ▼
Configure team branding (logo, colors)
     │
     ▼
Set up document templates
     │
     ▼
Members create/send documents under team
     │
     ▼
All team members can view team documents
     │
     ▼
Audit logs track all activity
```

### 4. Bulk Sending

**Actor:** Power User

```
Create template with recipient placeholders
     │
     ▼
Upload CSV with recipient data
     │
     ▼
Map CSV columns to template fields
     │
     ▼
Review and confirm
     │
     ▼
System queues all documents for sending
     │
     ▼
Track completion status per recipient
```

### 5. Public Profile / Direct Templates

**Actor:** Public User → Document Owner

```
Owner creates public profile
     │
     ▼
Owner creates "direct template"
     │
     ▼
Owner shares public link
     │
     ▼
Public user visits profile
     │
     ▼
Public user selects template
     │
     ▼
Public user fills in their details
     │
     ▼
Document created and signed in one flow
```

---

## Feature Map

### Document Management
- [x] PDF upload and viewing
- [x] Multi-page document support
- [x] Document folders organization
- [x] Document search and filtering
- [x] Document status tracking (draft, pending, completed, cancelled)
- [x] Document deletion and archival

### Signing Features
- [x] Draw signature (mouse/touch)
- [x] Type signature (font selection)
- [x] Upload signature image
- [x] Initials support
- [x] Date fields (auto-populated)
- [x] Text fields
- [x] Checkbox fields
- [x] Dropdown fields
- [x] Radio button fields
- [x] Number fields
- [x] Field validation (required, format)

### Recipient Management
- [x] Multiple recipients per document
- [x] Sequential signing order
- [x] Recipient roles (Signer, Approver, CC, Viewer)
- [x] Access code protection
- [x] Signing reminders
- [x] Document rejection with reason

### Templates
- [x] Create templates from documents
- [x] Reusable field placement
- [x] Template sharing within team
- [x] Direct templates (public-facing)
- [x] Bulk send from template

### Security & Compliance
- [x] Digital certificate signing (PKI)
- [x] Timestamp authority support (LTV)
- [x] Document audit trail
- [x] IP address logging
- [x] User agent logging
- [x] Download audit log PDF
- [x] Certificate verification

### Authentication
- [x] Email/password login
- [x] Google OAuth
- [x] OIDC provider support
- [x] Passkey/WebAuthn
- [x] Two-factor authentication (TOTP)
- [x] Backup codes
- [x] Session management

### Organisation & Teams
- [x] Multi-tenant organisations
- [x] Teams within organisations
- [x] Member invitations
- [x] Role-based permissions
- [x] SSO configuration (Enterprise)
- [x] Email domain verification

### Branding (Customization)
- [x] Custom logo
- [x] Brand colors
- [x] Custom email templates
- [x] Public profile pages
- [x] Team-level branding

### Integrations
- [x] Webhook notifications
- [x] REST API (v2)
- [x] Zapier (via webhooks)
- [x] Stripe billing (optional)

### Administration
- [x] User management
- [x] Document overview
- [x] Organisation insights
- [x] Site-wide settings
- [x] Claims/subscription management

---

## Domain Model

### Core Entities

```
Organisation
├── Teams[]
│   ├── Documents[]
│   ├── Templates[]
│   ├── Webhooks[]
│   └── Members[]
├── Members[]
└── Groups[]

User
├── Documents[] (personal)
├── Templates[] (personal)
├── OrganisationMemberships[]
├── TeamMemberships[]
├── Passkeys[]
├── ApiTokens[]
└── SecurityAuditLogs[]

Document (Envelope)
├── DocumentData (PDF binary)
├── Recipients[]
│   └── Fields[]
├── AuditLogs[]
└── Metadata
    ├── Status
    ├── ExternalId
    └── Timestamps

Template
├── DocumentData
├── TemplateRecipients[]
│   └── TemplateFields[]
└── DirectLinkConfig (for public templates)

Field Types
├── SIGNATURE
├── INITIALS
├── DATE
├── TEXT
├── NUMBER
├── DROPDOWN
├── CHECKBOX
└── RADIO
```

### Status Flow

```
Document Status:
DRAFT → PENDING → COMPLETED
                ↘ CANCELLED
                ↘ REJECTED

Recipient Status:
PENDING → OPENED → SIGNED
                 ↘ REJECTED
```

---

## Integrations

### Email Providers (SMTP Transport)
| Provider | Configuration |
|----------|---------------|
| Generic SMTP | Host, port, credentials |
| SMTP API | API key authentication |
| Resend | API key |
| MailChannels | API key + DKIM |

### Storage Providers
| Provider | Configuration |
|----------|---------------|
| Database | Default (no config needed) |
| AWS S3 | Bucket, credentials, region |
| MinIO | Endpoint, credentials |
| Any S3-compatible | Endpoint, credentials |

### Signing Infrastructure
| Provider | Configuration |
|----------|---------------|
| Local | .p12 certificate file |
| Google Cloud HSM | KMS key path, credentials |

### Analytics & Monitoring
| Service | Configuration |
|---------|---------------|
| PostHog | API key |
| Anonymous telemetry | Opt-out available |

### Billing
| Service | Configuration |
|---------|---------------|
| Stripe | API key, webhook secret |

---

## Out of Scope

The following are explicitly **not** part of Davinci Sign:

1. **Document Creation** - Only accepts uploaded PDFs (no document editor)
2. **OCR/Text Extraction** - Documents are images, not parsed text
3. **AI Analysis** - Basic AI features require Google Vertex (not document AI)
4. **Mobile Apps** - Web-only, responsive design
5. **Offline Signing** - Requires internet connection
6. **Witness/Notary** - No in-person witnessing workflow
7. **Payment Collection** - Cannot collect payments alongside signatures

---

## Open Questions

1. **UNKNOWN:** Planned integration points with other Davinci platform services?
2. **UNKNOWN:** Specific compliance requirements (eIDAS, UETA, ESIGN)?
3. **INFERRED:** Enterprise features (EE package) licensing model?
4. **UNKNOWN:** Target deployment environment for production?

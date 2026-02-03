# Davinci Sign - Operations Runbook

**Last Updated:** 2026-02-02
**Version:** 2.6.0

---

## Quickstart (Local Development)

### One-Command Start
```bash
npm run d
```
This runs: `npm ci` → Docker services → migrations → seed → dev server

### Access Points
| Service | URL | Purpose |
|---------|-----|---------|
| Application | http://localhost:3000 | Main app |
| Inbucket Mail | http://localhost:9000 | View sent emails |
| MinIO Console | http://localhost:9001 | S3 storage dashboard |
| PostgreSQL | localhost:54320 | Database (user: documenso) |

### Default Credentials (Development)
```
Database: documenso / password
MinIO: documenso / password
Test User: testuser@mail.com / test_Password123
```

---

## Deploy

### Docker Compose (Production)

**Prerequisites:**
- Docker & Docker Compose
- PostgreSQL (or use bundled)
- SMTP credentials
- SSL certificate (.p12) for signing

**Steps:**

1. **Create environment file:**
```bash
# Generate secrets
NEXTAUTH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY_2=$(openssl rand -hex 32)

cat > .env << EOF
NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
NEXT_PRIVATE_ENCRYPTION_KEY="${ENCRYPTION_KEY}"
NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY="${ENCRYPTION_KEY_2}"
NEXT_PUBLIC_WEBAPP_URL="https://esign.yourdomain.com"
NEXT_PRIVATE_DATABASE_URL="postgres://user:pass@db:5432/davinci_esign"
NEXT_PRIVATE_DIRECT_DATABASE_URL="postgres://user:pass@db:5432/davinci_esign"
NEXT_PRIVATE_SMTP_TRANSPORT="smtp-auth"
NEXT_PRIVATE_SMTP_HOST="smtp.example.com"
NEXT_PRIVATE_SMTP_PORT="587"
NEXT_PRIVATE_SMTP_USERNAME="user"
NEXT_PRIVATE_SMTP_PASSWORD="password"
NEXT_PRIVATE_SMTP_FROM_NAME="Davinci Sign"
NEXT_PRIVATE_SMTP_FROM_ADDRESS="noreply@yourdomain.com"
NEXT_PRIVATE_SIGNING_PASSPHRASE="your-cert-password"
EOF
```

2. **Place signing certificate:**
```bash
mkdir -p /opt/davinci-sign
cp your-cert.p12 /opt/davinci-sign/cert.p12
chmod 644 /opt/davinci-sign/cert.p12
```

3. **Start services:**
```bash
docker compose -f docker/production/compose.yml --env-file .env up -d
```

4. **Verify deployment:**
```bash
curl http://localhost:3000/api/health
```

### Manual Deployment (systemd)

1. **Build application:**
```bash
npm ci
npm run build
npm run prisma:migrate-deploy
```

2. **Create systemd service:**
```ini
# /etc/systemd/system/davinci-sign.service
[Unit]
Description=Davinci Sign
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/davinci-sign/apps/remix
EnvironmentFile=/var/www/davinci-sign/.env
ExecStart=/usr/bin/node build/server/main.js
Restart=always

[Install]
WantedBy=multi-user.target
```

3. **Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable davinci-sign
sudo systemctl start davinci-sign
```

---

## Rollback

### Docker Rollback
```bash
# List available versions
docker images documenso/documenso

# Stop current
docker compose -f docker/production/compose.yml down

# Update compose to specific version
# Change: image: davinci/davinci-sign:v2.5.0

# Start previous version
docker compose -f docker/production/compose.yml up -d
```

### Code Rollback
```bash
# Find previous working commit
git log --oneline -20

# Checkout and rebuild
git checkout <commit-hash>
npm ci
npm run build
npm run prisma:migrate-deploy
```

**Note:** Prisma migrations are forward-only. If rollback requires schema changes, you may need to manually revert database changes.

---

## Migrations

### Apply Pending Migrations
```bash
# Development
npm run prisma:migrate-dev

# Production
npm run prisma:migrate-deploy
```

### Create New Migration
```bash
# After modifying schema.prisma
npm run prisma:migrate-dev -- --name descriptive_name
```

### Reset Database (Development Only)
```bash
npm run prisma:migrate-reset
```

### View Migration Status
```bash
npm run with:env -- npx prisma migrate status
```

### Manual Migration Fix
```bash
# Mark migration as applied (if already manually applied)
npm run with:env -- npx prisma migrate resolve --applied <migration_name>

# Mark migration as rolled back
npm run with:env -- npx prisma migrate resolve --rolled-back <migration_name>
```

---

## Monitoring

### Health Endpoints

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `/api/health` | Overall health | `{"status": "ok"}` |
| `/api/certificate-status` | Signing certificate | Cert details or error |

### Log Locations

**Docker:**
```bash
docker compose logs -f davinci-sign
```

**systemd:**
```bash
journalctl -u davinci-sign -f
```

**File logging (if configured):**
```bash
tail -f $NEXT_PRIVATE_LOGGER_FILE_PATH
```

### Key Metrics to Monitor

1. **Application:**
   - Response times on `/api/health`
   - Error rate in logs
   - Memory usage

2. **Database:**
   - Connection pool utilization
   - Query latency
   - Disk space

3. **Email:**
   - Delivery success rate
   - Bounce rate
   - Queue depth

4. **Storage:**
   - Disk/S3 usage
   - Upload success rate

### Alerts to Configure

| Alert | Condition | Action |
|-------|-----------|--------|
| Health check failing | `/api/health` returns non-200 | Check logs, restart |
| Certificate expiring | Cert expires in < 30 days | Renew certificate |
| Database connection errors | Connection pool exhausted | Scale database |
| Email delivery failures | Bounce rate > 5% | Check SMTP config |
| Disk space low | < 20% free | Expand storage |

---

## Common Issues

### Database Connection Failed

**Symptoms:** Application won't start, "Connection refused" errors

**Solutions:**
```bash
# Check database is running
docker compose ps database

# Check connection string
echo $NEXT_PRIVATE_DATABASE_URL

# Test connection
psql $NEXT_PRIVATE_DATABASE_URL -c "SELECT 1"

# Reset connection pool (restart app)
docker compose restart davinci-sign
```

### Certificate Errors

**Symptoms:** Documents won't seal, "Failed to read signing certificate"

**Solutions:**
```bash
# Check file exists
ls -la /opt/davinci-sign/cert.p12

# Check permissions
# Should be readable by container user (uid 1001)
chown 1001:1001 /opt/davinci-sign/cert.p12
chmod 644 /opt/davinci-sign/cert.p12

# Verify certificate password
openssl pkcs12 -info -in /opt/davinci-sign/cert.p12 -noout

# Check mount in container
docker exec davinci-sign-production-davinci-sign-1 \
  ls -la /opt/davinci-sign/cert.p12
```

### Emails Not Sending

**Symptoms:** Users don't receive signing requests or confirmations

**Solutions:**
```bash
# Check SMTP configuration
echo $NEXT_PRIVATE_SMTP_HOST
echo $NEXT_PRIVATE_SMTP_PORT

# Test SMTP connection
telnet $NEXT_PRIVATE_SMTP_HOST $NEXT_PRIVATE_SMTP_PORT

# Check email logs
docker compose logs davinci-sign | grep -i email

# If using Inbucket (dev), check http://localhost:9000
```

### Document Upload Fails

**Symptoms:** "Failed to upload document" error

**Solutions:**
```bash
# Check upload size limit
echo $NEXT_PUBLIC_DOCUMENT_SIZE_UPLOAD_LIMIT

# For S3 storage, check credentials
aws s3 ls s3://$NEXT_PRIVATE_UPLOAD_BUCKET --endpoint-url $NEXT_PRIVATE_UPLOAD_ENDPOINT

# Check MinIO (dev)
curl http://localhost:9002/minio/health/live
```

### Slow Performance

**Symptoms:** Pages load slowly, timeouts

**Solutions:**
```bash
# Check database query performance
npm run prisma:studio
# Look for slow queries

# Check container resources
docker stats

# Check database connections
psql $NEXT_PRIVATE_DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity"

# Check for missing indexes
# Review schema.prisma @@index annotations
```

### Authentication Issues

**Symptoms:** Users can't log in, session errors

**Solutions:**
```bash
# Clear sessions (forces re-login)
psql $NEXT_PRIVATE_DATABASE_URL -c "DELETE FROM \"Session\" WHERE expires < NOW()"

# Check NEXTAUTH_SECRET is set
echo $NEXTAUTH_SECRET | wc -c  # Should be > 32

# For OAuth issues, verify callback URLs match
# NEXT_PUBLIC_WEBAPP_URL must match OAuth provider config
```

### Migration Failures

**Symptoms:** "Migration failed" during deploy

**Solutions:**
```bash
# Check migration status
npm run with:env -- npx prisma migrate status

# View failed migration
cat packages/prisma/migrations/<failed_migration>/migration.sql

# Manual fix if needed
psql $NEXT_PRIVATE_DATABASE_URL -f fix.sql

# Mark as applied
npm run with:env -- npx prisma migrate resolve --applied <migration_name>
```

---

## Maintenance Tasks

### Generate New Signing Certificate
```bash
# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout private.key \
  -out certificate.crt \
  -subj "/C=US/ST=State/L=City/O=Davinci/CN=esign.davincisolutions.ai"

# Convert to PKCS12
openssl pkcs12 -export \
  -out cert.p12 \
  -inkey private.key \
  -in certificate.crt \
  -passout pass:your-passphrase

# Deploy
cp cert.p12 /opt/davinci-sign/cert.p12
chmod 644 /opt/davinci-sign/cert.p12

# Restart application
docker compose restart davinci-sign
```

### Database Backup
```bash
# Create backup
pg_dump $NEXT_PRIVATE_DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore backup
psql $NEXT_PRIVATE_DATABASE_URL < backup_20260202.sql
```

### Clear Old Data
```bash
# Clear expired sessions
psql $NEXT_PRIVATE_DATABASE_URL -c "DELETE FROM \"Session\" WHERE expires < NOW() - INTERVAL '30 days'"

# Clear old audit logs (careful - may be compliance requirement)
# Review retention policy before running
```

### Update Application
```bash
# Pull latest image
docker compose -f docker/production/compose.yml pull

# Apply with new migrations
docker compose -f docker/production/compose.yml up -d
```

---

## Emergency Contacts

| Issue | Contact |
|-------|---------|
| Application Issues | DevOps Team |
| Database Issues | DBA Team |
| Security Incident | Security Team |
| Compliance Questions | Legal/Compliance |

---

## Appendix: Docker Commands Reference

```bash
# Start services
docker compose -f docker/production/compose.yml up -d

# Stop services
docker compose -f docker/production/compose.yml down

# View logs
docker compose -f docker/production/compose.yml logs -f

# Restart single service
docker compose -f docker/production/compose.yml restart davinci-sign

# Execute command in container
docker exec -it <container_name> sh

# Check container status
docker compose -f docker/production/compose.yml ps

# Rebuild and restart
docker compose -f docker/production/compose.yml up --build -d

# Remove volumes (DESTRUCTIVE)
docker compose -f docker/production/compose.yml down -v
```

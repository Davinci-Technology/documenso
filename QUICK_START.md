# Davinci ESign Quick Start

Get Davinci ESign running locally with Docker in minutes.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running
- [Docker Compose](https://docs.docker.com/compose/install/) (included with Docker Desktop)

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd documenso
```

### 2. Start the Application

For development/testing with a local mail server:

```bash
docker compose -f docker/testing/compose.yml up -d
```

This starts:
- **Davinci ESign** at http://localhost:3000
- **Inbucket** (email testing) at http://localhost:9000
- **PostgreSQL** database

### 3. Create an Account

1. Go to http://localhost:3000
2. Click "Sign up"
3. Enter your details
4. Check http://localhost:9000 for the verification email
5. Click the verification link

You're ready to use Davinci ESign!

## Other Docker Commands

### Stop the Application

```bash
docker compose -f docker/testing/compose.yml down
```

### View Logs

```bash
docker compose -f docker/testing/compose.yml logs -f
```

### Rebuild After Code Changes

```bash
docker compose -f docker/testing/compose.yml up --build -d
```

### Reset Database

```bash
docker compose -f docker/testing/compose.yml down -v
docker compose -f docker/testing/compose.yml up -d
```

## Production Deployment

For production, use the production compose file:

```bash
docker compose -f docker/production/compose.yml up -d
```

See `docker/README.md` for full production configuration options including:
- SSL certificates for document signing
- External database configuration
- SMTP configuration
- Environment variables

## Ports

| Service | Port | Description |
|---------|------|-------------|
| Davinci ESign | 3000 | Main application |
| Inbucket Web | 9000 | Email testing UI |
| Inbucket SMTP | 2500 | SMTP server |
| PostgreSQL | 54322 | Database |

## Troubleshooting

### Container won't start

Check the logs:
```bash
docker compose -f docker/testing/compose.yml logs davinci-esign
```

### Database connection issues

Reset the database:
```bash
docker compose -f docker/testing/compose.yml down -v
docker compose -f docker/testing/compose.yml up -d
```

### Emails not appearing in Inbucket

Ensure Inbucket is running:
```bash
docker compose -f docker/testing/compose.yml ps
```

The Inbucket web UI should be accessible at http://localhost:9000

## More Information

- **Testing Guide**: See `TESTING.md`
- **Branding Guide**: See `BRANDING.md`
- **Docker Documentation**: See `docker/README.md`

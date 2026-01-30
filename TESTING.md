# Davinci ESign Testing Guide

This document outlines the testing approach and procedures for the Davinci ESign application.

## Test Framework

The project uses **Playwright** for end-to-end (E2E) testing.

## Running Tests

### E2E Tests
```bash
# Run all E2E tests
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Run specific test file
npx playwright test path/to/test.spec.ts
```

### Unit Tests
```bash
# Run unit tests
npm run test
```

## Test Directory Structure

```
packages/
├── app-tests/           # E2E test suite
│   ├── e2e/            # End-to-end test files
│   └── fixtures/       # Test fixtures and helpers
```

## Local Testing with Docker

### Development Environment
```bash
# Start development services (database, mail, storage)
docker compose -f docker/development/compose.yml up -d

# Run the application
npm run dev
```

### Testing Stack
```bash
# Run full testing stack with build
docker compose -f docker/testing/compose.yml up --build

# Run tests against the testing stack
npm run test:e2e
```

### Production Build Testing
```bash
# Build the Docker image locally
docker build -f docker/Dockerfile -t davinci-esign:local .

# Run the local image
docker run -p 3000:3000 davinci-esign:local
```

## Environment Variables for Testing

Set these in your `.env` file for local testing:

```bash
E2E_TEST_AUTHENTICATE_USERNAME="Test User"
E2E_TEST_AUTHENTICATE_USER_EMAIL="testuser@mail.com"
E2E_TEST_AUTHENTICATE_USER_PASSWORD="test_Password123"
```

## Branding Verification Checklist

After making branding changes, verify the following:

### Visual Elements
- [ ] Favicon appears correctly in browser tab
- [ ] Logo displays on login/signup pages
- [ ] Logo displays in navigation header
- [ ] Logo displays in email templates
- [ ] Opengraph image shows correctly when sharing links

### Text Elements
- [ ] Page titles show "Davinci ESign"
- [ ] API documentation shows correct branding
- [ ] Email sender name shows "Davinci ESign"
- [ ] 2FA app shows "Davinci ESign" as issuer

### Color Theme
- [ ] Primary buttons use Davinci blue (#1A98CF)
- [ ] Links and accents use the correct color
- [ ] Dark mode maintains proper contrast

### Docker
- [ ] Containers start without errors
- [ ] Certificate paths resolve correctly
- [ ] Health check endpoint responds

## CI/CD Configuration

The project uses GitHub Actions for continuous integration. Test workflows are defined in:
- `.github/workflows/` directory

### Running Tests in CI
Tests automatically run on:
- Pull requests to main branch
- Pushes to main branch

## Troubleshooting

### Database Connection Issues
```bash
# Reset the development database
docker compose -f docker/development/compose.yml down -v
docker compose -f docker/development/compose.yml up -d
npm run prisma:migrate-dev
```

### Email Testing
The development stack includes Inbucket for email testing:
- Web UI: http://localhost:9000
- SMTP: localhost:2500

### Test Failures
1. Ensure all services are running: `docker compose -f docker/development/compose.yml ps`
2. Check database migrations are applied: `npm run prisma:migrate-dev`
3. Verify environment variables are set correctly
4. Check application logs for errors

## Writing New Tests

### E2E Test Template
```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/path');
    await expect(page.locator('selector')).toBeVisible();
  });
});
```

### Best Practices
1. Use descriptive test names
2. Keep tests independent and isolated
3. Use page object patterns for reusable interactions
4. Clean up test data after each test
5. Use meaningful assertions

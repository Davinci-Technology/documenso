#!/bin/sh

# 🚀 Starting Davinci Sign...
printf "🚀 Starting Davinci Sign...\n\n"

# 🔐 Check certificate configuration
printf "🔐 Checking certificate configuration...\n"

CERT_PATH="${NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH:-/opt/davinci-sign/cert.p12}"

if [ -f "$CERT_PATH" ] && [ -r "$CERT_PATH" ]; then
    printf "✅ Certificate file found and readable - document signing is ready!\n"
else
    printf "⚠️ Certificate not found or not readable\n"
    printf "💡 Tip: Davinci Sign will still start, but document signing will be unavailable\n"
    printf "🔧 Check: http://localhost:3000/api/certificate-status for detailed status\n"
fi

printf "\n📚 Useful Links:\n"
printf "📖 Documentation: https://davincisolutions.ai\n"
printf "🐳 Self-hosting guide: https://davincisolutions.ai/developers/self-hosting\n"
printf "🔐 Certificate setup: https://davincisolutions.ai/developers/self-hosting/signing-certificate\n"
printf "🏥 Health check: http://localhost:3000/api/health\n"
printf "📊 Certificate status: http://localhost:3000/api/certificate-status\n"
printf "👥 Community: https://github.com/documenso/documenso (upstream)\n\n"

# The Prisma schema requires a direct URL. Without a connection pooler, it is the same as the database URL.
export NEXT_PRIVATE_DIRECT_DATABASE_URL="${NEXT_PRIVATE_DIRECT_DATABASE_URL:-$NEXT_PRIVATE_DATABASE_URL}"

printf "🗄️  Running database migrations...\n"
npx prisma migrate deploy --schema ../../packages/prisma/schema.prisma

printf "🌟 Starting Davinci Sign server...\n"
HOSTNAME=0.0.0.0 node build/server/main.js

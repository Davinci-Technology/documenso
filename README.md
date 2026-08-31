# Davinci Sign

Professional electronic signature solution by Davinci AI Solutions.

> **Note:** This project is a modified fork of [Davinci Sign](https://github.com/documenso/documenso), an open-source document signing platform licensed under the AGPL-3.0. We extend our gratitude to the Davinci Sign team for their excellent work. The complete corresponding source for this fork is available in this repository.

<p align="center" style="margin-top: 20px">
  <p align="center">
  The Open Source DocuSign Alternative.
  <br>
    <a href="https://davincisolutions.ai"><strong>Learn more »</strong></a>
    <br />
    <br />
    <a href="https://documen.so/discord">Discord</a>
    ·
    <a href="https://davincisolutions.ai">Website</a>
    ·
    <a href="https://docs.davincisolutions.ai">Documentation</a>
    ·
    <a href="https://github.com/documenso/documenso/issues">Issues</a>
    ·
    <a href="https://documen.so/live">Upcoming Releases</a>
    ·
    <a href="https://documen.so/roadmap">Roadmap</a>
  </p>
</p>

## About Davinci Sign

Davinci Sign provides a fast, secure, and easy document signing experience for businesses. Built on the robust Davinci Sign platform, it offers:

- Secure electronic signatures
- Self-hosting capability
- Full control over your document signing infrastructure
- Integration with your existing workflows

## Community and Next Steps 🎯

- Try Davinci Sign by self-hosting it or visiting [davincisolutions.ai](https://davincisolutions.ai).
- Tell us what you think in the [Davinci Sign Discussions](https://github.com/documenso/documenso/discussions).
- Join the [Discord server](https://documen.so/discord) for any questions and getting to know other community members.
- ⭐ the repository to help us raise awareness.
- Open detailed [issues](https://github.com/documenso/documenso/issues) to report bugs or propose features.

## Contributing

> **Note**: We no longer accept external pull requests, aside from a small group of trusted contributors we reach out to directly. The best way to contribute is through detailed issues. Read [Why We're Pausing External Pull Requests](https://davincisolutions.ai/blog/why-we-re-pausing-external-pull-requests) for the reasoning.

- Davinci Sign stays open source. You can read, audit, run, and fork the code.
- To report issues or propose changes, see our [contribution guide](https://github.com/documenso/documenso/blob/main/CONTRIBUTING.md).

## Contact us

Contact us if you are interested in our Enterprise plan for large organizations that need extra flexibility and control at [support@davincisolutions.ai](mailto:support@davincisolutions.ai).

## Tech Stack

<p align="left">
  <a href="https://www.typescriptlang.org"><img src="https://shields.io/badge/TypeScript-3178C6?logo=TypeScript&logoColor=FFF&style=flat-square" alt="TypeScript"></a>
  <a href="https://prisma.io"><img width="122" height="20" src="http://made-with.prisma.io/indigo.svg" alt="Made with Prisma" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/tailwindcss-0F172A?&logo=tailwindcss" alt="Tailwind CSS"></a>
</p>

- [TypeScript](https://www.typescriptlang.org/) - Language
- [React Router v7](https://reactrouter.com/) - Framework
- [Hono](https://hono.dev/) - Server
- [Prisma](https://www.prisma.io/) - ORM
- [Tailwind CSS](https://tailwindcss.com/) - CSS
- [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/) - Component Library
- [react-email](https://react.email/) - Email Templates
- [Lingui](https://lingui.dev/) - Internationalization
- [tRPC](https://trpc.io/) - API
- [@documenso/pdf-sign](https://www.npmjs.com/package/@documenso/pdf-sign) - PDF Signatures
- [React-PDF](https://github.com/wojtekmaj/react-pdf) - Viewing PDFs
- [PDF-Lib](https://github.com/Hopding/pdf-lib) - PDF manipulation
- [Stripe](https://stripe.com/) - Payments

## Local Development

### Requirements

To run Davinci Sign locally, you will need

- Node.js (v22 or above)
- Postgres SQL Database
- Docker (optional)

### Developer Quickstart

> **Note**: This is a quickstart for developers. It assumes that you have both [docker](https://docs.docker.com/get-docker/) and [docker-compose](https://docs.docker.com/compose/) installed on your machine.

1. [Fork this repository](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-forks) to your GitHub account.

After forking the repository, clone it to your local device by using the following command:

```sh
git clone https://github.com/<your-username>/documenso
```

2. Set up your `.env` file using the recommendations in the `.env.example` file. Alternatively, just run `cp .env.example .env` to get started with our handpicked defaults.

3. Run `npm run dx` in the root directory

4. Run `npm run dev` in the root directory

## Developer Setup

For full instructions, requirements, and configuration details, see the [Self Hosting documentation](https://docs.davincisolutions.ai/docs/self-hosting).

### One-Click Deploys

> [!NOTE]
> Want to see another provider listed here? Please [open a provider request](https://github.com/documenso/documenso/issues/new?template=deploy-provider-request.yml) instead of a PR so the community can signal interest. PRs adding deploy badges without a prior issue will be closed.

<table>
  <tr>
    <td align="center" width="200">
      <a href="https://railway.com/deploy/DjrRRX?referralCode=EZR3s0&utm_medium=integration&utm_source=template&utm_campaign=generic">
        <img src="https://railway.com/button.svg" alt="Deploy on Railway" height="40" />
      </a>
    </td>
    <td align="center" width="200">
      <a href="https://render.com/deploy?repo=https://github.com/documenso/documenso">
        <img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" height="40" />
      </a>
    </td>
    <td align="center" width="200">
      <a href="https://app.koyeb.com/deploy?type=git&repository=github.com/documenso/documenso&branch=main&name=documenso-app&builder=dockerfile&dockerfile=/docker/Dockerfile">
        <img src="https://www.koyeb.com/static/images/deploy/button.svg" alt="Deploy to Koyeb" height="40" />
      </a>
    </td>
  </tr>
  <tr>
    <td align="center" width="200">
      <a href="https://elest.io/open-source/documenso">
        <img src="https://elest.io/images/logos/deploy-to-elestio-btn.png" alt="Deploy on Elestio" height="40" />
      </a>
    </td>
    <td align="center" width="200"></td>
    <td align="center" width="200"></td>
  </tr>
</table>

### Manual Setup

Follow these steps to setup Davinci Sign on your local machine, or refer to the [manual setup guide](https://docs.davincisolutions.ai/docs/developers/local-development/manual) for more details:

1. [Fork this repository](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-forks) to your GitHub account.

After forking the repository, clone it to your local device by using the following command:

```sh
git clone https://github.com/<your-username>/documenso
```

2. Run `npm i` in the root directory

3. Create your `.env` from the `.env.example`. You can use `cp .env.example .env` to get started with our handpicked defaults.

4. Set the following environment variables:

   - NEXTAUTH_SECRET
   - NEXT_PUBLIC_WEBAPP_URL
   - NEXT_PRIVATE_DATABASE_URL
   - NEXT_PRIVATE_DIRECT_DATABASE_URL
   - NEXT_PRIVATE_SMTP_FROM_NAME
   - NEXT_PRIVATE_SMTP_FROM_ADDRESS

5. Create the database schema by running `npm run prisma:migrate-dev`

6. Run `npm run translate:compile` in the root directory to compile lingui

7. Run `npm run dev` in the root directory to start

8. Register a new user at http://localhost:3000/signup

## Docker

### For Production

We provide a multi-platform Docker image for easy deployment:

```bash
docker pull davinci/davinci-sign:latest
```

### For local development and testing

> **Note**: This is not intended for a production deployment. It's intended for fast iteration and development.

We've created a development docker-compose that will spin up a local Davinci Sign instance with all dependencies.

1. Clone or fork the repository (see Developer Quickstart)
2. Run `cp .env.example .env`
3. Run `docker compose -f docker/development.docker-compose.yml up -d`

This will spin up a Davinci Sign instance at http://localhost:3000 with a Postgres database and an email service (Inbucket) for email testing.

The Inbucket service is available at http://localhost:9000 for viewing test emails.

If you are deploying to a cluster that uses only IPv6, you can use a custom command to pass a parameter to the Remix start command.

For local docker run:

```bash
docker run -it davinci/davinci-sign:latest npm run start -- -H ::
```

## Security

If you believe you have found a security vulnerability in Davinci Sign, please report it through our [Security Policy](https://github.com/documenso/documenso/security/policy). We prioritize private reports via [GitHub Security Advisories](https://github.com/documenso/documenso/security/advisories/new). See [SECURITY.md](./SECURITY.md) for scope and details.

## Troubleshooting

For troubleshooting self-hosted deployments, see the [Troubleshooting guide](https://docs.davincisolutions.ai/docs/self-hosting/maintenance/troubleshooting) and [Tips & Common Pitfalls](https://docs.davincisolutions.ai/docs/self-hosting/getting-started/tips).

### I'm not receiving any emails when using the developer quickstart.

When using the developer quickstart, an [Inbucket](https://inbucket.org/) server will be spun up in a docker container that will store all outgoing emails locally for you to view.

The Web UI can be found at http://localhost:9000, while the SMTP port will be on localhost:2500.

### I can't see environment variables in my package scripts.

Wrap your package script with the `with:env` script like such:

```json
{
  "scripts": {
    "my-custom-script": "with:env tsx hello-world.ts"
  }
}
```

Everything looks good? Then it's time to contribute. Read the contribution guide on [GitHub](https://github.com/documenso/documenso/blob/main/CONTRIBUTING.md).
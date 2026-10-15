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

5. Want it even faster? Just use

```sh
npm run d
```

#### Access Points for Your Application

1. **App** - http://localhost:3000
2. **Incoming Mail Access** - http://localhost:9000
3. **Database Connection Details**

   - **Port**: 54320
   - **Connection**: Use your favorite database client to connect using the provided port.

## Developer Setup

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

### Running the project

1. Run `npm run dev` in the root directory

## Test suite

All tests are located in the same directory as the source files. They are identified by the `.spec.ts` or `.test.ts` file extension.

```bash
# Run the test suite
npm test

# Run the test suite in watch mode
npm run test:watch
```

## Production

### Docker

We provide a Docker image for easy deployment. The Docker image is available at [davinci/davinci-sign](https://hub.docker.com/r/davinci/davinci-sign).

For Docker deployment, refer to our [Docker guide](https://docs.davincisolutions.ai/docs/developers/local-development/docker).

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/DLHftT?referralCode=luckybyte)

### Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/documenso/documenso)

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/documenso/documenso)

## Email Address

You can now setup your own email using [Resend](https://resend.com/docs/send-with-nextjs), [SendGrid](https://sendgrid.com/), [Mailgun](https://www.mailgun.com/), [Postmark](https://postmarkapp.com/), or [Nodemailer](https://nodemailer.com/about/).

## Pledges

This project was built in public by the [Davinci AI Solutions team](https://davincisolutions.ai/) and is funded by our own savings and by the community.

And a big thanks goes to the [Davinci Sign](https://davincisolutions.ai/) team for creating this open-source project that we could fork and build upon.

## Acknowledgements

## Credits

Thanks to all the contributors who have helped make Davinci Sign better:

<!-- Contributors list will be updated -->

## License

[AGPL-3.0 License](https://github.com/documenso/documenso/blob/main/LICENSE.md)
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { type AddressInfo, createServer as createTcpServer, type Socket } from 'node:net';
import path from 'node:path';
import { DEFAULT_DOCUMENT_EMAIL_SETTINGS } from '@documenso/lib/types/document-email';
import { prisma } from '@documenso/prisma';
import { test as base } from '@playwright/test';

export const startSmtpSink = async () => {
  let mode: 'accept' | 'drop-ack' | 'temporary' = 'accept';
  let bodies = 0;
  let accepted = 0;
  let rejected = false;
  const sockets = new Set<Socket>();
  const shutdownSockets = new WeakSet<Socket>();
  const connectionIds = new WeakMap<Socket, number>();
  const socketEvents: Array<{ connectionId: number; event: string; code?: string; expected?: boolean }> = [];
  const unexpectedErrors: Error[] = [];
  let nextConnectionId = 0;
  const expectPeerShutdown = () => {
    for (const socket of sockets) {
      shutdownSockets.add(socket);
      socketEvents.push({ connectionId: connectionIds.get(socket) ?? 0, event: 'intentional-peer-shutdown' });
    }
  };
  const assertNoUnexpectedErrors = () => {
    if (unexpectedErrors.length) {
      throw new Error('Unexpected SMTP sink socket error', { cause: unexpectedErrors[0] });
    }
  };
  const server = createTcpServer((socket) => {
    const connectionId = ++nextConnectionId;
    sockets.add(socket);
    connectionIds.set(socket, connectionId);
    socketEvents.push({ connectionId, event: 'open' });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      const expected = shutdownSockets.has(socket) && error.code === 'ECONNRESET';
      socketEvents.push({ connectionId, event: 'error', code: error.code, expected });
      if (!expected) {
        unexpectedErrors.push(error);
      }
    });
    socket.on('close', () => {
      socketEvents.push({ connectionId, event: 'close' });
      sockets.delete(socket);
    });
    socket.write('220 local synthetic SMTP\r\n');
    let buffer = '';
    let inData = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line !== '.') {
            continue;
          }
          bodies++;
          inData = false;
          if (mode === 'temporary' && !rejected) {
            rejected = true;
            socket.write('451 synthetic temporary rejection\r\n');
            continue;
          }
          accepted++;
          if (mode === 'drop-ack') {
            socket.destroy();
            return;
          }
          socket.write('250 synthetic accepted\r\n');
        } else if (/^(EHLO|HELO)/.test(line)) {
          socket.write('250 local\r\n');
        } else if (/^(MAIL FROM|RCPT TO)/.test(line)) {
          socket.write('250 OK\r\n');
        } else if (line === 'DATA') {
          inData = true;
          socket.write('354 send data\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    setMode(value: typeof mode) {
      mode = value;
      rejected = false;
    },
    counts: () => ({ bodies, accepted }),
    expectPeerShutdown,
    assertNoUnexpectedErrors,
    socketEvents: () => [...socketEvents],
    async close() {
      expectPeerShutdown();
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

export const test = base.extend<{
  runtime: {
    url: string;
    smtp: Awaited<ReturnType<typeof startSmtpSink>>;
    callbacks: Array<{ body: Buffer; headers: Record<string, string | string[] | undefined> }>;
    callbackUrl: string;
    providerPrivateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
    restart: () => Promise<void>;
  };
}>({
  runtime: async ({ request: _request }, use, testInfo) => {
    const smtp = await startSmtpSink();
    const callbacks: Array<{ body: Buffer; headers: Record<string, string | string[] | undefined> }> = [];
    const callback = createHttpServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      callbacks.push({ body: Buffer.concat(chunks), headers: req.headers });
      res.writeHead(200);
      res.end('OK');
    });
    const callbackPort = await listen(callback);
    const reservation = createHttpServer();
    const port = await listen(reservation);
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const url = `http://127.0.0.1:${port}`;
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    let child: ChildProcess | undefined;
    let diagnostics = '';
    const stop = async () => {
      if (child && child.exitCode === null) {
        const exited = once(child, 'exit');
        smtp.expectPeerShutdown();
        child.kill('SIGTERM');
        await exited;
      }
    };
    const start = async () => {
      child = spawn(process.execPath, [path.resolve('fixtures/delivery-server.mjs')], {
        env: {
          ...process.env,
          PORT: String(port),
          NODE_ENV: 'production',
          NEXT_PUBLIC_WEBAPP_URL: url,
          NEXT_PRIVATE_INTERNAL_WEBAPP_URL: url,
          NEXT_PRIVATE_JOBS_PROVIDER: 'local',
          NEXT_PRIVATE_SMTP_HOST: '127.0.0.1',
          NEXT_PRIVATE_SMTP_PORT: String(smtp.port),
          NEXT_PRIVATE_SMTP_USERNAME: '',
          NEXT_PRIVATE_SMTP_PASSWORD: '',
          NEXT_PRIVATE_SMTP_APIKEY: '',
          NEXT_PRIVATE_SMTP_SERVICE: '',
          NEXT_PRIVATE_SMTP_SECURE: 'false',
          NEXT_PRIVATE_SMTP_TRANSPORT: 'smtp-auth',
          NEXT_PRIVATE_SMTP_FROM_ADDRESS: 'synthetic@invalid.test',
          DOCUMENSO_DISABLE_TELEMETRY: 'true',
          NEXT_PRIVATE_WEBHOOK_ALLOWED_HOSTS: '127.0.0.1',
          NEXT_PRIVATE_SENDGRID_WEBHOOK_VERIFICATION_KEY: publicKey
            .export({ type: 'spki', format: 'der' })
            .toString('base64'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (data) => {
        diagnostics = (diagnostics + data.toString()).slice(-12000);
      });
      child.stderr?.on('data', (data) => {
        diagnostics = (diagnostics + data.toString()).slice(-12000);
      });
      for (let attempt = 0; attempt < 200; attempt++) {
        try {
          if ((await fetch(`${url}/api/operations/delivery`)).status === 403) {
            return;
          }
        } catch {}
        if (child.exitCode !== null) {
          throw new Error(`Delivery server exited: ${diagnostics}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Delivery server did not start: ${diagnostics}`);
    };
    try {
      await start();
      await use({
        url,
        smtp,
        callbacks,
        callbackUrl: `http://127.0.0.1:${callbackPort}/callback`,
        providerPrivateKey: privateKey,
        restart: async () => {
          await stop();
          await start();
        },
      });
    } finally {
      await stop();
      await smtp.close();
      callback.closeAllConnections();
      await new Promise<void>((resolve) => callback.close(() => resolve()));
      const socketEvents = smtp.socketEvents();
      if (testInfo.status !== testInfo.expectedStatus || socketEvents.some((event) => event.event === 'error')) {
        const file = testInfo.outputPath('synthetic-delivery-server.log');
        await writeFile(
          file,
          `${diagnostics}\nSMTP socket lifecycle: ${JSON.stringify({ port: smtp.port, events: socketEvents })}\n`,
        );
        await testInfo.attach('synthetic-delivery-server.log', { path: file, contentType: 'text/plain' });
      }
      smtp.assertNoUnexpectedErrors();
    }
  },
});

export const seedEnvelope = async (callbackUrl: string) => {
  const unique = randomUUID();
  const user = await prisma.user.create({
    data: { email: `${unique}@invalid.test`, roles: ['USER', 'ADMIN'], emailVerified: new Date() },
  });
  const organisation = await prisma.organisation.create({
    data: {
      id: unique,
      name: 'Synthetic delivery',
      url: unique,
      type: 'PERSONAL',
      owner: { connect: { id: user.id } },
      organisationClaim: {
        create: {
          id: unique,
          teamCount: 10,
          memberCount: 10,
          envelopeItemCount: 10,
          recipientCount: 10,
          flags: {},
          documentRateLimits: [],
          emailRateLimits: [],
          apiRateLimits: [],
        },
      },
      organisationGlobalSettings: { create: { id: unique, emailDocumentSettings: DEFAULT_DOCUMENT_EMAIL_SETTINGS } },
      organisationAuthenticationPortal: { create: { id: unique } },
    },
  });
  const team = await prisma.team.create({
    data: {
      name: 'Synthetic',
      url: unique,
      organisation: { connect: { id: organisation.id } },
      teamGlobalSettings: { create: { id: unique } },
    },
  });
  const member = await prisma.organisationMember.create({
    data: { id: unique, userId: user.id, organisationId: organisation.id },
  });
  await prisma.organisationGroup.create({
    data: {
      id: unique,
      type: 'INTERNAL_TEAM',
      organisationRole: 'ADMIN',
      organisationId: organisation.id,
      organisationGroupMembers: { create: { id: unique, organisationMemberId: member.id } },
      teamGroups: { create: { id: unique, teamRole: 'ADMIN', teamId: team.id } },
    },
  });
  const envelope = await prisma.envelope.create({
    data: {
      id: `envelope_${unique}`,
      secondaryId: `document_${user.id}`,
      title: 'Synthetic élève delivery',
      type: 'DOCUMENT',
      source: 'DOCUMENT',
      signatureLevel: 'SES',
      internalVersion: 2,
      user: { connect: { id: user.id } },
      team: { connect: { id: team.id } },
      status: 'COMPLETED',
      documentMeta: {
        create: { emailSettings: { ...DEFAULT_DOCUMENT_EMAIL_SETTINGS, ownerDocumentCompleted: false } },
      },
      recipients: {
        create: {
          name: 'Synthetic recipient',
          email: `recipient-${unique}@invalid.test`,
          token: unique,
          sendStatus: 'SENT',
        },
      },
    },
    include: { recipients: true },
  });
  const webhook = await prisma.webhook.create({
    data: {
      webhookUrl: callbackUrl,
      secret: 'synthetic-contract-secret',
      eventTriggers: ['DOCUMENT_COMPLETED', 'RECIPIENT_EXPIRED'],
      userId: user.id,
      teamId: team.id,
    },
  });
  return { user, envelope, recipient: envelope.recipients[0], webhook };
};

export const createParent = async (name: string, payload: Record<string, unknown>) =>
  prisma.backgroundJob.create({
    data: {
      id: randomUUID(),
      jobId: name,
      name,
      version: '1.0.0',
      payload,
    },
  });

export const cacheTask = async (jobId: string, name: string, result: Record<string, unknown>) =>
  prisma.backgroundJobTask.create({
    data: {
      id: `task-${createHash('sha256').update(name).digest('hex')}--${jobId}`,
      jobId,
      name,
      status: 'COMPLETED',
      result,
      completedAt: new Date(),
    },
  });

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { issueAccessToken } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createRepository } from '../src/repository.js';

let repo;
let app;
let owner;
let ownerHeaders;
let platformHeaders;
let internalHeaders;
let sentEmail;

function headersFor(user) {
  repo.users.push(user);
  return { Authorization: `Bearer ${issueAccessToken(user, config)}` };
}

before(async () => {
  repo = await createRepository({
    ...config, STORAGE_MODE: 'memory', SENSITIVE_DATA_KEY: randomBytes(32).toString('base64url')
  });
  owner = repo.users.find((user) => user.role === 'owner_director');
  ownerHeaders = { Authorization: `Bearer ${issueAccessToken(owner, config)}` };
  const platformUser = {
    ...owner, id: randomUUID(), role: 'super_admin',
    campusIds: [], activeCampusId: null, isActive: true
  };
  platformHeaders = headersFor(platformUser);
  const internalUser = {
    ...owner, id: randomUUID(), role: 'system_admin',
    email: `it-${randomUUID()}@example.test`
  };
  internalHeaders = headersFor(internalUser);
  app = createApp({
    repo,
    config: { ...config, NODE_ENV: 'test' },
    mailer: {
      async isConfigured() { return true; },
      async sendTestEmail(message) { sentEmail = message; }
    }
  });
});

after(async () => { await repo?.close(); });

describe('WP14 support and monitoring APIs', () => {
  it('creates tenant-scoped tickets, enforces transitions and permissions, and protects attachments', async () => {
    const created = await request(app).post('/api/support/tickets').set(ownerHeaders).send({
      subject: 'Cannot sign in', category: 'account', priority: 'high'
    });
    assert.equal(created.status, 201);
    const ticketId = created.body.data.id;
    assert.equal(created.body.data.ticketType, 'platform');

    const internalTicket = await request(app).post('/api/school/it-tickets')
      .set(internalHeaders).send({ subject: 'Printer issue', category: 'technical' });
    assert.equal(internalTicket.status, 201);
    assert.equal(internalTicket.body.data.ticketType, 'internal');
    assert.equal((await request(app).get('/api/support/tickets').set(ownerHeaders)).body.data.length, 1);
    assert.equal((await request(app).get('/api/school/it-tickets').set(internalHeaders)).body.data.length, 1);

    const otherSchoolTicket = {
      id: randomUUID(), organizationId: randomUUID(), campusId: owner.activeCampusId,
      ticketType: 'platform', subject: 'Other school issue', category: 'technical',
      priority: 'normal', status: 'open', createdBy: randomUUID(), assignedTo: null,
      resolvedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    repo.supportTickets.push(otherSchoolTicket);
    const schoolTickets = await request(app).get('/api/support/tickets').set(ownerHeaders);
    assert.equal(schoolTickets.status, 200);
    assert.equal(schoolTickets.body.data.length, 1);
    assert.equal((await request(app).get(`/api/support/tickets/${otherSchoolTicket.id}`)
      .set(ownerHeaders)).status, 404);
    const parentHeaders = headersFor({
      ...owner, id: randomUUID(), role: 'parent_guardian',
      email: `parent-${randomUUID()}@example.test`
    });
    assert.equal((await request(app).get('/api/support/tickets').set(parentHeaders)).status, 403);
    assert.equal((await request(app).patch(`/api/school/it-tickets/${internalTicket.body.data.id}`)
      .set(ownerHeaders).send({ status: 'resolved' })).status, 403);
    assert.equal((await request(app).get('/api/school/it-tickets')
      .set(ownerHeaders)).status, 403);

    const upload = await request(app).post(`/api/support/tickets/${ticketId}/attachments`)
      .set(ownerHeaders).set('Content-Type', 'application/pdf')
      .set('X-File-Name', 'troubleshoot.pdf').send(Buffer.from('%PDF-1.4 test'));
    assert.equal(upload.status, 201);
    assert.equal(upload.body.data.sizeBytes, 13);
    const attachmentId = upload.body.data.id;
    const download = await request(app).get(`/api/support/attachments/${attachmentId}`)
      .set(ownerHeaders);
    assert.equal(download.status, 200);
    assert.equal(download.headers['content-type'], 'application/pdf');
    assert.equal((await request(app).get(`/api/school/it-attachments/${attachmentId}`)
      .set(internalHeaders)).status, 404);

    const updated = await request(app).patch(`/api/platform/support/tickets/${ticketId}`)
      .set(platformHeaders).send({ status: 'in_progress' });
    assert.equal(updated.status, 200);
    const invalidTransition = await request(app).patch(`/api/platform/support/tickets/${ticketId}`)
      .set(platformHeaders).send({ status: 'in_progress' });
    assert.equal(invalidTransition.status, 409);

    const internalNote = await request(app).post(`/api/platform/support/tickets/${ticketId}/comments`)
      .set(platformHeaders).send({ body: 'Internal investigation', isInternal: true });
    assert.equal(internalNote.status, 201);
    const schoolView = await request(app).get(`/api/support/tickets/${ticketId}`).set(ownerHeaders);
    assert.equal(schoolView.status, 200);
    assert.equal(schoolView.body.data.comments.length, 0);
    assert.equal(schoolView.body.data.attachments[0].originalName, 'troubleshoot.pdf');
    const platformView = await request(app).get(`/api/platform/support/tickets/${ticketId}`)
      .set(platformHeaders);
    assert.equal(platformView.body.data.comments[0].isInternal, true);
  });

  it('restricts monitoring and backup history and does not expose email credentials', async () => {
    assert.equal((await request(app).get('/api/platform/monitoring').set(ownerHeaders)).status, 403);
    const monitoring = await request(app).get('/api/platform/monitoring').set(platformHeaders);
    assert.equal(monitoring.status, 200);
    assert.equal(monitoring.body.data.database.reachable, true);
    assert.equal(JSON.stringify(monitoring.body).includes('password'), false);

    assert.equal((await request(app).get('/api/platform/backups').set(ownerHeaders)).status, 403);
    const backupHistory = await request(app).get('/api/platform/backups').set(platformHeaders);
    assert.equal(backupHistory.status, 200);
    assert.equal(Array.isArray(backupHistory.body.data), true);

    const integration = await request(app).get('/api/school/integrations/email').set(internalHeaders);
    assert.equal(integration.status, 200);
    assert.deepEqual(integration.body.data, { configured: true });
    assert.equal(JSON.stringify(integration.body).includes('password'), false);
    const sent = await request(app).post('/api/school/integrations/email/test')
      .set(internalHeaders).send({ email: 'it@example.test' });
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body.data, { sent: true });
    assert.deepEqual(sentEmail, { email: 'it@example.test' });
  });
});

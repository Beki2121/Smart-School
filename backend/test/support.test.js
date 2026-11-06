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
let supportStaffHeaders;
let supportStaffUser;
let internalHeaders;
let internalUser;
let sentEmail;
let sentVerification;
let failTestEmail = false;

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
  supportStaffUser = {
    ...owner, id: randomUUID(), orgId: null, role: 'support_staff',
    campusIds: [], activeCampusId: null, isActive: true
  };
  supportStaffHeaders = headersFor(supportStaffUser);
  internalUser = {
    ...owner, id: randomUUID(), role: 'system_admin',
    email: `it-${randomUUID()}@example.test`
  };
  internalHeaders = headersFor(internalUser);
  app = createApp({
    repo,
    config: { ...config, NODE_ENV: 'test' },
    mailer: {
      async isConfigured() { return true; },
      async getIntegrationInfo() { return { configured: true, fromAddress: 'noreply@example.test' }; },
      async sendTestEmail(message) {
        sentEmail = message;
        if (failTestEmail) throw new Error('SMTP password=provider-secret-value');
      },
      async sendEmailVerification(message) { sentVerification = message; }
    }
  });
});

after(async () => { await repo?.close(); });

describe('WP14 support and monitoring APIs', () => {
  it('isolates school tickets and audits cross-school platform ticket reads', async () => {
    const created = await request(app).post('/api/support/tickets').set(ownerHeaders).send({
      subject: 'Cannot sign in', category: 'account', priority: 'high'
    });
    assert.equal(created.status, 201);
    const ticketId = created.body.data.id;
    assert.equal(created.body.data.ticketType, 'platform');
    const duplicateTicket = await request(app).post('/api/support/tickets').set(ownerHeaders).send({
      subject: 'Cannot sign in', category: 'account', priority: 'high'
    });
    assert.equal(duplicateTicket.status, 409);
    assert.equal(duplicateTicket.body.error.code, 'SUPPORT_TICKET_DUPLICATE');

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
    const platformTickets = await request(app).get('/api/platform/support/tickets')
      .set(platformHeaders);
    assert.equal(platformTickets.status, 200);
    assert.equal(platformTickets.body.data.some((ticket) => ticket.id === otherSchoolTicket.id), true);
    assert.equal(repo.audit.some((event) =>
      event.action === 'support.ticket.cross_school_read' &&
      event.entityId === otherSchoolTicket.id), true);
    const supportStaffTickets = await request(app).get('/api/platform/support/tickets')
      .set(supportStaffHeaders);
    assert.equal(supportStaffTickets.status, 200);
    const assignees = await request(app).get('/api/platform/support/assignees')
      .set(supportStaffHeaders);
    assert.equal(assignees.status, 200);
    assert.equal(assignees.body.data.some((assignee) =>
      assignee.id === supportStaffUser.id), true);
    const supportStaffAssignment = await request(app)
      .patch(`/api/platform/support/tickets/${ticketId}`)
      .set(supportStaffHeaders).send({ assignedTo: supportStaffUser.id });
    assert.equal(supportStaffAssignment.status, 200);
    assert.equal(supportStaffAssignment.body.data.assignedTo, supportStaffUser.id);
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

    const publicRouteInternalNote = await request(app)
      .post(`/api/platform/support/tickets/${ticketId}/comments`)
      .set(platformHeaders).send({ body: 'Internal investigation', isInternal: true });
    assert.equal(publicRouteInternalNote.status, 403);
    const internalNote = await request(app)
      .post(`/api/platform/support/tickets/${ticketId}/internal-notes`)
      .set(platformHeaders).send({ body: 'Internal investigation' });
    assert.equal(internalNote.status, 201);
    const schoolView = await request(app).get(`/api/support/tickets/${ticketId}`).set(ownerHeaders);
    assert.equal(schoolView.status, 200);
    assert.equal(schoolView.body.data.comments.length, 0);
    assert.equal(schoolView.body.data.attachments[0].originalName, 'troubleshoot.pdf');
    const platformView = await request(app).get(`/api/platform/support/tickets/${ticketId}`)
      .set(platformHeaders);
    assert.equal(platformView.body.data.comments[0].isInternal, true);
    assert.equal((await request(app).patch(
      `/api/platform/support/tickets/${ticketId}/comments/${internalNote.body.data.id}`)
      .set(platformHeaders).send({ body: 'Changed note' })).status, 404);
    assert.equal((await request(app).delete(
      `/api/platform/support/tickets/${ticketId}/comments/${internalNote.body.data.id}`)
      .set(platformHeaders)).status, 404);
  });

  it('denies school roles and scans monitoring, backup, and integration responses for secrets', async () => {
    const schoolRoles = ['owner_director', 'principal', 'system_admin',
      'homeroom_teacher', 'subject_teacher', 'parent_guardian', 'student'];
    for (const role of schoolRoles) {
      const schoolUser = {
        ...owner, id: randomUUID(), role, email: `${role}-${randomUUID()}@example.test`
      };
      const headers = headersFor(schoolUser);
      assert.equal((await request(app).get('/api/platform/monitoring').set(headers)).status, 403,
        `${role} must not view platform monitoring`);
      assert.equal((await request(app).get('/api/platform/backups').set(headers)).status, 403,
        `${role} must not view platform backups`);
    }
    assert.equal((await request(app).get('/api/platform/monitoring')
      .set(supportStaffHeaders)).status, 403);
    assert.equal((await request(app).get('/api/platform/backups')
      .set(supportStaffHeaders)).status, 403);
    const backupRun = await repo.createBackupRun();
    await repo.finishBackupRun(backupRun.id, {
      status: 'succeeded', sizeBytes: 321, artifactName: 'private-backup.sql'
    });
    const monitoring = await request(app).get('/api/platform/monitoring').set(platformHeaders);
    assert.equal(monitoring.status, 200);
    assert.equal(monitoring.body.data.database.reachable, true);
    const backupHistory = await request(app).get('/api/platform/backups').set(platformHeaders);
    assert.equal(backupHistory.status, 200);
    assert.equal(Array.isArray(backupHistory.body.data), true);
    assert.equal(backupHistory.body.data[0].kind, 'database');
    assert.equal(Object.hasOwn(backupHistory.body.data[0], 'artifactName'), false);
    assert.equal(monitoring.body.data.backupLatest.kind, 'database');
    assert.equal((await request(app).post('/api/platform/backups')
      .set(ownerHeaders).send({ status: 'succeeded' })).status, 404);

    const integration = await request(app).get('/api/school/integrations/email').set(internalHeaders);
    assert.equal(integration.status, 200);
    assert.equal(integration.body.data.configured, true);
    assert.equal(integration.body.data.emailAddress, internalUser.email);
    assert.equal(integration.body.data.emailVerified, false);
    assert.deepEqual(integration.body.data.lastTestResult, null);
    const verification = await request(app).post('/api/school/integrations/email/verification')
      .set(internalHeaders).send({});
    assert.equal(verification.status, 200);
    assert.equal(verification.body.data.sent, true);
    assert.equal(sentVerification.email, internalUser.email);
    const confirmation = await request(app).post(
      '/api/school/integrations/email/verification/confirm')
      .set(internalHeaders).send({ token: sentVerification.token });
    assert.equal(confirmation.status, 200);
    assert.equal(confirmation.body.data.verified, true);
    const arbitraryRecipient = await request(app).post('/api/school/integrations/email/test')
      .set(internalHeaders).send({ email: 'attacker@example.test' });
    assert.equal(arbitraryRecipient.status, 400);
    const sent = await request(app).post('/api/school/integrations/email/test')
      .set(internalHeaders).send({});
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body.data, { sent: true });
    assert.deepEqual(sentEmail, { email: internalUser.email });
    assert.equal((await request(app).get('/api/school/integrations/email')
      .set(internalHeaders)).body.data.lastTestResult.result, 'succeeded');
    const secretValues = [config.JWT_ACCESS_SECRET, config.DB_PASSWORD, config.SMTP_PASSWORD,
      config.SMTP_USER, config.DEMO_LOGIN_PASSWORD]
      .filter(Boolean);
    failTestEmail = true;
    const failedSend = await request(app).post('/api/school/integrations/email/test')
      .set(internalHeaders).send({});
    failTestEmail = false;
    assert.equal(failedSend.status, 502);
    assert.equal(JSON.stringify(failedSend.body).includes('provider-secret-value'), false);
    const rateLimitedSend = await request(app).post('/api/school/integrations/email/test')
      .set(internalHeaders).send({});
    assert.equal(rateLimitedSend.status, 429);
    const emailStatusAfterTest = await request(app).get('/api/school/integrations/email')
      .set(internalHeaders);
    for (const response of [
      monitoring, backupHistory, integration, verification, confirmation, sent,
      failedSend, rateLimitedSend, emailStatusAfterTest
    ]) {
      const serialized = JSON.stringify(response.body);
      for (const secret of secretValues) assert.equal(serialized.includes(secret), false);
      const assertSafeKeys = (value) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, nested] of Object.entries(value)) {
          assert.equal(/password|secret|credential|connection.?string|stack|filesystem.?path|token/i
            .test(key), false);
          assertSafeKeys(nested);
        }
      };
      assertSafeKeys(response.body);
    }
    assert.equal(emailStatusAfterTest.body.data.lastTestResult.result, 'failed');
    assert.equal(repo.audit.some((event) => event.action === 'integration.email_test_sent'), true);
    assert.equal(repo.audit.some((event) => event.action === 'integration.email_test_failed'), true);
  });
});

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { issueAccessToken } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createRepository } from '../src/repository.js';

const encryptionKey = randomBytes(32).toString('base64url');
const testConfig = { ...config, STORAGE_MODE: 'memory', SENSITIVE_DATA_KEY: encryptionKey };
let repo;
let app;
let headers;
let schoolHeaders;
let platformUser;

before(async () => {
  repo = await createRepository(testConfig);
  platformUser = {
    ...repo.users[0], id: randomUUID(),
    orgId: '00000000-0000-4000-8000-000000000001',
    role: 'super_admin', campusIds: [], activeCampusId: null,
    email: `wp3-platform-${randomUUID()}@example.test`,
    passwordHash: await bcrypt.hash(randomBytes(32).toString('base64url'), 4),
    isActive: true
  };
  repo.users.push(platformUser);
  const schoolUser = {
    ...repo.users[0], id: randomUUID(), role: 'owner_director',
    email: `wp3-school-${randomUUID()}@example.test`, isActive: true
  };
  repo.users.push(schoolUser);
  schoolHeaders = {
    Authorization: 'Bearer ' + issueAccessToken(schoolUser, testConfig)
  };
  app = createApp({ repo, config: testConfig });
  headers = { Authorization: `Bearer ${issueAccessToken(platformUser, testConfig)}` };
});

test('platform dashboard, provisioning defaults, quota rules, finance, and secret-safe settings work together', async () => {
  const forbiddenPlatformRoutes = [
    ['get', '/api/platform/settings'],
    ['put', '/api/platform/settings'],
    ['get', '/api/platform/reports/revenue.csv'],
    ['get', '/api/platform/reports/outstanding'],
    ['get', '/api/platform/reports/outstanding.csv'],
    ['post', '/api/platform/subscription-payments/00000000-0000-4000-8000-000000000001/refunds'],
    ['put', '/api/platform/schools/00000000-0000-4000-8000-000000000001/logo'],
    ['get', '/api/platform/schools/00000000-0000-4000-8000-000000000001/logo']
  ];
  for (const [method, path] of forbiddenPlatformRoutes) {
    const response = await request(app)[method](path).set(schoolHeaders);
    assert.equal(response.status, 403, `${method.toUpperCase()} ${path}`);
  }

  const details = {
    schoolName: `WP3 School ${randomUUID().slice(0, 8)}`,
    ownerName: 'Test Owner', ownerEmail: `wp3-owner-${randomUUID()}@example.test`,
    locale: 'am', currencyCode: 'ETB',
    academicConfiguration: {
      calendarType: 'gregorian', dateFormat: 'yyyy-MM-dd', defaultLocale: 'am'
    }
  };
  const created = await request(app).post('/api/platform/schools').set(headers).send(details);
  assert.equal(created.status, 201);
  const organizationId = created.body.data.organizationId;
  const schools = await request(app).get('/api/platform/schools').set(headers);
  const school = schools.body.data.find((item) => item.id === organizationId);
  assert.match(school.schoolCode, /^SCH-[A-F0-9]{10}$/);
  assert.equal(school.academicConfiguration.calendarType, 'gregorian');
  assert.equal(school.academicConfiguration.defaultLocale, 'am');

  const plan = await request(app).put('/api/platform/subscription-plans/wp3-quota')
    .set(headers).send({
      name: 'WP3 Quota', description: 'Quota and billing regression coverage',
      monthlyPrice: 125, currencyCode: 'ETB', trialDays: 14,
      studentLimit: 20, staffLimit: 10, siteLimit: 2,
      billingCycle: 'termly', maxUsers: 3, storageLimitBytes: 1000,
      modules: ['student_information'], isActive: true
    });
  assert.equal(plan.status, 200);
  const assigned = await request(app).put(`/api/platform/schools/${organizationId}/plan`)
    .set(headers).send({ planCode: 'wp3-quota' });
  assert.equal(assigned.status, 200);
  await assert.rejects(repo.assertUserCapacity(organizationId, 3), {
    code: 'PLAN_LIMIT_REACHED'
  });
  await assert.rejects(repo.assertPlanFitsOrganization({
    ...plan.body.data, maxUsers: 0
  }, organizationId), { code: 'PLAN_LIMIT_REACHED' });
  const existingLogo = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  await repo.saveOrganizationLogo(organizationId, {
    mimeType: 'image/png', content: existingLogo
  }, { userId: platformUser.id, role: 'super_admin', orgId: null });
  await assert.rejects(repo.assertPlanFitsOrganization({
    ...plan.body.data, studentLimit: 0, staffLimit: 0, siteLimit: 0,
    maxUsers: 0, storageLimitBytes: 0
  }, organizationId), (error) => {
    assert.equal(error.code, 'PLAN_LIMIT_REACHED');
    assert.deepEqual(error.details.map((item) => item.resource), ['branch', 'user', 'storage']);
    return true;
  });

  const logoContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const logo = await request(app).put(`/api/platform/schools/${organizationId}/logo`)
    .set(headers).set('Content-Type', 'image/png').send(logoContent);
  assert.equal(logo.status, 200);
  assert.equal(logo.body.data.sizeBytes, logoContent.length);
  assert.deepEqual((await repo.getOrganizationLogo(organizationId)).content, logoContent);
  const logoAuditCount = repo.audit.filter((event) =>
    event.action === 'school.logo_updated' && event.organizationId === organizationId).length;
  const assignedPlan = repo.subscriptionPlans.find((item) => item.code === 'wp3-quota');
  assignedPlan.storageLimitBytes = logoContent.length;
  const rejectedLogo = await request(app).put(`/api/platform/schools/${organizationId}/logo`)
    .set(headers).set('Content-Type', 'image/png')
    .send(Buffer.concat([logoContent, Buffer.from([1])]));
  assert.equal(rejectedLogo.status, 409);
  assert.deepEqual((await repo.getOrganizationLogo(organizationId)).content, logoContent);
  assert.equal(repo.audit.filter((event) =>
    event.action === 'school.logo_updated' && event.organizationId === organizationId).length,
  logoAuditCount);
  assignedPlan.storageLimitBytes = 1000;

  const invoice = await request(app).post(`/api/platform/schools/${organizationId}/invoices`)
    .set(headers).send({ amount: 125, currencyCode: 'ETB', dueOn: '2027-01-01' });
  assert.equal(invoice.status, 201);
  const payment = await request(app)
    .post(`/api/platform/subscription-invoices/${invoice.body.data.id}/payments`)
    .set(headers).send({ amount: 125, receivedOn: new Date().toISOString().slice(0, 10) });
  assert.equal(payment.status, 201);
  const renewed = await request(app)
    .get(`/api/platform/schools/${organizationId}/subscription`).set(headers);
  assert.equal(renewed.body.data.plan.billingCycle, 'termly');
  assert.ok(Date.parse(renewed.body.data.periodEndsAt) - Date.now() > 90 * 86400000);
  const refund = await request(app)
    .post(`/api/platform/subscription-payments/${payment.body.data.id}/refunds`)
    .set(headers).send({ amount: 25, reason: 'Duplicate payment' });
  assert.equal(refund.status, 201);
  const overPaidRefund = await request(app)
    .post(`/api/platform/subscription-payments/${payment.body.data.id}/refunds`)
    .set(headers).send({ amount: 126, reason: 'Exceeds paid amount' });
  assert.equal(overPaidRefund.status, 409);
  const overRefund = await request(app)
    .post(`/api/platform/subscription-payments/${payment.body.data.id}/refunds`)
    .set(headers).send({ amount: 101, reason: 'Exceeds remaining balance' });
  assert.equal(overRefund.status, 409);
  const noRefundReason = await request(app)
    .post(`/api/platform/subscription-payments/${payment.body.data.id}/refunds`)
    .set(headers).send({ amount: 1 });
  assert.equal(noRefundReason.status, 400);
  const refundAudit = repo.audit.find((event) => event.action === 'subscription_payment.refunded' &&
    event.entityId === refund.body.data.id);
  assert.equal(refundAudit.organizationId, organizationId);
  assert.equal(refundAudit.before.refundedAmount, 0);
  assert.equal(refundAudit.after.refundedAmount, 25);
  assert.equal(refundAudit.after.reason, 'Duplicate payment');

  const settings = await request(app).put('/api/platform/settings').set(headers).send({
    defaultLocale: 'am', currencyCode: 'ETB', dateFormat: 'yyyy-MM-dd',
    calendarType: 'gregorian', smtpHost: 'mail.example.test', smtpPort: 587,
    smtpSecure: false, smtpUser: 'mailer@example.test',
    smtpPassword: 'one-time-test-secret', smtpFrom: 'noreply@example.test'
  });
  assert.equal(settings.status, 200);
  assert.equal(JSON.stringify(settings.body).includes('one-time-test-secret'), false);
  assert.equal(repo.globalSettings.smtpPasswordCiphertext.includes('one-time-test-secret'), false);
  assert.equal(JSON.stringify(repo.audit).includes('one-time-test-secret'), false);
  assert.equal((await repo.getMailTransportSettings()).SMTP_PASSWORD, 'one-time-test-secret');

  const report = await request(app).get('/api/platform/reports/revenue.csv').set(headers);
  assert.equal(report.status, 200);
  assert.match(report.headers['content-type'], /text\/csv/);
  assert.match(report.text, /school,invoice,currency,invoiced,paid,outstanding,refunded,netRevenue,status/);
  assert.match(report.text, /125,125,0,25,100,paid/);
  const today = new Date().toISOString().slice(0, 10);
  const etbInvoice = await request(app).post(`/api/platform/schools/${organizationId}/invoices`)
    .set(headers).send({ amount: 50, currencyCode: 'ETB' });
  const etbPayment = await request(app)
    .post(`/api/platform/subscription-invoices/${etbInvoice.body.data.id}/payments`)
    .set(headers).send({ amount: 10, receivedOn: today });
  assert.equal(etbPayment.status, 201);
  const usdInvoice = await request(app).post(`/api/platform/schools/${organizationId}/invoices`)
    .set(headers).send({ amount: 25, currencyCode: 'USD' });
  const outstanding = await request(app)
    .get(`/api/platform/reports/outstanding?from=${today}&to=${today}`).set(headers);
  assert.equal(outstanding.status, 200);
  assert.deepEqual(outstanding.body.data.totals, [
    { currencyCode: 'ETB', invoiceCount: 1, outstandingAmount: 40 },
    { currencyCode: 'USD', invoiceCount: 1, outstandingAmount: 25 }
  ]);
  assert.equal(outstanding.body.data.items.length, 2);
  const futureDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const filteredOut = await request(app)
    .get(`/api/platform/reports/outstanding?from=${futureDate}&to=${futureDate}`).set(headers);
  assert.deepEqual(filteredOut.body.data.items, []);
  const invalidRange = await request(app)
    .get(`/api/platform/reports/outstanding?from=${futureDate}&to=${today}`).set(headers);
  assert.equal(invalidRange.status, 400);
  const outstandingCsv = await request(app)
    .get(`/api/platform/reports/outstanding.csv?from=${today}&to=${today}`).set(headers);
  assert.equal(outstandingCsv.status, 200);
  assert.match(outstandingCsv.text, /TOTAL,ETB,,,,,,,40/);
  assert.match(outstandingCsv.text, /TOTAL,USD,,,,,,,25/);
  assert.match(outstandingCsv.text, /INVOICE,ETB,/);
  assert.match(outstandingCsv.text, /INVOICE,USD,/);
  const dashboard = await request(app).get('/api/platform').set(headers);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.data.database.reachable, true);
  assert.ok(dashboard.body.data.totals.revenueCollected >= 125);
  assert.ok(dashboard.body.data.totals.refunds >= 25);
  assert.ok(dashboard.body.data.totals.storageUsedBytes >= logoContent.length);
  const activeSubscriptionsBeforeExpiry = dashboard.body.data.totals.activeSubscriptions;
  const expiredSubscriptionsBeforeExpiry = dashboard.body.data.totals.expiredSubscriptions;

  const subscription = repo.subscriptions.find((item) => item.organizationId === organizationId);
  subscription.periodEndsAt = new Date(Date.now() - 86400000).toISOString();
  const expired = await request(app)
    .get(`/api/platform/schools/${organizationId}/subscription`).set(headers);
  assert.equal(expired.body.data.status, 'expired');
  assert.ok(repo.audit.some((event) => event.action === 'subscription.expired' &&
    event.organizationId === organizationId));
  const refreshedDashboard = await request(app).get('/api/platform').set(headers);
  assert.equal(refreshedDashboard.status, 200);
  assert.equal(refreshedDashboard.body.data.totals.expiredSubscriptions,
    expiredSubscriptionsBeforeExpiry + 1);
  assert.equal(refreshedDashboard.body.data.totals.activeSubscriptions,
    activeSubscriptionsBeforeExpiry - 1);
});

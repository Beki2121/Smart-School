import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createRepository } from '../src/repository.js';

const campusId = '30000000-0000-4000-8000-000000000001';
const studentOne = '40000000-0000-4000-8000-000000000001';
const sectionId = '70000000-0000-4000-8000-000000000001';
let repo;
let app;
let token;

before(async () => {
  repo = await createRepository({ ...config, STORAGE_MODE: 'memory' });
  app = createApp({ repo, config: { ...config, NODE_ENV: 'test' } });
  const response = await request(app).post('/api/auth/login').send({
    login: config.DEMO_LOGIN_EMAIL, password: config.DEMO_LOGIN_PASSWORD
  });
  assert.equal(response.status, 200);
  token = response.body.data.accessToken;
});

describe('SIMS API', () => {
  it('reports health without authentication', async () => {
    const response = await request(app).get('/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ok');
  });

  it('rejects protected requests without a token', async () => {
    const response = await request(app).get('/api/students');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'AUTH_REQUIRED');
  });

  it('returns only the active campus students', async () => {
    const response = await request(app).get('/api/students').set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 3);
    assert.ok(response.body.data.every((student) => student.campusId === campusId));
  });

  it('lists only active-campus sections for attendance workflows', async () => {
    const response = await request(app).get('/api/sections').set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].campusId, campusId);
  });

  it('returns the active academic year for the token-scoped campus', async () => {
    const response = await request(app).get('/api/academic-year').set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.labelEc, '2019 E.C.');
  });

  it('ignores a caller-supplied campus id on a validated student write', async () => {
    const response = await request(app).post('/api/students').set('Authorization', `Bearer ${token}`).send({
      campusId: '99999999-9999-4999-8999-999999999999',
      studentNo: 'TEST-100', givenNameAm: 'ሚሊ', fatherNameAm: 'አለሙ',
      grandfatherNameAm: 'አበበ', givenNameEn: 'Mili', fatherNameEn: 'Alemu',
      grandfatherNameEn: 'Abebe', gender: 'female', sectionName: 'Grade 7A'
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.campusId, campusId);
    assert.equal(repo.audit.at(-1).action, 'student.created');
  });

  it('updates only the token-scoped campus profile and audits the change', async () => {
    const response = await request(app).put('/api/school').set('Authorization', `Bearer ${token}`).send({
      campusId: '99999999-9999-4999-8999-999999999999',
      name: 'Updated Learning Campus', address: 'Addis Ababa', phone: '+251911000000'
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, campusId);
    assert.equal(response.body.data.name, 'Updated Learning Campus');
    assert.equal(repo.audit.at(-1).action, 'school.profile_updated');
  });

  it('validates student writes and returns the standard error envelope', async () => {
    const response = await request(app).post('/api/students')
      .set('Authorization', `Bearer ${token}`).send({ studentNo: 'X' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(response.body.error.details));
  });

  it('rejects a student placement in a section outside the active campus setup', async () => {
    const response = await request(app).post('/api/students').set('Authorization', `Bearer ${token}`).send({
      studentNo: 'TEST-SECTION', givenNameAm: 'ሚሊ', fatherNameAm: 'አለሙ',
      grandfatherNameAm: 'አበበ', givenNameEn: 'Mili', fatherNameEn: 'Alemu',
      grandfatherNameEn: 'Abebe', gender: 'female', sectionName: 'Other Campus Section'
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'CAMPUS_SCOPE_VIOLATION');
  });

  it('records attendance once for an idempotency UUID', async () => {
    const body = {
      clientUuid: '5b201d7a-7e5c-4dda-91e5-b5cbf13e79de',
      date: '2026-10-22', sectionId,
      records: [{ studentId: studentOne, status: 'present' }]
    };
    const first = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`).send(body);
    const replay = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`).send(body);
    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.duplicate, true);
    assert.equal((await repo.listAttendance(campusId)).length, 1);
  });

  it('rejects cross-campus student IDs and checks role permissions', async () => {
    const body = {
      clientUuid: 'e8d29ef6-337f-4f5b-8eb4-50468378d427',
      date: '2026-10-22', sectionId,
      records: [{ studentId: '99999999-9999-4999-8999-999999999999', status: 'absent' }]
    };
    const denied = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`).send(body);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'CAMPUS_SCOPE_VIOLATION');
    const foreignSection = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`).send({
      ...body, clientUuid: 'e8d29ef6-337f-4f5b-8eb4-50468378d428',
      sectionId: '99999999-9999-4999-8999-999999999999',
      records: [{ studentId: studentOne, status: 'absent' }]
    });
    assert.equal(foreignSection.status, 403);
    assert.equal(foreignSection.body.error.code, 'CAMPUS_SCOPE_VIOLATION');

    const parentToken = jwt.sign({
      orgId: '20000000-0000-4000-8000-000000000001', role: 'parent_guardian',
      campusIds: [campusId], activeCampusId: campusId
    }, config.JWT_ACCESS_SECRET, {
      subject: '90000000-0000-4000-8000-000000000001', expiresIn: '10m',
      issuer: 'smartschool-sims', audience: 'smartschool-sims-web'
    });
    const roleDenied = await request(app).post('/api/attendance')
      .set('Authorization', `Bearer ${parentToken}`).send(body);
    assert.equal(roleDenied.status, 403);
    assert.equal(roleDenied.body.error.code, 'FORBIDDEN');
  });

  it('records a validated mark and does not allow over-max marks', async () => {
    const body = {
      clientUuid: '7e1346e1-cc9d-4e6e-841a-7e5d4b8cebac',
      studentId: studentOne, assessmentName: 'Math Quiz', value: 16, maxValue: 20
    };
    const saved = await request(app).post('/api/marks').set('Authorization', `Bearer ${token}`).send(body);
    assert.equal(saved.status, 201);
    assert.equal(saved.body.data.state, 'draft');
    assert.equal(repo.audit.at(-1).action, 'mark.created');

    const invalid = await request(app).post('/api/marks').set('Authorization', `Bearer ${token}`).send({
      ...body, clientUuid: '9b7546e1-cc9d-4e6e-841a-7e5d4b8cebac', value: 21
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  });

  it('creates academic-year setup only within the authenticated campus and audits it', async () => {
    const body = {
      campusId: '99999999-9999-4999-8999-999999999999',
      labelEc: '2020 E.C.', startDate: '2027-09-11', endDate: '2028-09-10'
    };
    const created = await request(app).post('/api/academic-years')
      .set({ Authorization: `Bearer ${token}` }).send(body);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.campusId, campusId);
    assert.equal(created.body.data.status, 'planned');
    assert.equal(repo.audit.at(-1).action, 'academic_year.created');
    const duplicate = await request(app).post('/api/academic-years')
      .set({ Authorization: `Bearer ${token}` }).send(body);
    assert.equal(duplicate.status, 409);
    const invalidDates = await request(app).post('/api/academic-years')
      .set({ Authorization: `Bearer ${token}` }).send({
        labelEc: '2021 E.C.', startDate: '2028-09-10', endDate: '2028-09-10'
      });
    assert.equal(invalidDates.status, 400);
  });

  it('creates terms within the active academic year and rejects out-of-range dates', async () => {
    const created = await request(app).post('/api/terms')
      .set({ Authorization: `Bearer ${token}` }).send({
        name: 'Term 1', startDate: '2026-09-11', endDate: '2027-01-15'
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.isCurrent, true);
    const invalid = await request(app).post('/api/terms')
      .set({ Authorization: `Bearer ${token}` }).send({
        name: 'Outside', startDate: '2026-09-01', endDate: '2027-01-15'
      });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'TERM_OUTSIDE_ACADEMIC_YEAR');
  });

  it('creates and lists campus-scoped grades, sections and subjects', async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const grade = await request(app).post('/api/grades').set(headers).send({
      code: 'G8', nameEn: 'Grade 8', nameAm: '8ኛ ክፍል', band: 'secondary', sortOrder: 8
    });
    assert.equal(grade.status, 201);
    assert.equal(grade.body.data.campusId, campusId);
    const section = await request(app).post('/api/sections').set(headers).send({
      gradeLevelId: grade.body.data.id, name: 'Grade 8B', capacity: 35
    });
    assert.equal(section.status, 201);
    assert.equal(section.body.data.gradeName, 'Grade 8');
    const subject = await request(app).post('/api/subjects').set(headers).send({
      code: 'SCI', nameEn: 'Science', nameAm: 'ሳይንስ'
    });
    assert.equal(subject.status, 201);
    assert.equal(subject.body.data.campusId, campusId);
    assert.ok((await request(app).get('/api/sections').set(headers)).body.data
      .some((item) => item.id === section.body.data.id));
    assert.ok((await request(app).get('/api/grades').set(headers)).body.data
      .some((item) => item.id === grade.body.data.id));
    assert.ok((await request(app).get('/api/subjects').set(headers)).body.data
      .some((item) => item.id === subject.body.data.id));
  });

  it('activates a planned year, closes the previous year and audits the transition', async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const years = await request(app).get('/api/academic-years').set(headers);
    const planned = years.body.data.find((year) => year.labelEc === '2020 E.C.');
    const activated = await request(app).patch(`/api/academic-years/${planned.id}/activate`).set(headers);
    assert.equal(activated.status, 200);
    assert.equal(activated.body.data.status, 'active');
    assert.equal((await request(app).get('/api/academic-year').set(headers)).body.data.id, planned.id);
    assert.equal(repo.academicYears.find((year) => year.labelEc === '2019 E.C.').status, 'closed');
    assert.equal(repo.audit.at(-1).action, 'academic_year.activated');
    const foreignYear = await request(app).patch('/api/academic-years/99999999-9999-4999-8999-999999999999/activate').set(headers);
    assert.equal(foreignYear.status, 404);
  });

  it('rotates the hashed refresh token cookie and rejects reuse', async () => {
    const login = await request(app).post('/api/auth/login').send({
      login: config.DEMO_LOGIN_EMAIL, password: config.DEMO_LOGIN_PASSWORD
    });
    const firstCookie = login.headers['set-cookie'][0].split(';')[0];
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', firstCookie);
    assert.equal(refresh.status, 200);
    assert.notEqual(refresh.headers['set-cookie'][0].split(';')[0], firstCookie);
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', firstCookie);
    assert.equal(replay.status, 401);
  });
});

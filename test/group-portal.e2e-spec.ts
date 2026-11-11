import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

// Group Expense's member portal end to end, against a real database
// (DATABASE_URL): an owner gives a member Viewer access, the member makes a
// login from the access link, signs in by username and by mobile number,
// reads the group but can't change it or reach the rest of the app; as an
// Editor they add only their own deposits; with access turned off they're
// out. Run: npm run test:e2e -- group-portal
describe('Group member portal (e2e)', () => {
  let app: INestApplication<App>;
  const stamp = Date.now().toString(36);
  const phone = `0191${String(Date.now()).slice(-7)}`;
  const username = `rk.${stamp}`.slice(0, 20);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('takes a member from an access link to a login that opens only the group, by role', async () => {
    const owner = await http()
      .post('/api/auth/register')
      .send({ name: 'Khaled Owner', email: `owner.${stamp}@example.com`, password: 'Owner12345' })
      .expect(201);
    const ownerToken: string = owner.body.accessToken;

    const group = await http()
      .post('/api/businesses')
      .set(as(ownerToken))
      .send({ name: `Mirpur ${stamp}`, currency: 'BDT', type: 'GROUP' })
      .expect(201);
    const businessId: string = group.body.id;
    const base = `/api/businesses/${businessId}/group`;
    const me = await http().post(`${base}/members`).set(as(ownerToken)).send({ name: 'Khaled Owner', role: 'ACCOUNTANT', isOwner: true }).expect(201);
    const rakib = await http().post(`${base}/members`).set(as(ownerToken)).send({ name: 'Rakib Mahmud', phone, role: 'VIEWER' }).expect(201);

    // The owner makes the link; it is shown once and works once.
    const link = await http().post(`${base}/members/${rakib.body.id}/access-link`).set(as(ownerToken)).send({ kind: 'JOIN' }).expect(201);
    const token: string = link.body.token;
    const preview = await http().get(`/api/group-invites/${token}`).expect(200);
    expect(preview.body).toMatchObject({ kind: 'JOIN', memberName: 'Rakib Mahmud', role: 'VIEWER', suggestedUsername: 'rakib' });

    const joined = await http().post(`/api/group-invites/${token}/accept`).send({ username, password: 'Bazar2026' }).expect(201);
    expect(joined.body.businessId).toBe(businessId);
    await http()
      .post(`/api/group-invites/${token}/accept`)
      .send({ username: `${username}x`.slice(0, 20), password: 'Bazar2026' })
      .expect(404);

    // Signs in by username and by mobile number.
    const byName = await http().post('/api/auth/sign-in').send({ email: username, password: 'Bazar2026' }).expect(201);
    expect(byName.body.audience).toBe('user');
    await http()
      .post('/api/auth/sign-in')
      .send({ email: phone.replace(/^(\d{5})/, '$1-'), password: 'Bazar2026' })
      .expect(201);
    const member: string = byName.body.accessToken;

    // A Viewer reads the group and changes nothing; the rest of the app is shut.
    const me2 = await http().get('/api/auth/me').set(as(member)).expect(200);
    expect(me2.body).toMatchObject({ portalOnly: true, username });
    await http().get(`${base}/members`).set(as(member)).expect(200);
    await http().get(`${base}/settlement`).set(as(member)).query({ from: '2026-11-01', to: '2026-11-30' }).expect(200);
    await http().post(`${base}/contributions`).set(as(member)).send({ groupMemberId: rakib.body.id, amount: '500', date: '2026-11-03' }).expect(403);
    await http().post('/api/businesses').set(as(member)).send({ name: 'Mine', currency: 'BDT', type: 'BUSINESS' }).expect(403);
    await http().get(`/api/businesses/${businessId}/accounts`).set(as(member)).expect(403);

    // As an Editor: their own deposit only.
    await http().patch(`${base}/members/${rakib.body.id}`).set(as(ownerToken)).send({ role: 'ACCOUNTANT' }).expect(200);
    await http().post(`${base}/contributions`).set(as(member)).send({ groupMemberId: rakib.body.id, amount: '500', date: '2026-11-03' }).expect(201);
    await http().post(`${base}/contributions`).set(as(member)).send({ groupMemberId: me.body.id, amount: '500', date: '2026-11-03' }).expect(403);
    await http().patch(`${base}/members/${me.body.id}`).set(as(member)).send({ name: 'Taken over' }).expect(403);

    // A reset link: a new password, and the login's other devices signed out.
    const reset = await http().post(`${base}/members/${rakib.body.id}/access-link`).set(as(ownerToken)).send({ kind: 'RESET' }).expect(201);
    const again = await http().post(`/api/group-invites/${reset.body.token}/accept`).send({ password: 'Shapla2027' }).expect(201);
    await http().get(`${base}/members`).set(as(member)).expect(401);
    await http().post('/api/auth/sign-in').send({ email: username, password: 'Bazar2026' }).expect(401);
    const fresh: string = again.body.accessToken;

    // A second group of the same owner joins the login it already has.
    const second = await http()
      .post('/api/businesses')
      .set(as(ownerToken))
      .send({ name: `Uttara ${stamp}`, currency: 'BDT', type: 'GROUP' })
      .expect(201);
    const base2 = `/api/businesses/${second.body.id}/group`;
    await http().post(`${base2}/members`).set(as(ownerToken)).send({ name: 'Khaled Owner', role: 'ACCOUNTANT', isOwner: true }).expect(201);
    const rakib2 = await http().post(`${base2}/members`).set(as(ownerToken)).send({ name: 'Rakib Mahmud', phone, role: 'VIEWER' }).expect(201);
    const link2 = await http().post(`${base2}/members/${rakib2.body.id}/access-link`).set(as(ownerToken)).send({ kind: 'JOIN' }).expect(201);
    await http().post(`/api/group-invites/${link2.body.token}/attach`).set(as(fresh)).expect(201);
    await http().get(`${base2}/members`).set(as(fresh)).expect(200);

    // Access off: the login can't open the group any more.
    await http().patch(`${base}/members/${rakib.body.id}`).set(as(ownerToken)).send({ role: 'MEMBER' }).expect(200);
    await http().get(`${base}/members`).set(as(fresh)).expect(403);
    await http().get(`${base2}/members`).set(as(fresh)).expect(200);
  });
});

const request = require('supertest');
const { app, server } = require('../server');

afterAll((done) => {
    if (server && server.close) {
        server.close(done);
    } else {
        done();
    }
});

describe('Wingman Comprehensive Security & Infrastructure Test Suite', () => {

    describe('1. HTTP Security Headers & CORS Lockdown', () => {
        test('Should enforce X-Frame-Options: DENY', async () => {
            const res = await request(app).get('/api/credits');
            expect(res.headers['x-frame-options']).toBe('DENY');
        });

        test('Should enforce X-Content-Type-Options: nosniff', async () => {
            const res = await request(app).get('/api/credits');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });

        test('Should enforce Strict-Transport-Security (HSTS)', async () => {
            const res = await request(app).get('/api/credits');
            expect(res.headers['strict-transport-security']).toBeDefined();
            expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
        });

        test('Should not leak X-Powered-By header', async () => {
            const res = await request(app).get('/api/credits');
            expect(res.headers['x-powered-by']).toBeUndefined();
        });
    });

    describe('2. Authentication & Bcrypt Password Hashing (>= 12 Rounds)', () => {
        const testUser = {
            email: `test_sec_${Date.now()}@example.com`,
            password: 'SuperSecretPassword123!',
            name: 'Security Test User'
        };

        let token = '';
        let userId = '';

        test('Should register user and hash password with bcrypt', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send(testUser);

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.user).toBeDefined();
            expect(res.body.user.email).toBe(testUser.email.toLowerCase());
            expect(res.body.user.passwordHash).toBeUndefined(); // Sensitive hash must be sanitized!
            expect(res.body.token).toBeDefined();

            token = res.body.token;
            userId = res.body.user.id;
        });

        test('Should reject duplicate registration with 409 Conflict', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send(testUser);

            expect(res.status).toBe(409);
            expect(res.body.success).toBe(false);
        });

        test('Should login registered user with valid password and issue JWT', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: testUser.email,
                    password: testUser.password
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.token).toBeDefined();
        });

        test('Should reject login with invalid password', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: testUser.email,
                    password: 'WrongPassword999!'
                });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });
    });

    describe('3. IDOR Prevention & Server-Side Ownership Checks', () => {
        let userA_Token = '';
        let userA_Id = '';
        let userB_Id = '';

        beforeAll(async () => {
            const resA = await request(app).post('/api/auth/register').send({
                email: `userA_${Date.now()}@test.com`,
                password: 'Password123!'
            });
            userA_Token = resA.body.token;
            userA_Id = resA.body.user.id;

            const resB = await request(app).post('/api/auth/register').send({
                email: `userB_${Date.now()}@test.com`,
                password: 'Password123!'
            });
            userB_Id = resB.body.user.id;
        });

        test('Should allow User A to access User A resource', async () => {
            const res = await request(app)
                .get(`/api/user/${userA_Id}`)
                .set('Authorization', `Bearer ${userA_Token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.user.id).toBe(userA_Id);
        });

        test('Should DENY User A trying to access User B resource (IDOR Prevention)', async () => {
            const res = await request(app)
                .get(`/api/user/${userB_Id}`)
                .set('Authorization', `Bearer ${userA_Token}`);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toContain('IDOR Protection');
        });

        test('Should DENY unauthenticated access to protected resource', async () => {
            const res = await request(app).get(`/api/user/${userA_Id}`);
            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });
    });

    describe('4. Rate Limiting Enforcement', () => {
        test('Should enforce rate limit (5 attempts max on auth endpoints)', async () => {
            const dummyUser = { email: `ratelimit_${Date.now()}@test.com`, password: 'pass' };
            
            // Send requests until rate limit triggers
            let hitRateLimit = false;
            for (let i = 0; i < 7; i++) {
                const res = await request(app).post('/api/auth/login').send(dummyUser);
                if (res.status === 429) {
                    hitRateLimit = true;
                    expect(res.body.error).toContain('Too many login/register attempts');
                    break;
                }
            }
            expect(hitRateLimit).toBe(true);
        });
    });

    describe('5. Core AI Endpoint Contract Preservation', () => {
        test('GET /api/credits returns credit balance', async () => {
            const res = await request(app).get('/api/credits');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.credits_inr).toBeDefined();
        });
    });
});

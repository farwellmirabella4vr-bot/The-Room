const request = require('supertest');
const app = require('../src/app');

describe('GET /api/hello', () => {
  // 1. Happy path
  test('happy path: returns 200, JSON content-type, exact body', async () => {
    const res = await request(app).get('/api/hello');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ message: 'Hello, World!' });
    expect(Object.keys(res.body)).toEqual(['message']);
  });

  // 2. Wrong method, same path
  describe('wrong method, same path', () => {
    test.each(['post', 'put', 'delete', 'patch'])(
      '%s /api/hello -> 404',
      async (method) => {
        const res = await request(app)[method]('/api/hello');
        expect(res.status).toBe(404);
      }
    );
  });

  // 3. HEAD on the route
  test('HEAD /api/hello -> 200, same headers as GET, empty body', async () => {
    const res = await request(app).head('/api/hello');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.text === undefined || res.text === '').toBe(true);
  });

  // 4. OPTIONS on the route
  // NOTE: Express's built-in default OPTIONS handler (used here since no
  // custom OPTIONS middleware was added, per spec) responds with the Allow
  // header AND a body listing the same methods (e.g. "GET,HEAD"), not an
  // empty body as the spec's edge case #4 description states. Verified
  // empirically against the actual Express 4.x behavior. This is a spec
  // inaccuracy, not an app.js/hello.js implementation bug, since no code
  // in this feature customizes OPTIONS handling. See tests.md Coverage Gaps.
  test('OPTIONS /api/hello -> 200 with Allow header listing GET,HEAD', async () => {
    const res = await request(app).options('/api/hello');
    expect(res.status).toBe(200);
    expect(res.headers['allow']).toBeDefined();
    const allowed = res.headers['allow'].split(',').map((s) => s.trim());
    expect(allowed.sort()).toEqual(['GET', 'HEAD'].sort());
  });

  // 5. Wrong path (sibling/near-miss)
  describe('wrong path (sibling/near-miss)', () => {
    test.each([
      '/api/hell',
      '/api/hello-world',
      '/hello',
      '/api/hello/extra',
    ])('GET %s -> 404', async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
    });
  });

  // 6. Root path
  test('GET / -> 404', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(404);
  });

  // 7. Trailing slash
  test('GET /api/hello/ -> 200 with same body (non-strict routing)', async () => {
    const res = await request(app).get('/api/hello/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Hello, World!' });
  });

  // 8. Case sensitivity
  describe('case sensitivity', () => {
    test.each(['/API/hello', '/api/Hello'])('GET %s -> 404', async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
    });
  });

  // 9. Extraneous query string
  test('GET /api/hello?name=Trey&foo=bar -> 200, body unchanged', async () => {
    const res = await request(app).get('/api/hello?name=Trey&foo=bar');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Hello, World!' });
  });

  // 10. Request body present on GET
  test('GET /api/hello with JSON body -> 200, body unchanged, body ignored', async () => {
    const res = await request(app)
      .get('/api/hello')
      .send({ irrelevant: 'data' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Hello, World!' });
  });

  // 11. Unusual Accept header
  describe('unusual Accept header', () => {
    test.each(['text/plain', '*/*'])(
      'GET /api/hello with Accept: %s -> 200, content-type still application/json',
      async (accept) => {
        const res = await request(app)
          .get('/api/hello')
          .set('Accept', accept);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^application\/json/);
      }
    );
  });

  // 12. Concurrent/repeated requests
  test('concurrent requests each return 200 with identical static body', async () => {
    const requests = Array.from({ length: 10 }, () =>
      request(app).get('/api/hello')
    );
    const responses = await Promise.all(requests);
    responses.forEach((res) => {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Hello, World!' });
    });
  });

  // 13. Content-Type correctness
  test('Content-Type header is exactly application/json with charset', async () => {
    const res = await request(app).get('/api/hello');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });
});

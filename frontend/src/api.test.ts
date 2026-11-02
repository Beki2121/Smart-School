import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setAccessToken } from './api';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function unauthorizedResponse(): Response {
  return jsonResponse({ error: { code: 'AUTH_REQUIRED', message: 'Sign in again.' } }, 401);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  setAccessToken('old-access-token');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shared session refresh', () => {
  it('uses one refresh for simultaneous protected requests and retries both', async () => {
    const refreshResponse = deferred<Response>();
    let protectedRequests = 0;
    let refreshRequests = 0;
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/api/auth/refresh')) {
        refreshRequests += 1;
        return refreshResponse.promise;
      }
      protectedRequests += 1;
      return protectedRequests <= 2
        ? unauthorizedResponse()
        : jsonResponse({ data: { studentCount: 1 } });
    });

    const requests = Promise.all([api.dashboard(), api.dashboard()]);
    await vi.waitFor(() => expect(protectedRequests).toBe(2));
    await vi.waitFor(() => expect(refreshRequests).toBe(1));
    refreshResponse.resolve(jsonResponse({ data: { accessToken: 'new-access-token' } }));

    const results = await requests;
    expect(results).toHaveLength(2);
    expect(refreshRequests).toBe(1);
    expect(protectedRequests).toBe(4);
  });

  it('rejects concurrent callers and clears the token when refresh fails', async () => {
    const refreshResponse = deferred<Response>();
    let protectedRequests = 0;
    let refreshRequests = 0;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/api/auth/refresh')) {
        refreshRequests += 1;
        return refreshResponse.promise;
      }
      protectedRequests += 1;
      if (protectedRequests <= 2) return unauthorizedResponse();
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      return jsonResponse({ data: { studentCount: 0 } });
    });

    const requests = Promise.allSettled([api.dashboard(), api.dashboard()]);
    await vi.waitFor(() => expect(protectedRequests).toBe(2));
    await vi.waitFor(() => expect(refreshRequests).toBe(1));
    refreshResponse.resolve(unauthorizedResponse());

    const results = await requests;
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(refreshRequests).toBe(1);
    await expect(api.dashboard()).resolves.toEqual({ studentCount: 0 });
    expect(refreshRequests).toBe(1);
  });

  it('clears the token and rejects waiters when the refresh request fails', async () => {
    const refreshResponse = deferred<Response>();
    let protectedRequests = 0;
    let refreshRequests = 0;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/api/auth/refresh')) {
        refreshRequests += 1;
        return refreshResponse.promise;
      }
      protectedRequests += 1;
      if (protectedRequests <= 2) return unauthorizedResponse();
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return jsonResponse({ data: { studentCount: 0 } });
    });

    const requests = Promise.allSettled([api.dashboard(), api.dashboard()]);
    await vi.waitFor(() => expect(protectedRequests).toBe(2));
    await vi.waitFor(() => expect(refreshRequests).toBe(1));
    refreshResponse.reject(new Error('Network unavailable.'));

    const results = await requests;
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(refreshRequests).toBe(1);
    await expect(api.dashboard()).resolves.toEqual({ studentCount: 0 });
  });

  it('starts a new refresh for a later 401 after the previous refresh settles', async () => {
    let protectedRequests = 0;
    let refreshRequests = 0;
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/api/auth/refresh')) {
        refreshRequests += 1;
        return jsonResponse({ data: { accessToken: `access-token-${refreshRequests + 1}` } });
      }
      protectedRequests += 1;
      return protectedRequests % 2 === 1
        ? unauthorizedResponse()
        : jsonResponse({ data: { studentCount: protectedRequests } });
    });

    await api.dashboard();
    await api.dashboard();

    expect(refreshRequests).toBe(2);
    expect(protectedRequests).toBe(4);
  });

  it('retries a protected request at most once', async () => {
    let protectedRequests = 0;
    let refreshRequests = 0;
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/api/auth/refresh')) {
        refreshRequests += 1;
        return jsonResponse({ data: { accessToken: 'new-access-token' } });
      }
      protectedRequests += 1;
      return unauthorizedResponse();
    });

    await expect(api.dashboard()).rejects.toThrow('Sign in again.');

    expect(protectedRequests).toBe(2);
    expect(refreshRequests).toBe(1);
  });

  it('deduplicates concurrent startup session restores', async () => {
    let meRequests = 0;
    let refreshRequests = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        refreshRequests += 1;
        return jsonResponse({ data: { accessToken: 'restored-access-token' } });
      }
      if (url.endsWith('/api/auth/me')) {
        meRequests += 1;
        return meRequests === 1
          ? unauthorizedResponse()
          : jsonResponse({ data: { id: 'user-1', role: 'super_admin' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const [first, second] = await Promise.all([api.me(), api.me()]);

    expect(first).toEqual(second);
    expect(meRequests).toBe(2);
    expect(refreshRequests).toBe(1);
  });
});

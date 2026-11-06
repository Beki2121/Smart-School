const startedAt = new Date().toISOString();
const jobStates = new Map();
let requests = 0;
let errors = 0;
let lastErrorAt = null;

export function trackHttpRequest(request, response, next) {
  requests += 1;
  response.once('finish', () => {
    if (response.statusCode >= 500) {
      errors += 1;
      lastErrorAt = new Date().toISOString();
    }
  });
  next();
}

export function registerBackgroundJob(name) {
  const state = jobStates.get(name) ?? {
    name, status: 'idle', lastStartedAt: null, lastSucceededAt: null,
    lastFailedAt: null, lastErrorCode: null
  };
  jobStates.set(name, state);
  return {
    start() { state.status = 'running'; state.lastStartedAt = new Date().toISOString(); },
    succeed() {
      state.status = 'idle';
      state.lastSucceededAt = new Date().toISOString();
      state.lastErrorCode = null;
    },
    fail(errorCode = 'JOB_FAILED') {
      state.status = 'degraded';
      state.lastFailedAt = new Date().toISOString();
      state.lastErrorCode = String(errorCode).slice(0, 80);
    }
  };
}

export function getRuntimeStatus() {
  return {
    processStartedAt: startedAt, uptimeSeconds: Math.floor(process.uptime()),
    requestCount: requests, serverErrorCount: errors, lastServerErrorAt: lastErrorAt,
    backgroundJobs: [...jobStates.values()].map((job) => ({ ...job }))
  };
}

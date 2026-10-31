'use strict';

import('./src/server.js').catch((error) => {
  console.error('Failed to load SIMS API server:', error);
  process.exitCode = 1;
});

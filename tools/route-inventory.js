const { readFileSync } = require('node:fs');

async function main() {
  const [{ createApp }, { MemoryRepository }] = await Promise.all([
    import('../backend/src/app.js'),
    import('../backend/src/repository.js')
  ]);
  const repo = new MemoryRepository({ users: [], campuses: [], sections: [], academicYears: [] });
  const app = createApp({
    repo,
    config: { WEB_ORIGIN: 'http://localhost:5173', WEB_ALLOWED_ORIGINS: [], NODE_ENV: 'test' }
  });

  const stack = app._router.stack;
  const authenticationIndex = stack.findIndex((layer) =>
    layer.handle?.authenticatesUser === true);
  const inventory = stack.flatMap((layer, index) => {
    if (!layer.route) return [];
    return Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => {
        const permission = layer.route.stack
          .map((handler) => handler.handle.permission)
          .find(Boolean);
        return {
          method: method.toUpperCase(),
          path: layer.route.path,
          guard: permission ? `permission:${permission}` :
            index > authenticationIndex ? 'authenticated' : 'public',
          routeMiddleware: layer.route.stack.map((handler) => handler.handle.name || '<anonymous>')
        };
      });
  });

  const baselineArgument = process.argv.indexOf('--compare-baseline');
  if (baselineArgument !== -1) {
    const baselineText = readFileSync(process.argv[baselineArgument + 1], 'utf8');
    const routeSection = baselineText.split('APP STACK')[0];
    const routeMetadata = new Map(routeSection
      .split(/\r?\n/)
      .map((line) => line.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) (.+?) (?:permission:(.+)|global middleware \/ handler|public\/rate-limited or globally authenticated)$/))
      .filter(Boolean)
      .map(([, method, path, permission]) => [
        `${method} ${path}`, permission ? `permission:${permission}` : null
      ]));
    const stackSection = baselineText.split('APP STACK')[1]?.split('MODULE EXPORTS')[0] ?? '';
    const baselineStack = stackSection.split(/\r?\n/);
    const authLayer = baselineStack.findIndex((line) =>
      line.includes('USE ') && line.includes('/^\\/api\\/?(?=\\/|$)/i'));
    const baselineRoutes = baselineStack
      .map((line, index) => {
        const match = line.match(/^\d+ ROUTE (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) (.+)$/);
        if (!match) return null;
        const [, method, path] = match;
        const key = `${method} ${path}`;
        const permission = routeMetadata.get(key);
        return {
          method, path,
          guard: permission ?? (index > authLayer ? 'authenticated' : 'public')
        };
      })
      .filter(Boolean);
    const currentRoutes = inventory.map(({ method, path, guard }) => ({ method, path, guard }));
    const equal = JSON.stringify(currentRoutes) === JSON.stringify(baselineRoutes);
    console.log(`Baseline routes: ${baselineRoutes.length}; current routes: ${currentRoutes.length}`);
    console.log(`Route and guard parity: ${equal ? 'PASS' : 'FAIL'}`);
    if (!equal) {
      const maxLength = Math.max(baselineRoutes.length, currentRoutes.length);
      for (let index = 0; index < maxLength; index += 1) {
        if (JSON.stringify(baselineRoutes[index]) !== JSON.stringify(currentRoutes[index])) {
          console.log(`Mismatch ${index + 1}: baseline=${JSON.stringify(baselineRoutes[index])} current=${JSON.stringify(currentRoutes[index])}`);
        }
      }
      process.exitCode = 1;
    }
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify(inventory, null, 2));
  } else {
    for (const route of inventory) {
      console.log(`${route.method.padEnd(7)} ${route.path.padEnd(64)} ${route.guard}`);
    }
    console.log(`\n${inventory.length} routes`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

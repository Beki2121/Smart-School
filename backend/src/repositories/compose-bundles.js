export function composeRepositoryBundles(bundles) {
  const methods = {};
  const owners = new Map();
  for (const [domain, bundle] of Object.entries(bundles)) {
    for (const [name, method] of Object.entries(bundle)) {
      if (owners.has(name)) {
        throw new Error(`Repository method "${name}" is defined by both "${owners.get(name)}" and "${domain}".`);
      }
      if (typeof method !== 'function') {
        throw new TypeError(`Repository method "${domain}.${name}" must be a function.`);
      }
      owners.set(name, domain);
      methods[name] = method;
    }
  }
  return methods;
}

// Tiny pattern router: supports "/api/orders/:id" style params and method maps.

export class Router {
  constructor() {
    this.routes = []; // { method, regex, keys, handler }
    this.middlewares = [];
  }

  use(fn) {
    this.middlewares.push(fn);
    return this;
  }

  add(method, pattern, handler) {
    const keys = [];
    const trimmed = pattern.replace(/\/+$/, ''); // normalize a trailing slash away
    const escaped = trimmed
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex metachars
      .replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
        // NOTE: the source literal must be /:name/ (not /\/:name/) because '/' is
        // not escaped. These params only ever appear after a '/'.
        keys.push(key);
        return '([^/]+)';
      });
    const regex = new RegExp(`^${escaped}/?$`);
    this.routes.push({ method, regex, keys, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: route.handler, params };
    }
    return null;
  }
}

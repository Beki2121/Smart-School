/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> };

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
const appShell = createHandlerBoundToURL('/index.html');
registerRoute(new NavigationRoute(appShell, {
  denylist: [/^\/api\//, /^\/socket\.io\//]
}));

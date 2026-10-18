// Service worker mínimo: permite instalar NBA JAM como app.
// No guarda nada en caché: los datos siempre se piden en línea para que estén al día.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// BYZ Admin Service Worker
const CACHE_NAME = 'byz-admin-v1';
const urlsToCache = [
  './admin.html',
  './admin-manifest.json',
  './assets/byz-logo-black.png',
  './assets/byz-logo-white.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Bypass service worker for Google Apps Script API calls
  if (url.hostname === 'script.google.com' || url.hostname.includes('googleapis.com')) {
    // Always fetch from network for API calls
    event.respondWith(fetch(event.request).catch(err => {
      console.error('Service Worker fetch error:', err);
      throw err;
    }));
    return;
  }
  
  // For static assets, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request).catch(err => {
          console.error('Service Worker fetch error:', err);
          throw err;
        });
      })
      .catch(err => {
        console.error('Service Worker cache match error:', err);
        // Fallback to network even if cache match fails
        return fetch(event.request).catch(networkErr => {
          console.error('Service Worker network fetch error:', networkErr);
          throw networkErr;
        });
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});


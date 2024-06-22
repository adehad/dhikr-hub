const cacheName = self.location.pathname
// Service Worker's check if this file changes in order to know when to re-run
// By including the hashes we can be sure that it will change when the content changes
const pages = {
  {{ if eq .Site.Params.BookServiceWorker "precache" }}
    {{ range .Site.AllPages -}}
  "{{ .RelPermalink }}": "{{ .GitInfo.AbbreviatedHash  }}",
    {{ end -}}
  {{ end }}
};

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(cacheName)
      .then((cache) => cache.addAll(Object.keys(pages)))
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  /**
   * @param {Response} response
   * @returns {Promise<Response>}
   */
  function saveToCache(response) {
    if (cacheable(response)) {
      return caches
        .open(cacheName)
        .then((cache) => cache.put(request, response.clone()))
        .then(() => response);
    } else {
      return response;
    }
  }

  /**
   * @param {Error} error
   */
  function serveFromCache(error) {
    return caches.open(cacheName).then((cache) => cache.match(request.url));
  }

  /**
   * @param {Response} response
   * @returns {Boolean}
   */
  function cacheable(response) {
    return response.type === "basic" && response.ok && !response.headers.has("Content-Disposition")
  }

  event.respondWith(fetch(request).then(saveToCache).catch(serveFromCache));
});

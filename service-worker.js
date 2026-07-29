/* ==========================================================
   جنة الفواكه والخضار — Service Worker  (v2)
   يسوي شغلتين:
   1) كاش للملفات الأساسية حتى التطبيق يفتح بدون نت (نفس السابق)
   2) يضيف تلقائياً <script src="bottom-nav.js"> لصفحات الموقع،
      حتى ما نحتاج نعدّل index.html أو control.html بأيدينا.
   إذا يوماً أضفت السطر بنفسك داخل الـ HTML، ما راح يتكرر —
   الكود يتحقق أول إذا موجود.
   ========================================================== */

const CACHE_NAME = "janat-store-cache-v2";
const CORE_ASSETS = [
  "./index.html",
  "./products.json",
  "./manifest.json",
  "./bottom-nav.js",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // نخزنهم واحد واحد حتى لا يفشل الكل إذا فشل ملف واحد
      Promise.all(
        CORE_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => null))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* ---- يضيف سطر السكربت داخل صفحة HTML قبل </body> ---- */
async function injectBottomNav(res) {
  try {
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return res;

    let html = await res.clone().text();
    if (html.includes("bottom-nav.js")) return res;      // موجود أصلاً
    if (!html.includes("</body>")) return res;            // شكل غير متوقع، ما نلمسه

    html = html.replace("</body>", '<script src="bottom-nav.js"></script>\n</body>');

    const headers = new Headers();
    headers.set("content-type", ct);
    return new Response(html, { status: res.status, statusText: res.statusText, headers });
  } catch (e) {
    return res; // أي مشكلة، نرجّع الصفحة الأصلية بدون تعديل
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (e) {}

  const isPage =
    req.mode === "navigate" ||
    req.destination === "document" ||
    (req.headers.get("accept") || "").includes("text/html");

  const isJson = req.url.endsWith(".json");

  // الصفحات: نت أولاً (حتى الأسعار تبقى محدثة) + إضافة الشريط + كاش احتياطي
  if (isPage && sameOrigin) {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          const out = await injectBottomNav(res);
          const copy = out.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return out;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          return (
            cached ||
            (await caches.match("./index.html")) ||
            new Response("<h3 style='font-family:sans-serif;text-align:center;padding:40px'>ما في اتصال بالإنترنت</h3>", {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" }
            })
          );
        })
    );
    return;
  }

  // ملفات البيانات: نت أولاً وكاش احتياطي
  if (isJson) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // الباقي (صور، سكربتات، خطوط): كاش أولاً
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

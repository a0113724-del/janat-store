/* ==========================================================
   جنة الفواكه والخضار — Service Worker  (v8)
   1) كاش للملفات الأساسية حتى التطبيق يفتح بدون نت
   2) يضيف <script src="bottom-nav.js"> لصفحة الزبون فقط
      ⚠️ صفحات الإدارة (control / admin / dashboard) مستثناة تماماً —
      قبل هذا التعديل كان الشريط يظهر بلوحة التحكم ويغطّي المحتوى.
   3) الصفحات وملفات البيانات: نت أولاً، حتى أي تعديل يوصل فوراً
   ========================================================== */

const CACHE_NAME = "janat-store-cache-v8";
const CORE_ASSETS = [
  "./index.html",
  "./products.json",
  "./settings.json",
  "./manifest.json",
  "./bottom-nav.js",
  "./icon-192.png",
  "./icon-512.png"
];

// أي صفحة اسمها يحتوي واحد من هذي = صفحة إدارة، ممنوع أي حشر فيها
const ADMIN_PAGES = ["control", "admin", "dashboard"];

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

/* ---- هل هذي صفحة الزبون؟ (الشريط يُضاف لها فقط) ---- */
function isCustomerPage(url) {
  let path = "";
  try { path = new URL(url).pathname.toLowerCase(); } catch (e) { return false; }
  const file = path.substring(path.lastIndexOf("/") + 1);
  if (ADMIN_PAGES.some((name) => file.includes(name))) return false;
  return file === "" || file === "index.html";
}

/* ---- يضيف سطر السكربت داخل صفحة الزبون قبل </body> ---- */
async function injectBottomNav(res, req) {
  try {
    if (!isCustomerPage(req.url)) return res;

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

  // ملفات السكربت والبيانات: نت أولاً حتى أي تعديل يوصل فوراً
  const isFresh = /\.(json|js)(\?.*)?$/.test(req.url) && sameOrigin;

  // الصفحات: نت أولاً (حتى الأسعار والإعدادات تبقى محدثة) + كاش احتياطي
  if (isPage && sameOrigin) {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          const out = await injectBottomNav(res, req);
          const copy = out.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return out;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          // بدون نت: صفحة الإدارة ما نبدلها بصفحة الزبون
          if (!isCustomerPage(req.url)) {
            return new Response(
              "<h3 style='font-family:sans-serif;text-align:center;padding:40px'>ما في اتصال بالإنترنت — لوحة التحكم تحتاج نت</h3>",
              { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
            );
          }
          return (
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

  // ملفات البيانات والسكربتات: نت أولاً وكاش احتياطي
  if (isFresh) {
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

  // الباقي (صور، خطوط): كاش أولاً
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

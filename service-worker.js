/* ==========================================================
   جنة الفواكه والخضار — Service Worker  (v28)
   1) كاش للملفات الأساسية حتى التطبيق يفتح بدون نت
   2) يضيف <script src="bottom-nav.js"> لصفحة الزبون فقط
      ⚠️ صفحات الإدارة (control / admin / dashboard) مستثناة تماماً —
      قبل هذا التعديل كان الشريط يظهر بلوحة التحكم ويغطّي المحتوى.
   3) الصفحة: الكاش أولاً والتحديث بالخلفية — تفتح فوراً بلا انتظار نت
   4) ملفات البيانات (products/settings): نت أولاً، حتى الأسعار تبقى محدثة
   ========================================================== */

const CACHE_NAME = "janat-store-cache-v28";
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

/* ═════════════ التحديث: النسخة الجديدة تنتظر إذن الزبون ═════════════
 *
 * ⚠️ قبل، كان install ينادي skipWaiting() فوراً — النسخة الجديدة تشتغل
 * بينما الصفحة المفتوحة لسه قديمة، وشريط «صدر تحديث» يطلع بلا ما يقدر
 * الزبون يسوي شي مفيد. الحين ننتظر رسالة من الصفحة (يعني الزبون ضغط
 * «حدّث الآن») وبعدها نشتغل ونمسح الكاش القديم، فالتحميل الجاي يجيب
 * النسخة الجديدة فعلاً.
 *
 * بس أكو حالة لازم ننتبه لها: الزباين اللي بأجهزتهم الصفحة القديمة ما
 * يعرفون يدزّون هذي الرسالة. لو انتظرناهم للأبد راح ينعلكون بالنسخة
 * القديمة. لهيچ: نستنى خمس ثواني — إذا سلّمت علينا صفحة تعرف البروتوكول
 * الجديد ننتظر ضغطتها، وإذا ماكو أحد نشتغل لحالنا.
 */
let newClientPresent = false;

self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d) return;
  if (d.type === "CLIENT_READY") newClientPresent = true;   // صفحة تعرف تنتظر
  if (d.type === "SKIP_WAITING") self.skipWaiting();        // الزبون ضغط الزر
});

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // نخزنهم واحد واحد حتى لا يفشل الكل إذا فشل ملف واحد
    //
    // ⚠️ "no-cache" مو "reload". الاثنين يتأكدون إن الملف محدّث، بس
    // "reload" يجبر تنزيل كامل حتى لو الملف نفسه اللي هسه انتزّل —
    // يعني أول زيارة كانت تنزّل index.html مرتين (٥١ كيلو مضغوطة
    // زيادة على نت الموبايل). "no-cache" يسأل السيرفر "تغيّر؟"
    // ويكتفي بـ304 إذا ما تغيّر.
    await Promise.all(
      CORE_ASSETS.map((url) => cache.add(new Request(url, { cache: "no-cache" })).catch(() => null))
    );

    // ⚠️ includeUncontrolled ضروري: النسخة اللي لسه تتنصّب ما تسيطر على
    // أي صفحة بعد، فبدونها القائمة تطلع فارغة دائماً وننادي skipWaiting
    // بكل تحديث — يعني نرجع لنفس الباگ اللي نصلّحه.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length === 0) { self.skipWaiting(); return; }   // ماكو صفحة مفتوحة

    await new Promise((r) => setTimeout(r, 3000));
    if (!newClientPresent) self.skipWaiting();
  })());
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

  // ═══ الصفحات: الكاش أولاً، والتحديث بالخلفية ═══
  //
  // قبل، كانت "نت أولاً": يعني كل فتحة للتطبيق تنتظر تنزيل الصفحة كاملة
  // (١٩٣ كيلو) قبل ما يشوف الزبون أي شي — حتى لو النسخة محفوظة بجهازه.
  // على نت موبايل ضعيف هذا ثواني ضايعة بكل مرة.
  //
  // الحين: نرجّع النسخة المحفوظة فوراً، وننزّل الجديدة بالهدوء للفتحة
  // الجاية. الأسعار والإعدادات ما تتأثر — هي بملفات JSON منفصلة تجي
  // من النت أولاً دائماً.
  if (isPage && sameOrigin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);

      const fromNetwork = fetch(req)
        .then(async (res) => {
          const out = await injectBottomNav(res, req);
          const copy = out.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return out;
        })
        .catch(() => null);

      // عدنا نسخة؟ نعطيها فوراً ونكمل التنزيل بالخلفية
      if (cached) {
        event.waitUntil(fromNetwork);
        return cached;
      }

      const fresh = await fromNetwork;
      if (fresh) return fresh;

      // أول زيارة وبلا نت: صفحة الإدارة ما نبدلها بصفحة الزبون
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
    })());
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

/* ==========================================================
   جنة الفواكه والخضار — شريط التنقل السفلي (شكل تطبيق)
   ملف مستقل: يكفي تضيف بآخر index.html قبل </body>
   <script src="bottom-nav.js"></script>
   ما يحتاج أي تعديل ثاني على الصفحة.
   ========================================================== */
(function () {
  "use strict";

  var NAV_H = 66; // ارتفاع الشريط

  /* ---------------- 1) التنسيق ---------------- */
  var css = `
  :root{ --nav-h:${NAV_H}px; }

  /* نخفي شريط السلة القديم ونستخدم الشريط الجديد بداله */
  .cart-bar{ display:none !important; }

  body{ padding-bottom:calc(var(--nav-h) + 30px) !important; transition:padding-bottom .2s; }
  body.jn-has-cart{ padding-bottom:calc(var(--nav-h) + 96px) !important; }

  /* نخفي شريط الأقسام العلوي لأن الشريط السفلي صار يسوي نفس الشغلة */
  .catnav{ display:none !important; }

  /* شارة النقاط تصير شريحة عائمة فوق */
  .jn-points-holder{
    position:fixed; top:10px; inset-inline-start:12px; z-index:46;
  }
  .jn-points-holder .points-badge{
    box-shadow:0 6px 18px rgba(0,0,0,.28); border:1px solid rgba(255,255,255,.35);
  }

  .jn-tabbar{
    position:fixed; bottom:0; left:0; right:0; z-index:48;
    height:var(--nav-h);
    padding-bottom:env(safe-area-inset-bottom);
    background:rgba(21,49,34,.97);
    backdrop-filter:blur(10px);
    border-top:1px solid rgba(201,154,46,.25);
    display:flex; align-items:stretch;
    box-shadow:0 -8px 24px rgba(0,0,0,.28);
  }
  .jn-tab{
    flex:1; border:none; background:none; cursor:pointer;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:3px; padding:6px 2px 8px; position:relative;
    color:rgba(233,205,134,.62);
    font-family:'Tajawal',sans-serif; font-size:.66rem; font-weight:700;
    transition:color .18s;
    -webkit-tap-highlight-color:transparent;
  }
  .jn-tab .jn-ico{ font-size:1.32rem; line-height:1; transition:transform .18s; }
  .jn-tab:active .jn-ico{ transform:scale(.86); }
  .jn-tab.active{ color:#F3DFA1; }
  .jn-tab.active .jn-ico{ transform:translateY(-1px); }
  .jn-tab.active::before{
    content:""; position:absolute; top:0; width:30px; height:3px; border-radius:0 0 4px 4px;
    background:linear-gradient(90deg,#E9CD86,#C99A2E);
  }
  .jn-badge{
    position:absolute; top:4px; inset-inline-end:calc(50% - 20px);
    min-width:18px; height:18px; padding:0 4px;
    background:#A13A2E; color:#fff; border-radius:100px;
    font-size:.62rem; font-weight:900;
    display:none; align-items:center; justify-content:center;
    border:1.5px solid rgba(21,49,34,.97);
  }
  .jn-badge.show{ display:flex; }

  /* شريط المجموع العائم — يطلع بس إذا بالسلة شي */
  .jn-checkout{
    position:fixed; z-index:47;
    bottom:calc(var(--nav-h) + env(safe-area-inset-bottom) + 10px);
    inset-inline-start:14px; inset-inline-end:14px;
    background:linear-gradient(90deg,#C99A2E,#E9CD86);
    color:#153122; border:none; border-radius:16px;
    padding:12px 16px; cursor:pointer;
    display:flex; align-items:center; gap:10px;
    font-family:'Tajawal',sans-serif; font-weight:900; font-size:.92rem;
    box-shadow:0 10px 26px rgba(0,0,0,.3);
    transform:translateY(140%); opacity:0; transition:.28s cubic-bezier(.2,.8,.2,1);
    pointer-events:none;
  }
  .jn-checkout.show{ transform:translateY(0); opacity:1; pointer-events:auto; }
  .jn-checkout:active{ transform:scale(.98); }
  .jn-checkout .jn-c-count{
    background:#153122; color:#E9CD86; min-width:26px; height:26px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; font-size:.78rem; flex:0 0 auto;
  }
  .jn-checkout .jn-c-mid{ flex:1; text-align:start; line-height:1.25; }
  .jn-checkout .jn-c-mid small{ display:block; font-weight:700; font-size:.66rem; opacity:.75; }
  .jn-checkout .jn-c-go{ font-size:.86rem; white-space:nowrap; }

  /* الأزرار العائمة الموجودة ترتفع فوق الشريط */
  .whatsapp-float, .install-btn{
    bottom:calc(var(--nav-h) + env(safe-area-inset-bottom) + 76px) !important;
  }

  /* رسالة تنبيه صغيرة */
  .jn-toast{
    position:fixed; z-index:90; bottom:calc(var(--nav-h) + 90px);
    left:50%; transform:translateX(-50%) translateY(16px);
    background:#153122; color:#E9CD86; border:1px solid rgba(201,154,46,.35);
    padding:10px 18px; border-radius:100px; font-family:'Tajawal',sans-serif;
    font-size:.82rem; font-weight:700; opacity:0; transition:.25s; pointer-events:none;
    box-shadow:0 8px 24px rgba(0,0,0,.35);
  }
  .jn-toast.show{ opacity:1; transform:translateX(-50%) translateY(0); }
  `;
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  /* الأزرار العائمة القديمة تعتمد على --bar-h، نصفّرها حتى ما تتضارب */
  document.documentElement.style.setProperty("--bar-h", "0px");

  /* ---------------- 2) البناء ---------------- */
  var TABS = [
    { id: "home",   ico: "🏠", label: "الرئيسية" },
    { id: "veg",    ico: "🥕", label: "خضروات" },
    { id: "fruit",  ico: "🍉", label: "فواكه" },
    { id: "offers", ico: "🔥", label: "العروض" },
    { id: "cart",   ico: "🧺", label: "السلة", badge: true }
  ];

  var bar = document.createElement("nav");
  bar.className = "jn-tabbar";
  bar.setAttribute("role", "tablist");
  bar.innerHTML = TABS.map(function (t) {
    return (
      '<button class="jn-tab" data-tab="' + t.id + '">' +
        (t.badge ? '<span class="jn-badge" id="jnBadge">0</span>' : "") +
        '<span class="jn-ico">' + t.ico + "</span>" +
        "<span>" + t.label + "</span>" +
      "</button>"
    );
  }).join("");
  document.body.appendChild(bar);

  var checkout = document.createElement("button");
  checkout.className = "jn-checkout";
  checkout.innerHTML =
    '<span class="jn-c-count" id="jnCCount">0</span>' +
    '<span class="jn-c-mid"><span id="jnCTotal">0 د.ع</span><small>المجموع الكلي</small></span>' +
    '<span class="jn-c-go">إتمام الطلب ◀</span>';
  document.body.appendChild(checkout);

  var toastEl = document.createElement("div");
  toastEl.className = "jn-toast";
  document.body.appendChild(toastEl);

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  /* ---------------- 3) التنقل ---------------- */
  var tabs = Array.prototype.slice.call(bar.querySelectorAll(".jn-tab"));

  function setActive(id) {
    tabs.forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === id);
    });
  }
  setActive("home");

  function openCart() {
    var btn = document.getElementById("openCheckout");
    if (!btn) return;
    if (btn.disabled) { toast("🧺 السلة فارغة — اختار منتج أول"); return; }
    btn.click();
  }

  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      var id = t.dataset.tab;
      if (id === "cart") { openCart(); return; }
      setActive(id);
      if (id === "home") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      var sec = document.getElementById(id);
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  checkout.addEventListener("click", openCart);

  /* التاب النشط يتغير حسب مكان القراءة بالصفحة */
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) setActive(e.target.id);
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });

    ["veg", "fruit", "offers"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });

    window.addEventListener("scroll", function () {
      if (window.scrollY < 120) setActive("home");
    }, { passive: true });
  }

  /* ---------------- 4) مزامنة السلة ---------------- */
  var srcCount = document.getElementById("barCount");
  var srcTotal = document.getElementById("barTotal");
  var badge = document.getElementById("jnBadge");
  var cCount = document.getElementById("jnCCount");
  var cTotal = document.getElementById("jnCTotal");

  function sync() {
    var n = parseInt((srcCount && srcCount.textContent) || "0", 10) || 0;
    var total = (srcTotal && srcTotal.textContent) || "0 د.ع";
    badge.textContent = n;
    badge.classList.toggle("show", n > 0);
    cCount.textContent = n;
    cTotal.textContent = total;
    checkout.classList.toggle("show", n > 0);
    document.body.classList.toggle("jn-has-cart", n > 0);
  }

  if (srcCount && "MutationObserver" in window) {
    var mo = new MutationObserver(sync);
    mo.observe(srcCount, { childList: true, characterData: true, subtree: true });
    if (srcTotal) mo.observe(srcTotal, { childList: true, characterData: true, subtree: true });
  }
  document.body.addEventListener("click", function () { setTimeout(sync, 60); });
  setTimeout(sync, 300);
  setInterval(sync, 1500); // ضمان إضافي خفيف

  /* ---------------- 5) شارة النقاط ---------------- */
  var pb = document.getElementById("pointsBadge");
  if (pb) {
    var holder = document.createElement("div");
    holder.className = "jn-points-holder";
    document.body.appendChild(holder);
    holder.appendChild(pb);
  }

  /* ---------------- 6) لمسات تطبيق ---------------- */
  /* لما التطبيق مثبّت ومفتوح كتطبيق، نخفي قسم "شلون تثبّت التطبيق" */
  var standalone =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;

  if (standalone) {
    var guide = document.querySelector(".install-guide");
    if (guide) guide.style.display = "none";
    var ib = document.getElementById("installBtn");
    if (ib) ib.classList.remove("show");
  }
})();

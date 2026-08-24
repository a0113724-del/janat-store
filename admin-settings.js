/* ============================================================
   لوحة إعدادات المتجر — تُضيف تبويب "⚙️ إعدادات" لصفحة control.html
   تقرأ وتكتب settings.json مباشرة بالمستودع (نفس مفتاح الدخول المحفوظ)
   ملف مستقل: ما يلمس أي شي ثاني بلوحة التحكم
   ============================================================ */
(function () {
  "use strict";

  const OWNER = "a0113724-del";
  const REPO = "janat-store";
  const BRANCH = "main";
  const PATH = "settings.json";
  const API = "https://api.github.com";

  const DEFAULTS = {
    deliveryFee: 1000,
    freeDeliveryOver: 0,
    minOrderTotal: 0,
    firstOrderFreeDelivery: true,
    openHour: 8,
    closeHour: 22,
    manualClosed: false,
    closedMessage: "",
    pointsPerOrder: 2,
    roundTo: 250,
    requireNotifications: false,
    requireInstall: false,
    promoText: "🚴 التوصيل الأول مجاني لكل زبون جديد!",
    announcement: "",
    scanPromoOn: false,
    scanPromoAmount: 2000,
    scanPromoMin: 10000,
    scanPromoMax: 0,
    scanPromoEnds: ""
  };

  let settings = Object.assign({}, DEFAULTS);
  let sha = null;
  let injected = false;

  const money = n => (Math.round(Number(n) || 0)).toLocaleString("en-US") + " د.ع";
  const getToken = () => { try { return localStorage.getItem("janat-admin-token") || ""; } catch (e) { return ""; } };

  function ghHeaders() {
    return { "Authorization": "Bearer " + getToken(), "Accept": "application/vnd.github+json" };
  }

  function fmtHour(h) {
    const hh = ((Number(h) % 24) + 24) % 24;
    const suffix = hh < 12 ? "صباحاً" : (hh < 17 ? "عصراً" : "مساءً");
    let d = hh % 12; if (d === 0) d = 12;
    return d + " " + suffix;
  }

  // ---------- الأنماط ----------
  function injectStyle() {
    const st = document.createElement("style");
    st.textContent = `
      .set-card{ background:#fff; border:1px solid rgba(62,122,68,.18); border-radius:16px; padding:16px; margin-bottom:14px; }
      .set-card h3{ font-size:.95rem; color:#153122; margin-bottom:4px; font-weight:900; }
      .set-card .note{ font-size:.74rem; color:#888; line-height:1.7; margin-bottom:12px; }
      .set-field{ margin-bottom:12px; }
      .set-field label{ display:block; font-size:.78rem; font-weight:700; margin-bottom:5px; color:#1C2A1D; }
      .set-field input[type=text], .set-field input[type=number], .set-field textarea, .set-field select{
        width:100%; border:1.5px solid rgba(62,122,68,.18); border-radius:10px;
        padding:10px 12px; font-family:inherit; font-size:.88rem; background:#fff; color:#1C2A1D;
      }
      .set-field .sub{ font-size:.7rem; color:#999; margin-top:4px; }
      .set-presets{ display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
      .set-presets button{
        border:1.5px solid #3E7A44; background:#fff; color:#3E7A44; font-family:inherit;
        font-weight:800; font-size:.78rem; padding:7px 14px; border-radius:100px; cursor:pointer;
      }
      .set-presets button.on{ background:#3E7A44; color:#fff; }
      .set-check{ display:flex; align-items:flex-start; gap:8px; font-size:.82rem; font-weight:700; cursor:pointer; margin-bottom:10px; }
      .set-check input{ margin-top:3px; flex:0 0 auto; }
      .set-hours{ display:flex; gap:8px; }
      .set-hours > div{ flex:1; }
      .set-preview{ background:#F6F1E1; border:1px dashed rgba(62,122,68,.3); border-radius:12px; padding:12px; font-size:.8rem; line-height:1.9; }
      .set-preview b{ color:#A13A2E; }
      .set-save{ width:100%; background:#153122; color:#E9CD86; border:none; font-family:inherit;
        font-weight:900; padding:14px; border-radius:12px; font-size:.95rem; cursor:pointer; }
      .set-save:disabled{ opacity:.55; cursor:not-allowed; }
      .set-msg{ text-align:center; font-size:.8rem; font-weight:700; margin-top:10px; min-height:20px; }
      .set-msg.ok{ color:#1e6b2b; }
      .set-msg.err{ color:#8a2418; }
    `;
    document.head.appendChild(st);
  }

  // ---------- بناء التبويب ----------
  function buildView() {
    const view = document.createElement("div");
    view.className = "view";
    view.id = "view-settings";
    view.innerHTML = `
      <div class="set-card">
        <h3>🚴 التوصيل</h3>
        <div class="note">التغيير يوصل الزباين خلال دقيقة تقريباً بعد الحفظ.</div>

        <div class="set-field">
          <label>أجرة التوصيل</label>
          <input type="number" id="setDeliveryFee" min="0" step="250">
          <div class="set-presets">
            <button data-fee="1000">1,000</button>
            <button data-fee="2000">2,000</button>
            <button data-fee="0">مجاني للكل</button>
          </div>
          <div class="sub">حط 0 إذا تريد التوصيل مجاني لكل الطلبات.</div>
        </div>

        <div class="set-field">
          <label>توصيل مجاني إذا وصل مجموع المنتجات</label>
          <input type="number" id="setFreeOver" min="0" step="1000">
          <div class="sub">0 = عطّل هذي الميزة.</div>
        </div>

        <label class="set-check">
          <input type="checkbox" id="setFirstFree">
          <span>🎁 التوصيل الأول مجاني لكل زبون جديد — يُلغى تلقائياً لأي زبون موجود بالسستم</span>
        </label>
      </div>

      <div class="set-card">
        <h3>📷 عرض «امسح الباركود»</h3>
        <div class="note">
          الزبون يمسح الباركود فيوصله خصم — مرة وحدة لكل رقم هاتف مهما بدّل جهازه
          أو مسح بيانات متصفحه. وياخذ الخصم <b>بدل</b> التوصيل المجاني لأول طلب، مو معاه.
        </div>
        <label class="set-check">
          <input type="checkbox" id="setScanPromoOn">
          <span>📷 شغّل عرض الباركود</span>
        </label>
        <div class="set-field">
          <label>قيمة الخصم</label>
          <input type="number" id="setScanPromoAmount" min="0" step="250">
        </div>
        <div class="set-field">
          <label>أقل مجموع سلة يشتغل بيه الخصم</label>
          <input type="number" id="setScanPromoMin" min="0" step="500">
          <div class="sub">
            ⚠️ خلّيه فوق قيمة الخصم بمرّات. لو خلّيته 0، أي واحد يطلب بقيمة الخصم
            وياخذ بضاعته ببلاش.
          </div>
        </div>
        <div class="set-field">
          <label>سقف عدد المستفيدين</label>
          <input type="number" id="setScanPromoMax" min="0" step="10">
          <div class="sub">
            ⚠️ <b>أهم مكبح</b>. الرابط ينمشي بالواتساب، فأي واحد يوصله ياخذ الخصم
            حتى لو ما شاف البوستر. السقف يحدّد خسارتك برقم تعرفه من الأول.
            <b>0 = بلا سقف</b>.
          </div>
        </div>
        <div class="set-field">
          <label>آخر يوم بالعرض</label>
          <input type="date" id="setScanPromoEnds">
          <div class="sub">بعد هذا اليوم يوقف لحاله. اتركه فاضي = بلا نهاية.</div>
        </div>
      </div>

      <div class="set-card">
        <h3>🧺 الطلبات</h3>
        <div class="set-field">
          <label>أقل مجموع مقبول للطلب</label>
          <input type="number" id="setMinOrder" min="0" step="500">
          <div class="sub">0 = بدون حد أدنى.</div>
        </div>
        <div class="set-field">
          <label>نقاط الولاء لكل طلب</label>
          <input type="number" id="setPoints" min="0" step="1">
          <div class="sub">⚠️ لازم يطابق الرقم المكتوب بـ Google Apps Script.</div>
        </div>
        <div class="set-field">
          <label>تقريب المبالغ لأقرب</label>
          <select id="setRoundTo">
            <option value="250">250 دينار (مستحسن)</option>
            <option value="500">500 دينار</option>
            <option value="1000">1000 دينار</option>
            <option value="0">بدون تقريب</option>
          </select>
          <div class="sub">أصغر ورقة بالعراق 250 — بدون التقريب يطلع مجموع مثل 1,375 ومحد يكدر يدفعه.
            ⚠️ لازم يطابق <b>roundTo</b> بـ Google Apps Script.</div>
        </div>
      </div>

      <div class="set-card">
        <h3>🔔 الإشعارات</h3>
        <label class="set-check">
          <input type="checkbox" id="setRequireNotif">
          <span>ما يدخل التطبيق إلا بعد ما يفعّل الإشعارات</span>
        </label>
        <label class="set-check">
          <input type="checkbox" id="setRequireInstall">
          <span>شاشة التثبيت تطلع لكل الزوار (مو للجاي من الباركود بس)</span>
        </label>
        <div class="sub">شاشة التثبيت تطلع دائماً للي يفتح الرابط من الباركود.
          أشّر هنا إذا تريدها تطلع لكل واحد يفتح الموقع.</div>
        <div class="sub">تطلع للزبون شاشة تطلب منه يفعّل الإشعارات قبل ما يتصفّح.
          ⚠️ لو ضغط "حظر" بالمتصفح، ما نكدر نطلبها مرة ثانية — وقتها نشرحله
          شلون يفكّها ونخليه يدخل، حتى ما يضيع الزبون كلياً.</div>
      </div>

      <div class="set-card">
        <h3>🕐 أوقات العمل</h3>
        <div class="note">خارج هذي الساعات الطلب يُسجّل، بس الزبون يشوف إنه راح يُجهّز بالفتح.</div>
        <div class="set-hours">
          <div class="set-field"><label>نفتح</label><select id="setOpenHour"></select></div>
          <div class="set-field"><label>نغلق</label><select id="setCloseHour"></select></div>
        </div>
        <label class="set-check">
          <input type="checkbox" id="setManualClosed">
          <span>🌙 إغلاق مؤقت الآن (عطلة أو ظرف) — يتجاوز أوقات العمل</span>
        </label>
        <div class="set-field">
          <label>نص يظهر وقت الإغلاق المؤقت</label>
          <input type="text" id="setClosedMsg" placeholder="مثال: مغلق اليوم بمناسبة العيد، نرجع باچر">
        </div>
      </div>

      <div class="set-card">
        <h3>📢 نصوص الصفحة</h3>
        <div class="set-field">
          <label>بانر العرض (الشريط الأحمر)</label>
          <input type="text" id="setPromoText" placeholder="🚴 التوصيل الأول مجاني لكل زبون جديد!">
          <div class="sub">يختفي البانر إذا خليته فاضي أو طفّيت عرض التوصيل الأول.</div>
        </div>
        <div class="set-field">
          <label>إعلان بأعلى الصفحة</label>
          <textarea id="setAnnouncement" rows="2" placeholder="مثال: فواكه الموسم وصلت اليوم 🍉"></textarea>
          <div class="sub">فاضي = مخفي.</div>
        </div>
      </div>

      <div class="set-card">
        <h3>👁️ اللي راح يشوفه الزبون</h3>
        <div class="set-preview" id="setPreview">…</div>
      </div>

      <button class="set-save" id="setSaveBtn">💾 حفظ الإعدادات</button>
      <div class="set-msg" id="setMsg"></div>
    `;
    document.getElementById("app").appendChild(view);

    // زر التبويب بالبار السفلي
    const nav = document.querySelector(".bottom-nav");
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.dataset.view = "settings";
    btn.innerHTML = `<span class="ic">⚙️</span>إعدادات`;
    nav.appendChild(btn);
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      view.classList.add("active");
    });

    // قوائم الساعات
    ["setOpenHour", "setCloseHour"].forEach(id => {
      const sel = document.getElementById(id);
      for (let h = 0; h < 24; h++) {
        const o = document.createElement("option");
        o.value = h; o.textContent = fmtHour(h);
        sel.appendChild(o);
      }
    });

    // أزرار الأجرة السريعة
    document.querySelectorAll(".set-presets button").forEach(b => {
      b.addEventListener("click", () => {
        document.getElementById("setDeliveryFee").value = b.dataset.fee;
        readForm(); fillForm(); updatePreview();
      });
    });

    document.getElementById("view-settings").addEventListener("input", () => { readForm(); updatePreview(); });
    document.getElementById("view-settings").addEventListener("change", () => { readForm(); updatePreview(); });
    document.getElementById("setSaveBtn").addEventListener("click", save);
  }

  // ---------- ربط النموذج ----------
  function fillForm() {
    document.getElementById("setDeliveryFee").value = settings.deliveryFee;
    document.getElementById("setFreeOver").value = settings.freeDeliveryOver;
    document.getElementById("setMinOrder").value = settings.minOrderTotal;
    document.getElementById("setPoints").value = settings.pointsPerOrder;
    document.getElementById("setRoundTo").value = String(settings.roundTo ?? 250);
    document.getElementById("setRequireNotif").checked = !!settings.requireNotifications;
    document.getElementById("setRequireInstall").checked = !!settings.requireInstall;
    document.getElementById("setFirstFree").checked = !!settings.firstOrderFreeDelivery;
    document.getElementById("setManualClosed").checked = !!settings.manualClosed;
    document.getElementById("setOpenHour").value = settings.openHour;
    document.getElementById("setCloseHour").value = settings.closeHour;
    document.getElementById("setClosedMsg").value = settings.closedMessage || "";
    document.getElementById("setPromoText").value = settings.promoText || "";
    document.getElementById("setAnnouncement").value = settings.announcement || "";
    document.getElementById("setScanPromoOn").checked = !!settings.scanPromoOn;
    document.getElementById("setScanPromoAmount").value = settings.scanPromoAmount ?? 2000;
    document.getElementById("setScanPromoMin").value = settings.scanPromoMin ?? 10000;
    document.getElementById("setScanPromoMax").value = settings.scanPromoMax ?? 0;
    document.getElementById("setScanPromoEnds").value = settings.scanPromoEnds || "";

    document.querySelectorAll(".set-presets button").forEach(b => {
      b.classList.toggle("on", Number(b.dataset.fee) === Number(settings.deliveryFee));
    });
  }

  function num(id) {
    const v = Number(document.getElementById(id).value);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
  }

  function readForm() {
    settings.deliveryFee = num("setDeliveryFee");
    settings.freeDeliveryOver = num("setFreeOver");
    settings.minOrderTotal = num("setMinOrder");
    settings.pointsPerOrder = num("setPoints");
    settings.roundTo = num("setRoundTo");
    settings.requireNotifications = document.getElementById("setRequireNotif").checked;
    settings.requireInstall = document.getElementById("setRequireInstall").checked;
    settings.firstOrderFreeDelivery = document.getElementById("setFirstFree").checked;
    settings.manualClosed = document.getElementById("setManualClosed").checked;
    settings.openHour = num("setOpenHour");
    settings.closeHour = num("setCloseHour");
    settings.closedMessage = document.getElementById("setClosedMsg").value.trim();
    settings.promoText = document.getElementById("setPromoText").value.trim();
    settings.announcement = document.getElementById("setAnnouncement").value.trim();
    settings.scanPromoOn = document.getElementById("setScanPromoOn").checked;
    settings.scanPromoAmount = num("setScanPromoAmount");
    settings.scanPromoMin = num("setScanPromoMin");
    settings.scanPromoMax = num("setScanPromoMax");
    settings.scanPromoEnds = document.getElementById("setScanPromoEnds").value.trim();
    document.querySelectorAll(".set-presets button").forEach(b => {
      b.classList.toggle("on", Number(b.dataset.fee) === Number(settings.deliveryFee));
    });
  }

  function updatePreview() {
    const lines = [];
    lines.push(settings.deliveryFee === 0
      ? "🚴 التوصيل: <b>مجاني لكل الطلبات</b>"
      : `🚴 التوصيل: <b>${money(settings.deliveryFee)}</b>`);
    if (settings.freeDeliveryOver > 0 && settings.deliveryFee > 0)
      lines.push(`🎉 مجاني إذا وصل الطلب <b>${money(settings.freeDeliveryOver)}</b>`);
    if (settings.firstOrderFreeDelivery)
      lines.push("🎁 التوصيل الأول مجاني للزبون الجديد");
    lines.push(settings.minOrderTotal > 0
      ? `🧺 أقل طلب: <b>${money(settings.minOrderTotal)}</b>`
      : "🧺 بدون حد أدنى للطلب");
    lines.push(settings.manualClosed
      ? `🌙 <b>مغلق مؤقتاً</b>${settings.closedMessage ? " — " + settings.closedMessage : ""}`
      : `🕐 الدوام: من ${fmtHour(settings.openHour)} لحد ${fmtHour(settings.closeHour)}`);
    lines.push(`⭐ ${settings.pointsPerOrder} نقطة لكل طلب`);
    document.getElementById("setPreview").innerHTML = lines.join("<br>");
  }

  // ---------- قراءة/حفظ الملف ----------
  async function load() {
    const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}&t=${Date.now()}`, { headers: ghHeaders() });
    if (res.status === 404) { sha = null; settings = Object.assign({}, DEFAULTS); return; }
    if (!res.ok) throw new Error("load failed");
    const data = await res.json();
    sha = data.sha;
    const txt = decodeURIComponent(escape(atob((data.content || "").replace(/\n/g, ""))));
    settings = Object.assign({}, DEFAULTS, JSON.parse(txt));
  }

  async function putFile() {
    const body = {
      message: "تحديث إعدادات المتجر من لوحة التحكم",
      content: btoa(unescape(encodeURIComponent(JSON.stringify(settings, null, 2)))),
      branch: BRANCH
    };
    if (sha) body.sha = sha;
    return fetch(`${API}/repos/${OWNER}/${REPO}/contents/${PATH}`, {
      method: "PUT", headers: ghHeaders(), body: JSON.stringify(body)
    });
  }

  async function save() {
    const btn = document.getElementById("setSaveBtn");
    const msg = document.getElementById("setMsg");
    readForm();

    if (settings.openHour === settings.closeHour) {
      msg.className = "set-msg err";
      msg.textContent = "⚠️ ساعة الفتح والغلق نفسها — بدّل واحدة منهن";
      return;
    }

    btn.disabled = true; btn.textContent = "⏳ جاري الحفظ...";
    msg.className = "set-msg"; msg.textContent = "";
    try {
      let res = await putFile();
      if (res.status === 409 || res.status === 422) {
        // شخص ثاني (أو جهاز ثاني) عدّل الملف — نجدّد ونعيد المحاولة مرة وحدة
        const current = Object.assign({}, settings);
        await load();
        settings = current;
        res = await putFile();
      }
      if (!res.ok) throw new Error("save failed " + res.status);
      const data = await res.json();
      sha = data.content.sha;
      msg.className = "set-msg ok";
      msg.textContent = "✅ تم الحفظ — يوصل الزباين خلال دقيقة";
    } catch (e) {
      console.error(e);
      msg.className = "set-msg err";
      msg.textContent = "⚠️ تعذّر الحفظ — تأكد من الإنترنت وإن مفتاح الدخول عنده صلاحية الكتابة";
    }
    btn.disabled = false; btn.textContent = "💾 حفظ الإعدادات";
  }

  // ---------- الإقلاع: ننتظر لحين ما يدخل صاحب المتجر ----------
  async function boot() {
    if (injected) return;
    injected = true;
    injectStyle();
    buildView();
    try {
      await load();
      fillForm();
      updatePreview();
      if (sha === null) {
        const msg = document.getElementById("setMsg");
        msg.className = "set-msg err";
        msg.textContent = "ℹ️ ملف settings.json مو موجود — اضغط حفظ وينشأ تلقائياً";
      }
    } catch (e) {
      fillForm(); updatePreview();
      const msg = document.getElementById("setMsg");
      msg.className = "set-msg err";
      msg.textContent = "⚠️ تعذّر قراءة الإعدادات الحالية — تظهر لك القيم الافتراضية";
    }
  }

  const timer = setInterval(() => {
    const app = document.getElementById("app");
    if (app && app.style.display !== "none" && document.querySelector(".bottom-nav")) {
      clearInterval(timer);
      boot();
    }
  }, 400);
})();

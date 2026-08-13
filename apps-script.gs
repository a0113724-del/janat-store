/**
 * كود Google Apps Script لموقع "جنة الفواكه والخضار"
 * يسجّل كل طلب، يعطي تقارير، يدير نقاط الولاء، حالة الطلب، الإحالة، وقائمة الزبائن.
 *
 * ═══════════════ تعديلات هذه النسخة ═══════════════
 * 1) توحيد رقم الهاتف (نفس منطق index.html و control.html حرفياً):
 *    07801234567 · 7801234567 · +9647801234567 · ٠٧٨٠١٢٣٤٥٦٧ → كلها زبون واحد.
 *    + دالة migratePhoneNumbers() توحّد البيانات القديمة وتدمج المكرّر.
 * 2) النقاط ما تنصرف مرتين: الرصيد ينقص لحظة الطلب (حجز)، والمكتسب
 *    ينضاف عند التسليم. قبل، الرصيد كان ينقص بالتسليم بس — فطلبين
 *    متتاليين ياخذون خصم من نفس الرصيد.
 * 3) قفل (LockService) على تسجيل الطلب والتسليم: ما عاد يصير رقمين
 *    طلب متشابهين، ولا "أول طلب مجاني" مرتين لنفس الزبون.
 * 4) المجموع الفرعي يُعاد حسابه بالسيرفر من products.json اعتماداً على
 *    تفاصيل السلة (id + qty)، مو على الرقم الجاي من المتصفح.
 * 5) إشعار الزبون يوصل لكل أجهزته، مو لجهاز واحد.
 * 6) تتبّع النشطين: ورقة Visitors (ملخّص متجدد) + endpoint ?activeUsers=1
 *    يعطي قائمة مين فاتح التطبيق الحين ومين دخل مؤخراً.
 * 7) الأداء: doGet ما عاد يقرأ كل سجل Analytics — الملخّص يجي من
 *    ورقة Visitors الجاهزة.
 *
 * ⚠️ لسه ناقص (خطوة جاية): باسورد أدمن على نقاط الطلبات/الزبائن/الإشعارات،
 *    وسد تسريب checkPhone (أي أحد يقدر يسأل إذا رقم معيّن طلب قبل).
 *
 * نظام النقاط:
 * - نقطتين (2) عن كل طلب، تُضاف بعد تأكيد الاستلام فقط.
 * - النقاط المستخدمة تُخصم لحظة الطلب (حجز) حتى ما تنصرف مرتين.
 * - كل 10 نقاط = خصم 1000 دينار.
 * - مكافأة إحالة: 10 نقاط للمُحيل عند أول طلب لصديقه بـ 10,000 د.ع فأكثر،
 *   وبعد تأكيد استلامه فعلياً.
 *
 * ⚠️ خطوة إعداد مطلوبة مرة وحدة (onEdit trigger): راجع آخر هذا الملف.
 */

const SHEET_ID = "1m6KUvBYW07IH-YgLLGUGuU7Lyi4nxvRb9xdHWcFW65k";
const ORDERS_SHEET_NAME = "Orders";
const CUSTOMERS_SHEET_NAME = "Customers";

const POINTS_PER_ORDER = 2;
const IQD_PER_10_POINTS = 1000;
const REFERRAL_BONUS_POINTS = 10;
const REFERRAL_MIN_ORDER_TOTAL = 10000; // الحد الأدنى لقيمة طلب الصديق المدعو
const DEFAULT_STATUS = "قيد المراجعة";
const DELIVERED_STATUS = "تم التسليم";
const CANCELLED_STATUS = "ملغي";

// كم دقيقة يبقى الزائر محسوب "فاتح التطبيق الآن"
const ONLINE_WINDOW_MINUTES = 5;

// مهلة انتظار القفل قبل ما نعتبر الطلب فاشل (بالملي ثانية)
const LOCK_TIMEOUT_MS = 25000;

// أرقام أعمدة جدول Orders (تبدأ من 1)
const COL_TIME = 1;
const COL_NAME = 2;
const COL_PHONE = 3;
const COL_ADDRESS = 4;
const COL_APPROX_LOC = 5;
const COL_ITEMS = 6;
const COL_TOTAL = 7;
const COL_NOTES = 8;
const COL_FIRST_ORDER = 9;
const COL_POINTS_EARNED = 10;
const COL_POINTS_USED = 11;
const COL_STATUS = 12;
const COL_REFERRED_BY = 13;
const COL_POINTS_PROCESSED = 14;
const COL_ORDER_ID = 15;
const COL_SEQ_NO = 16;
const COL_SUBTOTAL = 17;
const COL_DELIVERY_FEE = 18;
const COL_FLAG = 19;
const ORDERS_NUM_COLS = 19;

// ═══════════ إعدادات المتجر وأسعاره (مصدر الحقيقة لحساب الفلوس) ═══════════
const BASE_URL = "https://a0113724-del.github.io/janat-store/";
const SETTINGS_URL = BASE_URL + "settings.json";
const PRODUCTS_URL = BASE_URL + "products.json";

const DEFAULT_SETTINGS = {
  deliveryFee: 1000,
  freeDeliveryOver: 0,        // 0 = معطّل
  minOrderTotal: 0,
  firstOrderFreeDelivery: true
};

function getStoreSettings() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("store-settings");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* كاش خربان، نجيبها من جديد */ }
  }
  try {
    const res = UrlFetchApp.fetch(SETTINGS_URL + "?t=" + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const s = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(res.getContentText()));
      cache.put("store-settings", JSON.stringify(s), 300); // 5 دقائق
      return s;
    }
  } catch (e) { /* نرجع للافتراضي */ }
  return DEFAULT_SETTINGS;
}

/**
 * أسعار المنتجات من products.json.
 * يرجع { map, stale, reason } — أو null إذا ما فيه أي أسعار إطلاقاً.
 * stale=true معناه الجلب فشل واستعملنا نسخة احتياطية، ووقتها ما ننبّه
 * على فروق المجموع لأن أسعارنا نفسها ممكن تكون قديمة.
 */
function getProductPrices() {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();

  const cached = cache.get("product-prices");
  if (cached) {
    try { return { map: JSON.parse(cached), stale: false, reason: "" }; } catch (e) { }
  }

  let reason = "";
  try {
    const res = UrlFetchApp.fetch(PRODUCTS_URL + "?t=" + Date.now(), {
      muteHttpExceptions: true,
      followRedirects: true
    });
    const code = res.getResponseCode();
    if (code === 200) {
      const body = res.getContentText();
      const arr = JSON.parse(body);
      if (Array.isArray(arr) && arr.length) {
        const map = {};
        arr.forEach(function (p) {
          if (p && p.id) {
            map[String(p.id)] = {
              price: Number(p.price) || 0,
              name: String(p.name || ""),
              unit: String(p.unit || "كغم")
            };
          }
        });
        const json = JSON.stringify(map);
        try { cache.put("product-prices", json, 300); } catch (e) { }
        // نسخة احتياطية دائمة — تنقذنا لو فشل الجلب مرة جاية
        try { props.setProperty("prices-backup", json); } catch (e) { }
        try { props.deleteProperty("prices-last-error"); } catch (e) { }
        return { map: map, stale: false, reason: "" };
      }
      reason = "الرد مو قائمة منتجات (طوله " + body.length + " حرف)";
    } else {
      reason = "HTTP " + code;
    }
  } catch (e) {
    reason = String(e);
  }

  // فشل الجلب — نسجّل السبب ونستعمل آخر نسخة ناجحة بدل ما نعطّل التحقق كلياً
  try { props.setProperty("prices-last-error", reason + " · " + new Date()); } catch (e) { }
  try {
    const backup = props.getProperty("prices-backup");
    if (backup) {
      Logger.log("⚠️ استعملنا الأسعار الاحتياطية — سبب الفشل: " + reason);
      return { map: JSON.parse(backup), stale: true, reason: reason };
    }
  } catch (e) { }

  return null;
}

/**
 * يعيد حساب مجموع السلة من تفاصيلها المنظّمة.
 * lines: [{ id: "tomato", qty: 2 }, ...]
 * يرجع { ok, subtotal, issues[] }
 */
function computeSubtotalFromLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, stale: false, subtotal: 0, issues: ["ما وصلت تفاصيل السلة"] };
  }
  const pr = getProductPrices();
  if (!pr || !pr.map) {
    return { ok: false, stale: false, subtotal: 0,
             issues: ["تعذّر جلب قائمة الأسعار" + (pr && pr.reason ? ": " + pr.reason : "")] };
  }
  const prices = pr.map;
  let sum = 0;
  const issues = [];
  lines.forEach(function (l) {
    const id = String((l && l.id) || "");
    const qty = Number((l && l.qty) || 0);
    const p = prices[id];
    if (!p) { issues.push("منتج غير معروف: " + id); return; }
    if (!(qty > 0) || qty > 500) { issues.push("كمية غير منطقية لـ " + id + ": " + qty); return; }
    sum += p.price * qty;
  });
  return {
    ok: issues.length === 0,
    stale: !!pr.stale,          // أسعار احتياطية — ما ننبّه على فروق المجموع
    subtotal: Math.round(sum),
    issues: issues
  };
}

function computeDeliveryFee(subtotal, isFirstOrder) {
  const s = getStoreSettings();
  if (s.firstOrderFreeDelivery && isFirstOrder) return 0;
  if (Number(s.freeDeliveryOver) > 0 && subtotal >= Number(s.freeDeliveryOver)) return 0;
  return Number(s.deliveryFee) || 0;
}

// ═══════════════════ أوراق الجداول ═══════════════════
function getOrdersSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(ORDERS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "الوقت", "الاسم", "الهاتف", "العنوان",
      "الموقع التقريبي", "المنتجات", "المجموع", "ملاحظات", "أول طلب",
      "نقاط مكتسبة", "نقاط مستخدمة", "الحالة", "أحاله", "معالجة النقاط",
      "رقم الطلب", "الرقم التسلسلي", "المجموع الفرعي", "رسوم التوصيل", "تنبيه"
    ]);
  } else if (String(sheet.getRange(1, COL_SUBTOTAL).getValue()).trim() === "") {
    // ترقية جدول موجود: نضيف عناوين الأعمدة الجديدة بدون المساس بالبيانات
    sheet.getRange(1, COL_SUBTOTAL, 1, 3)
      .setValues([["المجموع الفرعي", "رسوم التوصيل", "تنبيه"]]);
  }
  // بدونها Sheets يحوّل 07831158964 لرقم ويشيل الصفر
  forceTextColumn(sheet, COL_PHONE);
  return sheet;
}

function getCustomersSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CUSTOMERS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["الهاتف", "الاسم", "مجموع النقاط", "إجمالي الصرف"]);
  }
  forceTextColumn(sheet, 1);
  return sheet;
}

function getAnalyticsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName("Analytics");
  if (!sheet) sheet = ss.insertSheet("Analytics");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["الوقت", "نوع الحدث", "الموقع التقريبي", "رقم الجهاز"]);
  }
  return sheet;
}

/**
 * ورقة Visitors: ملخّص متجدد لكل جهاز زار التطبيق (سطر واحد لكل جهاز).
 * هي اللي تغذّي قائمة النشطين، وتخلي doGet سريع بدل ما يقرأ كل سجل Analytics.
 */
function getVisitorsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName("Visitors");
  if (!sheet) sheet = ss.insertSheet("Visitors");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "رقم الجهاز", "الهاتف", "الاسم", "أول زيارة",
      "آخر ظهور", "عدد الزيارات", "مثبّت التطبيق", "الموقع التقريبي"
    ]);
  }
  return sheet;
}
const VCOL_ID = 1, VCOL_PHONE = 2, VCOL_NAME = 3, VCOL_FIRST = 4,
      VCOL_LAST = 5, VCOL_VISITS = 6, VCOL_INSTALLED = 7, VCOL_LOC = 8;
const VISITORS_NUM_COLS = 8;

function getDevicesSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName("Devices");
  if (!sheet) sheet = ss.insertSheet("Devices");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["رمز الجهاز", "تاريخ التسجيل"]);
  }
  return sheet;
}

function getCustomerDevicesSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName("CustomerDevices");
  if (!sheet) sheet = ss.insertSheet("CustomerDevices");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["الهاتف", "رمز الجهاز", "تاريخ التسجيل"]);
  }
  return sheet;
}

// ═══════════════════ مساعدات ═══════════════════
/**
 * ⚠️ لازم تطابق normalizePhone بـ index.html و control.html حرفياً.
 * أي اختلاف = زبون ينحسب زبونين، تضيع نقاطه ويتكرر له "أول طلب مجاني".
 * الصيغة المعتمدة: 07XXXXXXXXX
 */
function normalizePhone(p) {
  // كيبورد عربي (٠-٩) وفارسي (۰-۹) → أرقام لاتينية
  var s = String(p || "").replace(/[٠-٩۰-۹]/g, function (ch) {
    return String(ch.charCodeAt(0) & 0x0F);
  });
  var d = s.replace(/[^0-9]/g, "");
  if (!d) return "";
  if (d.indexOf("00964") === 0) d = d.substring(5);
  else if (d.indexOf("964") === 0) d = d.substring(3);
  if (d.charAt(0) === "7") d = "0" + d;   // كتب 78... بدون صفر
  return d;
}

function isValidPhone(p) {
  return /^07[0-9]{9}$/.test(normalizePhone(p));
}

/**
 * يخلي عمود كامل نصّي. لولاها Sheets يقرأ "07831158964" كرقم
 * ويشيل الصفر البادئ، فيصير العرض غلط بلوحة التحكم.
 * (المطابقة نفسها ما تتأثر لأن normalizePhone ترجّع الصفر عند القراءة.)
 */
function forceTextColumn(sheet, col) {
  const key = "fmt-" + sheet.getSheetId() + "-" + col;
  const cache = CacheService.getScriptCache();
  if (cache.get(key)) return;              // انضبطت قريباً، ما نكررها
  try {
    sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat("@");
    cache.put(key, "1", 21600);            // 6 ساعات
  } catch (e) { /* التنسيق ثانوي */ }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════ أجهزة الزبائن ═══════════════════
function registerCustomerDevice(phone, token) {
  const sheet = getCustomerDevicesSheet();
  const p = normalizePhone(phone);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < existing.length; i++) {
      if (existing[i][1] === token) {
        sheet.getRange(i + 2, 1).setValue(p); // حدّث الهاتف المرتبط لو تغيّر
        return;
      }
    }
  }
  sheet.appendRow([p, token, new Date()]);
}

/**
 * كل أجهزة الزبون، مو أول جهاز بس — زبون عنده موبايل وتابلت
 * لازم يوصله الإشعار على الاثنين.
 */
function getCustomerDeviceTokens(phone) {
  const sheet = getCustomerDevicesSheet();
  const target = normalizePhone(phone);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || target === "") return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (normalizePhone(rows[i][0]) === target) {
      const t = String(rows[i][1] || "").trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    }
  }
  return out;
}

/** يرسل إشعار لكل أجهزة زبون معيّن. يرجع { sent, failed } */
function notifyCustomer(phone, title, body) {
  const tokens = getCustomerDeviceTokens(phone);
  if (tokens.length === 0) return { sent: 0, failed: 0 };
  let accessToken;
  try { accessToken = getFcmAccessToken(); }
  catch (e) { return { sent: 0, failed: tokens.length }; }
  let sent = 0, failed = 0;
  tokens.forEach(function (t) {
    try {
      const r = sendPushToToken(t, title, body, accessToken);
      if (r.code === 200) sent++; else failed++;
    } catch (e) { failed++; }
  });
  return { sent: sent, failed: failed };
}

// ═══════════ إشعارات Firebase Cloud Messaging ═══════════
// يبني ويوقّع JWT يدوياً من مفتاح حساب الخدمة، ويستبدله برمز دخول مؤقت من
// Google. الرمز يُخزَّن بالكاش 55 دقيقة — هذا اللي يخلي الإرسال الجماعي
// يخلص بالوقت بدل ما يتوقف بالنص.
function getFcmAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("fcm-token");
  if (cached) return cached;

  const props = PropertiesService.getScriptProperties();
  const clientEmail = props.getProperty("FIREBASE_CLIENT_EMAIL");
  const rawKey = props.getProperty("FIREBASE_PRIVATE_KEY");
  if (!clientEmail || !rawKey) {
    throw new Error("إعدادات Firebase ناقصة بـ Script Properties (CLIENT_EMAIL / PRIVATE_KEY)");
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const base64url = function (obj) {
    return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, "");
  };
  const toSign = base64url(header) + "." + base64url(claimSet);
  const signatureBytes = Utilities.computeRsaSha256Signature(toSign, privateKey);
  const signature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, "");
  const jwt = toSign + "." + signature;

  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    },
    muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText());
  if (!data.access_token) {
    throw new Error("فشل جلب رمز الدخول من Google: " + res.getContentText());
  }

  cache.put("fcm-token", data.access_token, 3300); // 55 دقيقة (الرمز صالح 60)
  return data.access_token;
}

// يرجع { code, body } — ما يخفي الأخطاء
function sendPushToToken(deviceToken, title, body, accessToken) {
  const props = PropertiesService.getScriptProperties();
  const projectId = props.getProperty("FIREBASE_PROJECT_ID");
  const token = accessToken || getFcmAccessToken();

  const res = UrlFetchApp.fetch(
    "https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send",
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({
        message: { token: deviceToken, notification: { title: title, body: body } }
      }),
      muteHttpExceptions: true
    }
  );
  return { code: res.getResponseCode(), body: res.getContentText() };
}

// إرسال جماعي لورقة أجهزة: رمز دخول واحد للكل + تنظيف الأرمز الميتة
// sheet: ورقة الأجهزة · tokenCol: رقم عمود الرمز
function broadcastToSheet(sheet, tokenCol, title, body) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sent: 0, failed: 0, removed: 0 };

  const rows = sheet.getRange(2, tokenCol, lastRow - 1, 1).getValues();
  const accessToken = getFcmAccessToken();

  let sent = 0, failed = 0;
  const deadRows = [];

  for (let i = 0; i < rows.length; i++) {
    const deviceToken = String(rows[i][0] || "").trim();
    if (!deviceToken) continue;
    let r;
    try {
      r = sendPushToToken(deviceToken, title, body, accessToken);
    } catch (e) {
      failed++;
      continue;
    }
    if (r.code === 200) {
      sent++;
    } else if (r.code === 404 || r.code === 400) {
      // الرمز ميت (شال التطبيق أو بطّل الإشعارات) — نشيله من الجدول
      deadRows.push(i + 2);
      failed++;
    } else {
      failed++;
      Logger.log("فشل إرسال (" + r.code + "): " + r.body);
    }
  }

  // نحذف من الآخر للأول حتى ما تنزاح أرقام الصفوف
  deadRows.sort(function (a, b) { return b - a; });
  deadRows.forEach(function (r) { sheet.deleteRow(r); });

  return { sent: sent, failed: failed, removed: deadRows.length };
}

function sendPushToAllCustomerDevices(title, body) {
  return broadcastToSheet(getCustomerDevicesSheet(), 2, title, body);
}

function sendPushToAllDevices(title, body) {
  return broadcastToSheet(getDevicesSheet(), 1, title, body);
}

// ═══════════════════ الزبائن والنقاط ═══════════════════
function findOrCreateCustomerRow(sheet, phone, name) {
  const target = normalizePhone(phone);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    for (let i = 0; i < data.length; i++) {
      if (normalizePhone(data[i][0]) === target && target !== "") {
        return i + 2;
      }
    }
  }
  sheet.appendRow([target, name || "", 0, 0]);
  return sheet.getLastRow();
}

function addPointsToCustomer(sheet, phone, name, pointsDelta, spendDelta) {
  if (!phone) return;
  const row = findOrCreateCustomerRow(sheet, phone, name);
  // قراءة وحدة وكتابة وحدة بدل قراءتين وثلاث كتابات
  const cur = sheet.getRange(row, 1, 1, 4).getValues()[0];
  const currentPoints = Number(cur[2]) || 0;
  const currentSpend = Number(cur[3]) || 0;
  sheet.getRange(row, 1, 1, 4).setValues([[
    cur[0],
    name || cur[1],
    Math.max(0, currentPoints + pointsDelta),
    currentSpend + (spendDelta || 0)
  ]]);
}

// رصيد نقاط الزبون الحالي
function getCustomerPointsBalance(phone) {
  const sheet = getCustomersSheet();
  const target = normalizePhone(phone);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || target === "") return 0;
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    if (normalizePhone(data[i][0]) === target) return Number(data[i][2]) || 0;
  }
  return 0;
}

function customerHasPriorOrders(ordersSheet, phone) {
  const target = normalizePhone(phone);
  if (target === "") return false;
  const lastRow = ordersSheet.getLastRow();
  if (lastRow < 2) return false;
  const phones = ordersSheet.getRange(2, COL_PHONE, lastRow - 1, 1).getValues();
  return phones.some(function (row) { return normalizePhone(row[0]) === target; });
}

/**
 * تأكيد استلام طلب + إضافة نقاطه المكتسبة لرصيد الزبون.
 * ⚠️ النقاط المستخدمة انخصمت أصلاً لحظة الطلب (حجز)، فهنا نضيف
 * المكتسب بس — وإلا تنخصم مرتين.
 */
function creditOrderPoints(ordersSheet, customersSheet, row) {
  const processedCell = ordersSheet.getRange(row, COL_POINTS_PROCESSED);
  if (String(processedCell.getValue()).trim() === "نعم") return false; // انعالج قبل

  const rowData = ordersSheet.getRange(row, 1, 1, ORDERS_NUM_COLS).getValues()[0];
  const name = rowData[COL_NAME - 1];
  const phone = rowData[COL_PHONE - 1];
  const total = Number(rowData[COL_TOTAL - 1]) || 0;
  const pointsEarned = Number(rowData[COL_POINTS_EARNED - 1]) || 0;
  const referredBy = rowData[COL_REFERRED_BY - 1];

  if (phone) {
    addPointsToCustomer(customersSheet, phone, name, pointsEarned, total);
  }
  if (referredBy && total >= REFERRAL_MIN_ORDER_TOTAL) {
    addPointsToCustomer(customersSheet, referredBy, "", REFERRAL_BONUS_POINTS, 0);
    try {
      notifyCustomer(referredBy, "🎁 ربحت " + REFERRAL_BONUS_POINTS + " نقاط!",
        "صديقك اللي دعيته استلم أول طلب — نقاطك انضافت لرصيدك 🌿");
    } catch (e) { /* فشل الإشعار ما يوقف النقاط */ }
  }

  processedCell.setValue("نعم");

  // إشعار شخصي للزبون على كل أجهزته
  if (phone) {
    try {
      notifyCustomer(phone, "✅ تم تسليم طلبك!",
        "شكراً لطلبك من جنة الفواكه والخضار 🌿 — انضافت لك " + pointsEarned + " نقطة");
    } catch (e) { /* فشل إشعار الزبون ما يوقف باقي العملية */ }
  }

  return true;
}

/** يرجّع النقاط المحجوزة لطلب ملغي */
function refundOrderPoints(ordersSheet, customersSheet, row) {
  const rowData = ordersSheet.getRange(row, 1, 1, ORDERS_NUM_COLS).getValues()[0];
  const phone = rowData[COL_PHONE - 1];
  const pointsUsed = Number(rowData[COL_POINTS_USED - 1]) || 0;
  if (phone && pointsUsed > 0) {
    addPointsToCustomer(customersSheet, phone, "", pointsUsed, 0);
  }
  ordersSheet.getRange(row, COL_POINTS_USED).setValue(0);
}

// ═══════════════════ تتبّع الزوار والنشطين ═══════════════════
/**
 * يحدّث سطر الزائر بورقة Visitors (سطر واحد لكل جهاز).
 * يُستدعى من كل حدث analytics — بما فيه نبضة "لسه فاتح التطبيق".
 */
function touchVisitor(visitorId, eventType, approxLocation, phone, name) {
  const id = String(visitorId || "").trim();
  if (!id) return;
  const sheet = getVisitorsSheet();
  const now = new Date();

  // البحث بـ TextFinder أسرع بكثير من قراءة كل العمود
  const found = sheet.createTextFinder(id).matchEntireCell(true).findNext();

  if (found && found.getColumn() === VCOL_ID) {
    const row = found.getRow();
    // قراءة وحدة وكتابة وحدة بدل 6 كتابات منفصلة — النبضة تشتغل كل 90
    // ثانية لكل جهاز مفتوح، وكل setValue رحلة كاملة للسيرفر.
    const cur = sheet.getRange(row, 1, 1, VISITORS_NUM_COLS).getValues()[0];
    if (eventType !== "heartbeat") cur[VCOL_VISITS - 1] = (Number(cur[VCOL_VISITS - 1]) || 0) + 1;
    cur[VCOL_LAST - 1] = now;
    if (eventType === "install") cur[VCOL_INSTALLED - 1] = "نعم";
    if (phone) {
      cur[VCOL_PHONE - 1] = normalizePhone(phone);
      if (name) cur[VCOL_NAME - 1] = name;
    }
    if (approxLocation) cur[VCOL_LOC - 1] = approxLocation;
    sheet.getRange(row, 1, 1, VISITORS_NUM_COLS).setValues([cur]);
  } else {
    sheet.appendRow([
      id,
      phone ? normalizePhone(phone) : "",
      name || "",
      now,
      now,
      1,
      eventType === "install" ? "نعم" : "لا",
      approxLocation || ""
    ]);
  }
}

/** يربط جهاز الزائر برقم الزبون بعد ما يسوي طلب */
function linkVisitorToCustomer(visitorId, phone, name) {
  if (!visitorId || !phone) return;
  try { touchVisitor(visitorId, "order", "", phone, name); } catch (e) { /* ثانوي */ }
}

// ═══════════ استقبال الطلبات + إجراءات لوحة التقارير ═══════════
function doPost(e) {
  let data;
  let lastOrderSummary = null; // ينملي فقط لو الطلب انسجل فعلاً بالجدول
  try {
    data = JSON.parse(e.postData.contents);

    // ───────────── أحداث التتبّع (زيارة / تثبيت / نبضة) ─────────────
    if (data.type === "analytics") {
      const eventType = data.eventType || "visit";
      // النبضة ما تنكتب بسجل Analytics حتى ما ينتفخ — تحدّث Visitors بس
      if (eventType !== "heartbeat") {
        getAnalyticsSheet().appendRow([
          new Date(),
          eventType,
          data.approxLocation || "غير معروف",
          data.visitorId || ""
        ]);
      }
      try {
        touchVisitor(data.visitorId, eventType, data.approxLocation, data.phone, data.name);
      } catch (vErr) { /* التتبّع ثانوي، ما يوقف شي */ }
      return jsonOut({ status: "ok" });
    }

    // تسجيل رمز جهاز الأدمن (من صفحة التحكم عند تفعيل الإشعارات)
    if (data.action === "registerDeviceToken" && data.token) {
      const devicesSheet = getDevicesSheet();
      const lastRow = devicesSheet.getLastRow();
      let exists = false;
      if (lastRow >= 2) {
        const existing = devicesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        exists = existing.some(function (row) { return row[0] === data.token; });
      }
      if (!exists) devicesSheet.appendRow([data.token, new Date()]);
      return jsonOut({ status: "ok" });
    }

    // زر "إرسال إشعار تجريبي" بصفحة التحكم
    if (data.action === "sendTestNotification") {
      const result = sendPushToAllDevices(
        data.title || "🔔 إشعار تجريبي",
        data.body || "هذا اختبار للتأكد إن الإشعارات تشتغل"
      );
      return jsonOut({ status: "ok", result: result });
    }

    // تسجيل رمز جهاز الزبون (من الصفحة الرئيسية عند موافقته على الإشعارات)
    if (data.action === "registerCustomerDeviceToken" && data.token) {
      registerCustomerDevice(data.phone || "", data.token);
      return jsonOut({ status: "ok" });
    }

    // إرسال إشعار جماعي لكل الزبائن المسجّلين (زر بصفحة التحكم)
    if (data.action === "sendCustomerBroadcast") {
      const result = sendPushToAllCustomerDevices(
        data.title || "🌿 جنة الفواكه والخضار",
        data.body || ""
      );
      return jsonOut({ status: "ok", result: result });
    }

    // زر "تأكيد الاستلام" بصفحة التقارير
    if (data.action === "confirmDelivery" && data.orderId) {
      const lock = LockService.getScriptLock();
      try { lock.waitLock(LOCK_TIMEOUT_MS); }
      catch (lockErr) { return jsonOut({ status: "error", message: "busy" }); }
      try {
        const ordersSheet = getOrdersSheet();
        const customersSheet = getCustomersSheet();
        const lastRow = ordersSheet.getLastRow();
        if (lastRow < 2) return jsonOut({ status: "error", message: "no orders" });

        const ids = ordersSheet.getRange(2, COL_ORDER_ID, lastRow - 1, 1).getValues();
        let targetRow = -1;
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(data.orderId)) { targetRow = i + 2; break; }
        }
        if (targetRow === -1) return jsonOut({ status: "error", message: "order not found" });

        ordersSheet.getRange(targetRow, COL_STATUS).setValue(DELIVERED_STATUS);
        creditOrderPoints(ordersSheet, customersSheet, targetRow);
        return jsonOut({ status: "ok" });
      } finally {
        lock.releaseLock();
      }
    }

    // إلغاء طلب — يرجّع النقاط المحجوزة لصاحبها
    if (data.action === "cancelOrder" && data.orderId) {
      const lock = LockService.getScriptLock();
      try { lock.waitLock(LOCK_TIMEOUT_MS); }
      catch (lockErr) { return jsonOut({ status: "error", message: "busy" }); }
      try {
        const ordersSheet = getOrdersSheet();
        const customersSheet = getCustomersSheet();
        const lastRow = ordersSheet.getLastRow();
        if (lastRow < 2) return jsonOut({ status: "error", message: "no orders" });
        const ids = ordersSheet.getRange(2, COL_ORDER_ID, lastRow - 1, 1).getValues();
        let targetRow = -1;
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(data.orderId)) { targetRow = i + 2; break; }
        }
        if (targetRow === -1) return jsonOut({ status: "error", message: "order not found" });
        const st = String(ordersSheet.getRange(targetRow, COL_STATUS).getValue()).trim();
        if (st === DELIVERED_STATUS) {
          return jsonOut({ status: "error", message: "already delivered" });
        }
        refundOrderPoints(ordersSheet, customersSheet, targetRow);
        ordersSheet.getRange(targetRow, COL_STATUS).setValue(CANCELLED_STATUS);
        return jsonOut({ status: "ok" });
      } finally {
        lock.releaseLock();
      }
    }

    // ───────────── تسجيل طلب جديد ─────────────
    // قفل يمنع طلبين متزامنين من أخذ نفس الرقم التسلسلي، أو من عبور
    // فحص "أول طلب" سوا وأخذ توصيل مجاني مرتين.
    const lock = LockService.getScriptLock();
    try { lock.waitLock(LOCK_TIMEOUT_MS); }
    catch (lockErr) {
      return jsonOut({ status: "error", message: "السيرفر مشغول، حاول مرة ثانية" });
    }

    try {
      const ordersSheet = getOrdersSheet();
      const customersSheet = getCustomersSheet();
      const phone = normalizePhone(data.phone);

      if (!isValidPhone(phone)) {
        return jsonOut({ status: "error", message: "رقم هاتف غير صحيح" });
      }

      // منع تكرار نفس الطلب لو الزبون ضغط مرتين أو أعاد المحاولة
      const existingRef = findOrderByRef(ordersSheet, data.orderRef);
      if (existingRef) {
        return jsonOut({
          status: "ok", duplicate: true,
          orderId: existingRef.orderId, seqNo: existingRef.seqNo,
          subtotal: existingRef.subtotal, deliveryFee: existingRef.deliveryFee,
          total: existingRef.total
        });
      }

      // أول طلب؟ نتحقق من الشيت، ما نسأل المتصفح
      const isGenuinelyFirstOrder = !customerHasPriorOrders(ordersSheet, phone);

      const flags = [];

      // ═══ المجموع الفرعي: نعيد حسابه من products.json ═══
      const clientSubtotal = Number(data.subtotal) || 0;
      const clientFee = Number(data.deliveryFee) || 0;
      const clientTotal = Number(data.total) || 0;
      const hasCustomRequest = String(data.customRequest || "").trim() !== "";

      let subtotal;
      const noLines = !Array.isArray(data.lines) || data.lines.length === 0;

      if (noLines && hasCustomRequest && clientSubtotal === 0) {
        // طلب خاص لحاله بدون منتجات — سعره يُحدد بالتأكيد، مو حالة تنبيه
        subtotal = 0;
      } else {
        let calc = computeSubtotalFromLines(data.lines);

        // اختلاف بسبب كاش الأسعار (5 دقائق) مو تلاعب — نجيب الأسعار
        // طازجة ونعيد الحساب مرة وحدة قبل ما ننبّه
        // جلب ثاني للأسعار مكلف (رحلة شبكة كاملة). ما نسويه إلا لو
        // الفرق راح يطلّع تنبيه فعلاً — يعني الزبون أرسل أقل من حسابنا.
        if (calc.ok && !calc.stale && clientSubtotal > 0 && clientSubtotal < calc.subtotal - 1) {
          CacheService.getScriptCache().remove("product-prices");
          const fresh = computeSubtotalFromLines(data.lines);
          if (fresh.ok) calc = fresh;
        }

        if (calc.ok) {
          subtotal = calc.subtotal;
          // ننبّه بس إذا الزبون أرسل رقم أقل من الحقيقي (محاولة يدفع أقل).
          // لو أرسل أكثر أو مساوي، السيرفر صحّحه وما فيه ضرر — سكوت.
          // لو أسعارنا احتياطية (الجلب فشل) ما ننبّه — ممكن نحن القدامى
          if (!calc.stale && clientSubtotal > 0 && clientSubtotal < subtotal - 1) {
            flags.push("مجموع فرعي أقل: أرسل " + clientSubtotal + " / الصحيح " + subtotal);
          }
        } else {
          // منتج مجهول أو قائمة أسعار ما وصلت — هذي تستاهل تنبيه فعلاً
          subtotal = clientSubtotal;
          flags.push("ما انتحقق من المجموع (" + calc.issues.join("، ") + ")");
        }
      }

      // ═══ النقاط: مقيَّدة برصيده الفعلي ومن مضاعفات 10 ═══
      const requestedPoints = Math.max(0, Number(data.pointsUsed) || 0);
      const balance = getCustomerPointsBalance(phone);
      const pointsUsed = Math.floor(Math.min(requestedPoints, balance) / 10) * 10;
      const maxDiscount = (pointsUsed / 10) * IQD_PER_10_POINTS;
      const discount = Math.min(maxDiscount, subtotal); // الخصم ما يتجاوز قيمة السلة
      if (requestedPoints !== pointsUsed) {
        flags.push("نقاط مرفوضة: طلب " + requestedPoints + " / رصيده " + balance);
      }

      // ═══ رسوم التوصيل والمجموع النهائي ═══
      const serverFee = computeDeliveryFee(subtotal, isGenuinelyFirstOrder);
      const total = Math.max(0, subtotal + serverFee - discount);

      // الواجهة تعرف "أول طلب" من checkPhone اللي ينتظر 600ms بعد ما يكتب
      // رقمه — لو ضغط تأكيد بسرعة، تحسب رسوم والسيرفر يعرف إنها مجانية.
      // هذا اختلاف مشروع، والسيرفر هو المرجع. ننبّه بس لو الزبون حاول
      // يدفع أقل من الصحيح.
      if (clientFee > 0 && serverFee > clientFee) {
        flags.push("رسوم أقل: أرسل " + clientFee + " / الصحيح " + serverFee);
      }
      if (!hasCustomRequest && clientTotal > 0 && clientTotal < total - 1) {
        flags.push("مجموع أقل: أرسل " + clientTotal + " / الصحيح " + total);
      }

      // ═══ الحد الأدنى للطلب (طلبات المنتجات بس) ═══
      const settings = getStoreSettings();
      const minTotal = Number(settings.minOrderTotal) || 0;
      if (minTotal > 0 && !hasCustomRequest && subtotal > 0 && subtotal < minTotal) {
        return jsonOut({
          status: "error",
          message: "أقل مجموع للطلب " + minTotal + " دينار"
        });
      }

      const pointsEarned = POINTS_PER_ORDER;

      const referralPhone = normalizePhone(data.referralPhone);
      const isValidReferral = referralPhone &&
        referralPhone !== phone &&
        isGenuinelyFirstOrder;

      const orderId = Utilities.getUuid();
      const seqNo = ordersSheet.getLastRow(); // عدد الطلبات الحالي = رقم هذا الطلب

      // نحجز النقاط فوراً — قبل، الرصيد كان ينقص بالتسليم بس، فطلبين
      // متتاليين ياخذون خصم من نفس الرصيد.
      if (pointsUsed > 0) {
        addPointsToCustomer(customersSheet, phone, data.name || "", -pointsUsed, 0);
      }

      ordersSheet.appendRow([
        new Date(),
        data.name || "",
        phone,
        data.address || "",
        data.approxLocation || "غير معروف",
        (data.items || "") + (data.orderRef ? "  ⟨ref:" + data.orderRef + "⟩" : ""),
        total,
        data.notes || "",
        isGenuinelyFirstOrder ? "نعم" : "لا",
        pointsEarned,
        pointsUsed,
        DEFAULT_STATUS,
        isValidReferral ? referralPhone : "",
        "لا",
        orderId,
        seqNo,
        subtotal,
        serverFee,
        flags.join(" | ")
      ]);

      // نربط جهاز الزائر بالزبون حتى تظهر أسماء بقائمة النشطين
      linkVisitorToCustomer(data.visitorId, phone, data.name);

      if (data.customerDeviceToken) {
        registerCustomerDevice(phone, data.customerDeviceToken);
      }

      // تأكيد فوري للزبون على أجهزته
      try {
        notifyCustomer(phone, "🌿 استلمنا طلبك #" + seqNo,
          "مجموع طلبك " + total + " د.ع — نجهّزه ونتواصل وياك قريباً");
      } catch (nErr) { /* ثانوي */ }

      lastOrderSummary = {
        name: data.name || "زبون",
        phone: phone,
        total: total,
        seqNo: seqNo,
        flagged: flags.length > 0
      };

      return jsonOut({
        status: "ok",
        pointsEarned: pointsEarned,
        orderId: orderId,
        seqNo: seqNo,
        subtotal: subtotal,
        deliveryFee: serverFee,
        pointsUsed: pointsUsed,
        discount: discount,
        total: total,
        firstOrder: isGenuinelyFirstOrder,
        pointsBalance: getCustomerPointsBalance(phone)
      });
    } finally {
      lock.releaseLock();
    }

  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  } finally {
    // إشعار فوري لأجهزة الأدمن — فقط إذا الطلب انسجل فعلاً بالجدول
    try {
      if (lastOrderSummary) {
        sendPushToAllDevices(
          (lastOrderSummary.flagged ? "⚠️ طلب جديد #" : "🛒 طلب جديد #") + lastOrderSummary.seqNo,
          lastOrderSummary.name + " · " + lastOrderSummary.total + " د.ع" +
          (lastOrderSummary.phone ? " · " + lastOrderSummary.phone : "")
        );
      }
    } catch (pushErr) { /* فشل الإرسال ما يوقف تسجيل الطلب */ }
  }
}

/** يدوّر على طلب سابق بنفس المرجع — يمنع الحفظ المزدوج */
function findOrderByRef(ordersSheet, orderRef) {
  const ref = String(orderRef || "").trim();
  if (!ref) return null;
  const found = ordersSheet.createTextFinder("⟨ref:" + ref + "⟩").findNext();
  if (!found) return null;
  const row = found.getRow();
  const d = ordersSheet.getRange(row, 1, 1, ORDERS_NUM_COLS).getValues()[0];
  return {
    orderId: d[COL_ORDER_ID - 1],
    seqNo: d[COL_SEQ_NO - 1],
    subtotal: d[COL_SUBTOTAL - 1],
    deliveryFee: d[COL_DELIVERY_FEE - 1],
    total: d[COL_TOTAL - 1]
  };
}

// ═══════ تُستدعى تلقائياً عند التعديل اليدوي بجدول Google Sheets ═══════
function onEdit(e) {
  try {
    const range = e.range;
    const sheet = range.getSheet();
    if (sheet.getName() !== ORDERS_SHEET_NAME) return;
    if (range.getColumn() !== COL_STATUS || range.getRow() < 2) return;

    const newStatus = String(range.getValue()).trim();
    const ss = e.source;
    let customersSheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);
    if (!customersSheet) {
      customersSheet = ss.insertSheet(CUSTOMERS_SHEET_NAME);
      customersSheet.appendRow(["الهاتف", "الاسم", "مجموع النقاط", "إجمالي الصرف"]);
    }

    if (newStatus === DELIVERED_STATUS) {
      creditOrderPoints(sheet, customersSheet, range.getRow());
    } else if (newStatus === CANCELLED_STATUS) {
      refundOrderPoints(sheet, customersSheet, range.getRow());
    }
  } catch (err) {
    // تجاهل أي خطأ حتى ما يوقف التعديل العادي بالجدول
  }
}

// ═══════════════════ قراءة البيانات ═══════════════════
function doGet(e) {
  if (e.parameter.customersList) {
    const customersSheet = getCustomersSheet();
    const lastRow = customersSheet.getLastRow();
    if (lastRow < 2) return jsonOut([]);
    const rows = customersSheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const customers = rows.map(function (row) {
      return { phone: row[0], name: row[1], points: row[2], totalSpend: row[3] };
    }).filter(function (c) { return String(c.phone).trim() !== ""; });
    return jsonOut(customers);
  }

  // ═══ قائمة النشطين — مين فاتح التطبيق الحين ومين دخل مؤخراً ═══
  if (e.parameter.activeUsers) {
    const vSheet = getVisitorsSheet();
    const lastRow = vSheet.getLastRow();
    if (lastRow < 2) return jsonOut({ onlineNow: 0, today: 0, active7d: 0, users: [] });

    const rows = vSheet.getRange(2, 1, lastRow - 1, VISITORS_NUM_COLS).getValues();
    const now = new Date();
    const onlineCutoff = new Date(now.getTime() - ONLINE_WINDOW_MINUTES * 60000);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

    let onlineNow = 0, today = 0, active7d = 0;
    const users = rows.map(function (r, i) {
      const last = r[VCOL_LAST - 1] ? new Date(r[VCOL_LAST - 1]) : null;
      const isOnline = last && last >= onlineCutoff;
      if (isOnline) onlineNow++;
      if (last && last >= todayStart) today++;
      if (last && last >= weekAgo) active7d++;
      const phone = String(r[VCOL_PHONE - 1] || "");
      return {
        visitorId: r[VCOL_ID - 1],
        label: String(r[VCOL_NAME - 1] || "").trim() || (phone ? phone : "زائر #" + (i + 1)),
        name: r[VCOL_NAME - 1] || "",
        phone: phone,
        known: phone !== "",
        firstSeen: r[VCOL_FIRST - 1],
        lastSeen: r[VCOL_LAST - 1],
        visits: Number(r[VCOL_VISITS - 1]) || 0,
        installed: String(r[VCOL_INSTALLED - 1] || "").trim() === "نعم",
        approxLocation: r[VCOL_LOC - 1] || "",
        online: !!isOnline
      };
    }).filter(function (u) { return u.lastSeen; });

    users.sort(function (a, b) { return new Date(b.lastSeen) - new Date(a.lastSeen); });

    return jsonOut({
      onlineNow: onlineNow, today: today, active7d: active7d,
      total: users.length,
      onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
      users: users.slice(0, 200)
    });
  }

  // ملخّص الاستخدام — يجي من ورقة Visitors الجاهزة (سريع)
  if (e.parameter.analyticsSummary) {
    const vSheet = getVisitorsSheet();
    const vLast = vSheet.getLastRow();
    let uniqueVisitors = 0, activeVisitors7d = 0, installs = 0,
        visits = 0, visitsToday = 0, installsToday = 0, onlineNow = 0;

    if (vLast >= 2) {
      const rows = vSheet.getRange(2, 1, vLast - 1, VISITORS_NUM_COLS).getValues();
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const onlineCutoff = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60000);
      rows.forEach(function (r) {
        const last = r[VCOL_LAST - 1] ? new Date(r[VCOL_LAST - 1]) : null;
        const first = r[VCOL_FIRST - 1] ? new Date(r[VCOL_FIRST - 1]) : null;
        uniqueVisitors++;
        visits += Number(r[VCOL_VISITS - 1]) || 0;
        if (last && last >= weekAgo) activeVisitors7d++;
        if (last && last >= onlineCutoff) onlineNow++;
        if (last && last >= todayStart) visitsToday++;
        if (String(r[VCOL_INSTALLED - 1] || "").trim() === "نعم") {
          installs++;
          if (first && first >= todayStart) installsToday++;
        }
      });
    }
    return jsonOut({
      visits: visits, installs: installs,
      visitsToday: visitsToday, installsToday: installsToday,
      uniqueVisitors: uniqueVisitors,
      activeVisitors7d: activeVisitors7d,
      onlineNow: onlineNow
    });
  }

  if (e.parameter.checkPoints) {
    const customersSheet = getCustomersSheet();
    const target = normalizePhone(e.parameter.checkPoints);
    const lastRow = customersSheet.getLastRow();
    let points = 0;
    if (lastRow >= 2 && target !== "") {
      const data = customersSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (let i = 0; i < data.length; i++) {
        if (normalizePhone(data[i][0]) === target) {
          points = Number(data[i][2]) || 0;
          break;
        }
      }
    }
    return jsonOut({
      points: points,
      redeemableValue: Math.floor(points / 10) * IQD_PER_10_POINTS
    });
  }

  const ordersSheet = getOrdersSheet();
  const lastRow = ordersSheet.getLastRow();

  if (e.parameter.orderStatus) {
    const target = normalizePhone(e.parameter.orderStatus);
    if (lastRow < 2 || target === "") return jsonOut({ found: false });
    const rows = ordersSheet.getRange(2, 1, lastRow - 1, ORDERS_NUM_COLS).getValues();
    let latest = null;
    rows.forEach(function (row) {
      if (normalizePhone(row[COL_PHONE - 1]) === target) {
        if (!latest || new Date(row[0]) > new Date(latest[0])) latest = row;
      }
    });
    if (!latest) return jsonOut({ found: false });
    return jsonOut({
      found: true,
      time: latest[COL_TIME - 1],
      items: latest[COL_ITEMS - 1],
      subtotal: latest[COL_SUBTOTAL - 1],
      total: latest[COL_TOTAL - 1],
      deliveryFee: latest[COL_DELIVERY_FEE - 1],
      seqNo: latest[COL_SEQ_NO - 1],
      status: latest[COL_STATUS - 1] || DEFAULT_STATUS
    });
  }

  if (lastRow < 2) {
    if (e.parameter.checkPhone) return jsonOut({ hasOrdered: false });
    return jsonOut([]);
  }

  const rows = ordersSheet.getRange(2, 1, lastRow - 1, ORDERS_NUM_COLS).getValues();

  if (e.parameter.checkPhone) {
    const target = normalizePhone(e.parameter.checkPhone);
    const found = rows.some(function (row) {
      return normalizePhone(row[COL_PHONE - 1]) === target && target !== "";
    });
    return jsonOut({ hasOrdered: found });
  }

  // القائمة الكاملة = كل بيانات زبائنك ومواقعهم — أخطر شي بالرابط

  // نرجّع طلبات نافذة زمنية بس. اللوحة تعرض آخر 30 وتحسب إحصائيات
  // اليوم/الأسبوع/الشهر — فـ 40 يوم تغطيها كلها، والرد ما ينتفخ مع
  // نمو السجل. ?days=0 يرجّع الكل لو احتجته.
  const daysParam = e.parameter.days === undefined ? 40 : Number(e.parameter.days);
  let windowRows = rows;
  if (daysParam > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysParam);
    windowRows = rows.filter(function (row) {
      const t = row[COL_TIME - 1];
      return t && new Date(t) >= cutoff;
    });
  }

  const orders = windowRows.map(function (row) {
    return {
      time: row[COL_TIME - 1],
      name: row[COL_NAME - 1],
      phone: row[COL_PHONE - 1],
      address: row[COL_ADDRESS - 1],
      approxLocation: row[COL_APPROX_LOC - 1],
      items: row[COL_ITEMS - 1],
      total: row[COL_TOTAL - 1],
      notes: row[COL_NOTES - 1],
      firstOrder: row[COL_FIRST_ORDER - 1],
      pointsEarned: row[COL_POINTS_EARNED - 1],
      pointsUsed: row[COL_POINTS_USED - 1],
      status: row[COL_STATUS - 1],
      referredBy: row[COL_REFERRED_BY - 1],
      pointsProcessed: row[COL_POINTS_PROCESSED - 1],
      orderId: row[COL_ORDER_ID - 1],
      seqNo: row[COL_SEQ_NO - 1],
      subtotal: row[COL_SUBTOTAL - 1],
      deliveryFee: row[COL_DELIVERY_FEE - 1],
      flag: row[COL_FLAG - 1]
    };
  });
  return jsonOut(orders);
}

// ═══════════════════ الترحيل (شغّلها مرة وحدة) ═══════════════════
/**
 * توحّد كل الأرقام المخزونة وتدمج الزبائن المكرّرين (اللي انقسموا
 * بين 07... و 78...). النقاط والصرف تُجمع، وما ينحذف أي طلب.
 *
 * ⚠️ خذ نسخة من الـ Sheet قبل التشغيل (File ← Make a copy).
 */
function migratePhoneNumbers() {
  const report = [];

  // 1) Orders: الهاتف ورقم المُحيل
  const orders = getOrdersSheet();
  const oLast = orders.getLastRow();
  let changed = 0;
  if (oLast >= 2) {
    const ph = orders.getRange(2, COL_PHONE, oLast - 1, 1).getValues();
    const rf = orders.getRange(2, COL_REFERRED_BY, oLast - 1, 1).getValues();
    for (let i = 0; i < ph.length; i++) {
      const np = normalizePhone(ph[i][0]);
      if (np && np !== String(ph[i][0])) { ph[i][0] = np; changed++; }
      const nr = normalizePhone(rf[i][0]);
      if (nr) rf[i][0] = nr;
    }
    orders.getRange(2, COL_PHONE, oLast - 1, 1).setValues(ph);
    orders.getRange(2, COL_REFERRED_BY, oLast - 1, 1).setValues(rf);
  }
  report.push("الطلبات: وُحّد " + changed + " رقم");

  // 2) Customers: توحيد + دمج المكرّر (يجمع النقاط والصرف)
  const cust = getCustomersSheet();
  const cLast = cust.getLastRow();
  let mergedCount = 0;
  if (cLast >= 2) {
    const rows = cust.getRange(2, 1, cLast - 1, 4).getValues();
    const byPhone = {}, order = [];
    rows.forEach(function (r) {
      const p = normalizePhone(r[0]);
      if (!p) return;
      if (!byPhone[p]) {
        byPhone[p] = { phone: p, name: r[1] || "",
                       points: Number(r[2]) || 0, spend: Number(r[3]) || 0 };
        order.push(p);
      } else {
        byPhone[p].points += Number(r[2]) || 0;
        byPhone[p].spend  += Number(r[3]) || 0;
        if (!byPhone[p].name && r[1]) byPhone[p].name = r[1];
        mergedCount++;
      }
    });
    const out = order.map(function (k) {
      const c = byPhone[k];
      return [c.phone, c.name, c.points, c.spend];
    });
    cust.getRange(2, 1, cLast - 1, 4).clearContent();
    if (out.length) cust.getRange(2, 1, out.length, 4).setValues(out);
  }
  report.push("الزبائن: اندمج " + mergedCount + " سطر مكرّر");

  // 3) CustomerDevices
  const dev = getCustomerDevicesSheet();
  const dLast = dev.getLastRow();
  if (dLast >= 2) {
    const dp = dev.getRange(2, 1, dLast - 1, 1).getValues();
    for (let j = 0; j < dp.length; j++) {
      const n = normalizePhone(dp[j][0]);
      if (n) dp[j][0] = n;
    }
    dev.getRange(2, 1, dLast - 1, 1).setValues(dp);
  }
  report.push("أجهزة الزبائن: وُحّدت");

  // 4) Visitors
  const vis = getVisitorsSheet();
  const vLast = vis.getLastRow();
  if (vLast >= 2) {
    const vp = vis.getRange(2, VCOL_PHONE, vLast - 1, 1).getValues();
    for (let k = 0; k < vp.length; k++) {
      const n = normalizePhone(vp[k][0]);
      if (n) vp[k][0] = n;
    }
    vis.getRange(2, VCOL_PHONE, vLast - 1, 1).setValues(vp);
  }
  report.push("الزوار: وُحّدت");

  report.forEach(function (l) { Logger.log(l); });
  return report.join("\n");
}

/**
 * يبني ورقة Visitors من سجل Analytics القديم — شغّلها مرة وحدة بعد
 * الترحيل حتى قائمة النشطين تطلع فيها بيانات من أول يوم.
 */
function backfillVisitorsFromAnalytics() {
  const aSheet = getAnalyticsSheet();
  const aLast = aSheet.getLastRow();
  if (aLast < 2) { Logger.log("ما فيه سجل Analytics"); return; }

  const rows = aSheet.getRange(2, 1, aLast - 1, 4).getValues();
  const byId = {};
  rows.forEach(function (r) {
    const id = String(r[3] || "").trim();
    if (!id) return;
    const t = new Date(r[0]);
    if (!byId[id]) {
      byId[id] = { id: id, first: t, last: t, visits: 0, installed: false, loc: r[2] || "" };
    }
    if (t < byId[id].first) byId[id].first = t;
    if (t > byId[id].last) byId[id].last = t;
    if (r[1] === "install") byId[id].installed = true; else byId[id].visits++;
    if (r[2]) byId[id].loc = r[2];
  });

  const vSheet = getVisitorsSheet();
  const existing = {};
  const vLast = vSheet.getLastRow();
  if (vLast >= 2) {
    vSheet.getRange(2, VCOL_ID, vLast - 1, 1).getValues().forEach(function (r) {
      existing[String(r[0])] = true;
    });
  }

  const out = [];
  Object.keys(byId).forEach(function (id) {
    if (existing[id]) return;
    const v = byId[id];
    out.push([id, "", "", v.first, v.last, v.visits, v.installed ? "نعم" : "لا", v.loc]);
  });

  if (out.length) {
    vSheet.getRange(vSheet.getLastRow() + 1, 1, out.length, VISITORS_NUM_COLS).setValues(out);
  }
  Logger.log("انضاف " + out.length + " زائر لورقة Visitors");
  return out.length;
}

// ═══════════════════ أدوات فحص ═══════════════════
// شغّلها من المحرر (زر ▶) وشوف النتيجة بـ Execution log
function testFirebaseSetup() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty("FIREBASE_CLIENT_EMAIL");
  const key = props.getProperty("FIREBASE_PRIVATE_KEY");
  const proj = props.getProperty("FIREBASE_PROJECT_ID");

  Logger.log("CLIENT_EMAIL: " + (email ? "✅ موجود — " + email : "❌ ناقص"));
  Logger.log("PRIVATE_KEY: " + (key ? "✅ موجود — طوله " + key.length : "❌ ناقص"));
  Logger.log("PROJECT_ID: " + (proj ? "✅ موجود — " + proj : "❌ ناقص"));

  if (!email || !key || !proj) { Logger.log("⛔ توقف — كمّل الناقص أول"); return; }

  try {
    const t = getFcmAccessToken();
    Logger.log(t ? "✅ رمز الدخول من Google نجح" : "❌ فشل جلب رمز الدخول");
  } catch (e) {
    Logger.log("❌ خطأ: " + e);
  }

  Logger.log("أجهزة الأدمن المسجّلة: " + Math.max(0, getDevicesSheet().getLastRow() - 1));
  Logger.log("أجهزة الزبائن المسجّلة: " + Math.max(0, getCustomerDevicesSheet().getLastRow() - 1));
  Logger.log("الزبائن بالجدول: " + Math.max(0, getCustomersSheet().getLastRow() - 1));
  Logger.log("الزوار المتتبَّعين: " + Math.max(0, getVisitorsSheet().getLastRow() - 1));
  Logger.log("إعدادات المتجر: " + JSON.stringify(getStoreSettings()));
  const pr = getProductPrices();
  if (!pr) Logger.log("قائمة الأسعار: ❌ تعذّر الجلب ولا فيه نسخة احتياطية");
  else Logger.log("قائمة الأسعار: " + (pr.stale ? "⚠️ احتياطية (" + pr.reason + ") — " : "✅ ") +
                  Object.keys(pr.map).length + " منتج");
}

// فحص شامل: يتأكد إن التوحيد والحساب يشتغلون صح
function testCalculations() {
  Logger.log("═══ توحيد الأرقام ═══");
  const cases = ["07801234567", "7801234567", "+9647801234567", "٠٧٨٠١٢٣٤٥٦٧", "0780 123 4567"];
  cases.forEach(function (c) {
    Logger.log(c + " → " + normalizePhone(c) + (isValidPhone(c) ? " ✅" : " ❌"));
  });

  Logger.log("═══ حساب السلة ═══");
  const pr = getProductPrices();
  if (!pr) { Logger.log("❌ ما وصلت قائمة الأسعار"); return; }
  if (pr.stale) Logger.log("⚠️ أسعار احتياطية — سبب فشل الجلب: " + pr.reason);
  const prices = pr.map;
  const ids = Object.keys(prices).slice(0, 2);
  const lines = ids.map(function (id) { return { id: id, qty: 2 }; });
  const calc = computeSubtotalFromLines(lines);
  Logger.log("عينة: " + JSON.stringify(lines));
  Logger.log("النتيجة: " + JSON.stringify(calc));
  let expected = 0;
  ids.forEach(function (id) { expected += prices[id].price * 2; });
  Logger.log(calc.subtotal === expected ? "✅ الحساب صحيح" : "❌ متوقع " + expected);

  Logger.log("═══ رفض المنتج المجهول ═══");
  Logger.log(JSON.stringify(computeSubtotalFromLines([{ id: "لا-يوجد", qty: 1 }])));
}

// تجربة إرسال جماعي للزبائن مباشرة من المحرر
function testCustomerBroadcast() {
  const r = sendPushToAllCustomerDevices("🌿 تجربة", "هذا إشعار تجريبي من جنة الفواكه والخضار");
  Logger.log("النتيجة: " + JSON.stringify(r));
}

/**
 * ⚠️ خطوة إعداد يدوية مطلوبة مرة وحدة عشان onEdit تشتغل:
 * 1. بمحرر Apps Script، من القائمة الجانبية اضغط أيقونة الساعة (Triggers)
 * 2. اضغط "+ Add Trigger"
 * 3. اختار الدالة: onEdit
 * 4. Event source: From spreadsheet
 * 5. Event type: On edit
 * 6. احفظ ووافق على الصلاحيات إذا طلبت منك
 */

/**
 * تشخيص جلب الأسعار — شغّلها لو طلع تنبيه "تعذّر جلب قائمة الأسعار".
 * تبيّن بالضبط شنو يرجّع الرابط للسيرفر.
 */
function testProductFetch() {
  const url = PRODUCTS_URL + "?t=" + Date.now();
  Logger.log("الرابط: " + url);
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const code = res.getResponseCode();
    const body = res.getContentText();
    Logger.log("رمز الرد: " + code + (code === 200 ? " ✅" : " ❌"));
    Logger.log("طول الرد: " + body.length + " حرف");
    Logger.log("أول 200 حرف: " + body.substring(0, 200));
    if (code === 200) {
      try {
        const arr = JSON.parse(body);
        Logger.log(Array.isArray(arr) ? "✅ قائمة صحيحة — " + arr.length + " منتج"
                                      : "❌ الرد مو مصفوفة");
      } catch (e) { Logger.log("❌ الرد مو JSON صحيح: " + e); }
    }
  } catch (e) {
    Logger.log("❌ فشل الاتصال كلياً: " + e);
  }
  const props = PropertiesService.getScriptProperties();
  Logger.log("آخر خطأ مسجّل: " + (props.getProperty("prices-last-error") || "ما فيه"));
  Logger.log("نسخة احتياطية محفوظة: " + (props.getProperty("prices-backup") ? "✅ موجودة" : "❌ ما موجودة"));
}

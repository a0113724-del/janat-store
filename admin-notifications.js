// admin-notifications.js
// ملف مستقل يدير إشعارات صفحة الأدمن
// ارفع هذا الملف بجذر المستودع (نفس مكان admin.html)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyDTdGzpr7SLK79m0UVqrwKfEyWHfD7HYeE",
  authDomain: "janat-store-notifications.firebaseapp.com",
  projectId: "janat-store-notifications",
  storageBucket: "janat-store-notifications.firebasestorage.app",
  messagingSenderId: "262111878623",
  appId: "1:262111878623:web:6f26ec354fe4c205d2386a"
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);
const VAPID_KEY = "BBQ3ouOvUisn2yOROxBi4ZKeRIU-GQXIga4_KnLWViEMxgTdQOmOXc-wzGm32nyGr6aGZ-OQKPMtANAJvLnpU2Y";

async function setupNotifications() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      alert("لازم توافق على الإشعارات عشان توصلك تنبيهات الطلبات الجديدة");
      return;
    }

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    console.log("رمز الجهاز (Device Token):", token);
    // TODO: أرسل هذا الـtoken لدالة Apps Script عشان تخزنه بـ Google Sheet

    onMessage(messaging, (payload) => {
      alert("طلب جديد: " + (payload.notification?.body || ""));
    });

  } catch (err) {
    console.error("خطأ بإعداد الإشعارات:", err);
  }
}

setupNotifications();

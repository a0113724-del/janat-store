// firebase-messaging-sw.js
// هذا الملف لازم يكون بجذر الموقع (نفس مستوى index.html)
// وهو المسؤول عن استقبال الإشعارات حتى لو الصفحة/التطبيق مسكّر بالكامل

importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDTdGzpr7SLK79m0UVqrwKfEyWHfD7HYeE",
  authDomain: "janat-store-notifications.firebaseapp.com",
  projectId: "janat-store-notifications",
  storageBucket: "janat-store-notifications.firebasestorage.app",
  messagingSenderId: "262111878623",
  appId: "1:262111878623:web:6f26ec354fe4c205d2386a"
});

const messaging = firebase.messaging();

// يستقبل الإشعار وقت التطبيق مسكّر أو بالخلفية
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "طلب جديد 🛒";
  const options = {
    body: payload.notification?.body || "وصلك طلب جديد من الزبون",
    icon: "/icon-192.png", // غيّرها لمسار شعار متجرك إذا موجود
    badge: "/icon-192.png",
    vibrate: [200, 100, 200, 100, 200], // اهتزاز قوي يلفت الانتباه
    requireInteraction: true // يضل الإشعار ظاهر لين يضغط عليه المستخدم
  };
  self.registration.showNotification(title, options);
});

/**
 * SERVICE WORKER - SHINORA DEADLINE TRACKER
 * Chạy ngầm trong hệ điều hành để nhận Web Push Notifications kể cả khi đóng tab web
 */

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let payload = {
        title: '🔔 Shinora Deadline',
        message: 'Bạn có thông báo mới về hạn chót công việc!',
        url: '/deadline',
        type: 'info'
    };

    if (event.data) {
        try {
            payload = event.data.json();
        } catch (e) {
            payload.message = event.data.text();
        }
    }

    const options = {
        body: payload.message || '',
        vibrate: [200, 100, 200],
        data: {
            url: payload.url || '/deadline',
            deadlineId: payload.deadlineId || null
        },
        tag: payload.deadlineId ? `dl-${payload.deadlineId}` : `shinora-push-${Date.now()}`,
        renotify: true,
        requireInteraction: true // Ghim trên màn hình hệ thống cho đến khi người dùng nhấp hoặc đóng
    };

    event.waitUntil(
        self.registration.showNotification(payload.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification.data?.url || '/deadline';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Nếu đã có tab đang mở trang deadline thì focus vào tab đó
            for (const client of clientList) {
                if (client.url.includes('/deadline') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Nếu đóng web rồi thì tự động mở một tab mới đưa thẳng vào trang deadline
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});

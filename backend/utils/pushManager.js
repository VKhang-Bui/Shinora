/**
 * PUSH MANAGER UTILITY - SHINORA DEADLINE
 * Quản lý VAPID Keys và gửi Web Push Notification qua Google FCM / Trình duyệt
 */

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const vapidFilePath = path.join(__dirname, '../database/vapid.json');

let vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || ''
};

// Khởi tạo hoặc nạp VAPID Keys bền vững
function initVapidKeys() {
    if (vapidKeys.publicKey && vapidKeys.privateKey) {
        return vapidKeys;
    }

    if (fs.existsSync(vapidFilePath)) {
        try {
            const raw = fs.readFileSync(vapidFilePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.publicKey && parsed.privateKey) {
                vapidKeys = parsed;
                return vapidKeys;
            }
        } catch (e) {
            console.error('[WebPush] Lỗi đọc file vapid.json:', e.message);
        }
    }

    // Tự động sinh cặp khóa mới nếu chưa có
    try {
        const generated = webpush.generateVAPIDKeys();
        vapidKeys = {
            publicKey: generated.publicKey,
            privateKey: generated.privateKey
        };
        const dir = path.dirname(vapidFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(vapidFilePath, JSON.stringify(vapidKeys, null, 2), 'utf8');
        console.log('[WebPush] Đã tự động tạo và lưu cặp khóa VAPID mới tại:', vapidFilePath);
    } catch (e) {
        console.error('[WebPush] Lỗi khi tạo VAPID keys:', e.message);
    }

    return vapidKeys;
}

initVapidKeys();

const mailto = process.env.GMAIL_USER || 'mailto:vkhg.bui@gmail.com';
const subject = mailto.startsWith('mailto:') ? mailto : `mailto:${mailto}`;

if (vapidKeys.publicKey && vapidKeys.privateKey) {
    try {
        webpush.setVapidDetails(
            subject,
            vapidKeys.publicKey,
            vapidKeys.privateKey
        );
    } catch (e) {
        console.error('[WebPush] Lỗi thiết lập VAPID details:', e.message);
    }
}

/**
 * Gửi thông báo Push đến một Subscription
 * @param {Object} subscription - { endpoint, keys: { p256dh, auth } }
 * @param {Object} payload - { title, message, url, deadlineId, type }
 */
async function sendPush(subscription, payload) {
    if (!subscription || !subscription.endpoint) {
        throw new Error('Subscription không hợp lệ');
    }

    const pushPayload = JSON.stringify({
        title: payload.title || 'Thông báo Shinora Deadline',
        message: payload.message || '',
        url: payload.url || '/deadline',
        deadlineId: payload.deadlineId || null,
        type: payload.type || 'info',
        timestamp: Date.now()
    });

    return webpush.sendNotification(subscription, pushPayload, {
        TTL: 60 * 60 * 24 // Lưu giữ gói tin tối đa 24h nếu thiết bị offline
    });
}

module.exports = {
    getPublicKey: () => vapidKeys.publicKey,
    sendPush
};

// tests/test_vercel_push_api.js
// Kiểm thử trực tiếp Serverless Function api/push.js mô phỏng môi trường Vercel

const assert = require('assert');
const pushHandler = require('../api/push');

function createMockReqRes(method, url, body = {}, query = {}) {
    const req = {
        method,
        url,
        body,
        query,
        headers: {}
    };

    let statusCode = 200;
    let responseData = null;
    let headers = {};

    const res = {
        setHeader: (k, v) => { headers[k] = v; },
        status: (code) => {
            statusCode = code;
            return res;
        },
        json: (data) => {
            responseData = data;
            return res;
        },
        end: () => res
    };

    return { req, res, getResult: () => ({ statusCode, responseData, headers }) };
}

async function runTests() {
    console.log('--- BẮT ĐẦU KIỂM THỬ VERCEL SERVERLESS FUNCTION API/PUSH.JS ---');

    // 1. Test GET /api/push/vapid-key
    {
        const { req, res, getResult } = createMockReqRes('GET', '/api/push/vapid-key', {}, { action: 'vapid-key' });
        await pushHandler(req, res);
        const { statusCode, responseData } = getResult();
        assert.strictEqual(statusCode, 200, 'GET vapid-key phải trả về 200');
        assert.strictEqual(responseData.success, true, 'success phải là true');
        assert(typeof responseData.publicKey === 'string' && responseData.publicKey.length > 30, 'publicKey phải là chuỗi VAPID hợp lệ');
        console.log('✔ PASS: GET /api/push/vapid-key trả về 200 và VAPID key hợp lệ');
    }

    // 2. Test POST /api/push/subscribe thiếu dữ liệu
    {
        const { req, res, getResult } = createMockReqRes('POST', '/api/push/subscribe', {}, { action: 'subscribe' });
        await pushHandler(req, res);
        const { statusCode, responseData } = getResult();
        assert.strictEqual(statusCode, 400, 'Subscribe thiếu body phải trả về 400');
        assert.strictEqual(responseData.success, false);
        console.log('✔ PASS: POST /api/push/subscribe chặn request thiếu subscription');
    }

    // 3. Test POST /api/push/subscribe dữ liệu hợp lệ
    const mockSub = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/vercel-test-token-' + Date.now(),
        keys: {
            p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcDnVuIxGZhp0RTSBagP2EB0STQ1vpURv9ELHNAmeDPCo',
            auth: 'tBHItJI5svbpez7KI4CCXg'
        }
    };

    {
        const { req, res, getResult } = createMockReqRes('POST', '/api/push/subscribe', {
            subscription: mockSub,
            userId: 'user-test'
        }, { action: 'subscribe' });
        await pushHandler(req, res);
        const { statusCode, responseData } = getResult();
        assert.strictEqual(statusCode, 201, 'Subscribe hợp lệ phải trả về 201');
        assert.strictEqual(responseData.success, true);
        console.log('✔ PASS: POST /api/push/subscribe lưu subscription thành công HTTP 201');
    }

    // 4. Test POST /api/push/test
    {
        const { req, res, getResult } = createMockReqRes('POST', '/api/push/test', {
            subscription: mockSub,
            delaySeconds: 0,
            userId: 'user-test'
        }, { action: 'test' });
        await pushHandler(req, res);
        const { statusCode, responseData } = getResult();
        assert.strictEqual(statusCode, 200, 'Push test phải trả về 200');
        assert.strictEqual(responseData.success, true);
        console.log('✔ PASS: POST /api/push/test xử lý thành công HTTP 200');
    }

    // 5. Test POST /api/push/unsubscribe
    {
        const { req, res, getResult } = createMockReqRes('POST', '/api/push/unsubscribe', {
            endpoint: mockSub.endpoint
        }, { action: 'unsubscribe' });
        await pushHandler(req, res);
        const { statusCode, responseData } = getResult();
        assert.strictEqual(statusCode, 200, 'Unsubscribe phải trả về 200');
        assert.strictEqual(responseData.success, true);
        console.log('✔ PASS: POST /api/push/unsubscribe hủy subscription thành công HTTP 200');
    }

    console.log('=== TẤT CẢ TEST VERCEL SERVERLESS FUNCTION API/PUSH ĐỀU PASS 100%! ===');
}

runTests().catch(err => {
    console.error('Test thất bại:', err);
    process.exit(1);
});

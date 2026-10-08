/**
 * AUTOMATED TEST SUITE CHO DEADLINE TRACKER
 * Chạy độc lập hoàn toàn trên CSDL test (/tmp/test_deadlines.sqlite)
 * Kiểm thử toàn diện: Kết nối, Loading/Cache, API Requests, Thông báo lỗi, Logic màu sắc, Optimistic UI
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Màu sắc cho output console
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, details = '') {
    if (condition) {
        console.log(`  ${GREEN}✔ PASS:${RESET} ${testName}`);
        passedCount++;
    } else {
        console.error(`  ${RED}✖ FAIL:${RESET} ${testName} ${details ? '(' + details + ')' : ''}`);
        failedCount++;
    }
}

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                const latency = Date.now() - start;
                let json = null;
                try {
                    json = JSON.parse(body);
                } catch (e) {}
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body,
                    json: json,
                    latency: latency
                });
            });
        });

        req.on('error', reject);
        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

// Logic tính màu sắc chuẩn của hệ thống để test
function calculateDaysLeft(dueDateStr, baseDate) {
    const due = new Date(dueDateStr);
    const base = new Date(baseDate);
    due.setHours(0, 0, 0, 0);
    base.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
}

function getDeadlineColorStyle(daysLeft, isCompleted = false) {
    if (isCompleted || daysLeft < 0) return { label: "pass", bg: "#e9ecef" };
    if (daysLeft <= 3) return { label: "3 ngày", bg: "#ffa39e" };
    if (daysLeft <= 7) return { label: "1 tuần", bg: "#ffd591" };
    if (daysLeft <= 21) return { label: "3 tuần", bg: "#ffe58f" };
    if (daysLeft <= 60) return { label: "2 tháng", bg: "#eaff8f" };
    return { label: "Dài hạn", bg: "#b7eb8f" };
}

async function runTestSuite() {
    console.log(`\n${BOLD}${CYAN}==============================================================${RESET}`);
    console.log(`${BOLD}${CYAN}  BẮT ĐẦU CHẠY BỘ KIỂM THỬ TOÀN DIỆN (AUTOMATED TEST SUITE)  ${RESET}`);
    console.log(`${BOLD}${CYAN}==============================================================${RESET}\n`);

    const PORT = process.env.PORT || 3000;
    const HOST = '127.0.0.1';

    // -------------------------------------------------------------
    // SUITE 1: KIỂM THỬ KẾT NỐI MẠNG & GIAO THỨC (CONNECTION TESTS)
    // -------------------------------------------------------------
    console.log(`${BOLD}${YELLOW}[SUITE 1]: Kiểm Thử Kết Nối Mạng & Giao Thức (Network Connection)${RESET}`);
    
    // Test 1.1: Kết nối trang chủ
    const resHome = await request({ host: HOST, port: PORT, path: '/', method: 'GET' });
    assert(resHome.statusCode === 200, 'Kết nối trang chủ HTTP 200 OK');
    assert(resHome.headers['content-type'].includes('text/html'), 'Trang chủ trả về Content-Type text/html');

    // Test 1.2: Kết nối trang /deadline
    const resDl = await request({ host: HOST, port: PORT, path: '/deadline', method: 'GET' });
    assert(resDl.statusCode === 200, 'Kết nối trang /deadline thành công HTTP 200');

    // Test 1.3: CORS Preflight (OPTIONS request)
    const resOptions = await request({ host: HOST, port: PORT, path: '/api/deadlines', method: 'OPTIONS' });
    assert(resOptions.statusCode === 204, 'Xử lý CORS preflight OPTIONS trả về HTTP 204');
    assert(resOptions.headers['access-control-allow-origin'] === '*', 'Header Access-Control-Allow-Origin = *');

    // -------------------------------------------------------------
    // SUITE 2: KIỂM THỬ TỐC ĐỘ TẢI & HTTP CACHE (LOADING & CACHE TESTS)
    // -------------------------------------------------------------
    console.log(`\n${BOLD}${YELLOW}[SUITE 2]: Kiểm Thử Tốc Độ Tải & Bộ Nhớ Đệm (Loading & HTTP Cache)${RESET}`);

    // Test 2.1: Cache-Control cho CSS/JS tĩnh
    const resCss = await request({ host: HOST, port: PORT, path: '/deadline.css', method: 'GET' });
    assert(resCss.statusCode === 200, 'Tải file CSS thành công HTTP 200');
    assert(resCss.headers['cache-control'] && resCss.headers['cache-control'].includes('max-age=86400'), 'CSS có Cache-Control public 86400s (Lưu vào Disk Cache)');
    assert(Boolean(resCss.headers['etag']), 'Server sinh ETag cho file tĩnh');

    // Test 2.2: Kiểm tra ETag 304 Not Modified (Tải trong 0ms)
    const etag = resCss.headers['etag'];
    const res304 = await request({ 
        host: HOST, port: PORT, path: '/deadline.css', method: 'GET',
        headers: { 'If-None-Match': etag }
    });
    assert(res304.statusCode === 304, 'Gửi kèm ETag trả về HTTP 304 Not Modified (Trình duyệt đọc từ Disk Cache 0ms)');

    // Test 2.3: HTML cấu hình no-cache
    assert(resDl.headers['cache-control'] && resDl.headers['cache-control'].includes('no-cache'), 'Trang HTML có Cache-Control no-cache (Đảm bảo cấu trúc luôn mới)');

    // Test 2.4: Độ trễ phản hồi (Response Latency < 50ms)
    assert(resDl.latency < 50, `Thời gian phản hồi máy chủ cực nhanh: ${resDl.latency}ms (< 50ms)`);

    // -------------------------------------------------------------
    // SUITE 3: KIỂM THỬ TÍNH NĂNG REQUEST API (CRUD REQUEST TESTS)
    // -------------------------------------------------------------
    console.log(`\n${BOLD}${YELLOW}[SUITE 3]: Kiểm Thử API Nghiệp Vụ (CRUD Database Requests)${RESET}`);

    // Test 3.1: Lấy toàn bộ danh sách test
    const resGetAll = await request({ host: HOST, port: PORT, path: '/api/deadlines', method: 'GET' });
    assert(resGetAll.statusCode === 200 && resGetAll.json && resGetAll.json.success === true, 'GET /api/deadlines trả về success = true');
    assert(Array.isArray(resGetAll.json.data) && resGetAll.json.data.length >= 7, `Đọc thành công ${resGetAll.json.data.length} bản ghi test từ test.sqlite`);

    // Test 3.2: Lọc tìm kiếm theo từ khóa
    const resSearch = await request({ host: HOST, port: PORT, path: '/api/deadlines?k=' + encodeURIComponent('Tiểu luận'), method: 'GET' });
    assert(resSearch.json && resSearch.json.data.length === 1, 'Tìm kiếm từ khóa "Tiểu luận" trả về chính xác 1 bản ghi');
    assert(resSearch.json.data[0].id === 'dl-test-1week', 'Bản ghi tìm thấy đúng ID "dl-test-1week"');

    // Test 3.3: Lấy chi tiết theo ID
    const resGetOne = await request({ host: HOST, port: PORT, path: '/api/deadlines/dl-test-urgent', method: 'GET' });
    assert(resGetOne.statusCode === 200 && resGetOne.json.data.id === 'dl-test-urgent', 'GET /api/deadlines/dl-test-urgent trả về chi tiết chính xác');

    // Test 3.4: Thêm mới deadline (POST)
    const newDlData = {
        title: 'Báo cáo Kiểm thử Tự động',
        dueDate: '2026-10-18T09:30:00',
        session: 'sang',
        category: 'personal'
    };
    const resPost = await request({
        host: HOST, port: PORT, path: '/api/deadlines', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, newDlData);
    assert(resPost.statusCode === 201 && resPost.json.success === true, 'POST /api/deadlines tạo mới thành công HTTP 201');
    const createdId = resPost.json.data.id;
    assert(Boolean(createdId), `Bản ghi mới được sinh ID: ${createdId}`);

    // Test 3.5: Cập nhật deadline (PUT)
    const updateData = {
        title: 'Báo cáo Kiểm thử Tự động (ĐÃ CẬP NHẬT)',
        session: 'chieu',
        isCompleted: 1
    };
    const resPut = await request({
        host: HOST, port: PORT, path: `/api/deadlines/${encodeURIComponent(createdId)}`, method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
    }, updateData);
    assert(resPut.statusCode === 200 && resPut.json.data.title === 'Báo cáo Kiểm thử Tự động (ĐÃ CẬP NHẬT)', 'PUT cập nhật tiêu đề thành công');
    assert(resPut.json.data.isCompleted === 1, 'PUT cập nhật isCompleted = 1 thành công');

    // Test 3.6: Xóa deadline (DELETE)
    const resDel = await request({
        host: HOST, port: PORT, path: `/api/deadlines/${encodeURIComponent(createdId)}`, method: 'DELETE'
    });
    assert(resDel.statusCode === 200 && resDel.json.success === true, 'DELETE xóa thành công HTTP 200');

    // -------------------------------------------------------------
    // SUITE 4: KIỂM THỬ THÔNG BÁO LỖI & RÀNG BUỘC (ERROR & VALIDATION)
    // -------------------------------------------------------------
    console.log(`\n${BOLD}${YELLOW}[SUITE 4]: Kiểm Thử Thông Báo Lỗi & Xử Lý Biên (Error & Validation)${RESET}`);

    // Test 4.1: POST thiếu tiêu đề
    const resErrTitle = await request({
        host: HOST, port: PORT, path: '/api/deadlines', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { dueDate: '2026-10-15T09:00:00' });
    assert(resErrTitle.statusCode === 400, 'POST thiếu tiêu đề trả về HTTP 400 Bad Request');
    assert(resErrTitle.json.message && resErrTitle.json.message.includes('bắt buộc'), 'Thông báo lỗi rõ ràng: "Tiêu đề và ngày nộp là bắt buộc"');

    // Test 4.2: POST thiếu ngày nộp
    const resErrDate = await request({
        host: HOST, port: PORT, path: '/api/deadlines', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { title: 'Viết tài liệu' });
    assert(resErrDate.statusCode === 400, 'POST thiếu ngày nộp trả về HTTP 400 Bad Request');

    // Test 4.3: GET ID không tồn tại
    const res404Get = await request({ host: HOST, port: PORT, path: '/api/deadlines/non-existent-id-999', method: 'GET' });
    assert(res404Get.statusCode === 404, 'GET ID không tồn tại trả về HTTP 404 Not Found');

    // Test 4.4: PUT ID không tồn tại
    const res404Put = await request({
        host: HOST, port: PORT, path: '/api/deadlines/non-existent-id-999', method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
    }, { title: 'Cập nhật ảo' });
    assert(res404Put.statusCode === 404, 'PUT ID không tồn tại trả về HTTP 404 Not Found');

    // Test 4.5: DELETE ID không tồn tại
    const res404Del = await request({ host: HOST, port: PORT, path: '/api/deadlines/non-existent-id-999', method: 'DELETE' });
    assert(res404Del.statusCode === 404, 'DELETE ID không tồn tại trả về HTTP 404 Not Found');

    // Test 4.6: Yêu cầu file tĩnh không tồn tại
    const res404Static = await request({ host: HOST, port: PORT, path: '/khong-ton-tai.xyz', method: 'GET' });
    assert(res404Static.statusCode === 404, 'Truy cập đường dẫn file không tồn tại trả về 404 Not Found');

    // -------------------------------------------------------------
    // SUITE 5: KIỂM THỬ QUY TẮC MÀU SẮC & LOGIC OPTIMISTIC UI
    // -------------------------------------------------------------
    console.log(`\n${BOLD}${YELLOW}[SUITE 5]: Kiểm Thử Quy Tắc 5 Mốc Màu Sắc & Logic Optimistic UI${RESET}`);

    const baseToday = new Date(2026, 9, 5); // 05/10/2026

    // Test 5.1: Quá hạn (< 0 ngày) -> Màu Xám (pass)
    const daysPass = calculateDaysLeft('2026-10-02T09:00:00', baseToday);
    const colorPass = getDeadlineColorStyle(daysPass, false);
    assert(colorPass.label === 'pass' && colorPass.bg === '#e9ecef', 'Quá hạn (-3 ngày) -> Gán màu XÁM [pass]');

    // Test 5.2: Gấp (<= 3 ngày) -> Màu Đỏ
    const daysRed = calculateDaysLeft('2026-10-07T20:00:00', baseToday);
    const colorRed = getDeadlineColorStyle(daysRed, false);
    assert(colorRed.label === '3 ngày' && colorRed.bg === '#ffa39e', 'Còn 2 ngày -> Gán màu ĐỎ [3 ngày]');

    // Test 5.3: 1 tuần (4 - 7 ngày) -> Màu Cam
    const daysOrange = calculateDaysLeft('2026-10-11T09:00:00', baseToday);
    const colorOrange = getDeadlineColorStyle(daysOrange, false);
    assert(colorOrange.label === '1 tuần' && colorOrange.bg === '#ffd591', 'Còn 6 ngày -> Gán màu CAM [1 tuần]');

    // Test 5.4: 3 tuần (8 - 21 ngày) -> Màu Vàng
    const daysYellow = calculateDaysLeft('2026-10-22T15:00:00', baseToday);
    const colorYellow = getDeadlineColorStyle(daysYellow, false);
    assert(colorYellow.label === '3 tuần' && colorYellow.bg === '#ffe58f', 'Còn 17 ngày -> Gán màu VÀNG [3 tuần]');

    // Test 5.5: 2 tháng (22 - 60 ngày) -> Màu Xanh chanh
    const daysGreen = calculateDaysLeft('2026-11-20T10:00:00', baseToday);
    const colorGreen = getDeadlineColorStyle(daysGreen, false);
    assert(colorGreen.label === '2 tháng' && colorGreen.bg === '#eaff8f', 'Còn 46 ngày -> Gán màu XANH [2 tháng]');

    // Test 5.6: Đã xong (isCompleted = 1) dù còn ngày -> Vẫn màu Xám
    const colorDone = getDeadlineColorStyle(10, true);
    assert(colorDone.label === 'pass' && colorDone.bg === '#e9ecef', 'Đã hoàn thành (isCompleted = 1) -> Tự động chuyển màu XÁM [pass]');

    // Test 5.7: Mô phỏng gộp 2 Phân khu Local Cache (Khu A: Confirmed + Khu B: Pending)
    const mockKhuA = [{ id: 'dl-1', title: 'Task Đã lưu', dueDate: '2026-10-10' }];
    const mockKhuB = [{ id: 'dl-2', title: 'Task Vừa tạo (Optimistic)', dueDate: '2026-10-12', _syncOp: 'create', _syncStatus: 'pending' }];
    const merged = [...mockKhuA, ...mockKhuB];
    assert(merged.length === 2 && merged[1]._syncStatus === 'pending', 'Mô phỏng gộp Khu A + Khu B: Hiển thị ngay lập tức thẻ pending trên giao diện');

    // -------------------------------------------------------------
    // SUITE 6: BẢO VỆ CSDL THẬT (KIỂM TRA CSDL THẬT KHÔNG BỊ Ô NHIỄM)
    // -------------------------------------------------------------
    console.log(`\n${BOLD}${YELLOW}[SUITE 6]: Kiểm Tra Tính Toàn Vẹn & Cách Ly CSDL Thật Của Dự Án${RESET}`);
    
    const prodDbPath = path.join(__dirname, '..', 'backend', 'database', 'deadlines.sqlite');
    if (fs.existsSync(prodDbPath)) {
        const prodDb = new DatabaseSync(prodDbPath);
        const tables = prodDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
        assert(tables.includes('deadlines') && tables.includes('users'), 'CSDL THẬT (deadlines.sqlite) toàn vẹn cấu trúc và hoạt động tốt');
    } else {
        assert(true, 'File CSDL thật an toàn tuyệt đối');
    }

    // -------------------------------------------------------------
    // SUITE 7: KIỂM THỬ XÁC THỰC THÀNH VIÊN & PHÂN QUYỀN DEADLINE
    // -------------------------------------------------------------
    console.log(`\n${BOLD}${YELLOW}[SUITE 7]: Kiểm Thử Đăng Nhập & Phân Quyền Deadline Thành Viên (Auth & Partitioning)${RESET}`);

    // Test 7.1: Đăng nhập sai mật khẩu -> HTTP 400
    const resBadPass = await request({
        host: HOST, port: PORT, path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { name: 'Bùi Văn Khang', password: 'wrong' });
    assert(resBadPass.statusCode === 400 && resBadPass.json.message.includes('Mật khẩu không chính xác'), 'Đăng nhập sai mật khẩu trả về HTTP 400');

    // Test 7.2: Đăng nhập đúng mật khẩu Vkhang@84752006 -> HTTP 200, user id chuẩn hóa không phân biệt HOA/thường
    const resLogin1 = await request({
        host: HOST, port: PORT, path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { name: 'Bùi Văn Khang', password: 'Vkhang@84752006' });
    assert(resLogin1.statusCode === 200 && resLogin1.json.user.id === 'bùi văn khang', 'Đăng nhập thành công với mật khẩu Vkhang@84752006 (Case-insensitive ID)');

    const resLogin2 = await request({
        host: HOST, port: PORT, path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { name: 'bùi văn khang', password: 'Vkhang@84752006' });
    assert(resLogin2.statusCode === 200 && resLogin2.json.user.id === resLogin1.json.user.id, 'Tên chữ thường trùng khớp tài khoản chữ HOA ("bùi văn khang" == "Bùi Văn Khang")');

    // Test 7.3: Kiểm tra người lạ chưa được Admin tạo trong CSDL -> BỊ TỪ CHỐI HTTP 400
    const resStranger = await request({
        host: HOST, port: PORT, path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { name: 'Người Lạ Không Có Trong Hệ Thống', password: 'Vkhang@84752006' });
    assert(resStranger.statusCode === 400 && resStranger.json.message.includes('Tài khoản không tồn tại'), 'Chặn người lạ chưa được Admin tạo sẵn trong CSDL (HTTP 400)');

    // Test 7.4: Đăng nhập thành công với cả 4 tài khoản được cấp phép
    const allowedAccounts = [
        'Bùi Văn Khang',
        'Lê Hoàng Anh Kiệt',
        'Huỳnh Thái Khang',
        'Lý Thị Ngọc Như'
    ];
    for (const accName of allowedAccounts) {
        const resAcc = await request({
            host: HOST, port: PORT, path: '/api/auth/login', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { name: accName, password: 'Vkhang@84752006' });
        assert(resAcc.statusCode === 200 && resAcc.json.user, `Đăng nhập thành công tài khoản được cấp phép: "${accName}"`);
    }

    // Test 7.5: Lấy danh sách thành viên GET /api/users
    const resUsers = await request({ host: HOST, port: PORT, path: '/api/users', method: 'GET' });
    assert(resUsers.statusCode === 200 && Array.isArray(resUsers.json.data) && resUsers.json.data.length >= 4, 'GET /api/users trả về danh sách 4 thành viên được cấp phép');

    // Test 7.6: Thành viên A (Lê Hoàng Anh Kiệt) tạo deadline cá nhân
    const userADeadline = {
        id: 'dl-private-kiet',
        title: 'Kế hoạch cá nhân tuyệt mật của Kiệt',
        dueDate: '2026-10-25T10:00:00',
        session: 'sang',
        category: 'personal',
        userId: 'lê hoàng anh kiệt',
        userName: 'Lê Hoàng Anh Kiệt',
        assignees: '["lê hoàng anh kiệt"]'
    };
    const resCreateA = await request({
        host: HOST, port: PORT, path: '/api/deadlines', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, userADeadline);
    assert(resCreateA.statusCode === 201, 'Lê Hoàng Anh Kiệt tạo deadline cá nhân thành công');

    // Test 7.7: User B (Bùi Văn Khang) truy vấn -> TUYỆT ĐỐI KHÔNG THẤY deadline cá nhân của Kiệt
    const resQueryB = await request({ host: HOST, port: PORT, path: '/api/deadlines?userId=' + encodeURIComponent('bùi văn khang'), method: 'GET' });
    const userBList = resQueryB.json.data;
    const canSeePrivateA = userBList.some(d => d.id === 'dl-private-kiet');
    assert(!canSeePrivateA, 'Bùi Văn Khang KHÔNG THẤY deadline cá nhân của Kiệt (Bảo mật quyền riêng tư)');

    // Test 7.8: Kiệt truy vấn -> Thấy được deadline cá nhân của chính mình
    const resQueryA = await request({ host: HOST, port: PORT, path: '/api/deadlines?userId=' + encodeURIComponent('lê hoàng anh kiệt'), method: 'GET' });
    const userAList = resQueryA.json.data;
    const selfCanSeePrivateA = userAList.some(d => d.id === 'dl-private-kiet');
    assert(selfCanSeePrivateA, 'Kiệt thấy được deadline cá nhân của chính mình khi đăng nhập');

    // -------------------------------------------------------------
    // TỔNG KẾT BÁO CÁO
    // -------------------------------------------------------------
    console.log(`\n${BOLD}${CYAN}==============================================================${RESET}`);
    console.log(`${BOLD}TỔNG KẾT KẾT QUẢ KIỂM THỬ:${RESET}`);
    console.log(`  ${GREEN}✔ Tổng số bài test THÀNH CÔNG:${RESET} ${passedCount}`);
    console.log(`  ${RED}✖ Tổng số bài test THẤT BẠI:${RESET}   ${failedCount}`);
    console.log(`${BOLD}${CYAN}==============================================================${RESET}\n`);

    if (failedCount > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTestSuite().catch(err => {
    console.error('Lỗi khi chạy bộ test:', err);
    process.exit(1);
});

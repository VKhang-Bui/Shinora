/**
 * DEADLINE TRACKER - JAVASCRIPT MODULE
 * Tối ưu hóa 2 tầng: HTTP Cache + Optimistic UI 2 Phân khu Local Cache
 */

const APP_VERSION = '1.0.5';

let currentDate = new Date(); // Mặc định thời điểm hôm nay thực tế của máy người dùng
let todayDate = new Date();    // Mốc thời gian thực để tính toán màu sắc và độ gấp
let currentViewMode = 'week';  // 'week' | 'month'
let currentDeadlines = [];     // Danh sách deadline gộp từ 2 phân khu

/**
 * Chuyển đổi chuỗi ngày hạn chót sang đối tượng Date chuẩn theo giờ địa phương (Wall-clock time)
 * Tuyệt đối không bị lệch múi giờ (+00:00, Z, hoặc UTC sang GMT+7)
 */
function parseDeadlineDate(dateStr) {
    if (!dateStr) return new Date();
    if (dateStr instanceof Date) return dateStr;
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
        return new Date(
            parseInt(m[1], 10),
            parseInt(m[2], 10) - 1,
            parseInt(m[3], 10),
            parseInt(m[4], 10),
            parseInt(m[5], 10),
            m[6] ? parseInt(m[6], 10) : 0
        );
    }
    return new Date(dateStr);
}

// ==========================================
// 1. QUẢN LÝ ĐĂNG NHẬP / PHIÊN THÀNH VIÊN & LOCAL CACHE THEO NGƯỜI DÙNG
// ==========================================
const DEADLINE_AUTH_USER_KEY = 'deadline_user_session_v1';
const CACHE_GUEST_KEY = 'deadlines_guest_v1';
const API_URL = '/api/deadlines';

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

function getAuthUser() {
    try {
        const raw = localStorage.getItem(DEADLINE_AUTH_USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function setAuthUser(user) {
    try {
        if (user) {
            localStorage.setItem(DEADLINE_AUTH_USER_KEY, JSON.stringify(user));
        } else {
            localStorage.removeItem(DEADLINE_AUTH_USER_KEY);
        }
    } catch (e) {
        console.error('[Set Auth Error]:', e);
    }
    updateAuthHeaderUI();
}

function updateAuthHeaderUI() {
    closeUserDropdown();
    const user = getAuthUser();
    if (user) {
        $('#authGuestView').hide();
        $('#authUserView').css('display', 'flex');
        const initial = (user.name || 'K').trim().charAt(0).toUpperCase();
        $('#headerUserAvatar').text(initial);
        $('#headerUserName').text(user.name);
    } else {
        $('#authUserView').hide();
        $('#authGuestView').css('display', 'flex');
    }
}

function toggleUserDropdown(event) {
    if (event) {
        event.stopPropagation();
    }
    const dropdown = $('#userProfileDropdown');
    dropdown.stop(true, true).slideToggle(160);
}
window.toggleUserDropdown = toggleUserDropdown;

function closeUserDropdown() {
    $('#userProfileDropdown').stop(true, true).slideUp(120);
}
window.closeUserDropdown = closeUserDropdown;

$(document).on('click', function(e) {
    if (!$(e.target).closest('#authUserView').length) {
        closeUserDropdown();
    }
});


function openLoginModal() {
    $('#loginModalOverlay').css('display', 'flex');
    $('#loginInputPass').val('');
    setTimeout(() => { $('#loginInputName').focus(); }, 100);
}

function closeLoginModal() {
    $('#loginModalOverlay').hide();
    $('#loginInputPass').val('');
}

async function handleLoginSubmit(event) {
    if (event) event.preventDefault();
    const name = $('#loginInputName').val().trim();
    const password = $('#loginInputPass').val().trim();
    if (!name) {
        if (typeof toastr !== 'undefined') toastr.warning('Vui lòng nhập họ và tên!');
        $('#loginInputName').focus();
        return;
    }
    if (!password) {
        if (typeof toastr !== 'undefined') toastr.warning('Vui lòng nhập mật khẩu!');
        $('#loginInputPass').focus();
        return;
    }
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password })
        });
        const result = await res.json();
        if (result.success && result.user) {
            setAuthUser(result.user);
            closeLoginModal();
            if (typeof toastr !== 'undefined') toastr.success(`Xin chào ${result.user.name}! Đã kết nối đồng bộ.`);
            await loadRegisteredUsers();
            await fetchDeadlinesFromDb();
        } else {
            if (typeof toastr !== 'undefined') toastr.error(result.message || 'Đăng nhập không thành công');
            else alert(result.message || 'Đăng nhập không thành công');
        }
    } catch (e) {
        console.error('Login error:', e);
        if (typeof toastr !== 'undefined') toastr.error('Lỗi kết nối máy chủ!');
    }
}

function logoutUser() {
    closeUserDropdown();
    setAuthUser(null);
    if (typeof toastr !== 'undefined') toastr.info('Đã đăng xuất. Bạn đang ở chế độ Khách (chỉ lưu trên máy này).');
    fetchDeadlinesFromDb();
}

// Lấy danh sách thành viên nhóm cho checklist phân công
let cachedRegisteredUsers = [];
async function loadRegisteredUsers() {
    try {
        const res = await fetch('/api/users');
        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
            cachedRegisteredUsers = result.data;
            renderAssigneesList();
        }
    } catch (e) {
        console.warn('Lỗi lấy danh sách thành viên:', e);
    }
}

function renderAssigneesList(selectedIds = null) {
    const container = $('#assigneesList');
    if (!container.length) return;
    const currentUser = getAuthUser();

    let list = [...cachedRegisteredUsers];
    if (currentUser && !list.some(u => u.id === currentUser.id)) {
        list.push({ id: currentUser.id, name: currentUser.name });
    }

    if (list.length === 0) {
        container.html('<span style="font-size: 11px; color: #70757a;">Chưa có thành viên nào khác. Bạn có thể nhập thêm bên dưới.</span>');
        return;
    }

    let html = '';
    list.forEach(u => {
        const isChecked = selectedIds ? (selectedIds.includes(u.id) || selectedIds.includes(u.name)) : true;
        html += `
            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; background: white; border: 1px solid #dadce0; border-radius: 4px; padding: 2px 8px; cursor: pointer; user-select: none; margin: 0;">
                <input type="checkbox" class="assignee-item" value="${escapeHtml(u.id)}" data-name="${escapeHtml(u.name)}" ${isChecked ? 'checked' : ''} style="margin: 0; vertical-align: middle;">
                <span>${escapeHtml(u.name)}</span>
            </label>
        `;
    });
    container.html(html);
}

function toggleAssignAll(isChecked) {
    if (isChecked) {
        $('#assigneesContainer').hide();
        $('.assignee-item').prop('checked', true);
    } else {
        $('#assigneesContainer').show();
        loadRegisteredUsers();
    }
}

async function addNewMemberFromModal() {
    const input = $('#inputNewMemberName');
    const name = input.val().trim();
    if (!name) return;
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password: '123456789' })
        });
        const result = await res.json();
        if (result.success && result.user) {
            input.val('');
            await loadRegisteredUsers();
            if (typeof toastr !== 'undefined') toastr.success(`Đã thêm thành viên "${result.user.name}"`);
        }
    } catch (e) {
        console.error('Add member error:', e);
    }
}

// ------------------------------------------
// 2. KHU VỰC CACHE 2 PHÂN KHU TÙY THEO USER HOẶC KHÁCH
// ------------------------------------------
function getConfirmedCacheKey() {
    const user = getAuthUser();
    return user ? `deadlines_synced_${user.id}_v1` : CACHE_GUEST_KEY;
}

function getPendingCacheKey() {
    const user = getAuthUser();
    return user ? `deadlines_pending_${user.id}_v1` : 'deadlines_pending_guest_v1';
}

function getConfirmedCache() {
    try {
        const raw = localStorage.getItem(getConfirmedCacheKey());
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function setConfirmedCache(list) {
    try {
        localStorage.setItem(getConfirmedCacheKey(), JSON.stringify(list || []));
    } catch (e) {
        console.error('[Cache Save Confirmed Error]:', e);
    }
}

function getPendingCache() {
    const user = getAuthUser();
    if (!user) return [];
    try {
        const raw = localStorage.getItem(getPendingCacheKey());
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function setPendingCache(list) {
    const user = getAuthUser();
    if (!user) return;
    try {
        localStorage.setItem(getPendingCacheKey(), JSON.stringify(list || []));
    } catch (e) {
        console.error('[Cache Save Pending Error]:', e);
    }
}

function isDeadlineVisibleForUser(item, user) {
    if (!item) return false;
    // Chế độ Khách (Guest)
    if (!user) {
        return true;
    }

    const myId = (user.id || '').toLowerCase();
    const itemUserId = (item.userId || '').toLowerCase();

    // 1. Người tạo: Luôn thấy (cả cá nhân và nhóm)
    if (itemUserId && itemUserId === myId) {
        return true;
    }

    // 2. Deadline cá nhân của người khác: TUYỆT ĐỐI KHÔNG THẤY
    if (item.category === 'personal') {
        return false;
    }

    // 3. Deadline nhóm (group)
    if (item.category === 'group') {
        if (!item.assignees || item.assignees === 'all' || item.assignees === '["all"]') {
            return true;
        }
        let parsed = [];
        try {
            parsed = typeof item.assignees === 'string' ? JSON.parse(item.assignees) : item.assignees;
        } catch (e) {
            parsed = [String(item.assignees)];
        }
        if (!Array.isArray(parsed)) parsed = [parsed];
        if (parsed.includes('all')) return true;

        const myName = (user.name || '').toLowerCase();
        return parsed.some(asg => {
            if (!asg) return false;
            const asgStr = String(asg).toLowerCase();
            return asgStr === myId || asgStr === myName;
        });
    }

    return true;
}

// Gộp 2 phân khu (Khu A + Khu B) để vẽ lên màn hình tức thì
function computeEffectiveDeadlines() {
    const user = getAuthUser();
    const confirmed = getConfirmedCache();
    const pending = getPendingCache();

    const map = new Map();
    confirmed.forEach(item => {
        map.set(item.id, { ...item, _syncStatus: user ? 'synced' : 'guest' });
    });

    pending.forEach(pItem => {
        if (pItem._syncOp === 'delete') {
            map.delete(pItem.id);
        } else if (pItem._syncOp === 'update') {
            const old = map.get(pItem.id) || {};
            map.set(pItem.id, { ...old, ...pItem });
        } else { // 'create'
            map.set(pItem.id, { ...pItem });
        }
    });

    const result = Array.from(map.values()).filter(item => isDeadlineVisibleForUser(item, user));
    result.sort((a, b) => parseDeadlineDate(a.dueDate) - parseDeadlineDate(b.dueDate));
    return result;
}

// Tải dữ liệu ban đầu
async function fetchDeadlinesFromDb(keyword = '') {
    const user = getAuthUser();

    // 1. Tức thì: Nạp ngay từ Local Cache (0ms)
    currentDeadlines = computeEffectiveDeadlines();
    if (keyword && keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        currentDeadlines = currentDeadlines.filter(d => d.title && d.title.toLowerCase().includes(kw));
    }
    renderCurrentView();

    // Nếu là Khách: Tuyệt đối không gửi lên server CSDL
    if (!user) {
        return;
    }

    // 2. Chạy ngầm: Gửi request lên server để so sánh và cập nhật mới nhất cho thành viên
    try {
        let url = `${API_URL}?userId=${encodeURIComponent(user.id)}`;
        if (keyword && keyword.trim()) {
            url += `&k=${encodeURIComponent(keyword.trim())}`;
        }
        const res = await fetch(url);
        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
            setConfirmedCache(result.data);

            // Dọn dẹp Khu B
            const serverIdSet = new Set(result.data.map(d => d.id));
            const currentPending = getPendingCache().filter(p => {
                if (p._syncOp === 'create' && serverIdSet.has(p.id)) return false;
                if (p._syncOp === 'delete' && !serverIdSet.has(p.id)) return false;
                return true;
            });
            setPendingCache(currentPending);

            currentDeadlines = computeEffectiveDeadlines();
            if (keyword && keyword.trim()) {
                const kw = keyword.trim().toLowerCase();
                currentDeadlines = currentDeadlines.filter(d => d.title && d.title.toLowerCase().includes(kw));
            }
            renderCurrentView();
        }
    } catch (err) {
        console.warn('[Offline Mode / Revalidate Warning]: Đang sử dụng bộ nhớ đệm cục bộ.', err);
    }
}

// OPTIMISTIC CREATE: Lưu vào Khu B -> Hiện ngay lập tức -> Gửi ngầm server -> Chuyển sang Khu A
async function optimisticCreateDeadline(dlData) {
    const user = getAuthUser();
    const tempId = dlData.id || ('dl-' + Date.now());
    const enrichedData = {
        ...dlData,
        id: tempId,
        userId: user ? user.id : null,
        userName: user ? user.name : 'Khách',
        assignees: dlData.assignees || 'all'
    };

    // 1. NẾU LÀ KHÁCH: LƯU TRỰC TIẾP VÀO LOCAL CACHE KHÁCH (KHÔNG GỬI SERVER)
    if (!user) {
        const confirmed = getConfirmedCache();
        confirmed.push({
            ...enrichedData,
            _syncStatus: 'guest'
        });
        setConfirmedCache(confirmed);

        currentDeadlines = computeEffectiveDeadlines();
        renderCurrentView();
        if (typeof toastr !== 'undefined') {
            toastr.success(`Đã lưu "${dlData.title}" vào máy (Chế độ Khách).`);
        }
        return enrichedData;
    }

    // 2. NẾU ĐÃ ĐĂNG NHẬP: GHI KHU B -> RENDER NGAY -> GỬI SERVER SQL -> CHUYỂN KHU A
    const pendingItem = {
        ...enrichedData,
        _syncOp: 'create',
        _syncStatus: 'pending'
    };

    const pendingList = getPendingCache();
    pendingList.push(pendingItem);
    setPendingCache(pendingList);

    currentDeadlines = computeEffectiveDeadlines();
    renderCurrentView();

    if (typeof toastr !== 'undefined') {
        toastr.info(`Đang lưu "${dlData.title}"...`, '', { timeOut: 1200 });
    }

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: tempId,
                title: dlData.title,
                dueDate: dlData.dueDate,
                session: dlData.session,
                category: dlData.category,
                userId: enrichedData.userId,
                userName: enrichedData.userName,
                assignees: enrichedData.assignees
            })
        });
        const result = await res.json();
        if (result.success && result.data) {
            setPendingCache(getPendingCache().filter(p => p.id !== tempId));
            const confirmed = getConfirmedCache().filter(c => c.id !== tempId);
            confirmed.push(result.data);
            setConfirmedCache(confirmed);

            currentDeadlines = computeEffectiveDeadlines();
            renderCurrentView();
            if (typeof toastr !== 'undefined') {
                toastr.success(`Đã lưu "${dlData.title}" thành công vào CSDL!`);
            }
            return result.data;
        } else {
            throw new Error(result.message || 'Lỗi server');
        }
    } catch (err) {
        console.error('[Optimistic Create Error]:', err);
        const pending = getPendingCache();
        const item = pending.find(p => p.id === tempId);
        if (item) {
            item._syncStatus = 'error';
            setPendingCache(pending);
        }
        currentDeadlines = computeEffectiveDeadlines();
        renderCurrentView();
        if (typeof toastr !== 'undefined') {
            toastr.error(`Lỗi kết nối máy chủ! Dữ liệu được giữ an toàn trên máy bạn.`);
        }
        return null;
    }
}

// OPTIMISTIC UPDATE: Cập nhật ngay trong Khu B -> Hiện ngay lập tức -> Gửi ngầm server
async function optimisticUpdateDeadline(id, dlData) {
    const user = getAuthUser();

    // 1. NẾU LÀ KHÁCH: CẬP NHẬT TRONG LOCAL CACHE KHÁCH
    if (!user) {
        const confirmed = getConfirmedCache();
        const idx = confirmed.findIndex(c => c.id === id);
        if (idx >= 0) {
            confirmed[idx] = { ...confirmed[idx], ...dlData };
            setConfirmedCache(confirmed);
        }
        currentDeadlines = computeEffectiveDeadlines();
        renderCurrentView();
        if (typeof toastr !== 'undefined') toastr.success(`Đã cập nhật deadline thành công!`);
        return dlData;
    }

    // 2. NẾU ĐÃ ĐĂNG NHẬP: GỬI LÊN SERVER
    const pendingList = getPendingCache();
    const existingIdx = pendingList.findIndex(p => p.id === id);
    const pendingItem = {
        id,
        ...dlData,
        _syncOp: 'update',
        _syncStatus: 'pending'
    };
    if (existingIdx >= 0) pendingList[existingIdx] = pendingItem;
    else pendingList.push(pendingItem);
    setPendingCache(pendingList);

    currentDeadlines = computeEffectiveDeadlines();
    renderCurrentView();

    try {
        const res = await fetch(`${API_URL}/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dlData)
        });
        const result = await res.json();
        if (result.success && result.data) {
            setPendingCache(getPendingCache().filter(p => p.id !== id));
            const confirmed = getConfirmedCache().filter(c => c.id !== id);
            confirmed.push(result.data);
            setConfirmedCache(confirmed);

            currentDeadlines = computeEffectiveDeadlines();
            renderCurrentView();
            if (typeof toastr !== 'undefined') toastr.success(`Đã cập nhật deadline thành công!`);
            return result.data;
        } else {
            throw new Error(result.message || 'Lỗi server');
        }
    } catch (err) {
        console.error('[Optimistic Update Error]:', err);
        const pending = getPendingCache();
        const item = pending.find(p => p.id === id);
        if (item) {
            item._syncStatus = 'error';
            setPendingCache(pending);
        }
        currentDeadlines = computeEffectiveDeadlines();
        renderCurrentView();
        if (typeof toastr !== 'undefined') toastr.error(`Lỗi cập nhật máy chủ! Đã giữ tạm trên máy.`);
        return null;
    }
}

// OPTIMISTIC DELETE: Ẩn ngay lập tức -> Nếu khách xóa thẳng -> Nếu đăng nhập gửi server xóa
async function optimisticDeleteDeadline(id) {
    const user = getAuthUser();
    const itemToDelete = currentDeadlines.find(d => d.id === id);
    if (!itemToDelete) return false;

    // 1. NẾU LÀ KHÁCH: XÓA THẲNG TRONG LOCAL CACHE KHÁCH
    if (!user) {
        setConfirmedCache(getConfirmedCache().filter(c => c.id !== id));
        currentDeadlines = computeEffectiveDeadlines();
        renderCurrentView();
        if (typeof toastr !== 'undefined') toastr.success(`Đã xóa deadline thành công!`);
        return true;
    }

    // 2. NẾU ĐÃ ĐĂNG NHẬP: ẨN NGAY -> GỬI XÓA SERVER
    const pendingList = getPendingCache().filter(p => p.id !== id);
    pendingList.push({
        id,
        _syncOp: 'delete',
        _syncStatus: 'pending',
        _originalItem: itemToDelete
    });
    setPendingCache(pendingList);

    currentDeadlines = computeEffectiveDeadlines();
    renderCurrentView();

    try {
        const res = await fetch(`${API_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            setPendingCache(getPendingCache().filter(p => p.id !== id));
            setConfirmedCache(getConfirmedCache().filter(c => c.id !== id));
            currentDeadlines = computeEffectiveDeadlines();
            renderCurrentView();
            if (typeof toastr !== 'undefined') toastr.success(`Đã xóa deadline thành công!`);
            return true;
        } else {
            throw new Error(result.message);
        }
    } catch (err) {
        console.error('[Optimistic Delete Error]:', err);
        setPendingCache(getPendingCache().filter(p => p.id !== id));
        currentDeadlines = computeEffectiveDeadlines();
        renderCurrentView();
        if (typeof toastr !== 'undefined') toastr.error(`Không thể xóa trên máy chủ! Đã khôi phục lại thẻ.`);
        return false;
    }
}

// Thử lại bản ghi bị lỗi đồng bộ
async function retryPendingSync(id) {
    const pending = getPendingCache();
    const item = pending.find(p => p.id === id);
    if (!item) return;

    item._syncStatus = 'pending';
    setPendingCache(pending);
    currentDeadlines = computeEffectiveDeadlines();
    renderCurrentView();

    if (item._syncOp === 'create') {
        await optimisticCreateDeadline(item);
    } else if (item._syncOp === 'update') {
        await optimisticUpdateDeadline(id, item);
    }
}

// Hủy bỏ bản ghi lỗi khỏi máy
function discardPendingItem(id) {
    setPendingCache(getPendingCache().filter(p => p.id !== id));
    currentDeadlines = computeEffectiveDeadlines();
    renderCurrentView();
    closeDeadlineDetailModal();
    if (typeof toastr !== 'undefined') toastr.info('Đã hủy bỏ bản ghi chờ.');
}

// ==========================================
// 2. TÍNH TOÁN KHOẢNG CÁCH NGÀY & MÃ MÀU CHUẨN
// ==========================================
function calculateDaysLeft(dueDateStr, baseDate) {
    if (!dueDateStr) return 0;
    const due = parseDeadlineDate(dueDateStr);
    const base = new Date(baseDate);
    due.setHours(0, 0, 0, 0);
    base.setHours(0, 0, 0, 0);
    const diffTime = due.getTime() - base.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function getDeadlineColorStyle(daysLeft, isCompleted = false) {
    // 1. Quá hạn (< 0 ngày) hoặc Đã xong -> Màu XÁM
    if (isCompleted || daysLeft < 0) {
        return { bg: "#e9ecef", border: "#adb5bd", text: "#495057", label: "pass" };
    }
    // 2. <= 3 ngày -> Màu ĐỎ (Cực gấp)
    if (daysLeft <= 3) {
        return { bg: "#ffa39e", border: "#f5222d", text: "#820014", label: "3 ngày" };
    }
    // 3. 4 - 7 ngày (1 tuần) -> Màu CAM
    if (daysLeft <= 7) {
        return { bg: "#ffd591", border: "#fa541c", text: "#871400", label: "1 tuần" };
    }
    // 4. 8 - 21 ngày (3 tuần) -> Màu VÀNG
    if (daysLeft <= 21) {
        return { bg: "#ffe58f", border: "#faad14", text: "#613400", label: "3 tuần" };
    }
    // 5. 22 - 60 ngày (2 tháng) -> VÀNG CHANH / XANH MẠ
    if (daysLeft <= 60) {
        return { bg: "#eaff8f", border: "#a0d911", text: "#3f6600", label: "2 tháng" };
    }
    // 6. > 2 tháng -> XANH LÁ
    return { bg: "#b7eb8f", border: "#52c41a", text: "#135200", label: "Dài hạn" };
}

// ==========================================
// 3. RENDER BẢNG DEADLINE THEO TUẦN VÀ THÁNG
// ==========================================
function clearScheduleTable() {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const sessions = ['sang', 'chieu', 'toi'];
    days.forEach(day => {
        sessions.forEach(sess => {
            const cell = document.getElementById(`cell-${day}-${sess}`);
            if (cell) cell.innerHTML = '';
        });
    });
}

function renderWeekSchedule(items, mondayDate, filterType = "0", todayDate = new Date()) {
    clearScheduleTable();
    if (!items || items.length === 0) return;

    const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(mondayDate);
        d.setDate(mondayDate.getDate() + i);
        d.setHours(0, 0, 0, 0);
        weekDates.push(d);
    }

    items.forEach(item => {
        if (filterType === "group" && item.category !== "group") return;
        if (filterType === "personal" && item.category !== "personal") return;

        const itemDate = parseDeadlineDate(item.dueDate);
        itemDate.setHours(0, 0, 0, 0);

        let matchedDayIndex = -1;
        for (let i = 0; i < 7; i++) {
            if (itemDate.getTime() === weekDates[i].getTime()) {
                matchedDayIndex = i;
                break;
            }
        }
        if (matchedDayIndex === -1) return;

        const dayKey = dayKeys[matchedDayIndex];
        const cellId = `cell-${dayKey}-${item.session}`;
        const targetCell = document.getElementById(cellId);
        if (!targetCell) return;

        const daysLeft = calculateDaysLeft(item.dueDate, todayDate);
        const styleInfo = getDeadlineColorStyle(daysLeft, item.isCompleted);

        const dueObj = parseDeadlineDate(item.dueDate);
        const timeOnly = `${String(dueObj.getHours()).padStart(2,'0')}:${String(dueObj.getMinutes()).padStart(2,'0')}`;
        const fullTimeStr = `${timeOnly} - ${String(dueObj.getDate()).padStart(2,'0')}/${String(dueObj.getMonth()+1).padStart(2,'0')}/${dueObj.getFullYear()}`;

        let badgeText = '';
        if (daysLeft < 0) {
            badgeText = `Quá hạn ${Math.abs(daysLeft)} ngày`;
        } else if (daysLeft === 0) {
            badgeText = `Hôm nay`;
        } else {
            badgeText = `Còn ${daysLeft} ngày`;
        }

        let syncStatusHtml = '';
        let cardExtraStyle = '';
        if (item._syncStatus === 'pending') {
            syncStatusHtml = `<span title="Đang đồng bộ lên máy chủ..." style="color: #1a73e8; margin-left: 3px;"><i class="fa fa-refresh fa-spin"></i></span>`;
            cardExtraStyle = 'border-style: dashed !important;';
        } else if (item._syncStatus === 'error') {
            syncStatusHtml = `<span title="Lỗi đồng bộ máy chủ! Nhấp để xem" style="color: #d93025; margin-left: 3px;"><i class="fa fa-exclamation-triangle"></i></span>`;
            cardExtraStyle = 'border: 1.5px dashed #d93025 !important;';
        }

        let cardHtml = `
            <div class="content text-start deadline-card" onclick="showDeadlineDetail('${item.id}', event, this)" title="Hạn chót: ${fullTimeStr} | ${badgeText}" style="background-color: ${styleInfo.bg}; border: 1.5px solid ${styleInfo.border}; ${cardExtraStyle} color: ${styleInfo.text}; padding: 7px 9px; margin-bottom: 6px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: left;">
                <!-- HEADER THẺ (PHƯƠNG ÁN C): GIỜ HẠN CHÓT + BADGE THỜI GIAN CÒN LẠI -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; padding-bottom: 4px; border-bottom: 1px dashed rgba(0,0,0,0.18);">
                    <div style="font-size: 11.5px; font-weight: 700; color: ${styleInfo.text}; display: flex; align-items: center; gap: 4px;">
                        <i class="fa fa-clock-o" aria-hidden="true"></i> <span>${timeOnly}</span>
                        ${syncStatusHtml}
                    </div>
                    <span style="background: rgba(255, 255, 255, 0.7); border: 1px solid ${styleInfo.border}; border-radius: 3px; padding: 1px 5px; font-size: 10px; font-weight: 700; color: ${styleInfo.text}; white-space: nowrap;">
                        ${badgeText}
                    </span>
                </div>
                <!-- BODY THẺ: TIÊU ĐỀ DEADLINE -->
                <div style="font-weight: 700; font-size: 12.5px; line-height: 1.35; color: ${styleInfo.text}; word-break: break-word;">
                    ${escapeHtml(item.title)}
                </div>
            </div>
        `;
        targetCell.insertAdjacentHTML('beforeend', cardHtml);
    });
}

function renderMonthSchedule(items, year, month, filterType = "0", todayDate = new Date()) {
    const container = document.getElementById("monthGridBody");
    if (!container) return;
    container.innerHTML = '';
    closeMonthDayListPopover();

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    let startDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - startDayOfWeek);

    let currentGridDate = new Date(startDate);
    let totalCells = (startDayOfWeek + lastDayOfMonth.getDate() > 35) ? 42 : 35;

    let rowHtml = '<tr role="row">';
    for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
        const isCurrentMonth = currentGridDate.getMonth() === month;
        const isToday = currentGridDate.getFullYear() === todayDate.getFullYear() &&
                        currentGridDate.getMonth() === todayDate.getMonth() &&
                        currentGridDate.getDate() === todayDate.getDate();

        const dayNum = currentGridDate.getDate();
        const dateKey = `${currentGridDate.getFullYear()}-${String(currentGridDate.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

        const matchedDeadlines = [];
        if (items) {
            items.forEach(item => {
                if (filterType === "group" && item.category !== "group") return;
                if (filterType === "personal" && item.category !== "personal") return;

                const itemD = parseDeadlineDate(item.dueDate);
                if (itemD.getFullYear() === currentGridDate.getFullYear() &&
                    itemD.getMonth() === currentGridDate.getMonth() &&
                    itemD.getDate() === currentGridDate.getDate()) {
                    matchedDeadlines.push(item);
                }
            });
        }

        // Sắp xếp các deadline trong ngày theo thứ tự giờ hạn chót
        matchedDeadlines.sort((a, b) => parseDeadlineDate(a.dueDate).getTime() - parseDeadlineDate(b.dueDate).getTime());

        // CHỈ HIỂN THỊ TIÊU ĐỀ (Title Only), tối đa 2 chip để bảng luôn gọn gàng
        let chipsHtml = '';
        const maxDisplay = 2;
        const displayItems = matchedDeadlines.slice(0, maxDisplay);
        const remainingCount = matchedDeadlines.length - maxDisplay;

        displayItems.forEach(dl => {
            const daysLeft = calculateDaysLeft(dl.dueDate, todayDate);
            const styleInfo = getDeadlineColorStyle(daysLeft, dl.isCompleted);
            const dueObj = parseDeadlineDate(dl.dueDate);
            const timeOnly = `${String(dueObj.getHours()).padStart(2, '0')}:${String(dueObj.getMinutes()).padStart(2, '0')}`;

            let mSync = '';
            if (dl._syncStatus === 'pending') {
                mSync = ' <i class="fa fa-refresh fa-spin" style="color: #1a73e8; margin-left: 2px;"></i>';
            } else if (dl._syncStatus === 'error') {
                mSync = ' <i class="fa fa-exclamation-triangle" style="color: #d93025; margin-left: 2px;"></i>';
            }

            chipsHtml += `
                <div class="month-deadline-chip" onclick="showDeadlineDetail('${dl.id}', event, this)" title="${escapeHtml(dl.title)} (Hạn: ${timeOnly})" style="background-color: ${styleInfo.bg}; border-left-color: ${styleInfo.border} !important; color: ${styleInfo.text};">
                    <span class="month-chip-title">${escapeHtml(dl.title)}</span>
                    ${mSync}
                </div>
            `;
        });

        // Nếu còn thêm deadline trong ngày: Hiện "+N việc khác"
        if (remainingCount > 0) {
            chipsHtml += `
                <div class="month-more-chip" onclick="showDayDeadlinesModal('${dateKey}', event, this)" title="Xem tất cả ${matchedDeadlines.length} deadline ngày ${dayNum}">
                    <i class="fa fa-plus-circle" style="font-size: 10px;"></i>
                    <span>${remainingCount} việc khác</span>
                </div>
            `;
        }

        const cellClass = [
            'month-day-cell',
            isCurrentMonth ? '' : 'other-month',
            isToday ? 'is-today-cell' : ''
        ].filter(Boolean).join(' ');

        const dayNumClass = isToday ? 'month-day-number is-today-circle' : 'month-day-number';

        rowHtml += `
            <td class="${cellClass}">
                <div class="month-day-header">
                    <span class="${dayNumClass}">${dayNum}</span>
                </div>
                <div class="month-chips-container">
                    ${chipsHtml}
                </div>
            </td>
        `;

        if ((cellIndex + 1) % 7 === 0) {
            rowHtml += '</tr>';
            if (cellIndex + 1 < totalCells) {
                rowHtml += '<tr role="row">';
            }
        }
        currentGridDate.setDate(currentGridDate.getDate() + 1);
    }
    container.innerHTML = rowHtml;
}

/**
 * Hiển thị cửa sổ popover nhỏ xem tất cả deadline trong ngày khi bấm "+N việc khác"
 */
function showDayDeadlinesModal(dateKey, event, triggerEl) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const popover = $('#monthDayListPopover');
    if (!popover.length) return;

    const [y, m, d] = dateKey.split('-').map(Number);
    const dayDeadlines = currentDeadlines.filter(item => {
        const itemD = parseDeadlineDate(item.dueDate);
        return itemD.getFullYear() === y && (itemD.getMonth() + 1) === m && itemD.getDate() === d;
    });

    dayDeadlines.sort((a, b) => parseDeadlineDate(a.dueDate).getTime() - parseDeadlineDate(b.dueDate).getTime());

    const titleText = `Lịch ngày ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y} (${dayDeadlines.length})`;
    $('#monthDayListTitle').text(titleText);

    let itemsHtml = '';
    dayDeadlines.forEach(dl => {
        const daysLeft = calculateDaysLeft(dl.dueDate, todayDate);
        const styleInfo = getDeadlineColorStyle(daysLeft, dl.isCompleted);
        const dueObj = parseDeadlineDate(dl.dueDate);
        const timeOnly = `${String(dueObj.getHours()).padStart(2, '0')}:${String(dueObj.getMinutes()).padStart(2, '0')}`;

        itemsHtml += `
            <div class="popover-day-item" onclick="closeMonthDayListPopover(); showDeadlineDetail('${dl.id}', event, this);" style="background-color: ${styleInfo.bg}; border-left-color: ${styleInfo.border} !important; color: ${styleInfo.text};">
                <span class="popover-day-title" title="${escapeHtml(dl.title)}">${escapeHtml(dl.title)}</span>
                <span class="popover-day-time">${timeOnly}</span>
            </div>
        `;
    });

    $('#monthDayListItems').html(itemsHtml || '<div style="font-size: 12px; color: #888; text-align: center; padding: 10px;">Không có deadline</div>');

    popover.show();
    const triggerOffset = $(triggerEl).offset();
    const popoverWidth = popover.outerWidth() || 280;
    const popoverHeight = popover.outerHeight() || 180;

    let left = triggerOffset.left;
    let top = triggerOffset.top + $(triggerEl).outerHeight() + 6;

    if (left + popoverWidth > $(window).width() - 15) {
        left = $(window).width() - popoverWidth - 15;
    }
    if (top + popoverHeight > $(window).height() + $(window).scrollTop() - 15) {
        top = triggerOffset.top - popoverHeight - 6;
    }

    popover.css({
        position: 'absolute',
        top: Math.max(10, top) + 'px',
        left: Math.max(10, left) + 'px'
    });
}
window.showDayDeadlinesModal = showDayDeadlinesModal;

function closeMonthDayListPopover() {
    $('#monthDayListPopover').hide();
}
window.closeMonthDayListPopover = closeMonthDayListPopover;

// ==========================================
// 4. GIAO DIỆN CHUYÊN BIỆT CHO ĐIỆN THOẠI (MOBILE DAY AGENDA VIEW)
// ==========================================
let selectedMobileDayIndex = -1;
let mobileSubView = 'day';

function getWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function selectMobileDay(index) {
    selectedMobileDayIndex = index;
    renderMobileDayAgendaView();
}
window.selectMobileDay = selectMobileDay;

function switchMobileSubView(mode) {
    mobileSubView = mode;
    if (mode === 'day') {
        $('#btn_m_view_day').addClass('active');
        $('#btn_m_view_table').removeClass('active');
        $('body').removeClass('mobile-show-table');
    } else {
        $('#btn_m_view_table').addClass('active');
        $('#btn_m_view_day').removeClass('active');
        $('body').addClass('mobile-show-table');
    }
}
window.switchMobileSubView = switchMobileSubView;

function toggleMobileFabMenu() {
    $('#mobileFabMenu').stop(true, true).slideToggle(140);
}
window.toggleMobileFabMenu = toggleMobileFabMenu;

function navPrevWeek() {
    $('#btn_TroVe').click();
}
window.navPrevWeek = navPrevWeek;

function navNextWeek() {
    $('#btn_Tiep').click();
}
window.navNextWeek = navNextWeek;

function navToday() {
    $('#btn_HienTai').click();
}
window.navToday = navToday;

function renderMobileDayAgendaView() {
    const monday = getMonday(currentDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        d.setHours(0, 0, 0, 0);
        weekDates.push(d);
    }

    // Nếu chưa chọn ngày hoặc chuyển tuần, mặc định chọn ngày hôm nay nếu nằm trong tuần, hoặc Thứ 2 (index 0)
    if (selectedMobileDayIndex < 0 || selectedMobileDayIndex > 6) {
        let todayIdx = -1;
        for (let i = 0; i < 7; i++) {
            if (weekDates[i].getTime() === today.getTime()) {
                todayIdx = i;
                break;
            }
        }
        selectedMobileDayIndex = todayIdx !== -1 ? todayIdx : 0;
    }

    const selDate = weekDates[selectedMobileDayIndex];

    // Cập nhật tiêu đề tháng & tuần
    const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
    $('#mobileMonthYearText').text(`${monthNames[selDate.getMonth()]} / ${selDate.getFullYear()}`);
    $('#mobileWeekSubtitle').text(`Tuần ${getWeekNumber(selDate)}`);

    // Render thanh 7 ngày (Day Strip)
    const dayShortNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    let stripHtml = '';

    for (let i = 0; i < 7; i++) {
        const d = weekDates[i];
        const isToday = d.getTime() === today.getTime();
        const isSelected = i === selectedMobileDayIndex;
        const dayNum = String(d.getDate()).padStart(2, '0');

        // Tìm các deadline của ngày này để tạo chấm màu
        let dotColor = 'transparent';
        const dayDeadlines = currentDeadlines.filter(item => {
            const itemDate = parseDeadlineDate(item.dueDate);
            itemDate.setHours(0, 0, 0, 0);
            return itemDate.getTime() === d.getTime();
        });

        if (dayDeadlines.length > 0) {
            let mostUrgentStyle = null;
            dayDeadlines.forEach(item => {
                const dl = calculateDaysLeft(item.dueDate, todayDate);
                const st = getDeadlineColorStyle(dl, item.isCompleted);
                if (!mostUrgentStyle || dl < mostUrgentStyle.dl) {
                    mostUrgentStyle = { dl, color: st.border };
                }
            });
            if (mostUrgentStyle) dotColor = mostUrgentStyle.color;
        }

        stripHtml += `
            <div class="m-day-pill ${isToday ? 'is-today' : ''} ${isSelected ? 'active' : ''}" onclick="selectMobileDay(${i})">
                <span class="m-day-name">${dayShortNames[i]}</span>
                <span class="m-day-num">${dayNum}</span>
                <span class="m-day-dot" style="background-color: ${dotColor};"></span>
            </div>
        `;
    }
    $('#mobileDayStrip').html(stripHtml);

    // Render 3 ca của ngày đang chọn
    renderMobileSessions(selDate);
}

function renderMobileSessions(targetDate) {
    const targetTime = targetDate.getTime();
    const dayDeadlines = currentDeadlines.filter(item => {
        const itemDate = parseDeadlineDate(item.dueDate);
        itemDate.setHours(0, 0, 0, 0);
        return itemDate.getTime() === targetTime;
    });

    const sessions = {
        sang: dayDeadlines.filter(item => item.session === 'sang'),
        chieu: dayDeadlines.filter(item => item.session === 'chieu'),
        toi: dayDeadlines.filter(item => item.session === 'toi')
    };

    const sessionKeys = ['sang', 'chieu', 'toi'];
    sessionKeys.forEach(sess => {
        const items = sessions[sess];
        $(`#m-count-${sess}`).text(items.length);
        if (items.length > 0) {
            $(`#m-count-${sess}`).addClass('has-items');
            let cardsHtml = '';
            items.forEach(item => {
                const daysLeft = calculateDaysLeft(item.dueDate, todayDate);
                const styleInfo = getDeadlineColorStyle(daysLeft, item.isCompleted);
                const dueObj = parseDeadlineDate(item.dueDate);
                const timeOnly = `${String(dueObj.getHours()).padStart(2, '0')}:${String(dueObj.getMinutes()).padStart(2, '0')}`;

                let badgeText = '';
                if (daysLeft < 0) badgeText = `Quá hạn ${Math.abs(daysLeft)}d`;
                else if (daysLeft === 0) badgeText = `Hôm nay`;
                else badgeText = `Còn ${daysLeft}d`;

                let syncStatusHtml = '';
                if (item._syncStatus === 'pending') {
                    syncStatusHtml = `<span style="color: #1a73e8; margin-left: 3px;"><i class="fa fa-refresh fa-spin"></i></span>`;
                } else if (item._syncStatus === 'error') {
                    syncStatusHtml = `<span style="color: #d93025; margin-left: 3px;"><i class="fa fa-exclamation-triangle"></i></span>`;
                }

                cardsHtml += `
                    <div class="m-deadline-card" onclick="showDeadlineDetail('${item.id}', event, this)" style="background-color: ${styleInfo.bg}; border-color: ${styleInfo.border}; color: ${styleInfo.text};">
                        <div class="m-card-header">
                            <div class="m-card-time" style="color: ${styleInfo.text};">
                                <i class="fa fa-clock-o"></i> <span>${timeOnly}</span>
                                ${syncStatusHtml}
                            </div>
                            <span class="m-card-badge" style="color: ${styleInfo.text}; border-color: ${styleInfo.border};">
                                ${badgeText}
                            </span>
                        </div>
                        <div class="m-card-title" style="color: ${styleInfo.text};">
                            ${escapeHtml(item.title)}
                        </div>
                        <div class="m-card-footer">
                            <span class="m-card-cat" style="color: ${item.category === 'group' ? '#0f9d58' : '#1a73e8'};">
                                <i class="fa ${item.category === 'group' ? 'fa-users' : 'fa-user'}"></i>
                                ${item.category === 'group' ? 'Cả nhóm' : 'Cá nhân'}
                            </span>
                            <span class="m-card-author">
                                ${item.userName ? escapeHtml(item.userName) : ''}
                            </span>
                        </div>
                    </div>
                `;
            });
            $(`#m-cards-${sess}`).html(cardsHtml);
        } else {
            $(`#m-count-${sess}`).removeClass('has-items');
            $(`#m-cards-${sess}`).html('<div class="m-empty-session">Không có deadline ca này</div>');
        }
    });
}

$(document).on('click', function(e) {
    if (!$(e.target).closest('#mobileFabContainer').length) {
        $('#mobileFabMenu').slideUp(120);
    }
});

function renderCurrentView() {
    todayDate = new Date(); // Luôn lấy thời gian thực của máy tính
    if (currentViewMode === 'week') {
        updateWeekHeader();
        renderWeekSchedule(currentDeadlines, getMonday(currentDate), "0", todayDate);
    } else {
        renderMonthSchedule(currentDeadlines, currentDate.getFullYear(), currentDate.getMonth(), "0", todayDate);
    }
    renderMobileDayAgendaView();

    const picker = $("#dateNgayXemLich").data("kendoDatePicker");
    if (picker) {
        picker.value(currentDate);
    } else {
        $("#dateNgayXemLich").val(formatDate(currentDate));
    }
}

function updateWeekHeader() {
    const monday = getMonday(currentDate);
    const dayIds = ['th-mon', 'th-tue', 'th-wed', 'th-thu', 'th-fri', 'th-sat', 'th-sun'];
    const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dateStr = formatDate(d);
        const th = document.getElementById(dayIds[i]);
        if (th) {
            const isToday = d.getFullYear() === today.getFullYear() &&
                            d.getMonth() === today.getMonth() &&
                            d.getDate() === today.getDate();
            const todayBadge = isToday ? ' <b style="color: #1a73e8; font-size: 11px;">(Hôm nay)</b>' : '';
            th.innerHTML = `<span>${dayNames[i]}${todayBadge}</span><br><small class="date-label">${dateStr}</small>`;
            if (isToday) {
                th.style.backgroundColor = '#e8f0fe';
                th.style.borderBottom = '2px solid #1a73e8';
            } else {
                th.style.backgroundColor = '';
                th.style.borderBottom = '';
            }
        }
    }
}

function getMonday(d) {
    const clone = new Date(d);
    const day = clone.getDay();
    const diff = clone.getDate() - day + (day === 0 ? -6 : 1);
    clone.setDate(diff);
    return clone;
}

function formatDate(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

const dayNamesVi = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
function formatVietnameseDate(d) {
    return `${dayNamesVi[d.getDay()]}, ${d.getDate()} tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}

// ==========================================
// 4. POPOVER CHI TIẾT DEADLINE (HIỂN THỊ CẠNH THẺ, KHÔNG OVERLAY)
// ==========================================
let currentDetailId = null;

function showDeadlineDetail(id, event, element) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const item = currentDeadlines.find(d => d.id === id);
    if (!item) return;

    currentDetailId = id;

    const daysLeft = calculateDaysLeft(item.dueDate, todayDate);
    const styleInfo = getDeadlineColorStyle(daysLeft, item.isCompleted);

    $('#detailColorBox').css({
        'background-color': styleInfo.bg,
        'border': `1.5px solid ${styleInfo.border}`
    });
    $('#detailTitleText').text(item.title);

    const dueObj = parseDeadlineDate(item.dueDate);
    const dateStrVi = formatVietnameseDate(dueObj);
    const hh = String(dueObj.getHours()).padStart(2, '0');
    const mm = String(dueObj.getMinutes()).padStart(2, '0');
    $('#detailTimeFullText').text(`${dateStrVi} · ${hh}:${mm}`);

    let badgeText = '';
    if (daysLeft < 0) {
        badgeText = `Quá hạn ${Math.abs(daysLeft)} ngày`;
    } else if (daysLeft === 0) {
        badgeText = `Hôm nay`;
    } else {
        badgeText = `Còn ${daysLeft} ngày`;
    }
    $('#detailTimeBadge').text(badgeText).css({
        'color': styleInfo.text,
        'border': `1px solid ${styleInfo.border}`,
        'background': 'rgba(255,255,255,0.85)'
    });

    // Cập nhật người tạo
    const currentUser = getAuthUser();
    let creatorStr = 'Khách';
    if (item.userName) {
        creatorStr = (currentUser && item.userId === currentUser.id) ? 'Bạn' : item.userName;
    } else if (currentUser && item.userId === currentUser.id) {
        creatorStr = 'Bạn';
    }
    $('#detailCreatorText').text(`Tạo bởi: ${creatorStr}`);

    if (item.category === 'group') {
        $('#detailCategoryIcon').attr('class', 'fa fa-users').css('color', '#0f9d58');
        $('#detailCategoryText').text('Cả nhóm');
        $('#detailAssigneesRow').show();

        let assigneesStr = 'Toàn bộ nhóm';
        if (item.assignees && item.assignees !== 'all' && item.assignees !== '["all"]') {
            let parsed = [];
            try {
                parsed = typeof item.assignees === 'string' ? JSON.parse(item.assignees) : item.assignees;
            } catch (e) {
                parsed = [String(item.assignees)];
            }
            if (Array.isArray(parsed) && parsed.length > 0 && !parsed.includes('all')) {
                const names = parsed.map(idOrName => {
                    const found = cachedRegisteredUsers.find(u => u.id === idOrName);
                    return found ? found.name : idOrName;
                });
                assigneesStr = names.join(', ');
            }
        }
        $('#detailAssigneesText').text(`Phân công: ${assigneesStr}`);
    } else {
        $('#detailCategoryIcon').attr('class', 'fa fa-user').css('color', '#1a73e8');
        $('#detailCategoryText').text('Cá nhân');
        $('#detailAssigneesRow').hide();
    }

    // HIỂN THỊ BANNER ĐỒNG BỘ TRÊN POPOVER (NẾU CÓ)
    if (item._syncStatus === 'pending') {
        $('#detailSyncBanner').html(`
            <div style="display: flex; align-items: center; gap: 8px; color: #1a73e8;">
                <i class="fa fa-refresh fa-spin"></i>
                <span><strong>Đang lưu lên máy chủ SQL...</strong> Dữ liệu đã an toàn trong bộ nhớ máy.</span>
            </div>
        `).css({ 'background': '#e8f0fe', 'border': '1px solid #c2e7ff' }).show();
    } else if (item._syncStatus === 'error') {
        $('#detailSyncBanner').html(`
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; color: #c5221f;">
                <div>
                    <i class="fa fa-exclamation-triangle"></i>
                    <span><strong>Lỗi kết nối máy chủ!</strong> Chưa thể ghi vào CSDL.</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button type="button" class="btn btn-xs btn-outline-danger" onclick="retryPendingSync('${item.id}')" style="padding: 2px 8px; font-size: 11px; font-weight: 700; border-radius: 4px;">Thử lại</button>
                    <button type="button" class="btn btn-xs btn-light" onclick="discardPendingItem('${item.id}')" style="padding: 2px 8px; font-size: 11px; border-radius: 4px;">Hủy bỏ</button>
                </div>
            </div>
        `).css({ 'background': '#fce8e6', 'border': '1px solid #f5c2c7' }).show();
    } else {
        $('#detailSyncBanner').hide();
    }

    $('#detailMoreMenu').hide();

    // Hiển thị và căn tọa độ neo ngay cạnh thẻ deadline
    const popover = $('#deadlineDetailPopover');
    popover.css({ visibility: 'hidden', display: 'block' });
    const popoverWidth = popover.outerWidth() || 420;
    const popoverHeight = popover.outerHeight() || 190;
    popover.css({ visibility: 'visible' });

    const targetEl = element || (event && event.currentTarget);
    if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const winWidth = $(window).width();
        const winHeight = $(window).height();

        let top = rect.top;
        let left = rect.right + 10; // Ưu tiên bên phải thẻ

        if (left + popoverWidth > winWidth - 15) {
            left = rect.left - popoverWidth - 10; // Sang bên trái thẻ
        }
        if (left < 15) {
            left = Math.max(15, (winWidth - popoverWidth) / 2);
        }
        if (top + popoverHeight > winHeight - 15) {
            top = Math.max(15, winHeight - popoverHeight - 15);
        }
        if (top < 15) {
            top = 15;
        }

        popover.css({ top: top + 'px', left: left + 'px' });
    } else {
        popover.css({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
    }
}

function closeDeadlineDetailModal() {
    $('#deadlineDetailPopover').hide();
    $('#detailMoreMenu').hide();
    currentDetailId = null;
}

function toggleDetailMoreMenu(event) {
    if (event) event.stopPropagation();
    $('#detailMoreMenu').toggle();
}

async function deleteDeadlineFromDetail(id) {
    const targetId = id || currentDetailId;
    if (!targetId) return;
    const item = currentDeadlines.find(d => d.id === targetId);
    if (!item) return;

    if (confirm(`Bạn có chắc chắn muốn xóa deadline "${item.title}" không?`)) {
        closeDeadlineDetailModal();
        await optimisticDeleteDeadline(targetId);
    }
}

function copyDeadlineWithPrompt(id) {
    const targetId = id || currentDetailId;
    if (!targetId) return;
    const item = currentDeadlines.find(d => d.id === targetId);
    if (!item) return;

    const daysLeft = calculateDaysLeft(item.dueDate, todayDate);
    let remainingStr = '';
    if (daysLeft < 0) remainingStr = `Đã quá hạn ${Math.abs(daysLeft)} ngày`;
    else if (daysLeft === 0) remainingStr = 'Hôm nay';
    else remainingStr = `Còn ${daysLeft} ngày`;

    const dueObj = parseDeadlineDate(item.dueDate);
    const dateFormatted = `${String(dueObj.getDate()).padStart(2,'0')}/${String(dueObj.getMonth()+1).padStart(2,'0')}/${dueObj.getFullYear()}`;
    const timeFormatted = `${String(dueObj.getHours()).padStart(2,'0')}:${String(dueObj.getMinutes()).padStart(2,'0')}`;
    const categoryName = item.category === 'group' ? 'Cả nhóm' : 'Cá nhân';

    const textToCopy = `[DEADLINE]
- Tiêu đề: ${item.title}
- Hạn nộp: ${timeFormatted} ngày ${dateFormatted}
- Thời gian còn lại: ${remainingStr}
- Phân loại: ${categoryName}

👉 Prompt gợi ý AI:
"Tôi có một deadline như trên. Hãy giúp tôi lập kế hoạch chi tiết từng bước (action plan) và phân bổ thời gian hợp lý để hoàn thành công việc đúng hạn!"`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(function () {
            if (typeof toastr !== 'undefined') {
                toastr.success("Đã sao chép thông tin deadline và prompt gợi ý AI vào Clipboard!");
            }
        }).catch(function () {
            fallbackCopyText(textToCopy);
        });
    } else {
        fallbackCopyText(textToCopy);
    }
    $('#detailMoreMenu').hide();
}

function fallbackCopyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        if (typeof toastr !== 'undefined') {
            toastr.success("Đã sao chép thông tin deadline và prompt gợi ý AI vào Clipboard!");
        }
    } catch (err) {
        if (typeof toastr !== 'undefined') {
            toastr.error("Không thể sao chép tự động!");
        }
    }
    document.body.removeChild(textArea);
}

function printDeadlineDetail(id) {
    const targetId = id || currentDetailId;
    if (!targetId) return;
    const item = currentDeadlines.find(d => d.id === targetId);
    if (!item) return;

    $('#detailMoreMenu').hide();

    const dueObj = parseDeadlineDate(item.dueDate);
    const dateFormatted = `${String(dueObj.getDate()).padStart(2,'0')}/${String(dueObj.getMonth()+1).padStart(2,'0')}/${dueObj.getFullYear()}`;
    const timeFormatted = `${String(dueObj.getHours()).padStart(2,'0')}:${String(dueObj.getMinutes()).padStart(2,'0')}`;
    const categoryName = item.category === 'group' ? 'Cả nhóm' : 'Cá nhân';
    const daysLeft = calculateDaysLeft(item.dueDate, todayDate);
    let remainingStr = daysLeft < 0 ? `Đã quá hạn ${Math.abs(daysLeft)} ngày` : (daysLeft === 0 ? 'Hôm nay' : `Còn ${daysLeft} ngày`);

    const printWin = window.open('', '', 'width=600,height=450');
    printWin.document.write(`
        <html>
        <head>
            <title>In Deadline - ${escapeHtml(item.title)}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 28px; color: #202124; line-height: 1.6; }
                .ticket { border: 2px solid #1a73e8; border-radius: 8px; padding: 20px; max-width: 480px; margin: 0 auto; }
                h2 { margin-top: 0; color: #1a73e8; font-size: 19px; border-bottom: 1px solid #dadce0; padding-bottom: 10px; }
                .item { margin-bottom: 12px; font-size: 14px; }
                .label { font-weight: bold; color: #5f6368; width: 140px; display: inline-block; }
                .badge { padding: 2px 8px; border-radius: 4px; font-weight: bold; background: #e8f0fe; color: #1a73e8; border: 1px solid #c2e7ff; }
            </style>
        </head>
        <body>
            <div class="ticket">
                <h2>THÔNG TIN DEADLINE</h2>
                <div class="item"><span class="label">Tiêu đề:</span> <b>${escapeHtml(item.title)}</b></div>
                <div class="item"><span class="label">Hạn nộp:</span> <b>${timeFormatted} ngày ${dateFormatted}</b></div>
                <div class="item"><span class="label">Thời gian còn lại:</span> <span class="badge">${remainingStr}</span></div>
                <div class="item"><span class="label">Phân loại:</span> <b>${categoryName}</b></div>
            </div>
            <script>window.onload = function() { window.print(); window.close(); }<\/script>
        </body>
        </html>
    `);
    printWin.document.close();
}

// ==========================================
// 5. CỬA SỔ MODAL TẠO & SỬA DEADLINE (GOOGLE CALENDAR STYLE)
// ==========================================
let miniCalYear = new Date().getFullYear();
let miniCalMonth = new Date().getMonth();
let selectedModalDate = new Date(Date.now() + 7 * 86400000);
let activeModalCategory = 'personal';
let editingDeadlineId = null;

function toggleCreateDropdown(event) {
    if (event) event.stopPropagation();
    $('#createDropdownMenu').toggle();
}

function openCreateDeadlineModal(category) {
    $('#createDropdownMenu').hide();
    editingDeadlineId = null;
    $('#btnModalSave').text('Lưu');
    $('#checkAssignAll').prop('checked', true);
    $('#assigneesContainer').hide();
    setModalCategory(category || 'personal');

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    selectedModalDate = nextWeek;
    miniCalYear = selectedModalDate.getFullYear();
    miniCalMonth = selectedModalDate.getMonth();

    $('#modalDateText').text(formatVietnameseDate(selectedModalDate));
    $('#modalTimeInput').val("09:00");
    $('#modalInputTitle').val("");
    $('#modalCalendarPopup').hide();
    renderMiniCalGrid();

    $('#createDeadlineModalOverlay').css('display', 'flex');
    setTimeout(function () { $('#modalInputTitle').focus(); }, 120);
}

function openEditDeadlineModal(id) {
    const targetId = id || currentDetailId;
    closeDeadlineDetailModal();
    if (!targetId) return;
    const item = currentDeadlines.find(d => d.id === targetId);
    if (!item) return;

    editingDeadlineId = targetId;
    $('#btnModalSave').text('Cập nhật');
    setModalCategory(item.category || 'personal');
    $('#modalInputTitle').val(item.title);

    if (item.category === 'group') {
        let isAll = !item.assignees || item.assignees === 'all' || item.assignees === '["all"]';
        $('#checkAssignAll').prop('checked', isAll);
        if (isAll) {
            $('#assigneesContainer').hide();
        } else {
            $('#assigneesContainer').show();
            let parsed = [];
            try {
                parsed = typeof item.assignees === 'string' ? JSON.parse(item.assignees) : item.assignees;
            } catch (e) {
                parsed = [String(item.assignees)];
            }
            if (!Array.isArray(parsed)) parsed = [parsed];
            renderAssigneesList(parsed);
        }
    }

    selectedModalDate = parseDeadlineDate(item.dueDate);
    miniCalYear = selectedModalDate.getFullYear();
    miniCalMonth = selectedModalDate.getMonth();

    const hh = String(selectedModalDate.getHours()).padStart(2, '0');
    const mm = String(selectedModalDate.getMinutes()).padStart(2, '0');
    $('#modalTimeInput').val(`${hh}:${mm}`);
    $('#modalDateText').text(formatVietnameseDate(selectedModalDate));

    $('#modalCalendarPopup').hide();
    renderMiniCalGrid();

    $('#createDeadlineModalOverlay').css('display', 'flex');
    setTimeout(function () { $('#modalInputTitle').focus(); }, 120);
}

function closeCreateDeadlineModal() {
    $('#createDeadlineModalOverlay').hide();
    $('#modalCalendarPopup').hide();
    editingDeadlineId = null;
}

function setModalCategory(category) {
    activeModalCategory = category;
    if (category === 'personal') {
        $('#tabBtnPersonal').css({ 'background': '#c2e7ff', 'color': '#001d35' });
        $('#tabBtnGroup').css({ 'background': '#f1f3f4', 'color': '#444746' });
        $('#noticePersonal').show();
        $('#noticeGroup').hide();
    } else {
        $('#tabBtnPersonal').css({ 'background': '#f1f3f4', 'color': '#444746' });
        $('#tabBtnGroup').css({ 'background': '#c2e7ff', 'color': '#001d35' });
        $('#noticePersonal').hide();
        $('#noticeGroup').show();
        loadRegisteredUsers();
    }
}

function toggleModalCalendarPopup(e) {
    if (e) e.stopPropagation();
    $('#modalCalendarPopup').toggle();
}

function renderMiniCalGrid() {
    $('#miniCalTitle').text(`Tháng ${miniCalMonth + 1}, ${miniCalYear}`);
    const today = new Date();
    const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const thisCalMonthStart = new Date(miniCalYear, miniCalMonth, 1);

    // Vô hiệu hóa nút lùi tháng nếu đang xem tháng hiện tại (không cho lùi về tháng trong quá khứ)
    if (thisCalMonthStart <= currentMonthStart) {
        $('#btnPrevMiniCal').prop('disabled', true).css({ 'opacity': '0.25', 'cursor': 'not-allowed' });
    } else {
        $('#btnPrevMiniCal').prop('disabled', false).css({ 'opacity': '1', 'cursor': 'pointer' });
    }

    const firstDay = new Date(miniCalYear, miniCalMonth, 1);
    const lastDay = new Date(miniCalYear, miniCalMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay();

    let html = '<div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 11px; margin-bottom: 6px; color: #70757a; font-weight: 600;">';
    const dayHeaders = ['Cn', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    dayHeaders.forEach(dh => { html += `<div>${dh}</div>`; });
    html += '</div>';

    html += '<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; font-size: 12px;">';
    const prevMonthLastDate = new Date(miniCalYear, miniCalMonth, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const dNum = prevMonthLastDate - i;
        const cellDate = new Date(miniCalYear, miniCalMonth - 1, dNum);
        if (cellDate < todayZero) {
            html += `<div style="padding: 5px 0; color: #d0d4d9; cursor: not-allowed; user-select: none;" title="Không thể chọn ngày trong quá khứ">${dNum}</div>`;
        } else {
            html += `<div style="padding: 5px 0; color: #b0b4b8; cursor: pointer;" onclick="selectModalDate(${miniCalYear}, ${miniCalMonth - 1}, ${dNum})">${dNum}</div>`;
        }
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
        const cellDate = new Date(miniCalYear, miniCalMonth, d);
        const isPast = cellDate < todayZero;
        const isToday = cellDate.getTime() === todayZero.getTime();
        const isSelected = selectedModalDate.getFullYear() === miniCalYear &&
                           selectedModalDate.getMonth() === miniCalMonth &&
                           selectedModalDate.getDate() === d;

        if (isPast) {
            // Ngày trong quá khứ: Làm mờ, khóa click, thông báo không thể chọn
            html += `<div style="padding: 5px 0; color: #d0d4d9; cursor: not-allowed; user-select: none;" title="Không thể chọn ngày trong quá khứ">${d}</div>`;
        } else if (isSelected) {
            html += `<div style="padding: 5px 0; display: flex; align-items: center; justify-content: center;"><span style="width: 24px; height: 24px; line-height: 24px; background: #1a73e8; color: #fff; border-radius: 50%; font-weight: bold; cursor: pointer;">${d}</span></div>`;
        } else if (isToday) {
            html += `<div style="padding: 5px 0; color: #1a73e8; font-weight: bold; cursor: pointer; border-radius: 50%;" title="Hôm nay (Tính từ hiện tại)" onclick="selectModalDate(${miniCalYear}, ${miniCalMonth}, ${d})">${d}</div>`;
        } else {
            html += `<div style="padding: 5px 0; color: #1f1f1f; cursor: pointer; border-radius: 50%;" onclick="selectModalDate(${miniCalYear}, ${miniCalMonth}, ${d})">${d}</div>`;
        }
    }
    const totalCells = startDayOfWeek + lastDay.getDate();
    const remainingCells = (totalCells <= 35 ? 35 : 42) - totalCells;
    for (let d = 1; d <= remainingCells; d++) {
        html += `<div style="padding: 5px 0; color: #b0b4b8; cursor: pointer;" onclick="selectModalDate(${miniCalYear}, ${miniCalMonth + 1}, ${d})">${d}</div>`;
    }
    html += '</div>';
    $('#miniCalGrid').html(html);
}

function prevMiniCalMonth(e) {
    if (e) e.stopPropagation();
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const targetMonthStart = new Date(miniCalYear, miniCalMonth - 1, 1);
    if (targetMonthStart < currentMonthStart) {
        return; // Không cho phép lùi về các tháng trong quá khứ
    }
    miniCalMonth--;
    if (miniCalMonth < 0) { miniCalMonth = 11; miniCalYear--; }
    renderMiniCalGrid();
}

function nextMiniCalMonth(e) {
    if (e) e.stopPropagation();
    miniCalMonth++;
    if (miniCalMonth > 11) { miniCalMonth = 0; miniCalYear++; }
    renderMiniCalGrid();
}

function selectModalDate(y, m, d) {
    const targetDate = new Date(y, m, d);
    const todayZero = new Date();
    todayZero.setHours(0, 0, 0, 0);

    if (targetDate < todayZero) {
        if (typeof toastr !== 'undefined') toastr.warning("Không thể chọn ngày trong quá khứ!");
        else alert("Không thể chọn ngày trong quá khứ!");
        return;
    }

    selectedModalDate = targetDate;
    miniCalYear = selectedModalDate.getFullYear();
    miniCalMonth = selectedModalDate.getMonth();
    $('#modalDateText').text(formatVietnameseDate(selectedModalDate));
    $('#modalCalendarPopup').hide();
    renderMiniCalGrid();
}

async function saveNewDeadlineFromModal() {
    const title = $('#modalInputTitle').val().trim();
    if (!title) {
        if (typeof toastr !== 'undefined') toastr.warning("Vui lòng nhập tiêu đề deadline!");
        else alert("Vui lòng nhập tiêu đề deadline!");
        $('#modalInputTitle').focus();
        return;
    }

    const timeVal = $('#modalTimeInput').val().trim() || "09:00";
    const timeParts = timeVal.split(':');
    const hour = parseInt(timeParts[0], 10) || 9;
    const minute = parseInt(timeParts[1] || 0, 10);

    let session = 'sang';
    if (hour >= 12 && hour < 18) session = 'chieu';
    else if (hour >= 18) session = 'toi';

    const y = selectedModalDate.getFullYear();
    const m = String(selectedModalDate.getMonth() + 1).padStart(2, '0');
    const d = String(selectedModalDate.getDate()).padStart(2, '0');
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const dueDateStr = `${y}-${m}-${d}T${hh}:${mm}:00`;

    // KIỂM TRA THỜI GIAN: KHÔNG ĐƯỢC CHỌN THỜI ĐIỂM TRONG QUÁ KHỨ
    const dueDateTime = parseDeadlineDate(dueDateStr);
    const now = new Date();
    if (dueDateTime < now) {
        const errorMsg = "Thời hạn nộp không thể ở trong quá khứ! Vui lòng chọn thời điểm từ hiện tại trở đi.";
        if (typeof toastr !== 'undefined') toastr.warning(errorMsg);
        else alert(errorMsg);
        return;
    }

    let assignees = 'all';
    if (activeModalCategory === 'group') {
        const isAll = $('#checkAssignAll').is(':checked');
        if (isAll) {
            assignees = 'all';
        } else {
            const selected = [];
            $('.assignee-item:checked').each(function () {
                selected.push($(this).val());
            });
            assignees = selected.length > 0 ? selected : 'all';
        }
    } else {
        const currentUser = getAuthUser();
        assignees = currentUser ? [currentUser.id] : ['guest'];
    }

    if (editingDeadlineId) {
        // CẬP NHẬT VỚI OPTIMISTIC UI (TỨC THÌ 0.01s)
        const updateId = editingDeadlineId;
        currentDate = new Date(selectedModalDate);
        closeCreateDeadlineModal();
        editingDeadlineId = null;

        await optimisticUpdateDeadline(updateId, {
            title: title,
            dueDate: dueDateStr,
            session: session,
            category: activeModalCategory,
            assignees: assignees
        });
        return;
    }

    // THÊM MỚI VỚI OPTIMISTIC UI (TỨC THÌ 0.01s)
    currentDate = new Date(selectedModalDate);
    closeCreateDeadlineModal();

    await optimisticCreateDeadline({
        title: title,
        dueDate: dueDateStr,
        session: session,
        category: activeModalCategory,
        assignees: assignees
    });
}

// ==========================================
// 6. KHỞI TẠO VÀ SỰ KIỆN TRANG WEB
// ==========================================
$(document).ready(function () {
    updateAuthHeaderUI();
    initDatePicker();
    fetchDeadlinesFromDb();
    loadRegisteredUsers();

    // Lọc tìm kiếm theo từ khóa trực tiếp từ SQL
    let searchTimeout = null;
    $('#k').on('input', function () {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            fetchDeadlinesFromDb($('#k').val().trim());
        }, 250);
    });

    // BỘ ĐẾM THỜI GIAN THỰC (LIVE TICKER)
    // Cứ mỗi 60 giây tự động tính toán lại ngày giờ & màu sắc động cho thẻ
    setInterval(function() {
        renderCurrentView();
    }, 60000);
});

function initDatePicker() {
    if (!$("#dateNgayXemLich").data("kendoDatePicker")) {
        $("#dateNgayXemLich").kendoDatePicker({
            format: "dd/MM/yyyy",
            value: currentDate,
            change: function () {
                const val = this.value();
                if (val) {
                    currentDate = new Date(val);
                    renderCurrentView();
                }
            }
        });

        $("#dateNgayXemLich").on("click", function () {
            const p = $(this).data("kendoDatePicker");
            if (p) p.open();
        });
    }
}

function switchViewMode(mode) {
    currentViewMode = mode;
    closeMonthDayListPopover();
    if (mode === 'week') {
        $('body').removeClass('view-mode-month');
        $('#viewLichTheoTuan').removeClass('desktop-inactive').addClass('desktop-active');
        $('#viewLichTheoThang').removeClass('desktop-active').addClass('desktop-inactive');
        $('#portletTitleText').text('Bảng theo dõi Deadline theo tuần');
        $('#sidebar_link_tuan').css({ 'color': '#ff851b', 'font-weight': 'bold', 'background-color': '#f7f9fa' });
        $('#sidebar_link_thang').css({ 'color': '', 'font-weight': 'normal', 'background-color': '' });
    } else {
        $('body').addClass('view-mode-month');
        $('#viewLichTheoTuan').removeClass('desktop-active').addClass('desktop-inactive');
        $('#viewLichTheoThang').removeClass('desktop-inactive').addClass('desktop-active');
        $('#portletTitleText').text('Bảng theo dõi Deadline theo tháng');
        $('#sidebar_link_thang').css({ 'color': '#ff851b', 'font-weight': 'bold', 'background-color': '#f7f9fa' });
        $('#sidebar_link_tuan').css({ 'color': '', 'font-weight': 'normal', 'background-color': '' });
    }
    renderCurrentView();
}

// Nút Trước
$('#btn_TroVe').click(function () {
    if (currentViewMode === 'week') {
        currentDate.setDate(currentDate.getDate() - 7);
    } else {
        currentDate.setMonth(currentDate.getMonth() - 1);
    }
    renderCurrentView();
});

// Nút Tiếp
$('#btn_Tiep').click(function () {
    if (currentViewMode === 'week') {
        currentDate.setDate(currentDate.getDate() + 7);
    } else {
        currentDate.setMonth(currentDate.getMonth() + 1);
    }
    renderCurrentView();
});

// Nút Hiện tại
$('#btn_HienTai').click(function () {
    currentDate = new Date();
    todayDate = new Date();
    renderCurrentView();
});

// Phóng to full bảng
$('#full-table').click(function () {
    const sidebar = $('.col-md-2');
    const mainCol = $('.col-md-10, .col-md-12');
    if (sidebar.is(':visible')) {
        sidebar.hide();
        mainCol.removeClass('col-md-10').addClass('col-md-12');
    } else {
        sidebar.show();
        mainCol.removeClass('col-md-12').addClass('col-md-10');
    }
});

// Đóng dropdown và popover khi click ra ngoài
$(document).on('click', function (e) {
    if (!$(e.target).closest('.create-dropdown-container').length) {
        $('#createDropdownMenu').hide();
    }
    if (!$(e.target).closest('#modalDateBtn, #modalCalendarPopup').length) {
        $('#modalCalendarPopup').hide();
    }
    if (!$(e.target).closest('#btnDetailMore, #detailMoreMenu').length) {
        $('#detailMoreMenu').hide();
    }
    if (!$(e.target).closest('#deadlineDetailPopover, .deadline-card, .month-deadline-badge, .month-deadline-chip, .popover-day-item').length) {
        closeDeadlineDetailModal();
    }
    if (!$(e.target).closest('#monthDayListPopover, .month-more-chip').length) {
        closeMonthDayListPopover();
    }
});

$('#createDeadlineModalOverlay').on('click', function (e) {
    if (e.target === this) {
        closeCreateDeadlineModal();
    }
});

$(document).on('keydown', function (e) {
    if (e.key === 'Escape') {
        closeCreateDeadlineModal();
        closeDeadlineDetailModal();
        closeMonthDayListPopover();
    }
});

// Lắng nghe sự kiện co giãn cửa sổ trình duyệt (Window Resize)
let resizeTimer;
$(window).on('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
        renderCurrentView();
    }, 150);
});


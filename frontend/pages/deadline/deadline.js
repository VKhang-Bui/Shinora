/**
 * DEADLINE TRACKER - JAVASCRIPT MODULE
 * Tối ưu hóa 2 tầng: HTTP Cache + Optimistic UI 2 Phân khu Local Cache
 */

const APP_VERSION = '1.0.6';

let currentDate = new Date(); // Mặc định thời điểm hôm nay thực tế của máy người dùng
let todayDate = new Date();    // Mốc thời gian thực để tính toán màu sắc và độ gấp
let currentViewMode = 'week';  // 'week' | 'month'
let currentDeadlines = [];     // Danh sách deadline gộp từ 2 phân khu

/**
 * Chép văn bản vào bộ nhớ tạm Clipboard (Hỗ trợ cả navigator.clipboard và fallback execCommand)
 */
function copyTextToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (typeof toastr !== 'undefined') toastr.success(`Đã sao chép: "${text}"`, '', { timeOut: 2000 });
        }).catch(() => {
            fallbackCopyText(text);
        });
    } else {
        fallbackCopyText(text);
    }
}
function fallbackCopyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        if (typeof toastr !== 'undefined') toastr.success(`Đã sao chép: "${text}"`, '', { timeOut: 2000 });
    } catch (err) {
        if (typeof toastr !== 'undefined') toastr.warning("Không thể sao chép tự động!");
    }
    document.body.removeChild(textArea);
}
window.copyTextToClipboard = copyTextToClipboard;

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
    if (!$(e.target).closest('#notifBellWrapper').length) {
        closeNotificationDropdown();
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
            // Nếu đang trong modal chỉnh sửa deadline: giữ nguyên danh sách của item đang chỉnh sửa
            if (editingDeadlineId) {
                const item = currentDeadlines.find(d => d.id === editingDeadlineId);
                if (item && item.category === 'group' && item.assignees && item.assignees !== 'all' && item.assignees !== '["all"]') {
                    let parsed = [];
                    try { parsed = typeof item.assignees === 'string' ? JSON.parse(item.assignees) : item.assignees; } catch(e) { parsed = [item.assignees]; }
                    renderAssigneesList(Array.isArray(parsed) ? parsed : [parsed]);
                    return;
                }
            }
            // Nếu người dùng đã tự tay tick chọn ô nào đó trong modal đang mở: bảo toàn ô đang tick
            const checkedVals = [];
            $('.assignee-item:checked').each(function () {
                checkedVals.push($(this).val());
            });
            if (checkedVals.length > 0) {
                renderAssigneesList(checkedVals);
            } else if ($('#checkAssignAll').length && !$('#checkAssignAll').is(':checked')) {
                // Đang mở mà đã bỏ tick "Toàn bộ nhóm" thì không tự động tick hết
                renderAssigneesList([]);
            } else {
                renderAssigneesList();
            }
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
    if (currentUser && !list.some(u => String(u.id).toLowerCase() === String(currentUser.id).toLowerCase())) {
        list.push({ id: currentUser.id, name: currentUser.name });
    }

    if (list.length === 0) {
        container.html('<span style="font-size: 11px; color: #70757a;">Chưa có thành viên nào khác. Bạn có thể nhập thêm bên dưới.</span>');
        return;
    }

    let normalizedSelected = null;
    if (Array.isArray(selectedIds)) {
        normalizedSelected = selectedIds.map(s => String(s).trim().toLowerCase());
    }

    let html = '';
    list.forEach(u => {
        const uIdLower = String(u.id).trim().toLowerCase();
        const uNameLower = String(u.name).trim().toLowerCase();
        let isChecked = false;
        if (normalizedSelected !== null) {
            isChecked = normalizedSelected.includes(uIdLower) || normalizedSelected.includes(uNameLower);
        } else {
            // Khi selectedIds === null (ví dụ khi tick "Toàn bộ nhóm" hoặc tạo mới lần đầu)
            isChecked = $('#checkAssignAll').length === 0 || $('#checkAssignAll').is(':checked');
        }

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
        // Giữ nguyên các ô đang được chọn hoặc render nếu chưa có
        if (!$('#assigneesList label').length) {
            renderAssigneesList([]);
        }
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
    checkDeadlineReminders();

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
            checkDeadlineReminders();
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
        assignees: dlData.assignees || 'all',
        isCompleted: dlData.isCompleted ? 1 : 0
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
                assignees: enrichedData.assignees,
                groupName: dlData.groupName || null,
                groupLink: dlData.groupLink || null,
                description: dlData.description || null,
                isCompleted: dlData.isCompleted ? 1 : 0
            })
        });
        const result = await res.json();
        if (result.success && result.data) {
            setPendingCache(getPendingCache().filter(p => p.id !== tempId));
            const confirmed = getConfirmedCache().filter(c => c.id !== tempId);
            const mergedCreate = { ...enrichedData, ...result.data };
            confirmed.push(mergedCreate);
            setConfirmedCache(confirmed);

            currentDeadlines = computeEffectiveDeadlines();
            renderCurrentView();
            if (typeof toastr !== 'undefined') {
                toastr.success(`Đã lưu "${dlData.title}" thành công vào CSDL!`);
            }
            return mergedCreate;
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
            const mergedUpdate = { ...dlData, ...result.data };
            confirmed.push(mergedUpdate);
            setConfirmedCache(confirmed);

            currentDeadlines = computeEffectiveDeadlines();
            renderCurrentView();
            if (typeof toastr !== 'undefined') toastr.success(`Đã cập nhật deadline thành công!`);
            return mergedUpdate;
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
        return { bg: "#e9ecef", border: "#adb5bd", text: "#495057", label: "khác" };
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

        const checkBtn = item.isCompleted 
            ? `<span class="deadline-check-btn completed" onclick="toggleDeadlineComplete('${item.id}', event)" title="Đã xong / Bỏ đánh dấu">
                <i class="fa fa-check-circle" style="color: #495057; font-size: 13.5px;"></i>
               </span>` 
            : '';

        let cardHtml = `
            <div class="content text-start deadline-card" onclick="showDeadlineDetail('${item.id}', event, this)" title="Hạn chót: ${fullTimeStr} | ${badgeText}" style="background-color: ${styleInfo.bg}; border: 1.5px solid ${styleInfo.border}; ${cardExtraStyle} color: ${styleInfo.text}; padding: 7px 9px; margin-bottom: 6px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: left;">
                <!-- HEADER THẺ (PHƯƠNG ÁN C): NÚT TÍCH + GIỜ HẠN CHÓT + BADGE THỜI GIAN CÒN LẠI -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; padding-bottom: 4px; border-bottom: 1px dashed rgba(0,0,0,0.18);">
                    <div style="font-size: 11.5px; font-weight: 700; color: ${styleInfo.text}; display: flex; align-items: center; gap: 4px;">
                        ${checkBtn}
                        <i class="fa fa-clock-o" aria-hidden="true" style="font-size: 11px;"></i> <span>${timeOnly}</span>
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

            const checkIcon = dl.isCompleted ? '<i class="fa fa-check" style="font-size: 10px; margin-right: 3px; color: #495057;"></i>' : '';
            chipsHtml += `
                <div class="month-deadline-chip" onclick="showDeadlineDetail('${dl.id}', event, this)" title="${escapeHtml(dl.title)} (Hạn: ${timeOnly})" style="background-color: ${styleInfo.bg}; border-left-color: ${styleInfo.border} !important; color: ${styleInfo.text};">
                    ${checkIcon}<span class="month-chip-title">${escapeHtml(dl.title)}</span>
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

        const checkIcon = dl.isCompleted ? '<i class="fa fa-check" style="font-size: 11px; margin-right: 4px; color: #495057;"></i>' : '';
        itemsHtml += `
            <div class="popover-day-item" onclick="closeMonthDayListPopover(); showDeadlineDetail('${dl.id}', event, this);" style="background-color: ${styleInfo.bg}; border-left-color: ${styleInfo.border} !important; color: ${styleInfo.text};">
                <span class="popover-day-title" title="${escapeHtml(dl.title)}">${checkIcon}${escapeHtml(dl.title)}</span>
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

                const checkBtn = item.isCompleted 
                    ? `<span class="deadline-check-btn completed" onclick="toggleDeadlineComplete('${item.id}', event)" title="Đã xong / Bỏ đánh dấu">
                        <i class="fa fa-check-circle" style="color: #495057; font-size: 14px;"></i>
                       </span>` 
                    : '';

                cardsHtml += `
                    <div class="m-deadline-card" onclick="showDeadlineDetail('${item.id}', event, this)" style="background-color: ${styleInfo.bg}; border-color: ${styleInfo.border}; color: ${styleInfo.text};">
                        <div class="m-card-header">
                            <div class="m-card-time" style="color: ${styleInfo.text}; display: flex; align-items: center; gap: 4px;">
                                ${checkBtn}
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

    // HIỂN THỊ THÔNG TIN NHÓM / KÊNH LÀM VIỆC (ZALO, TELEGRAM...)
    const hasGroupName = Boolean(item.groupName && item.groupName.trim());
    const hasGroupLink = Boolean(item.groupLink && item.groupLink.trim());

    if (hasGroupName || hasGroupLink) {
        let groupHtml = '';
        if (hasGroupLink) {
            let targetUrl = item.groupLink.trim();
            if (!/^https?:\/\//i.test(targetUrl)) {
                targetUrl = 'https://' + targetUrl;
            }
            const displayLabel = hasGroupName ? item.groupName.trim() : item.groupLink.trim();
            groupHtml = `
                <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" style="color: #1a73e8; font-weight: 600; text-decoration: underline; text-underline-offset: 2px;" title="Mở nhóm">
                    ${escapeHtml(displayLabel)}
                </a>
            `;
        } else {
            // Chỉ có tên nhóm (không có link)
            groupHtml = `
                <span style="font-weight: 600; color: #202124;">${escapeHtml(item.groupName.trim())}</span>
                <button type="button" class="btn-copy-mini" onclick="copyTextToClipboard('${escapeHtml(item.groupName.trim())}')" title="Sao chép tên nhóm">
                    <i class="fa fa-clone"></i> copy
                </button>
            `;
        }
        $('#detailGroupContent').html(groupHtml);
        $('#detailGroupRow').css('display', 'flex');
    } else {
        $('#detailGroupRow').hide();
    }

    // HIỂN THỊ MÔ TẢ CHI TIẾT / GHI CHÚ
    if (item.description && item.description.trim()) {
        $('#detailDescriptionText').text(item.description.trim());
        $('#detailDescriptionRow').css('display', 'flex');
    } else {
        $('#detailDescriptionRow').hide();
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

async function toggleDeadlineComplete(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const item = currentDeadlines.find(d => d.id === id);
    if (!item) return;

    const nextCompleted = item.isCompleted ? 0 : 1;
    await optimisticUpdateDeadline(id, {
        isCompleted: nextCompleted
    });

    if (nextCompleted === 1) {
        if (typeof toastr !== 'undefined') {
            toastr.success('Đã đánh dấu xong!', '', { timeOut: 1500 });
        }
    }
}
window.toggleDeadlineComplete = toggleDeadlineComplete;

async function toggleDeadlineCompleteFromDetail(id, event) {
    const targetId = id || currentDetailId;
    if (!targetId) return;
    await toggleDeadlineComplete(targetId, event);
    if (currentDetailId === targetId) {
        setTimeout(() => {
            showDeadlineDetail(targetId);
        }, 80);
    }
}
window.toggleDeadlineCompleteFromDetail = toggleDeadlineCompleteFromDetail;

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
    $('#modalInputGroupName').val("");
    $('#modalInputGroupLink').val("");
    $('#modalInputDescription').val("");
    $('#modalInputCompleted').prop('checked', false);
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
    $('#modalInputGroupName').val(item.groupName || "");
    $('#modalInputGroupLink').val(item.groupLink || "");
    $('#modalInputDescription').val(item.description || "");
    $('#modalInputCompleted').prop('checked', Boolean(item.isCompleted));

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
        if (!cachedRegisteredUsers || cachedRegisteredUsers.length === 0) {
            loadRegisteredUsers();
        }
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

    const groupName = $('#modalInputGroupName').val().trim() || null;
    const groupLink = $('#modalInputGroupLink').val().trim() || null;
    const description = $('#modalInputDescription').val().trim() || null;
    const isCompleted = $('#modalInputCompleted').is(':checked') ? 1 : 0;

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
            assignees: assignees,
            groupName: groupName,
            groupLink: groupLink,
            description: description,
            isCompleted: isCompleted
        });
        return;
    }

    // THÊM MỚI VỚI OPTIMISTIC UI (TỨC THÌ 0.01s)
    currentDate = new Date(selectedModalDate);
    closeCreateDeadlineModal();

    const createdDl = await optimisticCreateDeadline({
        title: title,
        dueDate: dueDateStr,
        session: session,
        category: activeModalCategory,
        assignees: assignees,
        groupName: groupName,
        groupLink: groupLink,
        description: description,
        isCompleted: isCompleted
    });

    if (createdDl) {
        addNotification({
            deadlineId: createdDl.id,
            type: 'info',
            title: '🆕 Deadline mới đã tạo',
            message: `${title} · ${formatVietnameseDate(selectedModalDate)}`,
            dueDate: dueDateStr
        });
    }
}

// ==========================================
// 6. KHỞI TẠO VÀ SỰ KIỆN TRANG WEB
// ==========================================
$(document).ready(function () {
    updateAuthHeaderUI();
    initDatePicker();
    fetchDeadlinesFromDb();
    loadRegisteredUsers();
    updateNotifBadge();
    renderNotificationList();
    initServiceWorker();

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

    // QUÉT VÀ THÔNG BÁO HẠN CHÓT ĐỊNH KỲ MỖI 30 GIÂY
    setInterval(function() {
        checkDeadlineReminders();
    }, 30000);
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

// ==========================================
// 7. HỆ THỐNG THÔNG BÁO HẠN CHÓT (NOTIFICATION CENTER)
// ==========================================
function getNotifStorageKey() {
    const user = getAuthUser();
    return user ? `deadline_notifs_${user.id}` : 'deadline_notifs_guest';
}

function getStoredNotifications() {
    try {
        const raw = localStorage.getItem(getNotifStorageKey());
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveStoredNotifications(list) {
    try {
        localStorage.setItem(getNotifStorageKey(), JSON.stringify(list.slice(0, 50)));
    } catch (e) {
        console.error('[Save Notifs Error]:', e);
    }
    updateNotifBadge();
    renderNotificationList();
}

function addNotification({ deadlineId, type, title, message, dueDate }) {
    const list = getStoredNotifications();
    const newNotif = {
        id: 'notif-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        deadlineId: deadlineId || null,
        type: type || 'info', // 'urgent' | 'warning' | 'info'
        title,
        message,
        dueDate: dueDate || null,
        isRead: false,
        createdAt: new Date().toISOString()
    };
    list.unshift(newNotif);
    saveStoredNotifications(list);

    // Kích hoạt Web Notification native của trình duyệt nếu người dùng đã cho phép
    sendBrowserNativeNotification(title, message);
}
window.addNotification = addNotification;

function updateNotifBadge() {
    const list = getStoredNotifications();
    const unreadCount = list.filter(n => !n.isRead).length;
    const badge = $('#notifBadge');
    if (unreadCount > 0) {
        badge.text(unreadCount > 99 ? '99+' : unreadCount).show();
    } else {
        badge.hide();
    }
}
window.updateNotifBadge = updateNotifBadge;

function renderNotificationList() {
    const list = getStoredNotifications();
    const container = $('#notificationList');
    if (!container.length) return;

    if (list.length === 0) {
        container.html(`
            <div style="padding: 26px 16px; text-align: center; color: #70757a; font-size: 12.5px;">
                <i class="fa fa-bell-slash-o" style="font-size: 24px; color: #dadce0; margin-bottom: 8px; display: block;"></i>
                Chưa có thông báo nhắc hẹn nào.
            </div>
        `);
        return;
    }

    let html = '';
    list.forEach(n => {
        let iconHtml = '<i class="fa fa-bell" style="color: #1a73e8; font-size: 13px;"></i>';
        if (n.type === 'urgent') {
            iconHtml = '<i class="fa fa-exclamation-circle" style="color: #d93025; font-size: 14px;"></i>';
        } else if (n.type === 'warning') {
            iconHtml = '<i class="fa fa-clock-o" style="color: #f2994a; font-size: 14px;"></i>';
        }

        const readStyle = n.isRead ? 'opacity: 0.7;' : 'font-weight: 600;';

        html += `
            <div class="notif-item ${n.type}" onclick="handleNotifClick('${n.id}', '${n.deadlineId || ''}')" style="${readStyle}">
                <div style="margin-top: 2px;">${iconHtml}</div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 12.5px; color: #202124; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(n.title)}
                    </div>
                    <div style="font-size: 11.5px; color: #5f6368; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(n.message)}
                    </div>
                </div>
            </div>
        `;
    });
    container.html(html);
}
window.renderNotificationList = renderNotificationList;

function toggleNotificationDropdown(event) {
    if (event) event.stopPropagation();
    closeUserDropdown();
    const dropdown = $('#notificationDropdown');
    const isVisible = dropdown.is(':visible');
    if (!isVisible) {
        requestBrowserNotificationPermission();
        renderNotificationList();
    }
    dropdown.stop(true, true).slideToggle(160);
}
window.toggleNotificationDropdown = toggleNotificationDropdown;

function closeNotificationDropdown() {
    $('#notificationDropdown').stop(true, true).slideUp(120);
}
window.closeNotificationDropdown = closeNotificationDropdown;

function clearAllNotifications(event) {
    if (event) event.stopPropagation();
    const list = getStoredNotifications().map(n => ({ ...n, isRead: true }));
    saveStoredNotifications(list);
}
window.clearAllNotifications = clearAllNotifications;

function handleNotifClick(notifId, deadlineId) {
    const list = getStoredNotifications();
    const found = list.find(n => n.id === notifId);
    if (found) {
        found.isRead = true;
        saveStoredNotifications(list);
    }
    closeNotificationDropdown();

    if (deadlineId) {
        const item = currentDeadlines.find(d => d.id === deadlineId);
        if (item) {
            currentDate = parseDeadlineDate(item.dueDate);
            renderCurrentView();
            setTimeout(() => {
                showDeadlineDetail(deadlineId);
            }, 120);
        }
    }
}
window.handleNotifClick = handleNotifClick;

// QUÉT VÀ THÔNG BÁO TỰ ĐỘNG THEO THỜI GIAN THẬT
function checkDeadlineReminders() {
    const user = getAuthUser();
    const now = new Date();

    currentDeadlines.forEach(item => {
        // Chỉ nhắc deadline chưa hoàn thành
        if (item.isCompleted) return;

        // Nếu đã đăng nhập: chỉ nhắc deadline liên quan tới user
        if (user) {
            if (item.category === 'personal' && item.userId && item.userId !== user.id) return;
            if (item.category === 'group' && item.assignees && item.assignees !== 'all' && item.assignees !== '["all"]') {
                let parsed = [];
                try { parsed = typeof item.assignees === 'string' ? JSON.parse(item.assignees) : item.assignees; } catch (e) { parsed = [String(item.assignees)]; }
                if (Array.isArray(parsed) && parsed.length > 0 && !parsed.includes('all') && !parsed.includes(user.id)) {
                    return;
                }
            }
        }

        const dueObj = parseDeadlineDate(item.dueDate);
        const diffMs = dueObj.getTime() - now.getTime();

        if (diffMs <= 0) return; // Quá hạn thì không nhắc

        // 1. MỐC KHẨN CẤP: CÒN <= 30 PHÚT
        const key30m = `notified_dl_${item.id}_30m`;
        if (diffMs <= 30 * 60 * 1000) {
            if (!localStorage.getItem(key30m)) {
                localStorage.setItem(key30m, '1');
                const minsLeft = Math.max(1, Math.round(diffMs / 60000));
                addNotification({
                    deadlineId: item.id,
                    type: 'urgent',
                    title: `🚨 GẤP: Chỉ còn ${minsLeft} phút!`,
                    message: item.title,
                    dueDate: item.dueDate
                });
                if (typeof toastr !== 'undefined') {
                    toastr.error(`🚨 KHẨN CẤP: Deadline "${item.title}" chỉ còn ${minsLeft} phút!`, 'Hạn chót sắp tới', { timeOut: 8000 });
                }
            }
        }

        // 2. MỐC NHẮC NHỞ: CÒN <= 3 NGÀY (VÀ > 30 PHÚT)
        const key3d = `notified_dl_${item.id}_3d`;
        if (diffMs <= 3 * 24 * 60 * 60 * 1000 && diffMs > 30 * 60 * 1000) {
            if (!localStorage.getItem(key3d)) {
                localStorage.setItem(key3d, '1');
                const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
                addNotification({
                    deadlineId: item.id,
                    type: 'warning',
                    title: `⏰ Sắp đến hạn: Còn ${daysLeft} ngày`,
                    message: item.title,
                    dueDate: item.dueDate
                });
                if (typeof toastr !== 'undefined') {
                    toastr.warning(`⏰ Nhắc nhở: Deadline "${item.title}" còn ${daysLeft} ngày nữa!`, 'Sắp đến hạn', { timeOut: 5000 });
                }
            }
        }
    });
}
window.checkDeadlineReminders = checkDeadlineReminders;

function requestBrowserNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function sendBrowserNativeNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(title, {
                body: body,
                icon: '/shared/favicon.ico'
            });
        } catch (e) {}
    }
}

// ==========================================
// 8. TÍCH HỢP SERVICE WORKER & WEB PUSH NOTIFICATION
// ==========================================
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Kiểm tra toàn diện năng lực Web Push trên thiết bị hiện tại (Desktop, Android, iOS Safari PWA)
function checkWebPushCapabilities() {
    const hasServiceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
    const hasPushManager = typeof window !== 'undefined' && 'PushManager' in window;
    const hasNotification = typeof window !== 'undefined' && 'Notification' in window;

    // Phát hiện iOS (iPhone, iPad, iPod)
    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    // Kiểm tra xem trang có đang chạy ở chế độ PWA (Standalone / Đã thêm vào màn hình chính) không
    const isStandalone = typeof window !== 'undefined' && (window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));

    return {
        hasServiceWorker,
        hasPushManager,
        hasNotification,
        isIOS,
        isStandalone,
        isSupported: hasServiceWorker && hasPushManager && hasNotification
    };
}
window.checkWebPushCapabilities = checkWebPushCapabilities;

// Hàm an toàn chờ Service Worker sẵn sàng với timeout để không bao giờ bị treo vô tận
function getServiceWorkerReadyWithTimeout(timeoutMs = 3500) {
    if (!('serviceWorker' in navigator)) {
        return Promise.reject(new Error('Trình duyệt không hỗ trợ Service Worker'));
    }
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Quá thời gian chờ Service Worker (timeout 3.5s)')), timeoutMs))
    ]);
}

// Đảm bảo và tự động đăng ký Push Subscription với máy chủ
async function ensurePushSubscription() {
    const caps = checkWebPushCapabilities();
    if (!caps.isSupported) {
        if (caps.isIOS && !caps.isStandalone) {
            throw new Error('Trên iPhone (iOS), bạn hãy bấm nút Chia sẻ (Share) -> Thêm vào MH chính (Add to Home Screen) để bật thông báo đẩy khi đóng web!');
        }
        throw new Error('Trình duyệt trên thiết bị này không hỗ trợ Web Push ngoài màn hình (yêu cầu Chrome, Safari PWA hoặc Edge có hỗ trợ Service Worker).');
    }

    // 1. Kiểm tra / Xin quyền thông báo hệ điều hành
    let permission = Notification.permission;
    if (permission === 'default') {
        permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
        throw new Error('Bạn chưa cấp quyền thông báo cho trình duyệt. Vui lòng bấm [Cho phép] (Allow) để nhận thông báo vào thiết bị!');
    }

    // 2. Chờ Service Worker với timeout bảo vệ 3.5s
    let registration = null;
    try {
        registration = await getServiceWorkerReadyWithTimeout(3500);
    } catch (e) {
        try {
            registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            await new Promise(r => setTimeout(r, 400));
        } catch (regErr) {
            throw new Error('Không thể khởi động Service Worker: ' + regErr.message);
        }
    }

    if (!registration) {
        throw new Error('Service Worker chưa sẵn sàng. Vui lòng tải lại trang.');
    }

    // 3. Lấy hoặc tạo mới subscription
    let sub = await registration.pushManager.getSubscription();
    if (!sub) {
        let resKey = null;
        try {
            const resp = await fetch('/api/push/vapid-key');
            resKey = await resp.json();
        } catch (err) {
            throw new Error('Không thể kết nối máy chủ để lấy VAPID Public Key: ' + err.message);
        }

        if (!resKey || !resKey.success || !resKey.publicKey) {
            throw new Error(resKey?.message || 'Không lấy được Public Key từ máy chủ');
        }

        const convertedKey = urlBase64ToUint8Array(resKey.publicKey);
        sub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey
        });
    }

    // 4. Lưu / Cập nhật subscription lên cơ sở dữ liệu
    const user = getAuthUser();
    try {
        await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription: sub,
                userId: user ? user.id : 'guest'
            })
        });
    } catch (saveErr) {
        console.warn('[Auto Push Subscribe Save Warning]:', saveErr.message);
    }

    return sub;
}
window.ensurePushSubscription = ensurePushSubscription;

async function initServiceWorker() {
    const caps = checkWebPushCapabilities();
    if (!caps.hasServiceWorker) return;

    try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[Service Worker] Đã đăng ký thành công với scope:', registration.scope);

        // Nếu đã từng cấp quyền trước đó, tự động đồng bộ subscription với máy chủ
        if (caps.hasNotification && Notification.permission === 'granted' && caps.hasPushManager) {
            ensurePushSubscription().catch(e => console.warn('[Auto Push Sync]:', e.message));
        }
    } catch (err) {
        console.warn('[Service Worker] Không thể đăng ký:', err);
    }
}
window.initServiceWorker = initServiceWorker;

// Kiểm tra và cập nhật giao diện Trạng thái Push trong Drawer Trợ giúp
async function refreshHelpPushUI() {
    const badge = $('#helpPushStatusBadge');
    const toggleWrapper = $('#helpPushToggleWrapper');
    const btnToggle = $('#btnToggleHelpPush');
    const guideBox = $('#helpPushBlockedGuide');
    if (!badge.length) return;

    const caps = checkWebPushCapabilities();

    // 1. Kiểm tra môi trường iOS chưa thêm vào Màn hình chính
    if (caps.isIOS && !caps.isStandalone) {
        badge.css({ background: '#fff8e1', color: '#b06000', border: '1px solid #ffe082' })
            .html('<i class="fa fa-apple"></i> <strong>Lưu ý cho iPhone:</strong> Trên iOS, để nhận thông báo khi đóng web bạn hãy bấm nút <strong>Chia sẻ (Share) <i class="fa fa-share-square-o"></i></strong> trong Safari rồi chọn <strong>"Thêm vào MH chính" (Add to Home Screen)</strong>.');
        if (toggleWrapper.length) toggleWrapper.hide();
        if (guideBox.length) guideBox.hide();
        return;
    }

    // 2. Trình duyệt không hỗ trợ Service Worker / Push / Notification
    if (!caps.isSupported) {
        badge.css({ background: '#f8f9fa', color: '#5f6368', border: '1px solid #e8eaed' })
            .html('<i class="fa fa-info-circle" style="color: #1a73e8;"></i> <strong>Thông báo chuông trong web đang hoạt động:</strong> Trình duyệt này hỗ trợ đầy đủ chuông báo & âm thanh khi mở web. (Web Push ngoài màn hình khi đóng web yêu cầu Chrome, Safari PWA hoặc Edge có hỗ trợ Service Worker).');
        if (toggleWrapper.length) toggleWrapper.hide();
        if (guideBox.length) guideBox.hide();
        return;
    }

    // 3. Quyền thông báo bị chặn
    if (Notification.permission === 'denied') {
        badge.css({ background: '#fce8e6', color: '#d93025', border: '1px solid #fad2cf' })
            .html('<i class="fa fa-ban"></i> <strong>Quyền thông báo đang bị chặn:</strong> Trình duyệt chưa cấp quyền hiển thị thông báo ngoài màn hình.');
        if (toggleWrapper.length) toggleWrapper.show();
        btnToggle.removeClass('btn-help-action-primary').css({ background: '#fce8e6', color: '#d93025', border: '1px solid #fad2cf' })
            .html('<i class="fa fa-unlock-alt"></i> Bị chặn - Xem hướng dẫn mở khóa bên dưới')
            .prop('disabled', true);
        if (guideBox.length) guideBox.show();
        return;
    }

    // 4. Kiểm tra subscription thực tế
    try {
        const registration = await getServiceWorkerReadyWithTimeout(3000);
        const subscription = await registration.pushManager.getSubscription();

        if (subscription && Notification.permission === 'granted') {
            badge.css({ background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' })
                .html('<i class="fa fa-check-circle"></i> <strong>Đang hoạt động:</strong> Thiết bị đã sẵn sàng nhận thông báo ngoài màn hình ngay cả khi đóng web.');
            if (toggleWrapper.length) toggleWrapper.show();
            btnToggle.removeClass('btn-help-action-primary')
                .css({ background: '#f1f3f4', color: '#5f6368', border: '1px solid #dadce0' })
                .html('<i class="fa fa-bell-slash-o"></i> Tắt thông báo ngoài màn hình')
                .prop('disabled', false);
            if (guideBox.length) guideBox.hide();
        } else if (Notification.permission === 'granted') {
            badge.css({ background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc' })
                .html('<i class="fa fa-check"></i> <strong>Đã cấp quyền:</strong> Bấm nút bên dưới để đồng bộ nhận thông báo hạn chót ngoài màn hình.');
            if (toggleWrapper.length) toggleWrapper.show();
            btnToggle.addClass('btn-help-action-primary')
                .css({ background: '#1a73e8', color: '#ffffff', border: 'none' })
                .html('<i class="fa fa-bell"></i> Kết nối thông báo thiết bị')
                .prop('disabled', false);
            if (guideBox.length) guideBox.hide();
        } else {
            badge.css({ background: '#f8f9fa', color: '#5f6368', border: '1px solid #dadce0' })
                .html('<i class="fa fa-info-circle" style="color: #1a73e8;"></i> <strong>Chưa kích hoạt:</strong> Bấm nút bên dưới để nhận thông báo hạn chót ngoài màn hình ngay cả khi đóng web.');
            if (toggleWrapper.length) toggleWrapper.show();
            btnToggle.addClass('btn-help-action-primary')
                .css({ background: '#1a73e8', color: '#ffffff', border: 'none' })
                .html('<i class="fa fa-bell"></i> Bật thông báo trên thiết bị')
                .prop('disabled', false);
            if (guideBox.length) guideBox.hide();
        }
    } catch (e) {
        badge.css({ background: '#f8f9fa', color: '#5f6368', border: '1px solid #dadce0' })
            .html('<i class="fa fa-info-circle"></i> Bấm nút bên dưới để cấp quyền thông báo ngoài màn hình.');
        if (toggleWrapper.length) toggleWrapper.show();
        btnToggle.addClass('btn-help-action-primary')
            .css({ background: '#1a73e8', color: '#ffffff', border: 'none' })
            .html('<i class="fa fa-bell"></i> Bật thông báo trên thiết bị')
            .prop('disabled', false);
        if (guideBox.length) guideBox.hide();
    }
}
window.refreshHelpPushUI = refreshHelpPushUI;

async function actionTogglePushFromHelp() {
    const caps = checkWebPushCapabilities();
    if (!caps.isSupported) {
        if (caps.isIOS && !caps.isStandalone) {
            if (typeof toastr !== 'undefined') toastr.warning('Trên iPhone, vui lòng chọn Chia sẻ -> Thêm vào MH chính để bật thông báo!');
            return;
        }
        if (typeof toastr !== 'undefined') toastr.error('Trình duyệt không hỗ trợ Web Push ngoài màn hình');
        return;
    }

    try {
        const registration = await getServiceWorkerReadyWithTimeout(3500);
        const currentSub = await registration.pushManager.getSubscription();

        if (currentSub) {
            // Tắt
            await fetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: currentSub.endpoint })
            });
            await currentSub.unsubscribe();
            if (typeof toastr !== 'undefined') toastr.info('Đã tắt thông báo ngoài màn hình.');
            refreshHelpPushUI();
        } else {
            // Bật
            await ensurePushSubscription();
            if (typeof toastr !== 'undefined') {
                toastr.success('Đã kích hoạt thông báo trên thiết bị thành công!', 'Thành công');
            }
            refreshHelpPushUI();
        }
    } catch (err) {
        console.error('[Help Push Toggle Error]:', err);
        if (typeof toastr !== 'undefined') toastr.error(err.message, 'Lỗi thiết lập');
        refreshHelpPushUI();
    }
}
window.actionTogglePushFromHelp = actionTogglePushFromHelp;

let helpCountdownInterval = null;

function startHelpCountdown(totalSeconds = 10) {
    const btn = $('#btnTestHelpPush');
    btn.prop('disabled', true);
    $('#helpTestCountdownNotice').show();

    let count = totalSeconds;
    $('#helpCountdownSeconds').text(count);
    btn.html(`<i class="fa fa-hourglass-half fa-spin"></i> Đang chờ ${count}s...`);

    clearInterval(helpCountdownInterval);
    helpCountdownInterval = setInterval(() => {
        count--;
        $('#helpCountdownSeconds').text(count);
        btn.html(`<i class="fa fa-hourglass-half fa-spin"></i> Đang chờ ${count}s...`);

        if (count <= 0) {
            clearInterval(helpCountdownInterval);
            btn.prop('disabled', false).html('<i class="fa fa-clock-o"></i> Test thông báo (Đếm ngược 10s)');
            $('#helpTestCountdownNotice').hide();

            // 1. Thêm 1 thông báo thực tế vào chuông
            addNotification({
                deadlineId: null,
                type: 'urgent',
                title: '🧪 Hạn chót thử nghiệm (Báo cáo Tiến độ)',
                message: 'Hệ thống đã đếm ngược xong 10 giây và gửi thông báo nhắc hẹn thành công!',
                dueDate: new Date(Date.now() + 25 * 60 * 1000).toISOString()
            });

            // 2. Bắn toastr nổi bật trên màn hình nếu web còn mở
            if (typeof toastr !== 'undefined') {
                toastr.error('🚨 [Thử nghiệm] Hạn chót còn 25 phút! Hệ thống đã phát thông báo vào Chuông.', 'Thông báo nhắc hẹn', { timeOut: 8000 });
            }

            // 3. Rung chuông trên header để thu hút ánh nhìn
            $('#btnNotifBell').addClass('bell-highlight-ring');
            setTimeout(() => {
                $('#btnNotifBell').removeClass('bell-highlight-ring');
            }, 3000);
        }
    }, 1000);
}

// Thao tác Test thông báo (Đếm ngược 10s & Bắn thông báo hệ thống ngoài màn hình khi đóng web)
async function actionTestNotification10s() {
    const btn = $('#btnTestHelpPush');
    if (btn.prop('disabled')) return;

    const caps = checkWebPushCapabilities();

    if (!caps.isSupported) {
        if (caps.isIOS && !caps.isStandalone) {
            if (typeof toastr !== 'undefined') {
                toastr.warning('Trên iPhone (iOS), bạn hãy bấm nút Chia sẻ -> "Thêm vào MH chính" để nhận thông báo đẩy khi đóng web nhé!', 'Hướng dẫn iOS');
            }
        } else {
            if (typeof toastr !== 'undefined') {
                toastr.info('Trình duyệt không hỗ trợ Web Push ngoài màn hình. Hệ thống sẽ thử nghiệm thông báo chuông sau 10s!', 'Thông báo');
            }
        }
        startHelpCountdown(10);
        return;
    }

    btn.prop('disabled', true).html('<i class="fa fa-circle-o-notch fa-spin"></i> Đang chuẩn bị...');

    let sub = null;
    try {
        sub = await ensurePushSubscription();
        refreshHelpPushUI();
    } catch (err) {
        btn.prop('disabled', false).html('<i class="fa fa-clock-o"></i> Test thông báo (Đếm ngược 10s)');
        if (typeof toastr !== 'undefined') {
            toastr.error(err.message, 'Cần cấp quyền thông báo');
        }
        $('#helpPushBlockedGuide').show();
        return;
    }

    // Bắt đầu đếm ngược 10s trên giao diện ngay lập tức
    startHelpCountdown(10);

    if (typeof toastr !== 'undefined') {
        toastr.success('🚀 ĐÃ HẸN GIỜ: Đúng 10 giây nữa THIẾT BỊ SẼ NHẬN ĐƯỢC THÔNG BÁO! Bạn hãy ĐÓNG HẲN TRANG WEB hoặc chuyển sang tab khác ngay bây giờ để thử nghiệm nhé!', 'Đang đếm ngược 10 giây', { timeOut: 9000 });
    }

    // Gửi lệnh hẹn giờ tới máy chủ với keepalive: true để không bị ngắt khi đóng web
    const user = getAuthUser();
    fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
            delaySeconds: 10,
            endpoint: sub.endpoint,
            subscription: sub,
            userId: user ? user.id : null
        })
    }).then(r => r.json()).then(res => {
        if (!res.success) {
            console.warn('[Push Test Warning]:', res.message);
        }
    }).catch(err => {
        console.warn('[Push Test Error]:', err.message);
    });
}
window.actionTestNotification10s = actionTestNotification10s;
// Giữ alias tương thích
window.actionTestPush10s = actionTestNotification10s;

// Mở Chuông thông báo trên Header trực tiếp từ Trợ giúp
function actionOpenBellNotification() {
    closeHelpDrawer();
    $('html, body').animate({ scrollTop: 0 }, 200);

    const dropdown = $('#notificationDropdown');
    dropdown.stop(true, true).slideDown(180);

    $('#btnNotifBell').addClass('bell-highlight-ring');
    setTimeout(() => {
        $('#btnNotifBell').removeClass('bell-highlight-ring');
    }, 2500);

    if (typeof toastr !== 'undefined') {
        toastr.info('Đã mở Menu Chuông thông báo trên thanh Header!', 'Chuông thông báo');
    }
}
window.actionOpenBellNotification = actionOpenBellNotification;

// Mở một mục trợ giúp cụ thể trực tiếp
function openHelpTopic(topicKey) {
    closeNotificationDropdown();
    openHelpDrawer();
    showHelpDetail(topicKey);
}
window.openHelpTopic = openHelpTopic;

/* ==========================================================================
   FOOTER, DRAWER GÓP Ý & DRAWER TRỢ GIÚP (MINIMALIST & ACTIONABLE)
   ========================================================================== */

let currentFeedbackScreenshotBase64 = null;

// Mở Drawer Góp ý
function openFeedbackDrawer() {
    closeHelpDrawer();
    $('#drawerBackdrop').addClass('active open');
    $('#feedbackDrawer').addClass('open').attr('aria-hidden', 'false');
    setTimeout(function() {
        $('#feedbackContentInput').focus();
    }, 150);
}
window.openFeedbackDrawer = openFeedbackDrawer;

// Đóng Drawer Góp ý
function closeFeedbackDrawer() {
    $('#feedbackDrawer').removeClass('open').attr('aria-hidden', 'true');
    if (!$('#helpDrawer').hasClass('open')) {
        $('#drawerBackdrop').removeClass('active open');
    }
}
window.closeFeedbackDrawer = closeFeedbackDrawer;

// Mở Drawer Trợ giúp
function openHelpDrawer() {
    closeFeedbackDrawer();
    backToHelpMain();
    $('#helpSearchInput').val('');
    filterHelpTopics('');
    $('#drawerBackdrop').addClass('active open');
    $('#helpDrawer').addClass('open').attr('aria-hidden', 'false');
}
window.openHelpDrawer = openHelpDrawer;

// Đóng Drawer Trợ giúp
function closeHelpDrawer() {
    $('#helpDrawer').removeClass('open').attr('aria-hidden', 'true');
    if (!$('#feedbackDrawer').hasClass('open')) {
        $('#drawerBackdrop').removeClass('active open');
    }
}
window.closeHelpDrawer = closeHelpDrawer;

// Đóng toàn bộ Drawers
function closeAllDrawers() {
    closeFeedbackDrawer();
    closeHelpDrawer();
}
window.closeAllDrawers = closeAllDrawers;

// Chụp ảnh màn hình góp ý bằng html2canvas
function captureFeedbackScreenshot() {
    const $btn = $('#btnCaptureScreenshot');
    const originalText = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Đang chụp ảnh màn hình...');

    // Ẩn tạm drawers và backdrop để không che giao diện cần chụp
    $('#feedbackDrawer, #drawerBackdrop').css('visibility', 'hidden');

    if (typeof html2canvas === 'undefined') {
        $('#feedbackDrawer, #drawerBackdrop').css('visibility', '');
        $btn.prop('disabled', false).html(originalText);
        if (typeof toastr !== 'undefined') {
            toastr.error('Thư viện chụp ảnh chưa sẵn sàng.', 'Lỗi');
        }
        return;
    }

    html2canvas(document.body, {
        useCORS: true,
        logging: false,
        scale: 1,
        ignoreElements: function(el) {
            return el.classList && (el.classList.contains('slide-drawer') || el.classList.contains('drawer-backdrop'));
        }
    }).then(function(canvas) {
        $('#feedbackDrawer, #drawerBackdrop').css('visibility', '');
        $btn.prop('disabled', false).html(originalText);

        try {
            // Nén ảnh JPEG chất lượng 0.65 để gửi gọn nhẹ
            currentFeedbackScreenshotBase64 = canvas.toDataURL('image/jpeg', 0.65);
            $('#feedbackScreenshotImg').attr('src', currentFeedbackScreenshotBase64);
            $('#feedbackScreenshotBox').show();
            if (typeof toastr !== 'undefined') {
                toastr.success('Đã đính kèm ảnh chụp màn hình!', 'Thành công');
            }
        } catch (e) {
            console.error('Lỗi nén ảnh:', e);
        }
    }).catch(function(err) {
        $('#feedbackDrawer, #drawerBackdrop').css('visibility', '');
        $btn.prop('disabled', false).html(originalText);
        console.error('html2canvas error:', err);
        if (typeof toastr !== 'undefined') {
            toastr.error('Không thể chụp ảnh màn hình lúc này.', 'Lỗi');
        }
    });
}
window.captureFeedbackScreenshot = captureFeedbackScreenshot;

// Xóa ảnh màn hình đã chụp
function removeFeedbackScreenshot() {
    currentFeedbackScreenshotBase64 = null;
    $('#feedbackScreenshotImg').attr('src', '');
    $('#feedbackScreenshotBox').hide();
}
window.removeFeedbackScreenshot = removeFeedbackScreenshot;

// Gửi Form Góp ý
function submitFeedbackForm() {
    const content = $('#feedbackContentInput').val().trim();
    if (!content) {
        if (typeof toastr !== 'undefined') {
            toastr.warning('Vui lòng nhập mô tả ý kiến hoặc lỗi bạn gặp phải.', 'Thông báo');
        }
        $('#feedbackContentInput').focus();
        return;
    }

    const includeSystem = $('#checkFeedbackIncludeSystem').is(':checked');
    const user = getAuthUser();
    const deviceInfo = includeSystem
        ? `${navigator.userAgent} | Màn hình: ${window.innerWidth}x${window.innerHeight} | URL: ${window.location.href}`
        : null;

    const payload = {
        userId: user ? user.id : 'guest',
        userName: user ? user.name : 'Khách vãng lai',
        content: content,
        deviceInfo: deviceInfo,
        screenshot: currentFeedbackScreenshotBase64 || null
    };

    const $btn = $('#btnSubmitFeedback');
    const originalHtml = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> <span>Đang gửi...</span>');

    $.ajax({
        url: '/api/feedbacks',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        success: function(res) {
            $btn.prop('disabled', false).html(originalHtml);
            if (typeof toastr !== 'undefined') {
                toastr.success('Cảm ơn bạn! Ý kiến đóng góp đã được gửi thành công.', 'Đã tiếp nhận');
            }
            $('#feedbackContentInput').val('');
            removeFeedbackScreenshot();
            closeFeedbackDrawer();
        },
        error: function(xhr) {
            $btn.prop('disabled', false).html(originalHtml);
            console.error('Feedback submit error:', xhr);
            if (typeof toastr !== 'undefined') {
                toastr.error('Có lỗi xảy ra khi gửi phản hồi. Vui lòng thử lại!', 'Thất bại');
            }
        }
    });
}
window.submitFeedbackForm = submitFeedbackForm;

// TRỢ GIÚP - DỮ LIỆU & CHI TIẾT CÁC MỤC (TỐI GIẢN & TƯƠNG TÁC THỰC CHIẾN)
const HELP_TOPICS_DATA = {
    'xem-lich': {
        title: 'Xem lịch',
        badge: 'Tổng quan giao diện',
        content: `
            <div class="help-section-desc">
                Shinora Deadline cung cấp 2 chế độ hiển thị linh hoạt giúp bạn theo dõi công việc từ chi tiết từng ngày đến bức tranh tổng thể dài hạn.
            </div>

            <!-- CHẾ ĐỘ XEM & ĐIỀU HƯỚNG -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 12px 0 6px 0;">
                1. Chế độ hiển thị & Điều hướng thời gian
            </div>
            <div style="font-size: 12px; color: #3c4043; line-height: 1.6; margin-bottom: 10px;">
                • <strong>Xem theo tuần:</strong> Phân chia ca học tập chi tiết (Ca Sáng: trước 12h, Ca Chiều: 12h - 18h, Ca Tối: sau 18h).<br>
                • <strong>Xem theo tháng:</strong> Xem toàn cảnh 30 ngày trong tháng để chủ động lên lịch ôn thi.<br>
                • <strong>Điều hướng:</strong> Sử dụng các nút <code>&lt; Trở về</code>, <code>Hiện tại</code>, <code>Tiếp &gt;</code> hoặc ô chọn ngày nhanh.
            </div>

            <!-- HÌNH ẢNH MINH HỌA LAPTOP: CHUYỂN ĐỔI TUẦN / THÁNG -->
            <div class="laptop-mockup-wrapper">
                <div class="laptop-mockup-screen">
                    <div class="laptop-mockup-camera"></div>
                    <div class="laptop-mockup-inner" style="height: 145px; background: #ffffff; padding: 8px;">
                        <!-- Toolbar mini -->
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e8eaed; padding-bottom: 5px; margin-bottom: 6px;">
                            <span style="font-weight: 700; color: #003763; font-size: 9.5px;">Bảng theo dõi Deadline</span>
                            <div style="display: flex; gap: 3px;">
                                <span style="font-size: 8px; padding: 1px 5px; background: #e8f0fe; color: #1a73e8; border-radius: 3px; font-weight: 600;">Hiện tại</span>
                                <span style="font-size: 8px; padding: 1px 5px; background: #f1f3f4; color: #3c4043; border-radius: 3px;">Tiếp &gt;</span>
                            </div>
                        </div>
                        <!-- Bố cục Sidebar mini + Bảng mini -->
                        <div style="display: flex; gap: 6px; height: 100px;">
                            <!-- Sidebar mini có pulsing -->
                            <div style="width: 70px; background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 4px; padding: 4px; font-size: 8px; display: flex; flex-direction: column; gap: 3px; position: relative;">
                                <div style="font-weight: 700; color: #ff851b; background: #fff; padding: 2px 4px; border-radius: 3px; border: 1px solid #ffd591; position: relative;">
                                    Tuần
                                    <div class="pulsing-indicator" style="top: -4px; left: -4px; width: 38px; height: 18px; border-radius: 4px;"></div>
                                </div>
                                <div style="color: #5f6368; padding: 2px 4px;">Tháng</div>
                                <div style="font-size: 7.5px; color: #d93025; font-weight: 700; margin-top: auto; line-height: 1.2;">
                                    ⬅ Đổi tuần/tháng
                                </div>
                            </div>
                            <!-- Lưới màu sắc mini -->
                            <div style="flex: 1; border: 1px solid #e8eaed; border-radius: 4px; padding: 4px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; font-size: 7.5px; align-content: start;">
                                <div style="background: #fce8e6; border: 1px solid #ea4335; color: #c5221f; border-radius: 2px; padding: 3px; font-weight: 600;">🚨 3 ngày</div>
                                <div style="background: #fff7e6; border: 1px solid #ff851b; color: #d46b08; border-radius: 2px; padding: 3px; font-weight: 600;">⏰ 1 tuần</div>
                                <div style="background: #feffe6; border: 1px solid #faad14; color: #ad6800; border-radius: 2px; padding: 3px; font-weight: 600;">📅 3 tuần</div>
                                <div style="background: #f6ffed; border: 1px solid #52c41a; color: #389e0d; border-radius: 2px; padding: 3px; font-weight: 600;">🌿 2 tháng</div>
                                <div style="background: #f5f5f5; border: 1px dashed #bfbfbf; color: #8c8c8c; border-radius: 2px; padding: 3px;">✔ Đã xong</div>
                                <div style="background: #f5f5f5; border: 1px solid #8c8c8c; color: #595959; border-radius: 2px; padding: 3px;">⏳ Quá hạn</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="laptop-mockup-base"></div>
            </div>

            <!-- BẢNG GIẢI MÃ TOÀN BỘ MÀU SẮC QUY ƯỚC -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 16px 0 8px 0;">
                2. Quy ước toàn bộ hệ thống màu sắc
            </div>
            <div style="font-size: 11.5px; color: #5f6368; margin-bottom: 8px;">
                Màu sắc của thẻ deadline được tính toán tự động dựa trên khoảng cách giữa thời gian hiện tại và hạn chót:
            </div>

            <div style="display: flex; flex-direction: column; gap: 6px;">
                <!-- Đỏ -->
                <div class="help-field-card" style="border-left: 3px solid #e02424; background: #fffdfd;">
                    <div class="field-name" style="color: #e02424;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #e02424; border-radius: 2px;"></span>
                        Màu đỏ (Khẩn cấp cao nhất) &middot; Hạn chót &le; 3 ngày
                    </div>
                    <div style="font-size: 11.5px; color: #3c4043;">
                        Deadline sắp đến rất gần. Bạn nên ưu tiên hoàn thành ngay để không bị trễ nộp.
                    </div>
                </div>

                <!-- Cam -->
                <div class="help-field-card" style="border-left: 3px solid #ff851b; background: #fffdf9;">
                    <div class="field-name" style="color: #d46b08;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #ff851b; border-radius: 2px;"></span>
                        Màu cam (Sắp tới) &middot; Hạn chót trong 1 tuần (4 - 7 ngày)
                    </div>
                    <div style="font-size: 11.5px; color: #3c4043;">
                        Các bài tập hoặc đồ án cần bắt đầu chuẩn bị tài liệu và làm dàn ý.
                    </div>
                </div>

                <!-- Vàng -->
                <div class="help-field-card" style="border-left: 3px solid #faad14; background: #fffff9;">
                    <div class="field-name" style="color: #ad6800;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #ffc107; border-radius: 2px;"></span>
                        Màu vàng (Trung hạn) &middot; Hạn chót trong 3 tuần (8 - 21 ngày)
                    </div>
                    <div style="font-size: 11.5px; color: #3c4043;">
                        Thời gian còn tương đối thoải mái để phân công các phần công việc dài hạn.
                    </div>
                </div>

                <!-- Xanh lá -->
                <div class="help-field-card" style="border-left: 3px solid #28a745; background: #fafffa;">
                    <div class="field-name" style="color: #28a745;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #28a745; border-radius: 2px;"></span>
                        Màu xanh lá (Thoải mái) &middot; Hạn chót trong 2 tháng (22 - 60 ngày)
                    </div>
                    <div style="font-size: 11.5px; color: #3c4043;">
                        Lịch thi học kỳ hoặc dự án lớn dài hạn của trường.
                    </div>
                </div>

                <!-- Xám mờ (Đã xong) -->
                <div class="help-field-card" style="border-left: 3px solid #9e9e9e; background: #fbfbfb;">
                    <div class="field-name" style="color: #616161;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #bdbdbd; border-radius: 2px;"></span>
                        Màu xám mờ &middot; Đã hoàn thành [ ✔ Đã xong ]
                    </div>
                    <div style="font-size: 11.5px; color: #3c4043;">
                        Bất kể còn bao nhiêu ngày, khi bạn tích dấu <strong>[ ✔ Đã xong ]</strong>, thẻ sẽ tự chuyển sang màu xám mờ để giảm tải thị giác trên lịch.
                    </div>
                </div>

                <!-- Xám đậm (Quá hạn) -->
                <div class="help-field-card" style="border-left: 3px solid #424242; background: #f5f5f5;">
                    <div class="field-name" style="color: #424242;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #616161; border-radius: 2px;"></span>
                        Màu xám đậm &middot; Quá hạn nộp [khác]
                    </div>
                    <div style="font-size: 11.5px; color: #3c4043;">
                        Deadline đã qua ngày giờ nộp nhưng chưa được tích xong.
                    </div>
                </div>
            </div>

            <!-- CÁC BIỂU TƯỢNG PHÂN BIỆT -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 16px 0 8px 0;">
                3. Biểu tượng nhận diện trên thẻ
            </div>
            <div style="display: flex; gap: 8px;">
                <div style="flex: 1; padding: 8px; border: 1px solid #e8eaed; border-radius: 6px; background: #fff; font-size: 11.5px;">
                    <strong style="color: #1a73e8;"><i class="fa fa-user"></i> Cá nhân:</strong> Chỉ riêng bạn thấy khi đăng nhập.
                </div>
                <div style="flex: 1; padding: 8px; border: 1px solid #e8eaed; border-radius: 6px; background: #fff; font-size: 11.5px;">
                    <strong style="color: #137333;"><i class="fa fa-users"></i> Cả nhóm:</strong> Toàn bộ thành viên trong nhóm cùng thấy.
                </div>
            </div>

            <div class="help-interactive-actions" style="margin-top: 16px;">
                <button type="button" class="btn-help-action btn-help-action-primary" onclick="actionSwitchHelpView('week')">
                    <i class="fa fa-calendar-check-o"></i> Chuyển sang xem theo tuần
                </button>
                <button type="button" class="btn-help-action btn-help-action-outline" onclick="actionSwitchHelpView('month')">
                    <i class="fa fa-calendar"></i> Chuyển sang xem theo tháng
                </button>
            </div>
        `
    },
    'tao-xoa-lich': {
        title: 'Tạo/xóa lịch',
        badge: 'Thao tác cơ bản',
        content: `
            <!-- THANH ĐIỀU HƯỚNG NHANH 2 PHẦN -->
            <div style="display: flex; gap: 6px; margin-bottom: 14px; background: #f1f3f4; padding: 3px; border-radius: 8px;">
                <button type="button" class="btn-help-tab active" onclick="switchHelpSubTab('tab-help-create', this)" style="flex: 1; padding: 6px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; background: #ffffff; color: #1a73e8; box-shadow: 0 1px 2px rgba(0,0,0,0.1); transition: all 0.2s;">
                    <i class="fa fa-plus-circle"></i> 1. Tạo lịch mới
                </button>
                <button type="button" class="btn-help-tab" onclick="switchHelpSubTab('tab-help-delete', this)" style="flex: 1; padding: 6px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; background: transparent; color: #5f6368; transition: all 0.2s;">
                    <i class="fa fa-trash-o"></i> 2. Xóa lịch & Cảnh báo
                </button>
            </div>

            <!-- PHẦN 1: HƯỚNG DẪN TẠO LỊCH -->
            <div id="tab-help-create" class="help-subtab-content">
                <div class="help-section-desc">
                    Shinora Deadline cho phép bạn thêm hạn chót học tập chỉ trong vài giây, hỗ trợ phân loại cá nhân hoặc bài tập nhóm.
                </div>

                <!-- BƯỚC 1: CÁCH MỞ CỬA SỔ -->
                <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 10px 0 6px 0;">
                    Bước 1: Mở cửa sổ Tạo lịch
                </div>
                <div style="font-size: 12px; color: #3c4043; line-height: 1.6; margin-bottom: 10px;">
                    Nhấn nút 
                    <span class="inline-create-dropdown" style="display: inline-block; position: relative;">
                        <button type="button" class="btn-help-inline-create" onclick="toggleHelpInlineDropdown(event)" title="Bấm để thử tạo lịch">
                            <i class="fa fa-plus"></i> Tạo <i class="fa fa-caret-down"></i>
                        </button>
                        <span id="helpInlineCreateMenu" class="help-inline-menu" style="display: none;">
                            <a href="javascript:void(0);" onclick="actionCreatePersonalDeadline()"><i class="fa fa-user"></i> Tạo cho Cá nhân</a>
                            <a href="javascript:void(0);" onclick="actionCreateGroupDeadline()"><i class="fa fa-users"></i> Tạo cho Cả nhóm</a>
                        </span>
                    </span>
                    ở góc trái trên cùng, hoặc <strong>nhấp đúp chuột vào bất kỳ ô ngày nào</strong> trên bảng lịch.
                </div>

                <!-- HÌNH ẢNH MINH HỌA LAPTOP: TẠO LỊCH -->
                <div class="laptop-mockup-wrapper">
                    <div class="laptop-mockup-screen">
                        <div class="laptop-mockup-camera"></div>
                        <div class="laptop-mockup-inner" style="height: 155px; background: #ffffff; padding: 8px;">
                            <!-- Header mini -->
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e8eaed; padding-bottom: 5px; margin-bottom: 8px;">
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <span style="font-weight: 700; color: #003763; font-size: 10px;">DEADLINE TRACKER</span>
                                </div>
                                <span style="font-size: 9px; padding: 2px 6px; background: #e8f0fe; color: #1a73e8; border-radius: 4px; font-weight: 600;">Đăng nhập</span>
                            </div>
                            <!-- Toolbar có nút Tạo -->
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; position: relative;">
                                <!-- NÚT TẠO CÓ VÒNG TRÒN PULSING -->
                                <div style="position: relative; display: inline-flex; align-items: center;">
                                    <span style="background: #1a73e8; color: #fff; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 9.5px; display: inline-flex; align-items: center; gap: 3px;">
                                        <i class="fa fa-plus"></i> Tạo ▾
                                    </span>
                                    <div class="pulsing-indicator" style="top: -5px; left: -5px; width: 62px; height: 26px; border-radius: 6px;"></div>
                                </div>
                                <span style="font-size: 8.5px; color: #d93025; font-weight: 700; background: #fce8e6; padding: 2px 6px; border-radius: 10px; border: 1px dashed #d93025;">
                                    ⬅ Nhấn nút Tạo tại đây
                                </span>
                            </div>
                            <!-- Lưới mini -->
                            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; border: 1px solid #e8eaed; border-radius: 4px; padding: 4px; background: #fafafa; font-size: 8px;">
                                <div style="background: #e8f0fe; padding: 3px; text-align: center; font-weight: 600; color: #1a73e8;">T2</div>
                                <div style="background: #e8f0fe; padding: 3px; text-align: center; font-weight: 600; color: #1a73e8;">T3</div>
                                <div style="background: #e8f0fe; padding: 3px; text-align: center; font-weight: 600; color: #1a73e8; position: relative;">
                                    T4
                                    <div style="position: absolute; bottom: -14px; left: -10px; white-space: nowrap; font-size: 7.5px; color: #188038; font-weight: 600;">
                                        👆 Hoặc nhấp ô ngày
                                    </div>
                                </div>
                                <div style="background: #e8f0fe; padding: 3px; text-align: center; font-weight: 600; color: #1a73e8;">T5</div>
                                <div style="background: #e8f0fe; padding: 3px; text-align: center; font-weight: 600; color: #1a73e8;">T6</div>
                                <div style="height: 38px; background: #fff; border: 1px dashed #dadce0;"></div>
                                <div style="height: 38px; background: #fff; border: 1px dashed #dadce0;"></div>
                                <div style="height: 38px; background: #e6f4ea; border: 1px solid #34a853; border-radius: 2px; padding: 2px; font-size: 7.5px; color: #137333;">Nhấp đúp</div>
                                <div style="height: 38px; background: #fff; border: 1px dashed #dadce0;"></div>
                                <div style="height: 38px; background: #fff; border: 1px dashed #dadce0;"></div>
                            </div>
                        </div>
                    </div>
                    <div class="laptop-mockup-base"></div>
                </div>

                <!-- BƯỚC 2: CÁC TRƯỜNG THÔNG TIN KHI TẠO -->
                <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 14px 0 8px 0;">
                    Bước 2: Các trường thông tin chi tiết
                </div>

                <div class="help-field-card">
                    <div class="field-name"><i class="fa fa-pencil"></i> 1. Tiêu đề deadline <span style="color: #d93025;">*</span></div>
                    <div>Tên bài tập, đồ án hoặc sự kiện cần hoàn thành (Ví dụ: <em>Nộp Báo cáo Tiến độ Tuần 3</em>).</div>
                </div>

                <div class="help-field-card">
                    <div class="field-name"><i class="fa fa-calendar"></i> 2. Ngày & Thời gian nộp</div>
                    <div>Nhấp chọn ngày và nhập giờ hạn chót (mặc định 09:00). Hệ thống sẽ tự phân loại:
                        <ul style="margin: 4px 0 0 16px; padding: 0;">
                            <li><strong>Ca Sáng:</strong> trước 12:00</li>
                            <li><strong>Ca Chiều:</strong> từ 12:00 đến 18:00</li>
                            <li><strong>Ca Tối:</strong> từ 18:00 đến 23:59</li>
                        </ul>
                    </div>
                </div>

                <div class="help-field-card">
                    <div class="field-name"><i class="fa fa-shield"></i> 3. Phạm vi (Cá nhân / Cả nhóm)</div>
                    <div>
                        <strong>👤 Cá nhân:</strong> Chỉ riêng bạn thấy khi đăng nhập.<br>
                        <strong>👥 Cả nhóm:</strong> Mọi thành viên trong nhóm đều thấy để cùng thực hiện.
                    </div>
                </div>

                <div class="help-field-card">
                    <div class="field-name"><i class="fa fa-users"></i> 4. Phân công thành viên <em>(chỉ có ở Cả nhóm)</em></div>
                    <div>Mặc định là <strong>Toàn bộ nhóm</strong>. Bạn có thể bỏ tích và chọn đích danh từng bạn chịu trách nhiệm công việc này.</div>
                </div>

                <div class="help-field-card">
                    <div class="field-name"><i class="fa fa-tag"></i> 5. Tên nhóm & 🔗 Link nhóm <em>(tùy chọn)</em></div>
                    <div>Điền tên nhóm (VD: <em>Nhóm 3</em>) và dán link nhóm chat (<strong>Zalo, Telegram, Teams...</strong>). Thành viên nhấp vào sẽ mở ngay phòng chat trao đổi!</div>
                </div>

                <div class="help-field-card">
                    <div class="field-name"><i class="fa fa-align-left"></i> 6. Mô tả / Ghi chú công việc <em>(tùy chọn)</em></div>
                    <div>Ghi chú chi tiết yêu cầu của giảng viên, dàn ý bài tập hoặc các tài liệu tham khảo.</div>
                </div>

                <div class="help-field-card" style="border-left: 3px solid #1a73e8;">
                    <div class="field-name" style="color: #1a73e8;"><i class="fa fa-check-square-o"></i> 7. Ô tích [ ✔ Đã xong ]</div>
                    <div>Nếu công việc đã hoàn thành, tích vào ô này. Thẻ deadline sẽ tự động <strong>chuyển sang màu xám mờ [khác]</strong> để báo hiệu xong việc, giúp bạn tập trung vào các deadline gấp còn lại!</div>
                </div>

                <div class="help-interactive-actions" style="margin-top: 14px;">
                    <button type="button" class="btn-help-action btn-help-action-primary" onclick="actionCreateDeadlineNow()">
                        <i class="fa fa-plus-circle"></i> Thử tạo lịch ngay bây giờ
                    </button>
                </div>
            </div>

            <!-- PHẦN 2: HƯỚNG DẪN XÓA LỊCH & CẢNH BÁO -->
            <div id="tab-help-delete" class="help-subtab-content" style="display: none;">
                <div class="help-section-desc">
                    Khi một deadline không còn cần thiết hoặc tạo nhầm, bạn có thể xóa bỏ hoàn toàn khỏi hệ thống.
                </div>

                <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 10px 0 6px 0;">
                    Cách thực hiện xóa deadline
                </div>
                <div style="font-size: 12px; color: #3c4043; line-height: 1.6; margin-bottom: 10px;">
                    1. Nhấp chuột vào <strong>Thẻ deadline</strong> bạn muốn xóa trên bảng lịch để mở hộp thông tin chi tiết.<br>
                    2. Nhấn vào biểu tượng <strong><i class="fa fa-trash-o" style="color: #d93025;"></i> Thùng rác</strong> ở thanh công cụ góc trên bên phải.<br>
                    3. Xác nhận đồng ý xóa trên hộp thoại.
                </div>

                <!-- HÌNH ẢNH MINH HỌA LAPTOP: XÓA LỊCH -->
                <div class="laptop-mockup-wrapper">
                    <div class="laptop-mockup-screen">
                        <div class="laptop-mockup-camera"></div>
                        <div class="laptop-mockup-inner" style="height: 165px; background: #ffffff; padding: 10px; display: flex; align-items: center; justify-content: center;">
                            <!-- Popover mô phỏng -->
                            <div style="background: #ffffff; border: 1px solid #dadce0; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.18); width: 220px; padding: 8px; position: relative;">
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f3f4; padding-bottom: 4px; margin-bottom: 6px;">
                                    <span style="font-size: 9px; color: #5f6368; font-weight: 600;">Chi tiết Deadline</span>
                                    <div style="display: flex; align-items: center; gap: 6px; position: relative;">
                                        <i class="fa fa-pencil" style="font-size: 10px; color: #5f6368;"></i>
                                        <!-- BIỂU TƯỢNG THÙNG RÁC CÓ PULSING -->
                                        <div style="position: relative; display: inline-flex; align-items: center; justify-content: center;">
                                            <i class="fa fa-trash-o" style="font-size: 11px; color: #d93025; font-weight: bold;"></i>
                                            <div class="pulsing-indicator" style="top: -6px; left: -6px; width: 22px; height: 22px;"></div>
                                        </div>
                                        <i class="fa fa-times" style="font-size: 10px; color: #5f6368;"></i>
                                    </div>
                                </div>
                                <div style="font-size: 10px; font-weight: 700; color: #1f1f1f; margin-bottom: 2px;">Tiểu luận Triết học</div>
                                <div style="font-size: 8.5px; color: #5f6368; margin-bottom: 6px;">Hạn chót: 20/10/2026 · 09:00</div>
                                <div style="background: #fce8e6; border: 1px dashed #d93025; border-radius: 4px; padding: 3px 6px; font-size: 8.5px; color: #d93025; font-weight: 600; text-align: center;">
                                    ⬆ Nhấn biểu tượng thùng rác để xóa
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="laptop-mockup-base"></div>
                </div>

                <!-- HỘP CẢNH BÁO QUAN TRỌNG KHI XÓA -->
                <div class="help-danger-alert">
                    <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: 4px; font-size: 12.5px;">
                        <i class="fa fa-exclamation-triangle"></i> LƯU Ý QUAN TRỌNG KHI XÓA DEADLINE
                    </div>
                    <ul style="margin: 0; padding-left: 18px;">
                        <li><strong>Xóa vĩnh viễn:</strong> Dữ liệu sẽ bị xóa trực tiếp khỏi CSDL và <strong>không thể phục hồi</strong> (không có thùng rác tạm).</li>
                        <li><strong>Ảnh hưởng lịch nhóm:</strong> Nếu xóa deadline thuộc chế độ <strong>Cả nhóm</strong>, lịch này sẽ biến mất trên màn hình của <strong>toàn bộ các thành viên khác</strong>. Hãy trao đổi với nhóm trước khi xóa!</li>
                        <li>💡 <strong>Khuyên dùng:</strong> Nếu công việc đã làm xong, bạn nên mở chỉnh sửa và tích chọn <strong>[ ✔ Đã xong ]</strong> thay vì xóa để vẫn lưu lại lịch sử làm việc của nhóm.</li>
                    </ul>
                </div>
            </div>
        `
    },
    'quyen-xem-lich': {
        title: 'Ai có thể xem lịch của bạn',
        badge: 'Quyền riêng tư & Bảo mật',
        content: `
            <div class="help-section-desc">
                Shinora bảo vệ tối đa tính riêng tư cá nhân của sinh viên đồng thời duy trì sự gắn kết minh bạch trong bài tập nhóm.
            </div>

            <!-- PHÂN CẤP 3 TẦNG BẢO MẬT -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 12px 0 6px 0;">
                1. Ba cấp độ phân quyền dữ liệu
            </div>

            <div class="help-field-card" style="border-left: 3px solid #1a73e8;">
                <div class="field-name" style="color: #1a73e8;"><i class="fa fa-lock"></i> 🔒 Lịch Cá Nhân &middot; Tuyệt mật 100%</div>
                <div>Chỉ duy nhất <strong>bạn (khi đăng nhập đúng tài khoản)</strong> mới nhìn thấy và quản lý. Bất kỳ ai khác (kể cả thành viên cùng nhóm hoặc khách) đều <strong>hoàn toàn không thấy</strong> trên lịch của họ.</div>
            </div>

            <div class="help-field-card" style="border-left: 3px solid #137333;">
                <div class="field-name" style="color: #137333;"><i class="fa fa-users"></i> 👥 Lịch Cả Nhóm &middot; Công khai nội bộ nhóm</div>
                <div>Toàn bộ <strong>4 thành viên trong nhóm</strong> đều nhìn thấy để cùng chia sẻ tài liệu, xem ai chịu trách nhiệm và theo dõi tiến độ chung.</div>
            </div>

            <div class="help-field-card" style="border-left: 3px solid #f57c00;">
                <div class="field-name" style="color: #f57c00;"><i class="fa fa-eye-slash"></i> 👁️ Khách vãng lai &middot; Chưa đăng nhập</div>
                <div>Chỉ xem được các lịch chung công khai của nhóm, <strong>tuyệt đối không xem được</strong> bất kỳ deadline cá nhân nào của bạn.</div>
            </div>

            <!-- HÌNH ẢNH MINH HỌA LAPTOP: SO SÁNH 2 MÀN HÌNH -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 14px 0 6px 0;">
                2. Minh họa hiển thị thực tế trên 2 thiết bị
            </div>

            <div class="laptop-mockup-wrapper">
                <div class="laptop-mockup-screen">
                    <div class="laptop-mockup-camera"></div>
                    <div class="laptop-mockup-inner" style="height: 155px; background: #ffffff; padding: 8px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; height: 100%;">
                            <!-- Màn hình máy của Bạn -->
                            <div style="border: 1px solid #c2e7ff; background: #f8fbff; border-radius: 4px; padding: 6px;">
                                <div style="font-size: 8.5px; font-weight: 700; color: #1a73e8; margin-bottom: 4px;">
                                    💻 Máy của BẠN (Đã đăng nhập)
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 3px; font-size: 7.5px;">
                                    <div style="background: #e8f0fe; color: #1a73e8; padding: 2px 4px; border-radius: 2px; font-weight: 600;">
                                        👤 Ôn thi Tin học (Cá nhân)
                                    </div>
                                    <div style="background: #e6f4ea; color: #137333; padding: 2px 4px; border-radius: 2px; font-weight: 600;">
                                        👥 Nộp Báo cáo (Cả nhóm)
                                    </div>
                                </div>
                            </div>
                            <!-- Màn hình máy của Bạn cùng nhóm -->
                            <div style="border: 1px solid #dadce0; background: #fafafa; border-radius: 4px; padding: 6px; position: relative;">
                                <div style="font-size: 8.5px; font-weight: 700; color: #5f6368; margin-bottom: 4px;">
                                    👥 Máy của BẠN CÙNG NHÓM
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 3px; font-size: 7.5px;">
                                    <div style="border: 1px dashed #d93025; color: #d93025; padding: 2px 4px; border-radius: 2px; background: #fff5f5; font-size: 7px; text-align: center;">
                                        🔒 Ẩn sạch lịch riêng của bạn
                                    </div>
                                    <div style="background: #e6f4ea; color: #137333; padding: 2px 4px; border-radius: 2px; font-weight: 600;">
                                        👥 Nộp Báo cáo (Cả nhóm)
                                    </div>
                                </div>
                                <div class="pulsing-indicator" style="top: 24px; left: 10px; width: 85px; height: 20px; border-radius: 4px;"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="laptop-mockup-base"></div>
            </div>

            <!-- BẢNG MA TRẬN ĐỐI CHIẾU QUYỀN HẠN -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 14px 0 6px 0;">
                3. Bảng đối chiếu quyền riêng tư
            </div>
            <div style="overflow-x: auto; border: 1px solid #e8eaed; border-radius: 6px; margin-bottom: 12px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: left;">
                    <thead style="background: #f1f3f4; color: #202124;">
                        <tr>
                            <th style="padding: 6px 8px; border-bottom: 1px solid #dadce0;">Loại dữ liệu</th>
                            <th style="padding: 6px 8px; border-bottom: 1px solid #dadce0;">Chưa đăng nhập</th>
                            <th style="padding: 6px 8px; border-bottom: 1px solid #dadce0;">Bạn (Chính chủ)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 6px 8px; border-bottom: 1px solid #f1f3f4;"><strong>Lịch cá nhân</strong></td>
                            <td style="padding: 6px 8px; border-bottom: 1px solid #f1f3f4; color: #d93025;">❌ Ẩn 100%</td>
                            <td style="padding: 6px 8px; border-bottom: 1px solid #f1f3f4; color: #188038;">✅ Xem &amp; Sửa</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 8px;"><strong>Lịch cả nhóm</strong></td>
                            <td style="padding: 6px 8px; color: #188038;">✅ Xem lịch chung</td>
                            <td style="padding: 6px 8px; color: #188038;">✅ Toàn quyền quản lý</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="help-interactive-actions">
                <button type="button" class="btn-help-action btn-help-action-primary" onclick="actionCheckAccountOrLogin()">
                    <i class="fa fa-user-circle"></i> Kiểm tra tài khoản hiện tại của bạn
                </button>
            </div>
        `
    },
    'lich-ca-nhan': {
        title: 'Lịch cá nhân',
        badge: 'Không gian riêng tư',
        content: `
            <div class="help-section-desc">
                Lịch cá nhân là không gian làm việc riêng tư 100% của bạn. Các thành viên khác trong nhóm hoàn toàn không nhìn thấy lịch này.
            </div>

            <!-- ƯU ĐIỂM -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 12px 0 6px 0;">
                1. Tại sao nên dùng Lịch cá nhân?
            </div>
            <div style="font-size: 12px; color: #3c4043; line-height: 1.6; margin-bottom: 10px;">
                • <strong>Bảo mật tối đa:</strong> Thích hợp cho lịch ôn thi cá nhân, nhắc hẹn riêng tư, bài tập môn riêng.<br>
                • <strong>Không làm loãng nhóm:</strong> Giữ bảng lịch của nhóm đồ án luôn gọn gàng và chuyên nghiệp.<br>
                • <strong>Nhắc nhở riêng:</strong> Hệ thống tự động gửi thông báo trực tiếp đến bạn khi sắp tới hạn chót.
            </div>

            <!-- HÌNH ẢNH MINH HỌA LAPTOP: TẠO LỊCH CÁ NHÂN -->
            <div class="laptop-mockup-wrapper">
                <div class="laptop-mockup-screen">
                    <div class="laptop-mockup-camera"></div>
                    <div class="laptop-mockup-inner" style="height: 155px; background: #ffffff; padding: 10px; display: flex; align-items: center; justify-content: center;">
                        <!-- Mockup Modal Tạo cá nhân -->
                        <div style="background: #ffffff; border: 1px solid #dadce0; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); width: 230px; padding: 8px; font-size: 8.5px;">
                            <div style="font-weight: 700; color: #1f1f1f; margin-bottom: 6px; border-bottom: 1px solid #1a73e8; padding-bottom: 3px;">
                                Ôn thi Giữa kỳ An ninh mạng
                            </div>
                            <!-- Tabs chọn Cá nhân đang bật -->
                            <div style="display: flex; gap: 4px; margin-bottom: 6px; position: relative;">
                                <span style="background: #c2e7ff; color: #001d35; font-weight: 700; padding: 2px 8px; border-radius: 10px; display: inline-flex; align-items: center; gap: 3px;">
                                    <i class="fa fa-user"></i> Cá nhân
                                </span>
                                <span style="background: #f1f3f4; color: #5f6368; padding: 2px 8px; border-radius: 10px;">
                                    👥 Cả nhóm
                                </span>
                                <div class="pulsing-indicator" style="top: -4px; left: -4px; width: 68px; height: 22px; border-radius: 10px;"></div>
                            </div>
                            <div style="font-size: 8px; color: #5f6368; line-height: 1.3;">
                                📅 25/10/2026 &middot; 09:00<br>
                                🔒 <em>Chỉ bạn nhìn thấy khi đăng nhập</em>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="laptop-mockup-base"></div>
            </div>

            <!-- CÁCH TẠO NHANH -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 14px 0 6px 0;">
                2. Cách tạo nhanh Lịch cá nhân
            </div>
            <div style="font-size: 12px; color: #3c4043; line-height: 1.6; margin-bottom: 12px;">
                Khi bạn mở cửa sổ tạo deadline, hệ thống <strong>tự động chọn sẵn tab Cá nhân</strong>. Các mục rườm rà như phân công thành viên và link nhóm sẽ tự ẩn đi, giúp bạn tạo chỉ trong 5 giây!
            </div>

            <div class="help-interactive-actions">
                <button type="button" class="btn-help-action btn-help-action-primary" onclick="actionCreatePersonalDeadline()">
                    <i class="fa fa-user-plus"></i> Tạo lịch cá nhân ngay bây giờ
                </button>
            </div>
        `
    },
    'lich-nhom': {
        title: 'Lịch nhóm',
        badge: 'Cộng tác & Phân công',
        content: `
            <div class="help-section-desc">
                Lịch nhóm được thiết kế chuyên biệt cho đồ án môn học, bài tập lớn và dự án nghiên cứu có nhiều thành viên cùng tham gia.
            </div>

            <!-- 3 SỨC MẠNH CỐT LÕI -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 12px 0 6px 0;">
                1. Tính năng nổi bật của Lịch nhóm
            </div>

            <div class="help-field-card">
                <div class="field-name"><i class="fa fa-refresh"></i> 👥 Đồng bộ thời gian thực cho cả nhóm</div>
                <div>Chỉ cần một bạn tạo deadline, toàn bộ các thành viên khác trong nhóm đều thấy ngay lập tức trên bảng lịch của mình.</div>
            </div>

            <div class="help-field-card">
                <div class="field-name"><i class="fa fa-check-circle-o"></i> 🎯 Phân công trách nhiệm rõ ràng</div>
                <div>Có thể giao cho <strong>Toàn bộ nhóm</strong> hoặc tích chọn đích danh từng bạn (VD: <em>Khang viết Báo cáo, Kiệt làm Slide</em>).</div>
            </div>

            <div class="help-field-card">
                <div class="field-name"><i class="fa fa-external-link"></i> 🔗 Tích hợp link nhóm chat Zalo / Telegram</div>
                <div>Đính kèm đường link nhóm trao đổi. Khi mở xem chi tiết deadline, thành viên chỉ cần bấm vào là chuyển thẳng tới phòng chat!</div>
            </div>

            <!-- HÌNH ẢNH MINH HỌA LAPTOP: TẠO LỊCH NHÓM & LINK ZALO -->
            <div class="laptop-mockup-wrapper">
                <div class="laptop-mockup-screen">
                    <div class="laptop-mockup-camera"></div>
                    <div class="laptop-mockup-inner" style="height: 165px; background: #ffffff; padding: 10px; display: flex; align-items: center; justify-content: center;">
                        <!-- Mockup Popover Lịch nhóm -->
                        <div style="background: #ffffff; border: 1px solid #dadce0; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); width: 235px; padding: 8px; font-size: 8.5px;">
                            <div style="font-weight: 700; color: #1f1f1f; margin-bottom: 4px;">
                                Nộp Báo cáo Tiến độ Đồ án Tuần 4
                            </div>
                            <div style="font-size: 8px; color: #137333; font-weight: 600; margin-bottom: 4px;">
                                👥 Lịch Cả nhóm &middot; Phân công: Toàn bộ nhóm
                            </div>
                            <!-- Link Zalo có pulsing -->
                            <div style="position: relative; display: inline-flex; align-items: center; margin-top: 2px;">
                                <span style="background: #e8f0fe; color: #1a73e8; border: 1px solid #c2e7ff; padding: 3px 8px; border-radius: 4px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                                    <i class="fa fa-comments"></i> Mở Nhóm Zalo Đồ Án ↗
                                </span>
                                <div class="pulsing-indicator" style="top: -5px; left: -5px; width: 145px; height: 26px; border-radius: 6px;"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="laptop-mockup-base"></div>
            </div>

            <!-- NGUYÊN TẮC LÀM VIỆC NHÓM -->
            <div class="help-danger-alert" style="background: #fffbe6; border-color: #ffe58f; border-left-color: #faad14; color: #d46b08;">
                <div style="font-weight: 700; margin-bottom: 4px;">
                    <i class="fa fa-lightbulb-o"></i> LƯU Ý VĂN HÓA LÀM VIỆC NHÓM
                </div>
                <ul style="margin: 0; padding-left: 18px; font-size: 11.5px; color: #ad6800;">
                    <li>Không tự ý xóa deadline của nhóm nếu chưa trao đổi thống nhất.</li>
                    <li>Khi hoàn thành phần việc được giao, hãy tích chọn <strong>[ ✔ Đã xong ]</strong> để các bạn khác cùng yên tâm theo dõi.</li>
                </ul>
            </div>

            <div class="help-interactive-actions" style="margin-top: 14px;">
                <button type="button" class="btn-help-action btn-help-action-primary" onclick="actionCreateGroupDeadline()">
                    <i class="fa fa-users"></i> Tạo lịch nhóm ngay bây giờ
                </button>
            </div>
        `
    },
    'thong-bao': {
        title: 'Thông báo nhắc hẹn',
        badge: 'Cơ chế nhắc hẹn tự động',
        content: `
            <div class="help-section-desc">
                Shinora Deadline hỗ trợ hệ thống nhắc hẹn đa tầng thông minh: vừa hiển thị số đếm trực quan trên <strong>Chuông thông báo</strong> của trang web, vừa hỗ trợ gửi <strong>Thông báo ngoài màn hình</strong> ngay cả khi bạn đã đóng hoàn toàn web.
            </div>

            <!-- PHẦN 1: CÁCH HOẠT ĐỘNG VÀ CƠ CHẾ -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 12px 0 6px 0;">
                1. Hai cơ chế thông báo tự động
            </div>

            <div class="help-field-card" style="border-left: 3px solid #1a73e8;">
                <div class="field-name" style="color: #1a73e8;"><i class="fa fa-bell-o"></i> 🔔 Thông báo trong Web (Menu Chuông Header)</div>
                <div>Tự động nhảy chấm đỏ và số đếm trên icon Chuông góc phải Header. Nhấp vào chuông để xem danh sách; bấm vào thông báo sẽ tự động chuyển lịch đến đúng ngày và mở xem chi tiết công việc.</div>
            </div>

            <div class="help-field-card" style="border-left: 3px solid #137333;">
                <div class="field-name" style="color: #137333;"><i class="fa fa-desktop"></i> 💻 Thông báo ngoài màn hình (Kể cả khi đóng web)</div>
                <div>Sử dụng công nghệ Service Worker chuẩn PWA chạy ngầm. Hệ điều hành sẽ nhận tín hiệu và hiển thị banner góc màn hình (máy tính hoặc điện thoại) kèm âm thanh mặc định tinh tế của hệ thống.</div>
            </div>

            <!-- PHẦN 2: CÁC MỐC THỜI GIAN TỰ ĐỘNG NHẮC NHỞ -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 14px 0 6px 0;">
                2. Các mốc thời gian tự động nhắc nhở
            </div>

            <div class="help-field-card" style="border-left: 3px solid #d93025; background: #fffbfb;">
                <div class="field-name" style="color: #d93025;"><i class="fa fa-exclamation-circle"></i> 🚨 Mốc Khẩn cấp &middot; Còn &le; 30 phút</div>
                <div>Hệ thống phát cảnh báo khẩn cấp màu đỏ để bạn kịp kiểm tra file, hoàn tất tài liệu và nộp bài trước giờ đóng cổng nộp.</div>
            </div>

            <div class="help-field-card" style="border-left: 3px solid #f57c00; background: #fffdf9;">
                <div class="field-name" style="color: #d46b08;"><i class="fa fa-clock-o"></i> ⏰ Mốc Sắp đến hạn &middot; Còn &le; 3 ngày</div>
                <div>Hệ thống nhắc trước 3 ngày để bạn chủ động chuẩn bị tài liệu, làm slide thuyết trình và phân chia công việc trong nhóm.</div>
            </div>

            <!-- PHẦN 3: HÌNH ẢNH MINH HỌA LAPTOP MOCKUP CHUẨN ĐỒNG BỘ -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 14px 0 6px 0;">
                3. Minh họa hiển thị Chuông thông báo
            </div>

            <div class="laptop-mockup-wrapper">
                <div class="laptop-mockup-screen">
                    <div class="laptop-mockup-camera"></div>
                    <div class="laptop-mockup-inner" style="height: 175px; background: #ffffff; padding: 10px; display: flex; flex-direction: column;">
                        <!-- Header mini -->
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e8eaed; padding-bottom: 6px; margin-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <span style="font-weight: 700; color: #003763; font-size: 10px;">DEADLINE TRACKER</span>
                            </div>
                            <!-- Cụm Chuông có Pulsing và Badge đỏ -->
                            <div style="display: flex; align-items: center; gap: 8px; position: relative;">
                                <div style="position: relative; display: inline-flex; align-items: center;">
                                    <span style="width: 24px; height: 24px; border-radius: 50%; background: #e8f0fe; color: #1a73e8; display: flex; align-items: center; justify-content: center; font-size: 12px; position: relative;">
                                        <i class="fa fa-bell"></i>
                                        <span style="position: absolute; top: -3px; right: -3px; background: #d93025; color: #fff; font-size: 7.5px; font-weight: 700; width: 14px; height: 14px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1.5px solid #fff;">1</span>
                                    </span>
                                    <div class="pulsing-indicator" style="top: -4px; left: -4px; width: 32px; height: 32px; border-radius: 50%;"></div>
                                </div>
                                <span style="font-size: 8px; color: #d93025; font-weight: 700; background: #fce8e6; padding: 2px 6px; border-radius: 10px; border: 1px dashed #d93025;">
                                    ⬅ Chấm đỏ báo có hạn chót
                                </span>
                            </div>
                        </div>

                        <!-- Dropdown mini hiển thị thông báo -->
                        <div style="display: flex; justify-content: flex-end;">
                            <div style="width: 220px; background: #ffffff; border: 1px solid #dadce0; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.12); padding: 6px; font-size: 8px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f3f4; padding-bottom: 4px; margin-bottom: 4px;">
                                    <span style="font-weight: 700; color: #202124;"><i class="fa fa-bell" style="color: #1a73e8;"></i> Thông báo nhắc hẹn</span>
                                    <span style="color: #1a73e8; font-size: 7.5px;">Đã đọc hết</span>
                                </div>
                                <div style="background: #fff0f0; border-left: 2.5px solid #d93025; border-radius: 3px; padding: 5px 6px;">
                                    <div style="font-weight: 700; color: #c5221f; display: flex; align-items: center; justify-content: space-between;">
                                        <span>🚨 Nộp Báo cáo Tiến độ</span>
                                        <span style="font-size: 7px; color: #d93025; background: #fce8e6; padding: 1px 4px; border-radius: 3px;">Còn 25 phút</span>
                                    </div>
                                    <div style="color: #5f6368; font-size: 7.5px; margin-top: 2px;">
                                        Hạn chót hôm nay lúc 11:30 &middot; Bấm để xem chi tiết
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="laptop-mockup-base"></div>
            </div>

            <!-- PHẦN 4: KHỐI TƯƠNG TÁC THỬ NGHIỆM THỰC CHIẾN -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 16px 0 8px 0;">
                4. Thử nghiệm tính năng thông báo
            </div>

            <div class="help-interactive-actions" style="margin-top: 6px; display: flex; flex-direction: column; gap: 8px;">
                <button type="button" class="btn-help-action btn-help-action-primary" onclick="actionOpenBellNotification()" style="width: 100%; justify-content: center;">
                    <i class="fa fa-bell"></i> Mở xem chuông thông báo trên Header
                </button>
                <button type="button" id="btnTestHelpPush" class="btn-help-action" onclick="actionTestNotification10s()" style="width: 100%; justify-content: center; background: #e8f0fe; color: #1a73e8; border: 1px solid #c2e7ff;">
                    <i class="fa fa-clock-o"></i> Test thông báo (Đếm ngược 10s)
                </button>
            </div>

            <!-- HỘP ĐẾM NGƯỢC 10 GIÂY -->
            <div id="helpTestCountdownNotice" style="display: none; margin-top: 10px; font-size: 12px; color: #1a73e8; background: #e8f0fe; padding: 10px 14px; border-radius: 8px; border-left: 4px solid #1a73e8;">
                <div style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                    <i class="fa fa-hourglass-half fa-spin"></i> Đang đếm ngược: <span id="helpCountdownSeconds" style="font-size: 14px; color: #d93025; font-weight: bold;">10</span> giây
                </div>
                <div style="line-height: 1.45; color: #3c4043;">
                    💡 <strong>Bạn có thể:</strong> Chuyển sang tab khác hoặc đóng hoàn toàn trang web ngay bây giờ để kiểm tra xem thông báo có đẩy về máy không nhé!
                </div>
            </div>

            <!-- PHẦN 5: TRẠNG THÁI THÔNG BÁO NGOÀI MÀN HÌNH -->
            <div style="font-size: 12.5px; font-weight: 700; color: #202124; margin: 16px 0 8px 0;">
                5. Thông báo ngoài màn hình máy tính / điện thoại
            </div>

            <div style="border: 1px solid #dadce0; border-radius: 8px; background: #ffffff; padding: 12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 12px;">
                <div id="helpPushStatusBadge" style="margin-bottom: 10px; padding: 8px 12px; border-radius: 6px; font-size: 12px; background: #f1f3f4; color: #5f6368; display: flex; align-items: center; gap: 8px;">
                    <i class="fa fa-circle-o-notch fa-spin"></i> Đang kiểm tra trạng thái thiết bị...
                </div>

                <div id="helpPushToggleWrapper" style="display: flex; gap: 8px;">
                    <button type="button" id="btnToggleHelpPush" class="btn-help-action btn-help-action-primary" onclick="actionTogglePushFromHelp()" style="font-size: 12px; padding: 6px 14px;">
                        <i class="fa fa-bell"></i> Bật thông báo trên thiết bị
                    </button>
                </div>
            </div>

            <!-- HƯỚNG DẪN MỞ KHÓA NẾU BỊ CHẶN -->
            <div id="helpPushBlockedGuide" style="display: none; border: 1px solid #fce8e6; border-left: 4px solid #d93025; background: #fffbfb; border-radius: 6px; padding: 12px; font-size: 11.5px; color: #5f6368; margin-bottom: 12px;">
                <div style="font-weight: 700; color: #d93025; font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                    <i class="fa fa-lock"></i> Hướng dẫn khắc phục nếu quyền thông báo bị chặn
                </div>
                <div style="line-height: 1.5;">
                    Nếu bạn bấm Bật nhưng trình duyệt không hiện hộp thoại hỏi hoặc bị báo "Chặn":
                    <ol style="margin: 6px 0 0 16px; padding: 0;">
                        <li>Nhấp vào biểu tượng <strong>🔒 Ổ khóa</strong> hoặc <strong>Cài đặt trang web</strong> trên thanh địa chỉ URL.</li>
                        <li>Tại mục <strong>Thông báo (Notifications)</strong>, chuyển sang <strong>Cho phép (Allow)</strong>.</li>
                        <li>Tải lại trang (F5) và bấm lại nút <strong>Bật thông báo</strong> ở trên.</li>
                    </ol>
                </div>
            </div>
        `
    }
};

// Hiển thị Màn hình chi tiết chủ đề trợ giúp
function showHelpDetail(topicKey) {
    const data = HELP_TOPICS_DATA[topicKey];
    if (!data) return;

    $('#helpMainScreen').hide();
    $('#helpDetailScreen').css('display', 'flex');
    $('#helpDetailHeaderTitle').text(data.title);

    const html = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <h4 class="help-detail-title" style="margin: 0;">${data.title}</h4>
            ${data.badge ? `<span style="font-size: 11px; font-weight: 600; color: #1a73e8; background: #e8f0fe; padding: 2px 8px; border-radius: 12px;">${data.badge}</span>` : ''}
        </div>
        ${data.content}
    `;

    $('#helpDetailContentBody').html(html).scrollTop(0);

    if (topicKey === 'thong-bao') {
        setTimeout(refreshHelpPushUI, 50);
    }
}
window.showHelpDetail = showHelpDetail;

// Quay lại Màn hình chính danh mục trợ giúp
function backToHelpMain() {
    $('#helpDetailScreen').hide();
    $('#helpMainScreen').css('display', 'flex');
}
window.backToHelpMain = backToHelpMain;

// Tìm kiếm lọc 5 mục trong trợ giúp
function filterHelpTopics(query) {
    const q = (query || '').toLowerCase().trim();
    $('#helpTopicsList .help-topic-item').each(function() {
        const text = $(this).text().toLowerCase();
        if (!q || text.indexOf(q) !== -1) {
            $(this).show();
        } else {
            $(this).hide();
        }
    });
}
window.filterHelpTopics = filterHelpTopics;

// CÁC HÀNH ĐỘNG TƯƠNG TÁC THỰC CHIẾN TỪ TRỢ GIÚP (ACTIONABLE)
function actionSwitchHelpView(mode) {
    closeHelpDrawer();
    if (typeof switchViewMode === 'function') {
        switchViewMode(mode);
    }
}
window.actionSwitchHelpView = actionSwitchHelpView;

function actionCreateDeadlineNow() {
    closeHelpDrawer();
    if (typeof openCreateDeadlineModal === 'function') {
        openCreateDeadlineModal();
    }
}
window.actionCreateDeadlineNow = actionCreateDeadlineNow;

function actionCreatePersonalDeadline() {
    closeHelpDrawer();
    if (typeof openCreateDeadlineModal === 'function') {
        openCreateDeadlineModal('personal');
    }
}
window.actionCreatePersonalDeadline = actionCreatePersonalDeadline;

function actionCreateGroupDeadline() {
    closeHelpDrawer();
    if (typeof openCreateDeadlineModal === 'function') {
        openCreateDeadlineModal('group');
    }
}
window.actionCreateGroupDeadline = actionCreateGroupDeadline;

function actionCheckAccountOrLogin() {
    closeHelpDrawer();
    const user = getAuthUser();
    if (user && user.id && user.id !== 'guest') {
        if (typeof toastr !== 'undefined') {
            toastr.info(`Bạn đang đăng nhập với tài khoản: ${user.name}`, 'Thông tin tài khoản');
        }
    } else {
        if (typeof openLoginModal === 'function') {
            openLoginModal();
        }
    }
}
window.actionCheckAccountOrLogin = actionCheckAccountOrLogin;

// Bắt phím tắt Esc để đóng Drawers
$(document).keydown(function(e) {
    if (e.key === 'Escape' || e.keyCode === 27) {
        if ($('#feedbackDrawer').hasClass('open') || $('#helpDrawer').hasClass('open')) {
            closeAllDrawers();
        }
    }
});

// Chuyển đổi tab con trong chi tiết Trợ giúp
function switchHelpSubTab(tabId, btnElement) {
    $('.help-subtab-content').hide();
    $('#' + tabId).show();
    $('.btn-help-tab').css({ background: 'transparent', color: '#5f6368', boxShadow: 'none' });
    $(btnElement).css({ background: '#ffffff', color: '#1a73e8', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' });
}
window.switchHelpSubTab = switchHelpSubTab;

// Đóng mở dropdown mini tạo lịch inline
function toggleHelpInlineDropdown(event) {
    if (event) event.stopPropagation();
    $('#helpInlineCreateMenu').toggle();
}
window.toggleHelpInlineDropdown = toggleHelpInlineDropdown;

$(document).click(function(e) {
    if (!$(e.target).closest('.inline-create-dropdown').length) {
        $('#helpInlineCreateMenu').hide();
    }
});



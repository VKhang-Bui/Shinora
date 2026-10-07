/**
 * DEADLINE TRACKER - JAVASCRIPT MODULE
 * Tối ưu hóa 2 tầng: HTTP Cache + Optimistic UI 2 Phân khu Local Cache
 */

let currentDate = new Date(2026, 9, 5); // Mặc định mốc ngày Thứ 2, 05/10/2026
const todayDate = new Date(2026, 9, 5);  // Mốc ngày hiện tại để tính độ gấp màu sắc
let currentViewMode = 'week';           // 'week' | 'month'
let currentDeadlines = [];              // Danh sách deadline gộp từ 2 phân khu

// ==========================================
// 1. LOCAL CACHE 2 PHÂN KHU (STAGING BUFFER & OPTIMISTIC UI)
// ==========================================
const CACHE_CONFIRMED_KEY = 'deadlines_synced_v1'; // KHU A: Không biến động (Đã ghi vào SQL)
const CACHE_PENDING_KEY = 'deadlines_pending_v1';   // KHU B: Biến động (Đang chờ đồng bộ / Lỗi)
const API_URL = '/api/deadlines';

function getConfirmedCache() {
    try {
        const raw = localStorage.getItem(CACHE_CONFIRMED_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function setConfirmedCache(list) {
    try {
        localStorage.setItem(CACHE_CONFIRMED_KEY, JSON.stringify(list || []));
    } catch (e) {
        console.error('[Cache Save Confirmed Error]:', e);
    }
}

function getPendingCache() {
    try {
        const raw = localStorage.getItem(CACHE_PENDING_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function setPendingCache(list) {
    try {
        localStorage.setItem(CACHE_PENDING_KEY, JSON.stringify(list || []));
    } catch (e) {
        console.error('[Cache Save Pending Error]:', e);
    }
}

// Gộp 2 phân khu (Khu A + Khu B) để vẽ lên màn hình tức thì
function computeEffectiveDeadlines() {
    const confirmed = getConfirmedCache();
    const pending = getPendingCache();

    const map = new Map();
    confirmed.forEach(item => {
        map.set(item.id, { ...item, _syncStatus: 'synced' });
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

    const result = Array.from(map.values());
    result.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return result;
}

// Tải dữ liệu ban đầu: Hiển thị ngay từ Cache (0ms), sau đó Revalidate ngầm với Server
async function fetchDeadlinesFromDb(keyword = '') {
    // 1. Tức thì: Nạp ngay từ Local Cache (Khu A + Khu B)
    currentDeadlines = computeEffectiveDeadlines();
    if (keyword && keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        currentDeadlines = currentDeadlines.filter(d => d.title && d.title.toLowerCase().includes(kw));
    }
    renderCurrentView();

    // 2. Chạy ngầm: Gửi request lên server để so sánh và cập nhật mới nhất
    try {
        const url = keyword ? `${API_URL}?k=${encodeURIComponent(keyword)}` : API_URL;
        const res = await fetch(url);
        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
            // Cập nhật Khu A (Không biến động)
            setConfirmedCache(result.data);

            // Dọn dẹp Khu B: Các bản ghi create/update/delete đã được server xác nhận
            const serverIdSet = new Set(result.data.map(d => d.id));
            const currentPending = getPendingCache().filter(p => {
                if (p._syncOp === 'create' && serverIdSet.has(p.id)) return false;
                if (p._syncOp === 'delete' && !serverIdSet.has(p.id)) return false;
                return true;
            });
            setPendingCache(currentPending);

            // Cập nhật lại danh sách và vẽ lại mượt mà
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
    const tempId = dlData.id || ('dl-' + Date.now());
    const pendingItem = {
        ...dlData,
        id: tempId,
        _syncOp: 'create',
        _syncStatus: 'pending' // 'pending' | 'error' | 'synced'
    };

    // 1. Ghi ngay vào KHU B
    const pendingList = getPendingCache();
    pendingList.push(pendingItem);
    setPendingCache(pendingList);

    // 2. Render ngay tức thì (0.01s)
    currentDeadlines = computeEffectiveDeadlines();
    renderCurrentView();

    if (typeof toastr !== 'undefined') {
        toastr.info(`Đang lưu "${dlData.title}"...`, '', { timeOut: 1200 });
    }

    // 3. Gửi ngầm xuống CSDL SQL
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: tempId,
                title: dlData.title,
                dueDate: dlData.dueDate,
                session: dlData.session,
                category: dlData.category
            })
        });
        const result = await res.json();
        if (result.success && result.data) {
            // THÀNH CÔNG: Chuyển từ Khu B sang Khu A
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
        // THẤT BẠI: Đánh dấu lỗi trong Khu B (Không xóa mất bài của user)
        const pending = getPendingCache();
        const item = pending.find(p => p.id === tempId);
        if (item) {
            item._syncStatus = 'error';
            setPendingCache(pending);
        }
        currentDeadlines = computeEffectiveDeadlines();
        renderCurrentView();
        if (typeof toastr !== 'undefined') {
            toastr.error(`Lỗi kết nối máy chủ! Dữ liệu được giữ an toàn trên máy bạn. Nhấp vào thẻ để thử lại.`);
        }
        return null;
    }
}

// OPTIMISTIC UPDATE: Cập nhật ngay trong Khu B -> Hiện ngay lập tức -> Gửi ngầm server
async function optimisticUpdateDeadline(id, dlData) {
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

    // Render ngay tức thì
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
            // Chuyển sang Khu A
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

// OPTIMISTIC DELETE: Ẩn ngay lập tức -> Đưa vào Khu B chờ xóa ngầm -> Nếu lỗi thì khôi phục (Rollback)
async function optimisticDeleteDeadline(id) {
    const itemToDelete = currentDeadlines.find(d => d.id === id);
    if (!itemToDelete) return false;

    // Đưa vào Khu B với _syncOp: 'delete'
    const pendingList = getPendingCache().filter(p => p.id !== id);
    pendingList.push({
        id,
        _syncOp: 'delete',
        _syncStatus: 'pending',
        _originalItem: itemToDelete
    });
    setPendingCache(pendingList);

    // Ẩn ngay khỏi màn hình (0ms)
    currentDeadlines = computeEffectiveDeadlines();
    renderCurrentView();

    try {
        const res = await fetch(`${API_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            // Xóa dứt điểm khỏi cả 2 khu
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
        // ROLLBACK: Khôi phục lại thẻ
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
    const due = new Date(dueDateStr);
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

function renderWeekSchedule(items, mondayDate, filterType = "0", todayDate = new Date(2026, 9, 5)) {
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

        const itemDate = new Date(item.dueDate);
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

        const dueObj = new Date(item.dueDate);
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

function renderMonthSchedule(items, year, month, filterType = "0", todayDate = new Date(2026, 9, 5)) {
    const container = document.getElementById("monthGridBody");
    if (!container) return;
    container.innerHTML = '';

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
        const matchedDeadlines = [];
        if (items) {
            items.forEach(item => {
                if (filterType === "group" && item.category !== "group") return;
                if (filterType === "personal" && item.category !== "personal") return;

                const itemD = new Date(item.dueDate);
                if (itemD.getFullYear() === currentGridDate.getFullYear() &&
                    itemD.getMonth() === currentGridDate.getMonth() &&
                    itemD.getDate() === currentGridDate.getDate()) {
                    matchedDeadlines.push(item);
                }
            });
        }

        let deadlineBadgesHtml = '';
        matchedDeadlines.forEach(dl => {
            const daysLeft = calculateDaysLeft(dl.dueDate, todayDate);
            const styleInfo = getDeadlineColorStyle(daysLeft, dl.isCompleted);
            const dueObj = new Date(dl.dueDate);
            const timeOnly = `${String(dueObj.getHours()).padStart(2,'0')}:${String(dueObj.getMinutes()).padStart(2,'0')}`;

            let mSync = '';
            if (dl._syncStatus === 'pending') {
                mSync = ' <i class="fa fa-refresh fa-spin" style="color: #1a73e8; margin-left: 2px;"></i>';
            } else if (dl._syncStatus === 'error') {
                mSync = ' <i class="fa fa-exclamation-triangle" style="color: #d93025; margin-left: 2px;"></i>';
            }

            deadlineBadgesHtml += `
                <div class="month-deadline-badge" onclick="showDeadlineDetail('${dl.id}', event, this)" title="${escapeHtml(dl.title)} - Hạn: ${timeOnly}" style="background-color: ${styleInfo.bg}; border: 1px solid ${styleInfo.border}; color: ${styleInfo.text}; padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;">
                    <span style="font-weight: 700;">[${timeOnly}]</span> ${escapeHtml(dl.title)}${mSync}
                </div>
            `;
        });

        const bgCell = isCurrentMonth ? "#ffffff" : "#fbfbfb";
        const textOpacity = isCurrentMonth ? "1" : "0.45";
        const todayStyle = isToday ? "border: 2px solid #1890ff !important; background-color: #f0f8ff;" : "";

        rowHtml += `
            <td style="background-color: ${bgCell}; ${todayStyle} vertical-align: top; height: 110px; padding: 6px; width: 14.28%;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 11px; color: #888;">${isToday ? '<b style="color: #1890ff;">Hôm nay</b>' : ''}</span>
                    <span style="font-weight: bold; font-size: 13px; color: #333; opacity: ${textOpacity};">${dayNum}</span>
                </div>
                <div style="max-height: 85px; overflow-y: auto;">
                    ${deadlineBadgesHtml}
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

function renderCurrentView() {
    if (currentViewMode === 'week') {
        updateWeekHeader();
        renderWeekSchedule(currentDeadlines, getMonday(new Date(currentDate)), "0", todayDate);
    } else {
        renderMonthSchedule(currentDeadlines, currentDate.getFullYear(), currentDate.getMonth(), "0", todayDate);
    }

    const picker = $("#dateNgayXemLich").data("kendoDatePicker");
    if (picker) {
        picker.value(currentDate);
    }
}

function updateWeekHeader() {
    const monday = getMonday(new Date(currentDate));
    const dayIds = ['th-mon', 'th-tue', 'th-wed', 'th-thu', 'th-fri', 'th-sat', 'th-sun'];
    const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dateStr = formatDate(d);
        const th = document.getElementById(dayIds[i]);
        if (th) {
            th.innerHTML = `<span>${dayNames[i]}</span><br><small class="date-label">${dateStr}</small>`;
        }
    }
}

function getMonday(d) {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
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

    const dueObj = new Date(item.dueDate);
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

    if (item.category === 'group') {
        $('#detailCategoryIcon').attr('class', 'fa fa-users').css('color', '#0f9d58');
        $('#detailCategoryText').text('Cả nhóm');
    } else {
        $('#detailCategoryIcon').attr('class', 'fa fa-user').css('color', '#1a73e8');
        $('#detailCategoryText').text('Cá nhân');
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

    const dueObj = new Date(item.dueDate);
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

    const dueObj = new Date(item.dueDate);
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
let miniCalYear = 2026;
let miniCalMonth = 9;
let selectedModalDate = new Date(2026, 9, 12);
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
    setModalCategory(category || 'personal');

    const nextWeek = new Date(currentDate);
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

    selectedModalDate = new Date(item.dueDate);
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
    } else {
        $('#tabBtnPersonal').css({ 'background': '#f1f3f4', 'color': '#444746' });
        $('#tabBtnGroup').css({ 'background': '#c2e7ff', 'color': '#001d35' });
    }
}

function toggleModalCalendarPopup(e) {
    if (e) e.stopPropagation();
    $('#modalCalendarPopup').toggle();
}

function renderMiniCalGrid() {
    $('#miniCalTitle').text(`Tháng ${miniCalMonth + 1}, ${miniCalYear}`);
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
        html += `<div style="padding: 5px 0; color: #b0b4b8; cursor: pointer;" onclick="selectModalDate(${miniCalYear}, ${miniCalMonth - 1}, ${dNum})">${dNum}</div>`;
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
        const isSelected = selectedModalDate.getFullYear() === miniCalYear &&
                           selectedModalDate.getMonth() === miniCalMonth &&
                           selectedModalDate.getDate() === d;
        if (isSelected) {
            html += `<div style="padding: 5px 0; display: flex; align-items: center; justify-content: center;"><span style="width: 24px; height: 24px; line-height: 24px; background: #1a73e8; color: #fff; border-radius: 50%; font-weight: bold; cursor: pointer;">${d}</span></div>`;
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
    selectedModalDate = new Date(y, m, d);
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
            category: activeModalCategory
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
        category: activeModalCategory
    });
}

// ==========================================
// 6. KHỞI TẠO VÀ SỰ KIỆN TRANG WEB
// ==========================================
$(document).ready(function () {
    initDatePicker();
    fetchDeadlinesFromDb(); // Tải dữ liệu ban đầu (Đọc từ Cache trước 0ms + Revalidate ngầm)

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
    if (mode === 'week') {
        $('#viewLichTheoTuan').show();
        $('#viewLichTheoThang').hide();
        $('#portletTitleText').text('Bảng theo dõi Deadline theo tuần');
        $('#sidebar_link_tuan').css({ 'color': '#ff851b', 'font-weight': 'bold', 'background-color': '#f7f9fa' });
        $('#sidebar_link_thang').css({ 'color': '', 'font-weight': 'normal', 'background-color': '' });
    } else {
        $('#viewLichTheoTuan').hide();
        $('#viewLichTheoThang').show();
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
    currentDate = new Date(2026, 9, 5);
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
    if (!$(e.target).closest('#deadlineDetailPopover, .deadline-card, .month-deadline-badge').length) {
        closeDeadlineDetailModal();
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
    }
});

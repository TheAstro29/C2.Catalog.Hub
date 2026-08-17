// ============================================================
// Catalog Hub by C2TECH — ตั้งค่าที่ต้องแก้ตามของจริง
// ============================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYJ9v6sHQkTYgSxU57OqS5IE3OQlolzndSDhKqazX7qHqaYwkzcWVa8diAoTC1mb8/exec';
const SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRv8oYJkDkFIsXwM5ZTn_xPhH8XAD02VVl_9XVFzu2ySNOqnGVMOOH_WiXk5w0nYMU74jc1pxLQkwCD/pub?output=csv';
const CAT_CSV_URL = SHEET_BASE_URL + '&gid=1305593331';

const CACHE_KEY_PRODUCTS = 'catalogHub_products_v2';
const CACHE_KEY_CATEGORIES = 'catalogHub_categories_v2';
const CACHE_KEY_SYNC_TIME = 'catalogHub_lastSync_v2';

let catalogs = [];
let categories = [];
let currentFilter = 'all';
let currentSearch = '';
let currentAction = 'add';
let currentFileType = 'pdf'; // ประเภทไฟล์ที่กำลังเลือกอยู่ในฟอร์มเพิ่ม/แก้ไขสินค้า
let isAdmin = false;
let adminToken = null;
const selectedIdx = new Set(); // ดัชนีสินค้าที่เลือกไว้เพื่อ "แชร์ให้ลูกค้า" ทีเดียวหลังนำเสนอจบ

// --- Init ---
function init() {
  loadFromCache();
  fetchData();
  setupPullToRefresh();
  setupCatTabsClick();
  registerServiceWorker();
}

// --- แคชข้อมูลไว้ใช้ตอนออฟไลน์ (แสดงผลได้ทันทีจากแคชก่อน แล้วค่อยรีเฟรชเงียบๆ เมื่อมีเน็ต) ---
function loadFromCache() {
  try {
    const cachedProducts = localStorage.getItem(CACHE_KEY_PRODUCTS);
    const cachedCats = localStorage.getItem(CACHE_KEY_CATEGORIES);
    if (cachedProducts) {
      catalogs = JSON.parse(cachedProducts);
      categories = cachedCats ? JSON.parse(cachedCats) : ['ทั่วไป'];
      indexCatalogs();
      renderTabs();
      updateCatDropdown();
      renderCatalogs();
      showOfflineChip(true);
    }
  } catch (e) { /* แคชเสีย ไม่เป็นไร ปล่อยให้ fetchData โหลดสดแทน */ }
}

/** ติด _idx ให้ทุกสินค้าไว้ใช้เป็นตัวอ้างอิงที่ปลอดภัย (กันปัญหาชื่อสินค้ามีเครื่องหมายคำพูดทำให้ onclick พัง) */
function indexCatalogs() {
  catalogs.forEach((item, i) => { item._idx = i; });
}

function showOfflineChip(show, text) {
  const chip = document.getElementById('offlineChip');
  if (!chip) return;
  if (show) {
    document.getElementById('offlineChipText').textContent = text || 'ออฟไลน์ — แสดงแคตตาล็อกที่บันทึกไว้ล่าสุด';
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// --- Fetch Data ---
function fetchData(isSilent = false) {
  if (!isSilent && !catalogs.length) {
    document.getElementById('catalogList').innerHTML = `<div class="loading-state">กำลังอัปเดตข้อมูลล่าสุด...</div>`;
  }
  const cacheBuster = `&t=${new Date().getTime()}`;

  Papa.parse(SHEET_BASE_URL + cacheBuster, {
    download: true, header: true, skipEmptyLines: true,
    complete: (prodRes) => {
      const freshCatalogs = prodRes.data.filter(item => item.title && item.link);
      Papa.parse(CAT_CSV_URL + cacheBuster, {
        download: true, header: true, skipEmptyLines: true,
        complete: (catRes) => {
          const sheetCats = catRes.data.map(c => c.name).filter(c => c);
          const prodCats = freshCatalogs.map(item => item.category).filter(c => c);
          let freshCategories = [...new Set([...sheetCats, ...prodCats])];
          if (freshCategories.length === 0) freshCategories = ['ทั่วไป'];

          catalogs = freshCatalogs;
          categories = freshCategories;
          indexCatalogs();
          persistCache();
          showOfflineChip(false);
          renderTabs(); updateCatDropdown(); renderCatalogs();
        },
        error: () => handleFetchError(),
      });
    },
    error: () => handleFetchError(),
  });
}

function persistCache() {
  try {
    localStorage.setItem(CACHE_KEY_PRODUCTS, JSON.stringify(catalogs));
    localStorage.setItem(CACHE_KEY_CATEGORIES, JSON.stringify(categories));
    localStorage.setItem(CACHE_KEY_SYNC_TIME, new Date().toISOString());
  } catch (e) { /* localStorage เต็ม/ปิดใช้งาน ไม่ต้องหยุดแอปเพราะเรื่องนี้ */ }
}

function handleFetchError() {
  const lastSync = localStorage.getItem(CACHE_KEY_SYNC_TIME);
  if (catalogs.length) {
    // มีแคชอยู่แล้วให้แสดงต่อไป แค่บอกว่าออฟไลน์
    const timeText = lastSync ? `บันทึกไว้ล่าสุด ${formatSyncTime(lastSync)}` : 'แสดงแคตตาล็อกที่บันทึกไว้ล่าสุด';
    showOfflineChip(true, `ออฟไลน์ — ${timeText}`);
  } else {
    document.getElementById('catalogList').innerHTML = `
      <div class="empty-state">
        <i class="fas fa-wifi" style="font-size:22px;display:block;margin-bottom:10px;"></i>
        ไม่สามารถเชื่อมต่อข้อมูลได้ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ต<br>
        <button class="btn-secondary" style="margin-top:14px;width:auto;padding:10px 22px;" onclick="fetchData()">ลองใหม่อีกครั้ง</button>
      </div>`;
  }
}

function formatSyncTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// --- Pull to Refresh ---
function setupPullToRefresh() {
  let startY = 0;
  const ptr = document.getElementById('ptr');

  window.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0) startY = e.touches[0].pageY;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    const y = e.touches[0].pageY;
    if (window.scrollY === 0 && y > startY) {
      const diff = y - startY;
      if (diff < 100) {
        ptr.style.transform = `translateY(${diff}px)`;
        if (diff > 70) ptr.innerText = '🔄 ปล่อยเพื่อรีเฟรช';
      }
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (parseInt((ptr.style.transform || '').replace('translateY(', '')) > 70) {
      manualRefresh();
    }
    ptr.style.transform = 'translateY(0)';
    ptr.innerText = '⬇️ ลากลงเพื่อรีเฟรช';
  });
}

function manualRefresh() {
  Swal.fire({ title: 'กำลังรีเฟรช...', timer: 1000, showConfirmButton: false, didOpen: () => Swal.showLoading() });
  fetchData(true);
}

// ============================================================
// Admin Lock — ตอนนี้ผูกกับ Session Token จริงจาก backend แล้ว
// ============================================================
async function askAdminPassword() {
  const { value: password } = await Swal.fire({
    title: 'กรุณาใส่รหัสผ่านแอดมิน', input: 'password',
    inputPlaceholder: 'Enter Password', showCancelButton: true,
  });
  if (!password) return;

  Swal.fire({ title: 'กำลังตรวจสอบรหัสผ่าน...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', body: JSON.stringify({ action: 'checkAdminPassword', password: password.trim() }),
    });
    const result = await response.json();
    if (result.success === true && result.token) {
      isAdmin = true;
      adminToken = result.token;
      document.getElementById('adminBtn').classList.remove('hidden');
      document.getElementById('logoutBtn').classList.remove('hidden');
      document.getElementById('unlockBtn').classList.add('hidden');
      Swal.fire({ icon: 'success', title: 'ปลดล็อกเรียบร้อย', timer: 1000, showConfirmButton: false });
      renderCatalogs();
    } else {
      Swal.fire({ icon: 'error', title: 'รหัสผ่านไม่ถูกต้อง!', text: result.message || '' });
    }
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาดในการเชื่อมต่อ', text: 'โปรดตรวจสอบสัญญาณอินเทอร์เน็ต' });
  }
}

function handleLogout(silent) {
  const doLogout = () => {
    isAdmin = false; adminToken = null;
    document.getElementById('adminBtn').classList.add('hidden');
    document.getElementById('logoutBtn').classList.add('hidden');
    document.getElementById('unlockBtn').classList.remove('hidden');
    renderCatalogs();
    if (!silent) Swal.fire({ icon: 'success', title: 'ออกจากระบบแอดมินแล้ว', timer: 1000, showConfirmButton: false });
  };
  if (silent) { doLogout(); return; }
  Swal.fire({
    title: 'ยืนยันการออกจากระบบ?', icon: 'question', showCancelButton: true,
    confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
    confirmButtonText: 'ออกจากระบบ', cancelButtonText: 'ยกเลิก',
  }).then((result) => { if (result.isConfirmed) doLogout(); });
}

// ============================================================
// UI Rendering
// ============================================================
/** เดิมปุ่มหมวดหมู่ใช้ onclick="filterCategory(${JSON.stringify(cat)})" ซึ่งพัง! เพราะ JSON.stringify
 * ครอบชื่อหมวดหมู่ด้วยเครื่องหมาย " เสมอ แล้วไปชนกับเครื่องหมาย " ที่ครอบ attribute onclick="..." เอง
 * ทำให้ browser ตัด onclick ให้เหลือครึ่งเดียว กดแล้วไม่ทำงานเลยไม่ว่าชื่อหมวดหมู่จะเป็นอะไรก็ตาม (แก้ในรอบนี้)
 * เปลี่ยนมาเก็บชื่อหมวดหมู่ไว้ใน data-cat attribute (escape ให้ปลอดภัยแล้ว) แล้วใช้ event delegation แทน
 * onclick ตรงๆ — วิธีนี้ปลอดภัยไม่ว่าชื่อหมวดหมู่จะมีเครื่องหมายคำพูด, อะพอสโทรฟี หรืออักขระพิเศษอะไรก็ตาม */
function renderTabs() {
  const tabs = document.getElementById('catTabs');
  let html = `<button class="tab-pill ${currentFilter === 'all' ? 'active' : ''}" data-cat="all">ทั้งหมด</button>`;
  categories.forEach(cat => {
    html += `<button class="tab-pill ${currentFilter === cat ? 'active' : ''}" data-cat="${escapeAttr(cat)}">${escapeHtml(cat)}</button>`;
  });
  tabs.innerHTML = html;
}

// event delegation ผูกครั้งเดียวตอนเริ่มแอป — ไม่ต้องผูกใหม่ทุกครั้งที่ renderTabs() วาดปุ่มใหม่
function setupCatTabsClick() {
  document.getElementById('catTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-pill');
    if (!btn) return;
    filterCategory(btn.dataset.cat);
  });
}

function updateCatDropdown() {
  document.getElementById('inputCat').innerHTML = categories.map(cat => `<option value="${escapeAttr(cat)}">${escapeHtml(cat)}</option>`).join('');
}

// ============================================================
// ประเภทไฟล์ (PDF / วิดีโอ / รูปภาพ / อื่นๆ) + พรีวิวลิงก์ในฟอร์มเพิ่ม/แก้ไขสินค้า
// ============================================================
function toggleCatCollapse() {
  const body = document.getElementById('catCollapseBody');
  const arrow = document.getElementById('catCollapseArrow');
  const willOpen = body.classList.contains('hidden');
  body.classList.toggle('hidden');
  arrow.textContent = willOpen ? '▴' : '▾';
}

function fileTypeLabel(type) {
  return { pdf: 'PDF', video: 'วิดีโอ', image: 'รูปภาพ', other: 'ไฟล์อื่นๆ' }[type] || 'ไฟล์';
}

function setActiveTypePill(type) {
  document.querySelectorAll('#typePills .type-pill').forEach(p => p.classList.toggle('active', p.dataset.type === type));
}

function selectFileType(type) {
  currentFileType = type;
  setActiveTypePill(type);
  document.getElementById('autoDetectChip').classList.add('hidden'); // เลือกเองแล้ว ไม่ต้องโชว์ป้าย "ตรวจพบอัตโนมัติ"
}

/** เดาประเภทไฟล์จากลิงก์ที่วาง — ใช้ได้กับนามสกุลไฟล์ที่ปนอยู่ใน URL และโดเมนวิดีโอที่รู้จัก (YouTube/Vimeo)
 * หมายเหตุ: ลิงก์แชร์ปกติของ Google Drive ("/file/d/xxxx/view") ไม่มีนามสกุลไฟล์ปนอยู่ใน URL
 * จึงเดาไม่ได้ทุกกรณี — ผู้ใช้เลือกประเภทไฟล์เองได้เสมอจากปุ่มด้านบนอยู่แล้ว */
function detectFileTypeFromLink(link) {
  const l = (link || '').toLowerCase();
  if (!l) return null;
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(l)) return 'video';
  if (/\.(mp4|mov|avi|webm|mkv|m4v)(\?|$)/.test(l)) return 'video';
  if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/.test(l)) return 'image';
  if (/\.pdf(\?|$)/.test(l)) return 'pdf';
  return null;
}

function updateLinkPreview() {
  const link = document.getElementById('inputLink').value.trim();
  const previewBox = document.getElementById('linkPreview');
  const thumbWrap = document.getElementById('lpThumbWrap');
  const thumbImg = document.getElementById('lpThumbImg');
  const chip = document.getElementById('autoDetectChip');

  if (!link) { previewBox.classList.add('hidden'); chip.classList.add('hidden'); return; }

  const detected = detectFileTypeFromLink(link);
  if (detected) {
    currentFileType = detected;
    setActiveTypePill(detected);
    document.getElementById('autoDetectText').textContent = `✓ ตรวจพบอัตโนมัติจากลิงก์ว่าเป็น${fileTypeLabel(detected)}`;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }

  const fileId = link.match(/[-\w]{25,}/);
  thumbImg.src = fileId ? `https://lh3.googleusercontent.com/d/${fileId[0]}=w200` : localPlaceholder('พรีวิว');
  thumbWrap.classList.toggle('lp-play', currentFileType === 'video');
  previewBox.classList.remove('hidden');
}

/** placeholder รูปสินค้าแบบ local (ไม่พึ่ง third-party service ภายนอกที่อาจล่ม/ถูกบล็อก)
 * ใช้ base64 แทน URL-encoding ตรงๆ เพราะ SVG มีเครื่องหมาย ' อยู่ในตัว ถ้าใส่แบบ URL-encode ธรรมดา
 * แล้วนำไปฝังใน onerror="this.src='...'" เครื่องหมาย ' จะหลุดออกมาทำให้ inline JS พังได้ */
function localPlaceholder(label) {
  const safe = escapeHtml((label || 'C2TECH').slice(0, 16));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='220'><rect width='300' height='220' fill='#E9F1EC'/><text x='50%' y='50%' font-family='sans-serif' font-size='16' fill='#3F654D' text-anchor='middle' dy='.35em'>${safe}</text></svg>`;
  const utf8Safe = btoa(unescape(encodeURIComponent(svg)));
  return 'data:image/svg+xml;base64,' + utf8Safe;
}

function renderCatalogs() {
  const list = document.getElementById('catalogList');
  const filtered = catalogs.filter(item =>
    (currentFilter === 'all' || item.category === currentFilter) &&
    (!currentSearch || item.title.toLowerCase().includes(currentSearch))
  );

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">-- ไม่พบข้อมูลสินค้า --</div>`;
    return;
  }

  list.innerHTML = filtered.map((item) => {
    const idx = item._idx;
    const isVideo = item.fileType === 'video';
    const fileId = (item.link || '').match(/[-\w]{25,}/);
    // ใช้ lh3.googleusercontent.com แทน drive.google.com/thumbnail — endpoint หลังนี้ทำงานได้ปกติเวลาเปิดตรงๆ
    // ในเบราว์เซอร์ แต่เบราว์เซอร์รุ่นใหม่ๆ มักบล็อกไม่ให้เว็บอื่นฝังเป็น <img> (Cross-Origin-Resource-Policy)
    // ทำให้รูปพังเฉพาะตอนแสดงในเว็บของเรา ทั้งที่เปิดลิงก์ตรงๆ ก็เห็นรูปปกติ — สลับมาใช้โดเมนนี้แก้ปัญหานี้ได้
    const thumbUrl = fileId ? `https://lh3.googleusercontent.com/d/${fileId[0]}=w1000` : localPlaceholder(item.title);
    const isSelected = selectedIdx.has(idx);

    return `
      <div class="card ${isAdmin ? 'admin-mode' : ''}">
        ${isAdmin ? `
        <div class="admin-actions">
          <button class="edit-btn" onclick="openEditMode(${idx})"><i class="fas fa-pen"></i></button>
          <button class="del-btn" onclick="confirmDeleteProduct(${idx})"><i class="fas fa-trash"></i></button>
        </div>` : ''}
        <div class="card-img-wrap">
          <img class="card-img" src="${escapeAttr(thumbUrl)}" loading="lazy"
               onclick="previewImage('${escapeAttr(thumbUrl)}')"
               onerror="this.src='${localPlaceholder('ไม่พบรูป')}'">
          ${isVideo ? `<div class="play-badge"><i class="fas fa-play"></i></div>` : ''}
          <button class="pin-btn ${isSelected ? 'active' : ''}" onclick="toggleSelect(${idx})" title="เลือกไว้แชร์ให้ลูกค้า">
            <i class="fas ${isSelected ? 'fa-check' : 'fa-plus'}"></i>
          </button>
          <div class="cat-tag">${escapeHtml(item.category || 'ทั่วไป')}</div>
          ${isVideo ? `<div class="type-tag"><i class="fas fa-film"></i> วิดีโอ</div>` : ''}
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(item.title)}</div>
          <div class="card-actions">
            <button class="btn-open ${isVideo ? 'btn-play' : ''}" onclick="handleOpenFile(${idx})"><i class="fas ${isVideo ? 'fa-play' : 'fa-file-pdf'}"></i>${isVideo ? 'เล่นวิดีโอ' : 'เปิดไฟล์'}</button>
            <button class="btn-qr" onclick="showProductQR(${idx})"><i class="fas fa-qrcode"></i>QR</button>
            <button class="btn-share" onclick="shareSingleToLine(${idx})"><i class="fab fa-line"></i>แชร์</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// --- Search (with debounce) + Category — ใช้ state เดียวกันทั้งคู่ กันปัญหาค้นหาหายตอนสลับแท็บ ---
let searchTimer;
function filterProductsDebounced() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentSearch = document.getElementById('searchInput').value.toLowerCase();
    renderCatalogs();
  }, 300);
}

function filterCategory(c) { currentFilter = c; renderTabs(); renderCatalogs(); }

// --- Image preview ---
function previewImage(src) {
  document.getElementById('overlayImg').src = src;
  document.getElementById('imageOverlay').style.display = 'flex';
}

// ============================================================
// เลือกสินค้าไว้แชร์ให้ลูกค้าทีเดียว (ฟีเจอร์ใหม่)
// ============================================================
function toggleSelect(idx) {
  if (selectedIdx.has(idx)) selectedIdx.delete(idx); else selectedIdx.add(idx);
  renderCatalogs();
  renderSelectionBar();
}

function clearSelection() {
  selectedIdx.clear();
  renderCatalogs();
  renderSelectionBar();
}

function renderSelectionBar() {
  const bar = document.getElementById('selectionBar');
  const count = selectedIdx.size;
  document.getElementById('selectionCount').textContent = count;
  bar.classList.toggle('hidden', count === 0);
}

function buildLineShareText(items) {
  const lines = items.map(it => `${it.title}\n${it.link}`);
  return `แคตตาล็อกสินค้าที่สนใจ จาก C2TECH:\n\n${lines.join('\n\n')}`;
}

function openLineShare(text) {
  window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank');
}

function shareSelectionToLine() {
  const items = catalogs.filter(it => selectedIdx.has(it._idx));
  if (!items.length) return;
  openLineShare(buildLineShareText(items));
}

function shareSingleToLine(idx) {
  const item = catalogs.find(it => it._idx === idx);
  if (!item) return;
  openLineShare(`${item.title}\n${item.link}`);
}

// ============================================================
// Admin actions (add / edit / delete product & category)
// ============================================================
async function handleProductAction() {
  const p = {
    action: currentAction,
    title: document.getElementById('inputTitle').value.trim(),
    link: document.getElementById('inputLink').value.trim(),
    category: document.getElementById('inputCat').value,
    fileType: currentFileType,
    oldTitle: document.getElementById('editOldTitle').value,
  };
  if (!p.title || !p.link) return Swal.fire({ title: 'ระบุข้อมูลไม่ครบ', icon: 'warning' });
  await sendToCloud(p);
}

async function handleAddCat() {
  const name = document.getElementById('newCatInput').value.trim();
  if (!name) return;
  const ok = await sendToCloud({ action: 'addCat', catName: name });
  if (ok) document.getElementById('newCatInput').value = '';
}

async function handleDelCat() {
  const name = document.getElementById('inputCat').value;
  const res = await Swal.fire({ title: `ลบหมวด "${name}"?`, icon: 'warning', showCancelButton: true });
  if (res.isConfirmed) await sendToCloud({ action: 'deleteCat', oldCatName: name });
}

function confirmDeleteProduct(idx) {
  const item = catalogs.find(it => it._idx === idx);
  if (!item) return;
  Swal.fire({ title: 'ลบสินค้านี้?', text: item.title, icon: 'error', showCancelButton: true })
    .then((res) => { if (res.isConfirmed) sendToCloud({ action: 'delete', oldTitle: item.title }); });
}

/** ส่งคำสั่งแก้ไขข้อมูลไปที่ backend — แนบ token เสมอ และอ่านผลลัพธ์จริงกลับมา (ไม่ใช้ no-cors แบบเดิมที่บอกสำเร็จมั่วซั่ว) */
async function sendToCloud(p) {
  Swal.fire({ title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    const payload = Object.assign({}, p, { token: adminToken });
    const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json();

    if (result.success) {
      closeModal();
      Swal.fire({ icon: 'success', title: result.message || 'สำเร็จ', showConfirmButton: false, timer: 1200 });
      setTimeout(() => { fetchData(true); }, 900);
      return true;
    }

    if (String(result.message || '').startsWith('unauthorized')) {
      Swal.fire({ icon: 'error', title: 'หมดสิทธิ์แอดมิน', text: 'กรุณาปลดล็อกแอดมินใหม่อีกครั้ง' });
      handleLogout(true);
      return false;
    }

    Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: result.message || 'กรุณาลองใหม่อีกครั้ง' });
    return false;
  } catch (e) {
    Swal.fire({ title: 'เกิดข้อผิดพลาดในการเชื่อมต่อ', text: 'ตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่', icon: 'error' });
    return false;
  }
}

function openAdminModal() { document.getElementById('adminModal').classList.remove('hidden'); }
function closeModal() { document.getElementById('adminModal').classList.add('hidden'); resetToAddMode(); }

function openEditMode(idx) {
  const item = catalogs.find(it => it._idx === idx);
  if (!item) return;
  currentAction = 'edit';
  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-pen"></i> แก้ไขสินค้า';
  document.getElementById('editOldTitle').value = item.title;
  document.getElementById('inputTitle').value = item.title;
  document.getElementById('inputLink').value = item.link;
  document.getElementById('inputCat').value = item.category;
  currentFileType = item.fileType || 'pdf';
  setActiveTypePill(currentFileType);
  document.getElementById('autoDetectChip').classList.add('hidden');
  updateLinkPreview();
  document.getElementById('resetBtn').classList.remove('hidden');
  openAdminModal();
}

function resetToAddMode() {
  currentAction = 'add';
  currentFileType = 'pdf';
  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-toolbox"></i> จัดการระบบ';
  document.getElementById('inputTitle').value = '';
  document.getElementById('inputLink').value = '';
  document.getElementById('editOldTitle').value = '';
  document.getElementById('resetBtn').classList.add('hidden');
  setActiveTypePill('pdf');
  document.getElementById('autoDetectChip').classList.add('hidden');
  document.getElementById('linkPreview').classList.add('hidden');
  document.getElementById('catCollapseBody').classList.add('hidden');
  document.getElementById('catCollapseArrow').textContent = '▾';
}

// ============================================================
// Standard helpers
// ============================================================
function copyToClipboard(url) {
  const done = () => Swal.fire({ icon: 'success', title: 'คัดลอกสำเร็จ!', timer: 800, showConfirmButton: false, toast: true, position: 'top' });
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
  } else {
    fallbackCopy(url, done);
  }
}
function fallbackCopy(url, done) {
  const el = document.createElement('textarea');
  el.value = url; document.body.appendChild(el); el.select();
  document.execCommand('copy'); document.body.removeChild(el);
  done();
}

/** เปิดไฟล์ — รองรับทั้ง Browser ทั่วไปและ Webview (APK) */
function handleOpenFile(idx) {
  const item = catalogs.find(it => it._idx === idx);
  if (!item || !item.link) return;
  const link = document.createElement('a');
  link.href = item.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  try { link.click(); document.body.removeChild(link); } catch (e) { window.location.href = item.link; }
}

/** เปิดหน้าต่าง QR — ใช้ classList แทนการตั้ง style.display ตรงๆ เพราะ overlay ถูกซ่อนด้วย
 * class "hidden" (display:none !important) ตอนโหลดหน้าแรก การตั้ง style.display มาทับเฉยๆ
 * เอาชนะ !important ไม่ได้ ทำให้ปุ่ม QR กดแล้วไม่มีอะไรเกิดขึ้น (บั๊กที่แก้ในรอบนี้) */
function openQrOverlay() { document.getElementById('qrOverlay').classList.remove('hidden'); }
function closeQrOverlay() { document.getElementById('qrOverlay').classList.add('hidden'); }

function showProductQR(idx) {
  const item = catalogs.find(it => it._idx === idx);
  if (!item || !item.link) return;
  document.getElementById('qrTitle').innerText = item.title;
  document.getElementById('qrImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(item.link)}`;
  openQrOverlay();
}

function showWebQR() {
  document.getElementById('qrTitle').innerText = 'QR Code สำหรับเข้าเว็บไซต์';
  document.getElementById('qrImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(window.location.href)}`;
  openQrOverlay();
}

init();

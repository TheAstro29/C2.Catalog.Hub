// ============================================================
// Catalog Hub by C2TECH — ตั้งค่าที่ต้องแก้ตามของจริง
// ============================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYJ9v6sHQkTYgSxU57OqS5IE3OQlolzndSDhKqazX7qHqaYwkzcWVa8diAoTC1mb8/exec';
const SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRv8oYJkDkFIsXwM5ZTn_xPhH8XAD02VVl_9XVFzu2ySNOqnGVMOOH_WiXk5w0nYMU74jc1pxLQkwCD/pub?output=csv';
const CAT_CSV_URL = SHEET_BASE_URL + '&gid=1305593331';
// สไลด์หน้าแรก — CSV ของ Sheet แท็บ "slides" (คอลัมน์ imageUrl, linkUrl)
const SLIDES_CSV_URL = SHEET_BASE_URL + '&gid=935171774';

const CACHE_KEY_PRODUCTS = 'catalogHub_products_v2';
const CACHE_KEY_CATEGORIES = 'catalogHub_categories_v2';
const CACHE_KEY_SLIDES = 'catalogHub_slides_v1';
const CACHE_KEY_SYNC_TIME = 'catalogHub_lastSync_v2';
const CACHE_KEY_CONTACTS = 'catalogHub_contacts_v1';
const CACHE_KEY_CHANNELS = 'catalogHub_channels_v1';
const CACHE_KEY_THEME = 'catalogHub_theme_v1';
const CACHE_KEY_INSTALL_DISMISSED = 'catalogHub_installDismissed_v1';

let catalogs = [];
let categories = [];
let slides = []; // [{ imageUrl, linkUrl }]
let contacts = [
  { name: 'นพดล', role: 'CEO', phone: '' },
  { name: 'กานต์', role: 'COO', phone: '' },
  { name: 'เจษฎา', role: 'Marketing', phone: '' },
];
// ช่องทางออนไลน์ของบริษัท (แยกจากรายชื่อพนักงาน) — แสดงเป็นปุ่มบนสุดของแผ่นติดต่อด่วน ถ้าเปิดใช้งานและมีลิงก์
let channels = {
  line: { enabled: false, label: 'แชทผ่าน LINE OA', url: '' },
  facebook: { enabled: false, label: 'ข้อความผ่าน Facebook', url: '' },
};
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
  loadSlides();
  loadContacts();
  loadChannels();
  setupPullToRefresh();
  registerServiceWorker();
  initTheme();
  initInstallBanner();
}

// --- แคชข้อมูลไว้ใช้ตอนออฟไลน์ (แสดงผลได้ทันทีจากแคชก่อน แล้วค่อยรีเฟรชเงียบๆ เมื่อมีเน็ต) ---
function loadFromCache() {
  try {
    const cachedProducts = localStorage.getItem(CACHE_KEY_PRODUCTS);
    const cachedCats = localStorage.getItem(CACHE_KEY_CATEGORIES);
    const cachedSlides = localStorage.getItem(CACHE_KEY_SLIDES);
    if (cachedProducts) {
      catalogs = JSON.parse(cachedProducts);
      categories = cachedCats ? JSON.parse(cachedCats) : ['ทั่วไป'];
      indexCatalogs();
      renderTabs();
      updateCatDropdown();
      renderCatalogs();
      showOfflineChip(true);
    }
    if (cachedSlides) {
      slides = JSON.parse(cachedSlides);
      renderHeroSlider();
    }
    const cachedContacts = localStorage.getItem(CACHE_KEY_CONTACTS);
    if (cachedContacts) {
      contacts = JSON.parse(cachedContacts);
      renderContactFab();
    }
    const cachedChannels = localStorage.getItem(CACHE_KEY_CHANNELS);
    if (cachedChannels) {
      channels = Object.assign({}, channels, JSON.parse(cachedChannels));
      renderContactFab();
    }
  } catch (e) { /* แคชเสีย ไม่เป็นไร ปล่อยให้ fetchData/loadSlides โหลดสดแทน */ }
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
    // เมื่อมี Service Worker เวอร์ชันใหม่เข้าควบคุมหน้าเว็บ (หลัง admin อัปเดตไฟล์แอปแล้วเปลี่ยน CACHE_NAME ใน sw.js)
    // ให้รีโหลดหน้าอัตโนมัติทันทีครั้งเดียว กันปัญหาผู้ใช้เห็นเวอร์ชันเก่าค้างเพราะต้องกด hard refresh เอง
    // สำคัญ: ต้องกันด้วย sessionStorage (ไม่ใช่แค่ตัวแปรในหน่วยความจำ) เพราะตัวแปรธรรมดาจะรีเซ็ตทุกครั้งที่หน้ารีโหลด
    // ถ้า Service Worker บางเบราว์เซอร์ (โดยเฉพาะ Safari/iOS) ยิง controllerchange ซ้ำหลายรอบ จะกลายเป็นวนรีโหลดไม่หยุด
    // (บั๊กนี้เคยเกิดจริง ทำให้แตะปุ่มอะไรไม่ทันเพราะหน้าจอรีโหลดตัดหน้าตลอด) — sessionStorage อยู่ข้ามการรีโหลดได้ จึงกันซ้ำได้จริง
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      let alreadyReloaded = false;
      try { alreadyReloaded = sessionStorage.getItem('swReloaded') === '1'; } catch (e) { /* เข้าถึงไม่ได้ก็ข้าม ไม่รีโหลดเพื่อความปลอดภัย */ alreadyReloaded = true; }
      if (alreadyReloaded) return;
      try { sessionStorage.setItem('swReloaded', '1'); } catch (e) { /* ไม่เป็นไร */ }
      window.location.reload();
    });
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
function renderTabs() {
  const tabs = document.getElementById('catTabs');
  let html = `<button class="tab-pill ${currentFilter === 'all' ? 'active' : ''}" onclick="filterCategory('all')">ทั้งหมด</button>`;
  categories.forEach(cat => {
    // บั๊กเดิม: ใช้ JSON.stringify(cat) ฝังตรงๆ ใน onclick="..." ซึ่ง JSON.stringify ใส่ " ครอบให้เสมอ
    // แต่ attribute onclick ก็ใช้ " ครอบอยู่แล้วเหมือนกัน พอเจอกันเลยตัด attribute ขาดกลางคัน (เหลือแค่ "filterCategory(")
    // กดแท็บไหนก็ตามที่ไม่ใช่ "ทั้งหมด" เลย error "Unexpected end of input" ทุกครั้ง — แก้โดยใช้ single quote
    // ครอบ string แทน แล้ว escape ทั้งสองชั้น (เป็น JS string literal ก่อน แล้วค่อย HTML-escape สำหรับใส่ใน attribute)
    html += `<button class="tab-pill ${currentFilter === cat ? 'active' : ''}" onclick="filterCategory('${jsAttrString(cat)}')">${escapeHtml(cat)}</button>`;
  });
  tabs.innerHTML = html;
}

/** เตรียมข้อความให้ฝังใน onclick="...('ตรงนี้')" ได้อย่างปลอดภัย — escape backslash/apostrophe ให้เป็น JS string literal
 * ที่ถูกต้องก่อน แล้วค่อย HTML-escape อีกชั้นสำหรับใส่ใน attribute (เบราว์เซอร์จะ decode HTML entity ก่อนแล้วค่อยรัน JS) */
function jsAttrString(str) {
  const jsEscaped = String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return escapeAttr(jsEscaped);
}

function updateCatDropdown() {
  document.getElementById('inputCat').innerHTML = categories.map(cat => `<option value="${escapeAttr(cat)}">${escapeHtml(cat)}</option>`).join('');
}

// ============================================================
// ประเภทไฟล์ (PDF / วิดีโอ / รูปภาพ / อื่นๆ) + พรีวิวลิงก์ในฟอร์มเพิ่ม/แก้ไขสินค้า
// ============================================================
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
            <button class="btn-open ${isVideo ? 'btn-play' : ''}" onclick="handleOpenFile(${idx})"><i class="fas ${isVideo ? 'fa-play' : 'fa-file-pdf'}"></i><span class="btn-label">${isVideo ? 'เล่น' : 'เปิด'}</span></button>
            <button class="btn-qr" onclick="showProductQR(${idx})"><i class="fas fa-qrcode"></i><span class="btn-label">QR</span></button>
            <button class="btn-share" onclick="shareSingleToLine(${idx})"><i class="fab fa-line"></i><span class="btn-label">แชร์</span></button>
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
  logShare_(items.map(it => it.title));
}

function shareSingleToLine(idx) {
  const item = catalogs.find(it => it._idx === idx);
  if (!item) return;
  openLineShare(`${item.title}\n${item.link}`);
  logShare_([item.title]);
}

/** บันทึกสถิติการแชร์ไปที่ backend (ใช้ในหน้าสรุปแอดมิน) — ยิงแบบ fire-and-forget ไม่ต้องรอผล/ไม่ต้อง token
 * เพราะเป็นแค่การนับสถิติ ไม่ใช่ข้อมูลลับ พังก็ไม่กระทบการแชร์ของผู้ใช้ทั่วไป */
function logShare_(titles) {
  try {
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'logShare', titles: titles }),
    }).catch(() => {});
  } catch (e) { /* เงียบไว้ — ไม่ให้กระทบการใช้งานจริง */ }
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

/** หน้าจัดการหมวดหมู่ — แสดงทุกหมวดที่มีอยู่เป็นรายการพร้อมไอคอนแก้ไข/ลบท้ายแถว (เหมือนรูปแบบจัดการสไลด์)
 * และลากที่ไอคอน ☰ ด้านหน้าเพื่อจัดลำดับใหม่ได้ — ลากจัดได้อิสระหลายรอบก่อน ไม่บันทึกให้ทันทีทีละครั้ง
 * ต้องกดปุ่ม "บันทึกลำดับหมวดหมู่" เองตอนจัดเสร็จแล้ว (ลำดับนี้เป็นลำดับเดียวกับที่ใช้แสดงแท็บหมวดหมู่หน้าแรก) */
let catOrderDirty = false; // true = ลากจัดลำดับไว้แล้วแต่ยังไม่ได้กดบันทึก

function renderAdminCatList() {
  const list = document.getElementById('catAdminList');
  if (!list) return;
  catOrderDirty = false;
  const saveOrderBtn = document.getElementById('catSaveOrderBtn');
  if (saveOrderBtn) saveOrderBtn.classList.add('hidden');
  if (!categories.length) {
    list.innerHTML = `<div class="slide-admin-empty">ยังไม่มีหมวดหมู่ — เพิ่มหมวดแรกด้านล่างนี้ได้เลย</div>`;
    return;
  }
  list.innerHTML = categories.map(cat => `
    <div class="cat-admin-row" data-cat="${escapeAttr(cat)}">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ"><i class="fas fa-grip-lines"></i></span>
      <div class="cat-admin-name"><i class="fas fa-folder"></i> ${escapeHtml(cat)}</div>
      <div class="slide-admin-actions">
        <button class="edit" onclick="handleEditCat('${jsAttrString(cat)}')" title="แก้ไขชื่อหมวดนี้"><i class="fas fa-pen"></i></button>
        <button class="danger" onclick="handleDelCat('${jsAttrString(cat)}')" title="ลบหมวดนี้"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
  initCatDragDelegation();
}

// --- ลากจัดลำดับหมวดหมู่ (Pointer Events — ใช้ตัวเดียวกันได้ทั้งเมาส์และนิ้วสัมผัส) ---
let catDragState = null;

function initCatDragDelegation() {
  const list = document.getElementById('catAdminList');
  // ผูก listener แค่ครั้งเดียวตลอดอายุเพจ (กันไม่ให้ซ้อนกันทุกครั้งที่ renderAdminCatList() วาดใหม่)
  // ตัว element #catAdminList เองไม่ได้ถูกสร้างใหม่ แค่ innerHTML ข้างในถูกแทนที่ ผูกซ้ำได้เลยไม่หลุด
  if (!list || list.dataset.dragBound) return;
  list.dataset.dragBound = '1';

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const row = handle.closest('.cat-admin-row');
    if (!row) return;
    e.preventDefault();
    row.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ไม่เป็นไร */ }
    catDragState = { row, pointerId: e.pointerId, listEl: list };
  });

  list.addEventListener('pointermove', (e) => {
    if (!catDragState || catDragState.pointerId !== e.pointerId) return;
    const { row, listEl } = catDragState;
    const y = e.clientY;
    const others = Array.from(listEl.querySelectorAll('.cat-admin-row')).filter(r => r !== row);
    if (!others.length) return;

    // หาแถวที่ "ใกล้" ตำแหน่งนิ้ว/เมาส์ที่สุด (เทียบระยะจากจุดกึ่งกลางแนวตั้ง) แทนการไล่เช็คทีละแถวตามลำดับ DOM
    // แบบเดิม — วิธีเดิมพอลากเร็วๆ ข้ามหลายแถวในเฟรมเดียวจะเลือกแถวผิดพลาด กลายเป็นอาการเด้ง/สะดุดที่แจ้งมา
    let closest = null, closestDist = Infinity;
    others.forEach((other) => {
      const rect = other.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(y - mid);
      if (dist < closestDist) { closestDist = dist; closest = { el: other, mid }; }
    });
    if (!closest) return;

    const target = y < closest.mid ? closest.el : closest.el.nextSibling;
    // ถ้าตำแหน่งเป้าหมายเหมือนตำแหน่งปัจจุบันอยู่แล้ว ไม่ต้องขยับซ้ำ (กันสลับไปมาถี่ๆ ตอนนิ้ว/เมาส์นิ่งใกล้เส้นแบ่งแถว)
    if (target === row) return;
    if (target === null) {
      if (listEl.lastElementChild === row) return;
    } else if (target.previousElementSibling === row) {
      return;
    }

    // FLIP technique: จำตำแหน่งเดิมของทุกแถวไว้ก่อนสลับ แล้วเล่นแอนิเมชันเลื่อนแถวอื่นๆ ที่ขยับเข้าที่ใหม่แบบนุ่มนวล
    // (แถวที่กำลังลากอยู่ให้ขยับตามนิ้ว/เมาส์ตรงๆ ทันที ไม่ต้องเล่นแอนิเมชัน)
    const firstRects = new Map(Array.from(listEl.querySelectorAll('.cat-admin-row')).map(r => [r, r.getBoundingClientRect()]));
    listEl.insertBefore(row, target);
    Array.from(listEl.querySelectorAll('.cat-admin-row')).forEach((r) => {
      if (r === row) return;
      const first = firstRects.get(r);
      const last = r.getBoundingClientRect();
      const dy = first.top - last.top;
      if (!dy) return;
      r.style.transition = 'none';
      r.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        r.style.transition = 'transform .18s ease';
        r.style.transform = '';
      });
    });
  });

  // ปล่อยมือ — แค่ทำเครื่องหมายว่ามีการจัดลำดับค้างไว้ (ยังไม่ยิงบันทึกไปเซิร์ฟเวอร์ทันที) แล้วโชว์ปุ่ม
  // "บันทึกลำดับหมวดหมู่" ให้ admin ลากจัดต่อได้เรื่อยๆ กี่รอบก็ได้ก่อน ค่อยกดบันทึกทีเดียวตอนจัดเสร็จ
  const endCatDrag = (e) => {
    if (!catDragState || catDragState.pointerId !== e.pointerId) return;
    const { row } = catDragState;
    row.classList.remove('dragging');
    catDragState = null;
    catOrderDirty = true;
    const saveOrderBtn = document.getElementById('catSaveOrderBtn');
    if (saveOrderBtn) saveOrderBtn.classList.remove('hidden');
  };
  list.addEventListener('pointerup', endCatDrag);
  list.addEventListener('pointercancel', endCatDrag);
}

/** กดปุ่ม "บันทึกลำดับหมวดหมู่" — อ่านลำดับปัจจุบันจาก DOM (ตามที่ลากจัดไว้) แล้วค่อยส่งไปบันทึกที่เซิร์ฟเวอร์ทีเดียว */
async function handleSaveCatOrder() {
  const list = document.getElementById('catAdminList');
  if (!list) return;
  const order = Array.from(list.querySelectorAll('.cat-admin-row')).map(r => r.dataset.cat);
  await handleReorderCat(order);
}

/** บันทึกลำดับหมวดหมู่ใหม่ไปที่เซิร์ฟเวอร์ — อัปเดตหน้าจอทันที (optimistic) แล้วค่อยยืนยันกับเซิร์ฟเวอร์
 * ถ้าบันทึกไม่สำเร็จ (เช่นมีคนแก้หมวดหมู่จากที่อื่นพร้อมกัน) จะรีเฟรชข้อมูลจริงจากเซิร์ฟเวอร์แล้ววาดใหม่ให้ตรงกัน */
async function handleReorderCat(order) {
  categories = order;
  renderTabs();
  updateCatDropdown();
  persistCache();
  const ok = await sendToCloud(
    { action: 'reorderCat', order },
    { closeModalOnSuccess: false, onSuccess: refreshCatAdminView }
  );
  if (ok) {
    catOrderDirty = false;
    const saveOrderBtn = document.getElementById('catSaveOrderBtn');
    if (saveOrderBtn) saveOrderBtn.classList.add('hidden');
  } else {
    fetchData(true);
    setTimeout(renderAdminCatList, 950);
  }
}

/** รีเฟรชรายการหมวดหมู่จากเซิร์ฟเวอร์แล้ววาดหน้าแอดมินใหม่ — ใช้หลัง add/edit/delete หมวดหมู่สำเร็จ */
function refreshCatAdminView() {
  fetchData(true);
  setTimeout(renderAdminCatList, 950);
}

async function handleAddCat() {
  const name = document.getElementById('newCatInput').value.trim();
  if (!name) return;
  const ok = await sendToCloud(
    { action: 'addCat', catName: name },
    { closeModalOnSuccess: false, onSuccess: refreshCatAdminView }
  );
  if (ok) document.getElementById('newCatInput').value = '';
}

async function handleEditCat(oldName) {
  const { value: newName } = await Swal.fire({
    title: 'แก้ไขชื่อหมวดหมู่', input: 'text', inputValue: oldName,
    showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
  });
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  await sendToCloud(
    { action: 'editCat', oldCatName: oldName, catName: newName.trim() },
    { closeModalOnSuccess: false, onSuccess: refreshCatAdminView }
  );
}

async function handleDelCat(name) {
  const res = await Swal.fire({
    title: `ลบหมวด "${name}"?`, icon: 'warning', showCancelButton: true,
    confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก',
  });
  if (!res.isConfirmed) return;
  await sendToCloud(
    { action: 'deleteCat', oldCatName: name },
    { closeModalOnSuccess: false, onSuccess: refreshCatAdminView }
  );
}

function confirmDeleteProduct(idx) {
  const item = catalogs.find(it => it._idx === idx);
  if (!item) return;
  Swal.fire({ title: 'ลบสินค้านี้?', text: item.title, icon: 'error', showCancelButton: true })
    .then((res) => { if (res.isConfirmed) sendToCloud({ action: 'delete', oldTitle: item.title }); });
}

/** ส่งคำสั่งแก้ไขข้อมูลไปที่ backend — แนบ token เสมอ และอ่านผลลัพธ์จริงกลับมา (ไม่ใช้ no-cors แบบเดิมที่บอกสำเร็จมั่วซั่ว)
 * opts.closeModalOnSuccess (default true) — สินค้า/หมวดหมู่ปิด modal ทั้งอันเมื่อสำเร็จ แต่สไลด์ต้องเปิดโมดัลค้างไว้ให้เพิ่มต่อได้เรื่อยๆ
 * opts.onSuccess — callback แทนการรีเฟรชสินค้า (เช่น สไลด์ต้องรีเฟรช loadSlides() แทน fetchData()) */
async function sendToCloud(p, opts) {
  opts = opts || {};
  const closeModalOnSuccess = opts.closeModalOnSuccess !== false;
  Swal.fire({ title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    const payload = Object.assign({}, p, { token: adminToken });
    const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json();

    if (result.success) {
      if (closeModalOnSuccess) closeModal();
      Swal.fire({ icon: 'success', title: result.message || 'สำเร็จ', showConfirmButton: false, timer: 1200 });
      if (opts.onSuccess) {
        setTimeout(opts.onSuccess, 900);
      } else {
        setTimeout(() => { fetchData(true); }, 900);
      }
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

// ============================================================
// หน้าต่างจัดการระบบ — เมนูหลักแบบ grid (คล้าย C2 Loop) กดการ์ดไหนค่อยเข้าไปหน้านั้นทีละหน้า
// ============================================================
const ADMIN_SECTION_META = {
  category: { title: 'จัดการหมวดหมู่', icon: 'fa-folder' },
  slides: { title: 'จัดการสไลด์หน้าแรก', icon: 'fa-images' },
  contacts: { title: 'ผู้ติดต่อด่วน', icon: 'fa-headset' },
  channels: { title: 'ช่องทางออนไลน์', icon: 'fa-comments' },
  stats: { title: 'สรุปข้อมูล', icon: 'fa-chart-simple' },
  product: { title: 'จัดการสินค้า', icon: 'fa-box' },
};

function openAdminModal() {
  document.getElementById('adminModal').classList.remove('hidden');
  showAdminMainMenu();
}

/** เช็คว่ามีลำดับ (หมวดหมู่/สไลด์) ที่ลากจัดค้างไว้แต่ยังไม่ได้กดบันทึกหรือไม่ — ถามยืนยันก่อนออกจากหน้านั้น
 * กันลากจัดเสร็จแล้วลืมกดบันทึก แล้วปิด/ย้อนกลับไปเฉยๆ จนลำดับที่จัดไว้หายไปโดยไม่ตั้งใจ
 * คืนค่า true = ออกจากหน้าได้เลย (ไม่มีอะไรค้าง หรือผู้ใช้ยืนยันจะออกโดยไม่บันทึก), false = ผู้ใช้เลือกอยู่ต่อ */
async function confirmDiscardDirtyOrders() {
  if (catOrderDirty) {
    const res = await Swal.fire({
      title: 'ยังไม่ได้บันทึกลำดับหมวดหมู่', text: 'ออกจากหน้านี้ลำดับที่จัดไว้จะหายไป ต้องการออกเลยไหม?',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'ออกโดยไม่บันทึก', cancelButtonText: 'อยู่ต่อ',
    });
    if (!res.isConfirmed) return false;
    catOrderDirty = false;
  }
  if (slideOrderDirty) {
    const res = await Swal.fire({
      title: 'ยังไม่ได้บันทึกลำดับสไลด์', text: 'ออกจากหน้านี้ลำดับที่จัดไว้จะหายไป ต้องการออกเลยไหม?',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'ออกโดยไม่บันทึก', cancelButtonText: 'อยู่ต่อ',
    });
    if (!res.isConfirmed) return false;
    slideOrderDirty = false;
  }
  return true;
}

async function closeModal() {
  if (!(await confirmDiscardDirtyOrders())) return;
  document.getElementById('adminModal').classList.add('hidden');
  resetToAddMode();
  showAdminMainMenu();
}

/** กลับไปหน้าเมนูหลักของ "จัดการระบบ" — ซ่อนทุกหน้าย่อย โชว์ grid เมนู ซ่อนปุ่มย้อนกลับ */
function showAdminMainMenu() {
  document.getElementById('adminMainMenu').classList.remove('hidden');
  document.querySelectorAll('.admin-section').forEach(el => el.classList.add('hidden'));
  document.getElementById('adminBackBtn').classList.add('hidden');
  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-toolbox"></i> จัดการระบบ';
}

/** เปิดหน้าย่อยตามชื่อ (category/slides/contacts/stats/product) — โหลดข้อมูลของหน้านั้นให้สดใหม่ทุกครั้งที่เข้า */
function openAdminSection(name) {
  const meta = ADMIN_SECTION_META[name];
  if (!meta) return;
  document.getElementById('adminMainMenu').classList.add('hidden');
  document.querySelectorAll('.admin-section').forEach(el => el.classList.add('hidden'));
  const section = document.getElementById('adminSection-' + name);
  if (section) section.classList.remove('hidden');
  document.getElementById('adminBackBtn').classList.remove('hidden');
  document.getElementById('modalTitle').innerHTML = `<i class="fas ${meta.icon}"></i> ${meta.title}`;

  if (name === 'category') renderAdminCatList();
  if (name === 'slides') renderAdminSlideList();
  if (name === 'contacts') renderAdminContactForm();
  if (name === 'channels') renderAdminChannelForm();
  if (name === 'stats') loadStats();
}

/** ปุ่มย้อนกลับที่หัว modal — ถ้ากำลังแก้ไขสินค้าค้างอยู่ ให้ยกเลิกโหมดแก้ไขไปด้วยกันเลย */
async function backToAdminMenu() {
  if (!(await confirmDiscardDirtyOrders())) return;
  if (currentAction === 'edit') resetToAddMode();
  showAdminMainMenu();
}

function openEditMode(idx) {
  const item = catalogs.find(it => it._idx === idx);
  if (!item) return;
  currentAction = 'edit';
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
  openAdminSection('product');
  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-pen"></i> แก้ไขสินค้า';
}

function resetToAddMode() {
  currentAction = 'add';
  currentFileType = 'pdf';
  document.getElementById('inputTitle').value = '';
  document.getElementById('inputLink').value = '';
  document.getElementById('editOldTitle').value = '';
  document.getElementById('resetBtn').classList.add('hidden');
  setActiveTypePill('pdf');
  document.getElementById('autoDetectChip').classList.add('hidden');
  document.getElementById('linkPreview').classList.add('hidden');
  // ถ้ากำลังอยู่ในหน้าจัดการสินค้าอยู่แล้ว (เช่น กด "ยกเลิกแก้ไข") ให้อัปเดตหัวข้อกลับเป็นโหมดเพิ่มใหม่ด้วย
  const productSection = document.getElementById('adminSection-product');
  if (productSection && !productSection.classList.contains('hidden')) {
    document.getElementById('modalTitle').innerHTML = '<i class="fas fa-box"></i> จัดการสินค้า';
  }
}

// ============================================================
// สไลด์หน้าแรก (Hero Slider) — หมุนอัตโนมัติ กดรูปแล้วเปิดโบรชัวร์ที่ผูกไว้
// ทั้งรูปสไลด์และลิงก์ที่จะเปิดเป็นลิงก์ Google Drive ล้วนๆ ที่ admin วางเอง ไม่มีการอัปโหลดไฟล์
// ============================================================
let heroCurrentSlide = 0;
let heroCarouselInstance = null; // instance ของ Bootstrap Carousel — สร้างใหม่ทุกครั้งที่ renderHeroSlider()
let heroCarouselEventsBound = false; // event listener ของ #heroCarousel ผูกแค่ครั้งเดียว (element ตัวนี้ไม่ถูกสร้างใหม่ ถูก re-render แค่ลูกข้างใน)

/** ดึงรูปสไลด์จาก Sheet แท็บ "slides" — ถ้ายังไม่ได้ตั้งค่า gid (REPLACE_WITH_SLIDES_GID) หรือดึงไม่สำเร็จ
 * ให้ซ่อนสไลด์ไว้เงียบๆ ไม่ error ผู้ใช้ทั่วไปจะไม่เห็นสไลด์เลยจนกว่า admin จะตั้งค่า Sheet เสร็จ */
function loadSlides() {
  if (!SLIDES_CSV_URL || SLIDES_CSV_URL.indexOf('REPLACE_WITH_SLIDES_GID') !== -1) return;
  const cacheBuster = `&t=${new Date().getTime()}`;
  Papa.parse(SLIDES_CSV_URL + cacheBuster, {
    download: true, header: true, skipEmptyLines: true,
    complete: (res) => {
      const fresh = res.data
        .filter(row => row.imageUrl) // ลิงก์ไฟล์ที่จะเปิด (linkUrl) ไม่บังคับ — ถ้าไม่ใส่ กดแล้วจะขยายดูรูปเฉยๆ แทนการเปิดโบรชัวร์
        .map(row => ({ imageUrl: row.imageUrl.trim(), linkUrl: (row.linkUrl || '').trim() }));
      slides = fresh;
      try { localStorage.setItem(CACHE_KEY_SLIDES, JSON.stringify(slides)); } catch (e) { /* เต็ม/ปิดใช้งาน ไม่เป็นไร */ }
      renderHeroSlider();
      renderAdminSlideList();
    },
    error: () => { /* ยังไม่ตั้งค่า Sheet หรือเน็ตมีปัญหา — ปล่อยให้ใช้ค่าจากแคช (ถ้ามี) เงียบๆ */ },
  });
}

/** แปลงลิงก์ Google Drive ให้เป็น URL รูปที่แสดงตรงๆ ได้
 * หมายเหตุสำคัญ: เดิมใช้ https://drive.google.com/thumbnail?id=...&sz=... ซึ่งจริงๆ แล้วเป็นแค่ตัว "redirect" (HTTP 302)
 * ไปยัง URL รูปจริงที่โฮสต์อยู่บน lh3.googleusercontent.com อีกที — ปัญหาที่เจอคือสไลด์ 2-3 ที่โหลดพร้อมกันหลายรูป
 * (ไม่มี loading="lazy" คอยหน่วงให้) บางทีตัว redirect นี้ไม่ถูกตามไปจนสำเร็จ ทำให้รูปไม่ขึ้น (ทั้งที่ถ้าเปิด URL
 * ปลายทางตรงๆ ก็เห็นรูปปกติดี) จึงเปลี่ยนมาสร้างลิงก์ไปที่ lh3.googleusercontent.com ตรงๆ เลย ตัดขั้นตอน redirect ทิ้งไป
 * ทำให้โหลดได้เสถียรกว่าเดิมไม่ว่าจะโหลดพร้อมกันกี่รูปก็ตาม */
function driveImageUrl(link, size) {
  const fileId = (link || '').match(/[-\w]{25,}/);
  return fileId ? `https://lh3.googleusercontent.com/d/${fileId[0]}=${size || 'w1000'}` : localPlaceholder('C2TECH');
}

/** สไลด์หน้าแรก — ใช้ Bootstrap Carousel (bootstrap.bundle.min.js) เป็นตัวคุมกลไกเลื่อน/หมุนอัตโนมัติ/ปัดนิ้ว
 * ทั้งหมด (ไลบรารีสำเร็จรูปที่ผ่านการทดสอบมาดีแล้ว) แทนโค้ด carousel ที่เขียนเอง — ยังคงใช้วิธีโหลดรูปทีละรูป
 * แบบหน่วงเวลา + ลองใหม่อัตโนมัติ (loadHeroImage) เหมือนเดิม เผื่อกรณี Google จำกัดคำขอรูปพร้อมกันชั่วคราว */
function renderHeroSlider() {
  const wrap = document.getElementById('heroSlider');
  const track = document.getElementById('heroTrack');
  const dots = document.getElementById('heroDots');
  const carouselEl = document.getElementById('heroCarousel');
  if (!wrap || !track || !dots || !carouselEl) return;

  if (heroCarouselInstance) { heroCarouselInstance.dispose(); heroCarouselInstance = null; }

  if (!slides.length) {
    wrap.classList.add('hidden');
    track.innerHTML = ''; dots.innerHTML = '';
    return;
  }

  wrap.classList.remove('hidden');
  heroCurrentSlide = Math.min(heroCurrentSlide, slides.length - 1);

  // หมายเหตุสำคัญ: ห้ามใส่ loading="lazy" ให้รูปสไลด์พวกนี้ — สไลด์ที่ 2 เป็นต้นไปถูกจัดวางไว้นอกขอบเขตที่มองเห็นจริง
  // ของเบราว์เซอร์ตั้งแต่แรก ทำให้ตัวตรวจจับ lazy-load ของเบราว์เซอร์คิดว่ารูปยัง "อยู่ไกลจากจอ" และไม่ยอมโหลดให้
  //
  // อีกจุดที่พบว่าเป็นสาเหตุจริงของ "สไลด์ 2-3 ไม่ขึ้น": ถ้าตั้ง src ให้ทุกรูปพร้อมกันทีเดียวตอน render เบราว์เซอร์
  // จะยิง request ไปโหลดรูปจาก Google หลายรูปพร้อมกันในจังหวะเดียว (burst) ซึ่ง Google มักจะจำกัด/ปฏิเสธคำขอรูป
  // พร้อมกันจำนวนมากจาก client เดียวกันแบบนี้ (rate-limit ชั่วคราว) จึงเปลี่ยนมาใส่ URL ไว้ใน data-src ก่อน แล้วค่อย
  // ตั้ง src จริงให้ทีละรูปแบบหน่วงเวลาห่างกันเล็กน้อย พร้อมลองใหม่อัตโนมัติถ้าโหลดไม่สำเร็จในครั้งแรก
  track.innerHTML = slides.map((s, i) => {
    const hintText = s.linkUrl ? 'แตะเพื่อดูรายละเอียด' : 'แตะเพื่อดูภาพขยาย';
    return `
    <div class="carousel-item ${i === heroCurrentSlide ? 'active' : ''}" onclick="openBrochure(${i})">
      <img data-src="${escapeAttr(driveImageUrl(s.imageUrl))}" alt="สไลด์ ${i + 1}">
      <span class="hero-hint"><i class="fas fa-hand-pointer"></i> ${hintText}</span>
    </div>`;
  }).join('');

  Array.from(track.querySelectorAll('img[data-src]')).forEach((img, i) => {
    setTimeout(() => loadHeroImage(img), i * 350);
  });

  // ปุ่มจุดบอกตำแหน่ง — ผูกกับ Bootstrap ผ่าน data-bs-target/data-bs-slide-to (ไม่ต้องอยู่ใน #heroCarousel ก็ได้
  // เพราะ Bootstrap ดักฟัง click แบบ delegate จากทั้งเอกสาร แล้วค่อยหา carousel เป้าหมายจาก data-bs-target)
  dots.innerHTML = slides.map((_, i) => `
    <button type="button" class="hero-dot ${i === heroCurrentSlide ? 'active' : ''}"
            data-bs-target="#heroCarousel" data-bs-slide-to="${i}"
            aria-label="สไลด์ที่ ${i + 1}" onclick="event.stopPropagation()"></button>`).join('');

  const progressWrap = document.getElementById('heroProgressFill');
  if (progressWrap) progressWrap.parentElement.classList.toggle('hidden', slides.length <= 1);

  heroCarouselInstance = new bootstrap.Carousel(carouselEl, {
    interval: slides.length > 1 ? 4500 : false,
    ride: slides.length > 1 ? 'carousel' : false,
    touch: true,
    wrap: true,
  });

  // ผูก event แค่ครั้งเดียวตลอดอายุเพจ เพราะ #heroCarousel ไม่ได้ถูกสร้าง element ใหม่ทุกครั้งที่ renderHeroSlider()
  // (แค่ dispose+สร้าง instance ใหม่ทับ) ผูกซ้ำทุกรอบจะกลายเป็น listener ซ้อนกันเรื่อยๆ
  if (!heroCarouselEventsBound) {
    heroCarouselEventsBound = true;
    carouselEl.addEventListener('slide.bs.carousel', () => playHeroProgress());
    carouselEl.addEventListener('slid.bs.carousel', (e) => {
      heroCurrentSlide = e.to;
      document.querySelectorAll('#heroDots .hero-dot').forEach((d, i) => d.classList.toggle('active', i === e.to));
    });
  }
  if (slides.length > 1) playHeroProgress(); else resetHeroProgress();
}

/** โหลดรูปสไลด์ทีละรูป — ถ้าโหลดไม่สำเร็จ (มักเกิดจาก Google จำกัดคำขอรูปพร้อมกันชั่วคราว) จะลองใหม่อัตโนมัติ
 * อีก 2 ครั้งก่อนค่อย fallback ไปใช้รูป placeholder จริงๆ */
function loadHeroImage(img, attempt) {
  attempt = attempt || 1;
  const url = img.dataset.src;
  if (!url) return;
  img.onerror = () => {
    if (attempt < 3) {
      setTimeout(() => loadHeroImage(img, attempt + 1), 700 * attempt);
    } else {
      img.onerror = null;
      img.src = localPlaceholder('C2TECH');
    }
  };
  img.src = url;
}

/** แถบนับเวลาสไลด์อัตโนมัติ — วิ่งเต็มความกว้างใน 1 รอบ (4.5 วิ) แล้วรีเซ็ตใหม่ทุกครั้งที่ Bootstrap เปลี่ยนสไลด์ */
function resetHeroProgress() {
  const fill = document.getElementById('heroProgressFill');
  if (!fill) return;
  // ห้ามตั้ง fill.style.width ตรงๆ ด้วย JS — inline style จะชนะ class .animate ใน CSS เสมอ
  // (specificity ของ inline style สูงกว่า) ทำให้แถบไม่วิ่งเลยแม้ใส่ class animate แล้ว
  fill.classList.remove('animate');
  void fill.offsetWidth; // บังคับ reflow ให้ transition รันใหม่ได้ทุกครั้ง (ไม่งั้น browser จะมองว่าไม่มีอะไรเปลี่ยน)
}
function playHeroProgress() {
  resetHeroProgress();
  const fill = document.getElementById('heroProgressFill');
  if (!fill) return;
  requestAnimationFrame(() => { fill.classList.add('animate'); });
}

/** เรียกตอนเปิด overlay อื่น (โบรชัวร์/พรีวิวรูป) ทับหน้าสไลด์ — สั่งหยุดหมุนอัตโนมัติชั่วคราว */
function stopHeroAutoplay() {
  if (heroCarouselInstance) heroCarouselInstance.pause();
  resetHeroProgress();
}
/** เรียกตอนปิด overlay แล้ว — สั่งให้สไลด์หมุนอัตโนมัติต่อ (ถ้ามีมากกว่า 1 สไลด์) */
function restartHeroAutoplay() {
  if (heroCarouselInstance && slides.length > 1) heroCarouselInstance.cycle();
}

/** กดที่สไลด์แล้วเปิดหน้าต่างโบรชัวร์ — แสดงรูปปกของสไลด์นั้น แล้วมีปุ่มลิงก์ไปเปิดไฟล์ที่ผูกไว้ */
function openBrochure(i) {
  const slide = slides[i];
  if (!slide) return;
  // สไลด์ที่ไม่ได้ผูกลิงก์ไฟล์ไว้ (แค่ใส่รูปโชว์เฉยๆ) — กดแล้วขยายดูรูปแบบเต็มจอแทน ไม่ต้องเปิดหน้าต่างโบรชัวร์
  if (!slide.linkUrl) {
    stopHeroAutoplay();
    previewImage(driveImageUrl(slide.imageUrl));
    return;
  }
  document.getElementById('brochureCoverImg').innerHTML =
    `<img src="${escapeAttr(driveImageUrl(slide.imageUrl))}" alt="" onerror="this.src='${localPlaceholder('C2TECH')}'">`;
  document.getElementById('brochureTitle').textContent = 'เปิดโบรชัวร์';
  document.getElementById('brochureOpenBtn').href = slide.linkUrl;
  document.getElementById('brochureOverlay').classList.remove('hidden');
  stopHeroAutoplay();
}

function closeBrochureOverlay() {
  document.getElementById('brochureOverlay').classList.add('hidden');
  restartHeroAutoplay();
}

// --- Admin: จัดการสไลด์หน้าแรก ---
// ลากที่ไอคอน ☰ ด้านหน้าเพื่อจัดลำดับใหม่ได้ (แบบเดียวกับหมวดหมู่) — ลากจัดได้อิสระหลายรอบก่อน ไม่บันทึกทันทีทีละครั้ง
// ต้องกดปุ่ม "บันทึกลำดับสไลด์" เองตอนจัดเสร็จแล้ว (ลำดับนี้เป็นลำดับเดียวกับที่ใช้แสดงในสไลด์หน้าแรก)
let slideOrderDirty = false; // true = ลากจัดลำดับไว้แล้วแต่ยังไม่ได้กดบันทึก

function renderAdminSlideList() {
  const list = document.getElementById('slideAdminList');
  if (!list) return;
  slideOrderDirty = false;
  const saveOrderBtn = document.getElementById('slideSaveOrderBtn');
  if (saveOrderBtn) saveOrderBtn.classList.add('hidden');
  if (!slides.length) {
    list.innerHTML = `<div class="slide-admin-empty">ยังไม่มีสไลด์ — เพิ่มสไลด์แรกด้านล่างนี้ได้เลย</div>`;
    return;
  }
  // เก็บ imageUrl เต็มไว้ใน data-img (ใช้เป็นตัวอ้างอิงตอนอ่านลำดับจาก DOM ตอนกดบันทึก) — ใช้ index ตอน render
  // ตอนลบเท่านั้น (handleDeleteSlide อ้างจาก array ปัจจุบัน ไม่ผูกกับ index ที่ตายตัวในตัว DOM)
  list.innerHTML = slides.map((s, i) => `
    <div class="slide-admin-row" data-img="${escapeAttr(s.imageUrl)}">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ"><i class="fas fa-grip-lines"></i></span>
      <div class="slide-admin-thumb"><img src="${escapeAttr(driveImageUrl(s.imageUrl, 'w200'))}" alt="" onerror="this.src='${localPlaceholder('C2TECH')}'"></div>
      <div class="slide-admin-text">
        <div><i class="fas fa-image"></i> ${escapeHtml(truncateMiddle(s.imageUrl))}</div>
        <div>${s.linkUrl ? `<i class="fas fa-link"></i> ${escapeHtml(truncateMiddle(s.linkUrl))}` : `<i class="fas fa-image-slash"></i> แสดงภาพอย่างเดียว (ไม่มีลิงก์)`}</div>
      </div>
      <div class="slide-admin-actions">
        <button class="icon-sq-btn danger" onclick="handleDeleteSlide(${i})" title="ลบสไลด์นี้"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
  initSlideDragDelegation();
}

// --- ลากจัดลำดับสไลด์ (Pointer Events — เทคนิคเดียวกับที่ใช้กับหมวดหมู่: closest-row-by-midpoint + FLIP animation) ---
let slideDragState = null;

function initSlideDragDelegation() {
  const list = document.getElementById('slideAdminList');
  if (!list || list.dataset.dragBound) return;
  list.dataset.dragBound = '1';

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const row = handle.closest('.slide-admin-row');
    if (!row) return;
    e.preventDefault();
    row.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ไม่เป็นไร */ }
    slideDragState = { row, pointerId: e.pointerId, listEl: list };
  });

  list.addEventListener('pointermove', (e) => {
    if (!slideDragState || slideDragState.pointerId !== e.pointerId) return;
    const { row, listEl } = slideDragState;
    const y = e.clientY;
    const others = Array.from(listEl.querySelectorAll('.slide-admin-row')).filter(r => r !== row);
    if (!others.length) return;

    let closest = null, closestDist = Infinity;
    others.forEach((other) => {
      const rect = other.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(y - mid);
      if (dist < closestDist) { closestDist = dist; closest = { el: other, mid }; }
    });
    if (!closest) return;

    const target = y < closest.mid ? closest.el : closest.el.nextSibling;
    if (target === row) return;
    if (target === null) {
      if (listEl.lastElementChild === row) return;
    } else if (target.previousElementSibling === row) {
      return;
    }

    const firstRects = new Map(Array.from(listEl.querySelectorAll('.slide-admin-row')).map(r => [r, r.getBoundingClientRect()]));
    listEl.insertBefore(row, target);
    Array.from(listEl.querySelectorAll('.slide-admin-row')).forEach((r) => {
      if (r === row) return;
      const first = firstRects.get(r);
      const last = r.getBoundingClientRect();
      const dy = first.top - last.top;
      if (!dy) return;
      r.style.transition = 'none';
      r.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        r.style.transition = 'transform .18s ease';
        r.style.transform = '';
      });
    });
  });

  const endSlideDrag = (e) => {
    if (!slideDragState || slideDragState.pointerId !== e.pointerId) return;
    const { row } = slideDragState;
    row.classList.remove('dragging');
    slideDragState = null;
    slideOrderDirty = true;
    const saveOrderBtn = document.getElementById('slideSaveOrderBtn');
    if (saveOrderBtn) saveOrderBtn.classList.remove('hidden');
  };
  list.addEventListener('pointerup', endSlideDrag);
  list.addEventListener('pointercancel', endSlideDrag);
}

/** กดปุ่ม "บันทึกลำดับสไลด์" — อ่านลำดับปัจจุบันจาก DOM (ตามที่ลากจัดไว้) แล้วค่อยส่งไปบันทึกที่เซิร์ฟเวอร์ทีเดียว */
async function handleSaveSlideOrder() {
  const list = document.getElementById('slideAdminList');
  if (!list) return;
  const order = Array.from(list.querySelectorAll('.slide-admin-row')).map(r => r.dataset.img);
  await handleReorderSlide(order);
}

/** บันทึกลำดับสไลด์ใหม่ไปที่เซิร์ฟเวอร์ (อ้างอิงด้วย imageUrl) — ถ้าไม่สำเร็จ (เช่นมีคนแก้สไลด์จากที่อื่นพร้อมกัน)
 * จะรีเฟรชข้อมูลจริงจากเซิร์ฟเวอร์แล้ววาดใหม่ให้ตรงกัน */
async function handleReorderSlide(order) {
  const ok = await sendToCloud(
    { action: 'reorderSlide', order },
    { closeModalOnSuccess: false, onSuccess: loadSlides }
  );
  if (ok) {
    slideOrderDirty = false;
    const saveOrderBtn = document.getElementById('slideSaveOrderBtn');
    if (saveOrderBtn) saveOrderBtn.classList.add('hidden');
  } else {
    setTimeout(loadSlides, 950);
  }
}

function truncateMiddle(str, max) {
  max = max || 42;
  str = str || '';
  if (str.length <= max) return str;
  const half = Math.floor((max - 3) / 2);
  return str.slice(0, half) + '...' + str.slice(str.length - half);
}

async function handleAddSlide() {
  const imageUrl = document.getElementById('newSlideImgInput').value.trim();
  // ลิงก์ไฟล์ที่จะเปิด (linkUrl) ไม่บังคับ — เว้นว่างไว้ได้ถ้าต้องการแค่โชว์ภาพเฉยๆ ไม่ต้องมีไฟล์ให้กดเปิด
  const linkUrl = document.getElementById('newSlideLinkInput').value.trim();
  if (!imageUrl) return Swal.fire({ title: 'กรุณาวางลิงก์รูปภาพ', icon: 'warning' });

  const ok = await sendToCloud(
    { action: 'addSlide', imageUrl, linkUrl },
    { closeModalOnSuccess: false, onSuccess: loadSlides }
  );
  if (ok) {
    document.getElementById('newSlideImgInput').value = '';
    document.getElementById('newSlideLinkInput').value = '';
  }
}

async function handleDeleteSlide(i) {
  const slide = slides[i];
  if (!slide) return;
  const res = await Swal.fire({ title: 'ลบสไลด์นี้?', icon: 'warning', showCancelButton: true });
  if (!res.isConfirmed) return;
  await sendToCloud(
    { action: 'deleteSlide', imageUrl: slide.imageUrl },
    { closeModalOnSuccess: false, onSuccess: loadSlides }
  );
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

// ============================================================
// ปุ่มติดต่อด่วนลอย (FAB) — โทรหา นพดล/กานต์/เจษฎา ได้ทันที
// ชื่อ/ตำแหน่ง/เบอร์ แก้ไขได้จากหน้าแอดมิน (เก็บไว้ที่ backend ผ่าน action getContacts/updateContacts)
// ============================================================
function loadContacts() {
  fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getContacts' }) })
    .then(res => res.json())
    .then(result => {
      if (result.success && Array.isArray(result.contacts) && result.contacts.length) {
        contacts = result.contacts;
        try { localStorage.setItem(CACHE_KEY_CONTACTS, JSON.stringify(contacts)); } catch (e) { /* ไม่เป็นไร */ }
        renderContactFab();
        renderAdminContactForm();
      }
    })
    .catch(() => { /* เน็ตมีปัญหา — ใช้ค่าจากแคช/ค่าเริ่มต้นที่มีอยู่แล้วเงียบๆ */ });
}

// ============================================================
// ช่องทางออนไลน์ของบริษัท (LINE OA / Facebook) — action getChannels/updateChannels
// แสดงเป็นปุ่มบนสุดของแผ่นติดต่อด่วน แยกจากรายชื่อพนักงาน แสดงเฉพาะช่องที่เปิดใช้งานและมีลิงก์
// ============================================================
function loadChannels() {
  fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getChannels' }) })
    .then(res => res.json())
    .then(result => {
      if (result.success && result.channels) {
        channels = Object.assign({}, channels, result.channels);
        try { localStorage.setItem(CACHE_KEY_CHANNELS, JSON.stringify(channels)); } catch (e) { /* ไม่เป็นไร */ }
        renderContactFab();
      }
    })
    .catch(() => { /* เน็ตมีปัญหา — ใช้ค่าจากแคช/ค่าเริ่มต้นที่มีอยู่แล้วเงียบๆ */ });
}

const CHANNEL_META = {
  line: { icon: 'fab fa-line', cls: 'channel-btn-line' },
  facebook: { icon: 'fab fa-facebook-f', cls: 'channel-btn-fb' },
};

/** กันช่องลิงก์ถูกใช้แทรก javascript:/data: URI (ตอนนี้แก้ได้แค่จากแอดมินเท่านั้น แต่กันไว้เผื่ออนาคต) */
function isSafeHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function buildChannelButtonsHtml() {
  const active = ['line', 'facebook'].filter((key) => channels[key] && channels[key].enabled && channels[key].url && isSafeHttpUrl(channels[key].url));
  if (!active.length) return '';
  const buttons = active.map((key) => {
    const c = channels[key];
    const meta = CHANNEL_META[key];
    return `
      <a class="channel-btn ${meta.cls}" href="${escapeAttr(c.url)}" target="_blank" rel="noopener noreferrer">
        <span class="channel-btn-icon"><i class="${meta.icon}"></i></span>
        <span class="channel-btn-label">${escapeHtml(c.label || '')}</span>
        <i class="fas fa-chevron-right channel-btn-arrow"></i>
      </a>`;
  }).join('');
  return `<div class="channel-btns">${buttons}</div>`;
}

function renderContactFab() {
  const list = document.getElementById('contactSheetList');
  if (!list) return;
  const hasChannels = ['line', 'facebook'].some((key) => channels[key] && channels[key].enabled && channels[key].url);
  const hasContacts = contacts.some(c => c.name || c.phone);
  const fab = document.getElementById('contactFab');
  if (fab) fab.classList.toggle('hidden', !hasChannels && !hasContacts);

  const channelHtml = buildChannelButtonsHtml();
  const contactRows = contacts.map(c => {
    if (!c.name && !c.phone) return '';
    const initial = escapeHtml((c.name || '?').trim().slice(0, 1));
    return `
      <div class="contact-row">
        <div class="contact-avatar">${initial}</div>
        <div class="contact-meta">
          <div class="contact-name">${escapeHtml(c.name || '')}</div>
          <div class="contact-role">${escapeHtml(c.role || '')}</div>
        </div>
        <div class="contact-actions">
          ${c.phone ? `<a class="contact-call-btn" href="tel:${escapeAttr(c.phone)}"><i class="fas fa-phone"></i> ${escapeHtml(c.phone)}</a>` : `<span class="contact-no-phone">ยังไม่ระบุเบอร์</span>`}
        </div>
      </div>`;
  }).join('');

  const divider = (channelHtml && hasContacts) ? `<div class="channel-divider">ทีมงาน</div>` : '';
  list.innerHTML = channelHtml + divider + contactRows;
}

function toggleContactSheet() {
  const sheet = document.getElementById('contactSheet');
  if (!sheet) return;
  sheet.classList.toggle('hidden');
}

function closeContactSheet() {
  const sheet = document.getElementById('contactSheet');
  if (sheet) sheet.classList.add('hidden');
}

// --- Admin: แก้ไขชื่อ/ตำแหน่ง/เบอร์ผู้ติดต่อด่วน ---
// เดิมล็อกไว้แค่ 3 คนตายตัว (นพดล/กานต์/เจษฎา) แก้ได้แค่ชื่อ/ตำแหน่ง/เบอร์ — ตอนนี้เพิ่ม/ลบ/ลากจัดลำดับได้อิสระแล้ว
// ทุกอย่าง (พิมพ์แก้ค่า/เพิ่ม/ลบ/ลากสลับที่) ทำกับ DOM ตรงๆ ก่อน ยังไม่กระทบข้อมูลจริงจนกว่าจะกด "บันทึกผู้ติดต่อ"
// (ตอนบันทึกจะอ่านค่าจากแถวที่เห็นบนจอ ณ ขณะนั้นเลย ไม่ต้องเก็บ array คู่ขนานแยกให้เสี่ยงข้อมูลไม่ตรงกันตอนลากสลับที่)
function renderAdminContactForm() {
  const wrap = document.getElementById('contactAdminForm');
  if (!wrap) return;
  if (!contacts.length) {
    wrap.innerHTML = `<div class="slide-admin-empty">ยังไม่มีผู้ติดต่อ — กด "เพิ่มผู้ติดต่อ" ด้านล่างนี้ได้เลย</div>`;
  } else {
    wrap.innerHTML = contacts.map(c => buildContactRowHtml(c)).join('');
  }
  initContactDragDelegation();
}

/** ความยาวสูงสุดของแต่ละช่อง กันพิมพ์ยาวเกินจนล้นการ์ดผู้ติดต่อหน้าแรก */
const CONTACT_NAME_MAXLEN = 40;
const CONTACT_ROLE_MAXLEN = 30;
const CONTACT_PHONE_MAXLEN = 20;

function buildContactRowHtml(c) {
  c = c || { name: '', role: '', phone: '' };
  return `
    <div class="contact-admin-row">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ"><i class="fas fa-grip-lines"></i></span>
      <input type="text" placeholder="ชื่อ" value="${escapeAttr(c.name || '')}" maxlength="${CONTACT_NAME_MAXLEN}">
      <input type="text" placeholder="ตำแหน่ง" value="${escapeAttr(c.role || '')}" maxlength="${CONTACT_ROLE_MAXLEN}">
      <input type="tel" placeholder="เบอร์โทร" value="${escapeAttr(c.phone || '')}" maxlength="${CONTACT_PHONE_MAXLEN}">
      <button onclick="handleRemoveContactRow(this)" title="ลบผู้ติดต่อนี้"><i class="fas fa-trash"></i></button>
    </div>`;
}

function handleAddContactRow() {
  const wrap = document.getElementById('contactAdminForm');
  if (!wrap) return;
  if (!wrap.querySelector('.contact-admin-row')) wrap.innerHTML = ''; // ล้างข้อความ "ยังไม่มีผู้ติดต่อ" ถ้ามีอยู่
  wrap.insertAdjacentHTML('beforeend', buildContactRowHtml(null));
  initContactDragDelegation(); // เผื่อ wrap ถูกเคลียร์ innerHTML ทั้งหมดไปตอน "ยังไม่มีผู้ติดต่อ" (dataset ของ wrap ยังอยู่ ฟังก์ชันนี้ no-op ซ้ำได้)
}

async function handleRemoveContactRow(btn) {
  const row = btn.closest('.contact-admin-row');
  if (!row) return;
  const inputs = row.querySelectorAll('input');
  const name = (inputs[0].value || '').trim();
  const phone = (inputs[2].value || '').trim();
  // ถ้าแถวนี้กรอกข้อมูลไว้แล้ว (ไม่ใช่แถวว่างที่เพิ่งกดเพิ่ม) ถามยืนยันก่อน กันลบโดยไม่ตั้งใจ
  if (name || phone) {
    const res = await Swal.fire({ title: `ลบผู้ติดต่อ "${name || phone}"?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก' });
    if (!res.isConfirmed) return;
  }
  row.remove();
  const wrap = document.getElementById('contactAdminForm');
  if (wrap && !wrap.querySelector('.contact-admin-row')) {
    wrap.innerHTML = `<div class="slide-admin-empty">ยังไม่มีผู้ติดต่อ — กด "เพิ่มผู้ติดต่อ" ด้านล่างนี้ได้เลย</div>`;
  }
}

// --- ลากจัดลำดับผู้ติดต่อ (เทคนิคเดียวกับลากจัดลำดับหมวดหมู่ — Pointer Events ใช้ได้ทั้งเมาส์และนิ้วสัมผัส) ---
let contactDragState = null;

function initContactDragDelegation() {
  const list = document.getElementById('contactAdminForm');
  if (!list || list.dataset.dragBound) return;
  list.dataset.dragBound = '1';

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const row = handle.closest('.contact-admin-row');
    if (!row) return;
    e.preventDefault();
    row.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ไม่เป็นไร */ }
    contactDragState = { row, pointerId: e.pointerId, listEl: list };
  });

  list.addEventListener('pointermove', (e) => {
    if (!contactDragState || contactDragState.pointerId !== e.pointerId) return;
    const { row, listEl } = contactDragState;
    const y = e.clientY;
    const others = Array.from(listEl.querySelectorAll('.contact-admin-row')).filter(r => r !== row);
    if (!others.length) return;

    let closest = null, closestDist = Infinity;
    others.forEach((other) => {
      const rect = other.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(y - mid);
      if (dist < closestDist) { closestDist = dist; closest = { el: other, mid }; }
    });
    if (!closest) return;

    const target = y < closest.mid ? closest.el : closest.el.nextSibling;
    if (target === row) return;
    if (target === null) {
      if (listEl.lastElementChild === row) return;
    } else if (target.previousElementSibling === row) {
      return;
    }

    // FLIP: เลื่อนแถวอื่นที่โดนสลับที่แบบนุ่มนวล ส่วนแถวที่กำลังลากอยู่ขยับตามนิ้ว/เมาส์ตรงๆ ทันที
    const firstRects = new Map(Array.from(listEl.querySelectorAll('.contact-admin-row')).map(r => [r, r.getBoundingClientRect()]));
    listEl.insertBefore(row, target);
    Array.from(listEl.querySelectorAll('.contact-admin-row')).forEach((r) => {
      if (r === row) return;
      const first = firstRects.get(r);
      const last = r.getBoundingClientRect();
      const dy = first.top - last.top;
      if (!dy) return;
      r.style.transition = 'none';
      r.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        r.style.transition = 'transform .18s ease';
        r.style.transform = '';
      });
    });
  });

  const endContactDrag = (e) => {
    if (!contactDragState || contactDragState.pointerId !== e.pointerId) return;
    contactDragState.row.classList.remove('dragging');
    contactDragState = null;
    // ไม่ต้องบันทึกทันที — ลำดับใหม่จะถูกอ่านจากหน้าจอตอนกด "บันทึกผู้ติดต่อ" เหมือนค่าฟิลด์อื่นๆ ที่พิมพ์แก้ไว้
  };
  list.addEventListener('pointerup', endContactDrag);
  list.addEventListener('pointercancel', endContactDrag);
}

async function handleSaveContacts() {
  const wrap = document.getElementById('contactAdminForm');
  const rows = wrap ? Array.from(wrap.querySelectorAll('.contact-admin-row')) : [];
  const cleaned = rows.map((row) => {
    const inputs = row.querySelectorAll('input');
    return {
      name: (inputs[0].value || '').trim(),
      role: (inputs[1].value || '').trim(),
      phone: (inputs[2].value || '').trim(),
    };
  }).filter(c => c.name || c.phone); // ตัดแถวว่างเปล่าทิ้งก่อนบันทึก (เผื่อกด "เพิ่ม" แล้วไม่ได้กรอกอะไร)
  const ok = await sendToCloud(
    { action: 'updateContacts', contacts: cleaned },
    { closeModalOnSuccess: false, onSuccess: () => { contacts = cleaned; try { localStorage.setItem(CACHE_KEY_CONTACTS, JSON.stringify(contacts)); } catch (e) {} renderContactFab(); } }
  );
  if (ok) { contacts = cleaned; renderContactFab(); renderAdminContactForm(); }
}

// ============================================================
// หน้าแอดมิน "ช่องทางออนไลน์" — ตั้งค่าปุ่ม LINE OA / Facebook ที่โชว์ในแผ่นติดต่อด่วนของลูกค้า
// เก็บที่ backend แยกจากผู้ติดต่อรายคน (action getChannels/updateChannels) เพราะเป็นช่องทางของบริษัท
// ============================================================
const CHANNEL_FORM_META = [
  { key: 'line', label: 'LINE OA', icon: 'fab fa-line', cls: 'channel-admin-line', placeholder: 'https://lin.ee/xxxxxxx หรือ https://line.me/ti/p/~xxxx' },
  { key: 'facebook', label: 'Facebook', icon: 'fab fa-facebook-f', cls: 'channel-admin-fb', placeholder: 'https://facebook.com/... หรือ https://m.me/...' },
];

function renderAdminChannelForm() {
  const wrap = document.getElementById('channelAdminForm');
  if (!wrap) return;
  wrap.innerHTML = CHANNEL_FORM_META.map((meta) => {
    const c = channels[meta.key] || { enabled: false, label: '', url: '' };
    return `
      <div class="channel-admin-block ${meta.cls}" data-channel="${meta.key}">
        <div class="channel-admin-head">
          <span class="channel-admin-title"><i class="${meta.icon}"></i> ${meta.label}</span>
          <label class="channel-toggle">
            <input type="checkbox" class="channel-enabled-input" ${c.enabled ? 'checked' : ''}>
            <span class="channel-toggle-track"></span>
          </label>
        </div>
        <input type="text" class="channel-label-input" placeholder="ข้อความบนปุ่ม" value="${escapeAttr(c.label || '')}" maxlength="40">
        <input type="text" class="channel-url-input" placeholder="${escapeAttr(meta.placeholder)}" value="${escapeAttr(c.url || '')}" maxlength="300">
      </div>`;
  }).join('') + `<div class="channel-admin-hint"><i class="fas fa-circle-info"></i> ปิดสวิตช์ หรือเว้นลิงก์ว่างไว้ = ปุ่มนั้นจะไม่แสดงให้ลูกค้าเห็น</div>`;
}

async function handleSaveChannels() {
  const wrap = document.getElementById('channelAdminForm');
  const blocks = wrap ? Array.from(wrap.querySelectorAll('.channel-admin-block')) : [];
  const cleaned = {};
  blocks.forEach((block) => {
    const key = block.dataset.channel;
    cleaned[key] = {
      enabled: !!block.querySelector('.channel-enabled-input').checked,
      label: (block.querySelector('.channel-label-input').value || '').trim(),
      url: (block.querySelector('.channel-url-input').value || '').trim(),
    };
  });
  const ok = await sendToCloud(
    { action: 'updateChannels', channels: cleaned },
    { closeModalOnSuccess: false, onSuccess: () => { channels = cleaned; try { localStorage.setItem(CACHE_KEY_CHANNELS, JSON.stringify(channels)); } catch (e) {} renderContactFab(); } }
  );
  if (ok) { channels = cleaned; renderContactFab(); renderAdminChannelForm(); }
}

// ============================================================
// หน้าสรุปสำหรับแอดมิน — จำนวนสินค้า/หมวดหมู่/ยอดแชร์ + สินค้ายอดนิยม 5 อันดับ
// (เปิดหน้านี้ผ่านเมนูหลักของ "จัดการระบบ" — ดู openAdminSection('stats'))
// ============================================================

async function loadStats() {
  const wrap = document.getElementById('statsContent');
  if (!wrap) return;
  wrap.innerHTML = `<div class="stats-loading">กำลังโหลดข้อมูลสรุป...</div>`;
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'getStats', token: adminToken }),
    });
    const result = await response.json();
    if (!result.success) {
      wrap.innerHTML = `<div class="stats-loading">โหลดข้อมูลสรุปไม่สำเร็จ: ${escapeHtml(result.message || '')}</div>`;
      return;
    }
    renderStats(result.stats);
  } catch (e) {
    wrap.innerHTML = `<div class="stats-loading">เกิดข้อผิดพลาดในการเชื่อมต่อ</div>`;
  }
}

function renderStats(stats) {
  const wrap = document.getElementById('statsContent');
  if (!wrap) return;
  const top = stats.topSharedProducts || [];
  const maxCount = top.reduce((m, t) => Math.max(m, t.count), 0) || 1;

  const tilesHtml = `
    <div class="stats-tiles">
      <div class="stats-tile"><div class="stats-tile-num">${stats.totalProducts}</div><div class="stats-tile-label">สินค้าทั้งหมด</div></div>
      <div class="stats-tile"><div class="stats-tile-num">${stats.totalCategories}</div><div class="stats-tile-label">หมวดหมู่</div></div>
      <div class="stats-tile"><div class="stats-tile-num">${stats.totalShares}</div><div class="stats-tile-label">ยอดแชร์รวม</div></div>
      <div class="stats-tile"><div class="stats-tile-num">${escapeHtml(stats.popularCategory || '-')}</div><div class="stats-tile-label">หมวดยอดนิยม</div></div>
    </div>`;

  const barsHtml = top.length ? `
    <div class="stats-bars">
      <div class="stats-bars-title">สินค้าที่ถูกแชร์มากที่สุด (Top 5)</div>
      ${top.map(t => `
        <div class="stats-bar-row">
          <div class="stats-bar-label" title="${escapeAttr(t.title)}">${escapeHtml(t.title)}</div>
          <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${Math.max(6, (t.count / maxCount) * 100)}%"></div></div>
          <div class="stats-bar-count">${t.count}</div>
        </div>`).join('')}
    </div>` : `<div class="stats-loading">ยังไม่มีข้อมูลการแชร์</div>`;

  wrap.innerHTML = tilesHtml + barsHtml;
}

// ============================================================
// ปุ่ม "เพิ่มลงหน้าจอหลัก" (Add to Home Screen)
// ============================================================
let deferredInstallPrompt = null;

function initInstallBanner() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(CACHE_KEY_INSTALL_DISMISSED) === '1'; } catch (e) {}

  // ถ้าเปิดแอปแบบติดตั้งแล้ว (standalone) ไม่ต้องโชว์แบนเนอร์เลย
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!dismissed) showInstallBanner(false);
  });

  window.addEventListener('appinstalled', () => {
    hideInstallBanner();
    try { localStorage.setItem(CACHE_KEY_INSTALL_DISMISSED, '1'); } catch (e) {}
  });

  // iOS Safari ไม่รองรับ beforeinstallprompt — ถ้าเป็น iOS Safari (ไม่ใช่แอปที่ติดตั้งแล้ว) โชว์คำแนะนำแทน
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (!dismissed && isIos && isSafari) {
    showInstallBanner(true);
  }
}

function showInstallBanner(isIosInstructions) {
  const banner = document.getElementById('installBanner');
  if (!banner) return;
  document.getElementById('installBannerText').textContent = isIosInstructions
    ? 'เพิ่ม Catalog Hub ลงหน้าจอหลัก: กดปุ่มแชร์ แล้วเลือก "เพิ่มลงในหน้าจอโฮม"'
    : 'ติดตั้ง Catalog Hub ไว้ที่หน้าจอหลัก เปิดใช้งานได้ไวขึ้นเหมือนแอปทั่วไป';
  document.getElementById('installBannerBtn').classList.toggle('hidden', isIosInstructions);
  banner.classList.remove('hidden');
}

function hideInstallBanner() {
  const banner = document.getElementById('installBanner');
  if (banner) banner.classList.add('hidden');
}

function dismissInstallBanner() {
  hideInstallBanner();
  try { localStorage.setItem(CACHE_KEY_INSTALL_DISMISSED, '1'); } catch (e) {}
}

async function handleInstallClick() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  hideInstallBanner();
  if (choice.outcome === 'accepted') {
    try { localStorage.setItem(CACHE_KEY_INSTALL_DISMISSED, '1'); } catch (e) {}
  }
}

// ============================================================
// โหมดสว่าง (Light mode) — สลับเฉพาะโทนสี "เนื้อหา" (พื้นหลัง/การ์ดสินค้า/แท็บ)
// ส่วน header/modal/overlay/แถบเลือกสินค้า ยังคงเป็นธีมเข้มของแบรนด์เหมือนเดิมทั้งสองโหมด
// ============================================================
function initTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem(CACHE_KEY_THEME) || 'dark'; } catch (e) {}
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeToggleIcon');
  if (icon) icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
  try { localStorage.setItem(CACHE_KEY_THEME, theme); } catch (e) {}
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
}

init();

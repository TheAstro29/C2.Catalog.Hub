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

let catalogs = [];
let categories = [];
let slides = []; // [{ imageUrl, linkUrl }]
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
  setupPullToRefresh();
  registerServiceWorker();
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
  const slideBody = document.getElementById('slideCollapseBody');
  const slideArrow = document.getElementById('slideCollapseArrow');
  if (slideBody) slideBody.classList.add('hidden');
  if (slideArrow) slideArrow.textContent = '▾';
}

// ============================================================
// สไลด์หน้าแรก (Hero Slider) — หมุนอัตโนมัติ กดรูปแล้วเปิดโบรชัวร์ที่ผูกไว้
// ทั้งรูปสไลด์และลิงก์ที่จะเปิดเป็นลิงก์ Google Drive ล้วนๆ ที่ admin วางเอง ไม่มีการอัปโหลดไฟล์
// ============================================================
let heroAutoplayTimer = null;
let heroCurrentSlide = 0;

/** ดึงรูปสไลด์จาก Sheet แท็บ "slides" — ถ้ายังไม่ได้ตั้งค่า gid (REPLACE_WITH_SLIDES_GID) หรือดึงไม่สำเร็จ
 * ให้ซ่อนสไลด์ไว้เงียบๆ ไม่ error ผู้ใช้ทั่วไปจะไม่เห็นสไลด์เลยจนกว่า admin จะตั้งค่า Sheet เสร็จ */
function loadSlides() {
  if (!SLIDES_CSV_URL || SLIDES_CSV_URL.indexOf('REPLACE_WITH_SLIDES_GID') !== -1) return;
  const cacheBuster = `&t=${new Date().getTime()}`;
  Papa.parse(SLIDES_CSV_URL + cacheBuster, {
    download: true, header: true, skipEmptyLines: true,
    complete: (res) => {
      const fresh = res.data
        .filter(row => row.imageUrl && row.linkUrl) // ปิดฟีเจอร์ "ใส่แค่รูปอย่างเดียว" ไว้ก่อนชั่วคราว — ต้องมีทั้งรูปและลิงก์ไฟล์
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

function renderHeroSlider() {
  const wrap = document.getElementById('heroSlider');
  const track = document.getElementById('heroTrack');
  const dots = document.getElementById('heroDots');
  if (!wrap || !track || !dots) return;

  stopHeroAutoplay();

  if (!slides.length) {
    wrap.classList.add('hidden');
    track.innerHTML = ''; dots.innerHTML = '';
    return;
  }

  wrap.classList.remove('hidden');
  heroCurrentSlide = Math.min(heroCurrentSlide, slides.length - 1);

  // หมายเหตุสำคัญ: ห้ามใส่ loading="lazy" ให้รูปสไลด์พวกนี้ — สไลด์ที่ 2 เป็นต้นไปถูกจัดวางไว้นอกขอบเขตที่มองเห็นจริง
  // ของเบราว์เซอร์ตั้งแต่แรก (ใช้ CSS transform เลื่อนเข้ามาโชว์ทีหลัง ไม่ใช่การสกอลหน้าจอจริง) ทำให้ตัวตรวจจับ
  // lazy-load ของเบราว์เซอร์คิดว่ารูปยัง "อยู่ไกลจากจอ" และไม่ยอมโหลดให้เลยตลอดไป
  //
  // อีกจุดหนึ่งที่พบว่าเป็นสาเหตุจริงของ "สไลด์ 2-3 ไม่ขึ้น": ถ้าตั้ง src ให้ทุกรูปพร้อมกันทีเดียวตอน render
  // เบราว์เซอร์จะยิง request ไปโหลดรูปจาก Google หลายรูปพร้อมกันในจังหวะเดียว (burst) ซึ่ง Google มักจะจำกัด/ปฏิเสธ
  // คำขอรูปพร้อมกันจำนวนมากจาก client เดียวกันแบบนี้ (rate-limit ชั่วคราว) ทำให้รูปแรกขึ้นแต่รูปถัดไปโหลดไม่สำเร็จ
  // จึงเปลี่ยนมาใส่ URL ไว้ใน data-src ก่อน แล้วค่อยตั้ง src จริงให้ทีละรูปแบบหน่วงเวลาห่างกันเล็กน้อย (ไม่พร้อมกัน)
  // พร้อมลองใหม่อัตโนมัติถ้าโหลดไม่สำเร็จในครั้งแรก ก่อนจะ fallback ไปใช้รูป placeholder จริงๆ
  track.innerHTML = slides.map((s, i) => `
    <div class="hero-slide" onclick="openBrochure(${i})">
      <img data-src="${escapeAttr(driveImageUrl(s.imageUrl))}" alt="สไลด์ ${i + 1}">
      <span class="hero-hint"><i class="fas fa-hand-pointer"></i> แตะเพื่อดูรายละเอียด</span>
    </div>`).join('');

  Array.from(track.querySelectorAll('img[data-src]')).forEach((img, i) => {
    setTimeout(() => loadHeroImage(img), i * 350);
  });

  dots.innerHTML = slides.map((_, i) =>
    `<button class="hero-dot ${i === heroCurrentSlide ? 'active' : ''}" onclick="goToSlide(${i})" aria-label="สไลด์ที่ ${i + 1}"></button>`
  ).join('');

  const progressWrap = document.getElementById('heroProgressFill');
  if (progressWrap) progressWrap.parentElement.classList.toggle('hidden', slides.length <= 1);

  applyHeroTransform();
  setupHeroSwipe();
  if (slides.length > 1) startHeroAutoplay();
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

function applyHeroTransform() {
  const track = document.getElementById('heroTrack');
  if (!track) return;
  track.style.transform = `translateX(-${heroCurrentSlide * 100}%)`;
  document.querySelectorAll('#heroDots .hero-dot').forEach((d, i) => d.classList.toggle('active', i === heroCurrentSlide));
}

function goToSlide(i) {
  heroCurrentSlide = ((i % slides.length) + slides.length) % slides.length;
  applyHeroTransform();
  restartHeroAutoplay();
}

/** แถบนับเวลาสไลด์อัตโนมัติ — วิ่งเต็มความกว้างใน 1 รอบ (4.5 วิ) แล้วรีเซ็ตใหม่ทุกครั้งที่เปลี่ยนสไลด์ */
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

function startHeroAutoplay() {
  stopHeroAutoplay();
  playHeroProgress();
  heroAutoplayTimer = setInterval(() => { goToSlide(heroCurrentSlide + 1); }, 4500);
}
function stopHeroAutoplay() {
  if (heroAutoplayTimer) { clearInterval(heroAutoplayTimer); heroAutoplayTimer = null; }
  resetHeroProgress();
}
function restartHeroAutoplay() {
  if (slides.length > 1) startHeroAutoplay(); else stopHeroAutoplay();
}

/** รองรับปัดนิ้วซ้าย-ขวาเพื่อเปลี่ยนสไลด์บนมือถือ — bind แค่ครั้งเดียวเพราะ #heroTrack เป็น element เดิม
 * ที่ถูก re-render แค่ innerHTML ข้างในเท่านั้น (ตัว element เองไม่ได้ถูกสร้างใหม่) */
let heroSwipeBound = false;
function setupHeroSwipe() {
  if (heroSwipeBound) return;
  const track = document.getElementById('heroTrack');
  if (!track) return;
  heroSwipeBound = true;

  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;

  track.addEventListener('touchstart', (e) => {
    if (slides.length < 2) return;
    dragging = true;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dy = 0;
    track.style.transition = 'none';
    stopHeroAutoplay();
  }, { passive: true });

  track.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dx = e.touches[0].clientX - startX;
    dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy)) {
      const percent = (dx / track.clientWidth) * 100;
      track.style.transform = `translateX(calc(-${heroCurrentSlide * 100}% + ${percent}%))`;
    }
  }, { passive: true });

  track.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    track.style.transition = '';
    const swipedHorizontally = Math.abs(dx) > Math.abs(dy);
    const passedThreshold = Math.abs(dx) > track.clientWidth * 0.15;
    if (swipedHorizontally && passedThreshold) {
      goToSlide(heroCurrentSlide + (dx < 0 ? 1 : -1));
    } else {
      applyHeroTransform();
      restartHeroAutoplay();
    }
  });
}

/** กดที่สไลด์แล้วเปิดหน้าต่างโบรชัวร์ — แสดงรูปปกของสไลด์นั้น แล้วมีปุ่มลิงก์ไปเปิดไฟล์ที่ผูกไว้ */
function openBrochure(i) {
  const slide = slides[i];
  if (!slide) return;
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
function toggleSlideCollapse() {
  const body = document.getElementById('slideCollapseBody');
  const arrow = document.getElementById('slideCollapseArrow');
  const willOpen = body.classList.contains('hidden');
  body.classList.toggle('hidden');
  arrow.textContent = willOpen ? '▴' : '▾';
  if (willOpen) renderAdminSlideList();
}

function renderAdminSlideList() {
  const list = document.getElementById('slideAdminList');
  if (!list) return;
  if (!slides.length) {
    list.innerHTML = `<div class="slide-admin-empty">ยังไม่มีสไลด์ — เพิ่มสไลด์แรกด้านล่างนี้ได้เลย</div>`;
    return;
  }
  list.innerHTML = slides.map((s, i) => `
    <div class="slide-admin-row">
      <div class="slide-admin-thumb"><img src="${escapeAttr(driveImageUrl(s.imageUrl, 'w200'))}" alt="" onerror="this.src='${localPlaceholder('C2TECH')}'"></div>
      <div class="slide-admin-text">
        <div><i class="fas fa-image"></i> ${escapeHtml(truncateMiddle(s.imageUrl))}</div>
        <div><i class="fas fa-link"></i> ${escapeHtml(truncateMiddle(s.linkUrl))}</div>
      </div>
      <div class="slide-admin-actions">
        <button class="icon-sq-btn danger" onclick="handleDeleteSlide(${i})" title="ลบสไลด์นี้"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
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
  const linkUrl = document.getElementById('newSlideLinkInput').value.trim();
  if (!imageUrl || !linkUrl) return Swal.fire({ title: 'กรุณาวางลิงก์รูปภาพและลิงก์ไฟล์ให้ครบ', icon: 'warning' });

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

init();

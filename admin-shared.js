// BYZ Admin - Shared Session Management & Navigation
// Include this in all admin pages

// Prevent duplicate declarations - use window properties only
if (typeof window.ADMIN_SESSION_KEY === 'undefined') {
  window.ADMIN_SESSION_KEY = "byz_admin_session";
}
if (typeof window.ADMIN_REMEMBER_KEY === 'undefined') {
  window.ADMIN_REMEMBER_KEY = "byz_admin_remember";
}
if (typeof window.ADMIN_PASSWORD === 'undefined') {
  window.ADMIN_PASSWORD = "weballwithbyz";
}

// Session Management
function checkAuth() {
  // Check sessionStorage first (active session)
  const session = sessionStorage.getItem(window.ADMIN_SESSION_KEY);
  if (session && session === window.ADMIN_PASSWORD) {
    return true;
  }
  
  // Check localStorage for "remember me"
  const remembered = localStorage.getItem(window.ADMIN_REMEMBER_KEY);
  if (remembered && remembered === window.ADMIN_PASSWORD) {
    // Restore session
    sessionStorage.setItem(window.ADMIN_SESSION_KEY, window.ADMIN_PASSWORD);
    return true;
  }
  
  return false;
}

function setAuth(remember = false) {
  sessionStorage.setItem(window.ADMIN_SESSION_KEY, window.ADMIN_PASSWORD);
  if (remember) {
    localStorage.setItem(window.ADMIN_REMEMBER_KEY, window.ADMIN_PASSWORD);
  }
}

function clearAuth() {
  sessionStorage.removeItem(window.ADMIN_SESSION_KEY);
  localStorage.removeItem(window.ADMIN_REMEMBER_KEY);
}

function logout() {
  clearAuth();
  window.location.href = "admin.html";
}

// Navigation Menu Component
function renderAdminNav(activePage = "bookings") {
  const navHTML = `
    <header>
      <div class="container">
        <div class="header-inner">
          <a href="admin.html" class="brand">
            <div class="brand-logo-wrap">
              <img src="assets/byz-logo-black.png" alt="BYZ" class="brand-logo logo-light">
              <img src="assets/byz-logo-white.png" alt="BYZ" class="brand-logo logo-dark">
            </div>
            <span>BYZ Admin</span>
          </a>
          
          <nav class="admin-nav-desktop" id="adminNavDesktop">
            <a href="admin.html" class="nav-link ${activePage === "bookings" ? "active" : ""}">
              <i class="fa-solid fa-ticket"></i> Bookings
            </a>
            <a href="admin-messages.html" class="nav-link ${activePage === "messages" ? "active" : ""}">
              <i class="fa-solid fa-envelope"></i> Messages
            </a>
            <a href="admin-stats.html" class="nav-link ${activePage === "stats" ? "active" : ""}">
              <i class="fa-solid fa-chart-line"></i> Stats
            </a>
          </nav>
          
          <div class="top-actions">
            <button onclick="logout()" class="btn" style="padding:8px 14px;font-size:13px;">
              <i class="fa-solid fa-arrow-right-from-bracket"></i>
              <span class="logout-text">Logout</span>
            </button>
            <button class="mobile-menu-btn" id="mobileMenuBtn" onclick="toggleMobileMenu()" aria-label="Menu">
              <i class="fa-solid fa-bars"></i>
            </button>
          </div>
        </div>
      </div>
    </header>
    
    <!-- Mobile Navigation Menu -->
    <div class="mobile-nav-overlay hidden" id="mobileNavOverlay" onclick="toggleMobileMenu()"></div>
    <div class="mobile-nav-panel hidden" id="mobileNavPanel">
      <div class="mobile-nav-header">
        <div class="brand">
          <div class="brand-logo-wrap">
            <img src="assets/byz-logo-black.png" alt="BYZ" class="brand-logo logo-light">
            <img src="assets/byz-logo-white.png" alt="BYZ" class="brand-logo logo-dark">
          </div>
          <span>BYZ Admin</span>
        </div>
        <button onclick="toggleMobileMenu()" class="mobile-nav-close" aria-label="Close menu">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <nav class="mobile-nav-links">
        <a href="admin.html" class="nav-link ${activePage === "bookings" ? "active" : ""}" onclick="toggleMobileMenu()">
          <i class="fa-solid fa-ticket"></i> Bookings
        </a>
        <a href="admin-messages.html" class="nav-link ${activePage === "messages" ? "active" : ""}" onclick="toggleMobileMenu()">
          <i class="fa-solid fa-envelope"></i> Messages
        </a>
        <a href="admin-stats.html" class="nav-link ${activePage === "stats" ? "active" : ""}" onclick="toggleMobileMenu()">
          <i class="fa-solid fa-chart-line"></i> Stats
        </a>
        <button onclick="logout()" class="nav-link logout-btn">
          <i class="fa-solid fa-arrow-right-from-bracket"></i> Logout
        </button>
      </nav>
    </div>
  `;
  
  // Insert at the beginning of body
  const body = document.body;
  const firstChild = body.firstChild;
  if (firstChild) {
    body.insertAdjacentHTML("afterbegin", navHTML);
  } else {
    body.innerHTML = navHTML + body.innerHTML;
  }
}

function toggleMobileMenu() {
  const overlay = document.getElementById("mobileNavOverlay");
  const panel = document.getElementById("mobileNavPanel");
  if (overlay && panel) {
    const isHidden = overlay.classList.contains("hidden");
    if (isHidden) {
      overlay.classList.remove("hidden");
      panel.classList.remove("hidden");
      document.body.style.overflow = "hidden";
    } else {
      overlay.classList.add("hidden");
      panel.classList.add("hidden");
      document.body.style.overflow = "";
    }
  }
}

// Initialize auth check on page load
function initAdminAuth() {
  if (!checkAuth()) {
    // Not authenticated - redirect to login immediately
    const currentPath = window.location.pathname;
    const isAdminHtml = currentPath.includes("admin.html");
    
    // If not on admin.html (login page), redirect immediately
    if (!isAdminHtml) {
      window.location.replace("admin.html");
      return false;
    }
    
    // If on admin.html but no login element, show login
    const loginEl = document.getElementById("login");
    if (loginEl) {
      loginEl.classList.remove("hidden");
    }
    const dashboardEl = document.getElementById("dashboard");
    if (dashboardEl) {
      dashboardEl.classList.add("hidden");
    }
    return false;
  } else {
    // Authenticated - hide login, show dashboard
    const loginEl = document.getElementById("login");
    const dashboardEl = document.getElementById("dashboard");
    if (loginEl) loginEl.classList.add("hidden");
    if (dashboardEl) dashboardEl.classList.remove("hidden");
    return true;
  }
}

// Make functions globally available
window.checkAuth = checkAuth;
window.setAuth = setAuth;
window.clearAuth = clearAuth;
window.logout = logout;
window.renderAdminNav = renderAdminNav;
window.toggleMobileMenu = toggleMobileMenu;
window.initAdminAuth = initAdminAuth;


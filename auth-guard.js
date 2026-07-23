(function(){
  var client = null;

  function getClient(){
    if (client) return client;
    if (typeof window.supabase === 'undefined'){
      console.error('Nie wczytano Supabase JS SDK (sprawdź, czy skrypt @supabase/supabase-js jest dołączony przed auth-guard.js).');
      return null;
    }
    if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.url || window.SUPABASE_CONFIG.url.indexOf('TODO') === 0){
      console.error('Uzupełnij supabase-config.js danymi z Twojego projektu Supabase.');
      return null;
    }
    client = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return client;
  }

  function escapeHtml(s){
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  function renderAuthButtons(session){
    var wrap = document.querySelector('.auth-buttons');
    if (!wrap) return;
    if (session && session.user){
      wrap.innerHTML =
        '<span style="font-size:13px; color:var(--text-muted); margin-right:2px;">' + escapeHtml(session.user.email) + '</span>' +
        '<a href="#" class="btn btn-outline" id="rsLogoutBtn">Wyloguj</a>';
      var logoutBtn = document.getElementById('rsLogoutBtn');
      if (logoutBtn){
        logoutBtn.addEventListener('click', function(e){
          e.preventDefault();
          var c = getClient();
          if (!c) return;
          c.auth.signOut().then(function(){ window.location.href = 'index.html'; });
        });
      }
    } else {
      wrap.innerHTML =
        '<a href="login.html" class="btn btn-outline">Zaloguj się</a>' +
        '<a href="register.html" class="btn btn-solid">Zarejestruj się</a>';
    }
  }

  function redirectToLogin(){
    var here = window.location.pathname.split('/').pop();
    window.location.href = 'login.html?redirect=' + encodeURIComponent(here);
  }

  function checkEntitlement(c, userId, protocolId){
    return c
      .from('entitlements')
      .select('kind, protocol_id, status, current_period_end')
      .eq('user_id', userId)
      .eq('status', 'active')
      .then(function(res){
        if (res.error){
          console.error('Nie udało się sprawdzić dostępu:', res.error);
          return false;
        }
        var rows = res.data || [];
        return rows.some(function(r){
          if (r.kind === 'subscription'){
            if (!r.current_period_end) return true;
            return new Date(r.current_period_end) > new Date();
          }
          if (r.kind === 'protocol'){
            return r.protocol_id === protocolId;
          }
          return false;
        });
      });
  }

  var DEMO_STYLE =
    '.rs-demo-banner{' +
    '  max-width:980px; margin:14px auto 0; padding:12px 16px;' +
    '  background:#fff8e1; border:1px solid #f0d896; color:#7a5b00;' +
    '  border-radius:10px; font-size:13.5px; text-align:center;' +
    '}' +
    '.rs-demo-banner a{color:var(--red-700); font-weight:700; text-decoration:none;}' +
    '.rs-demo-banner a:hover{text-decoration:underline;}' +
    '.demo-locked{opacity:0.5; cursor:not-allowed;}';

  function injectDemoStyle(){
    if (document.getElementById('rsDemoStyle')) return;
    var style = document.createElement('style');
    style.id = 'rsDemoStyle';
    style.textContent = DEMO_STYLE;
    document.head.appendChild(style);
  }

  function lockExportButtons(protocolId){
    injectDemoStyle();
    ['printBtn', 'lockedPdfBtn', 'previewPrintBtn'].forEach(function(id){
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.add('demo-locked');
      btn.title = 'Wykup dostęp, aby drukować / eksportować PDF';
      btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = 'pricing.html?protocol=' + encodeURIComponent(protocolId || '');
      }, true);
    });

    var actionBarWrap = document.querySelector('.action-bar-wrap');
    if (actionBarWrap && !document.getElementById('rsDemoBanner')){
      var banner = document.createElement('div');
      banner.id = 'rsDemoBanner';
      banner.className = 'rs-demo-banner';
      banner.innerHTML = 'Tryb demo — możesz wypełnić formularz, ale druk i eksport PDF wymagają wykupienia dostępu. <a href="pricing.html?protocol=' + encodeURIComponent(protocolId || '') + '">Zobacz cennik →</a>';
      actionBarWrap.parentNode.insertBefore(banner, actionBarWrap.nextSibling);
    }
  }

  function initTileGuard(c){
    document.querySelectorAll('.tile').forEach(function(tile){
      tile.addEventListener('click', function(e){
        c.auth.getSession().then(function(res){
          var session = res.data && res.data.session;
          if (!session){
            e.preventDefault();
            var href = tile.getAttribute('href');
            window.location.href = 'login.html?redirect=' + encodeURIComponent(href || 'index.html');
          }
        });
      });
    });
  }

  function initProtocolGuard(c, protocolId){
    c.auth.getSession().then(function(res){
      var session = res.data && res.data.session;
      if (!session){
        redirectToLogin();
        return;
      }
      renderAuthButtons(session);
      checkEntitlement(c, session.user.id, protocolId).then(function(hasAccess){
        if (!hasAccess) lockExportButtons(protocolId);
      });
    });
  }

  function initPublicPage(c){
    c.auth.getSession().then(function(res){
      renderAuthButtons(res.data && res.data.session);
    });
  }

  function initAuthPage(c){
    c.auth.getSession().then(function(res){
      var session = res.data && res.data.session;
      if (session){
        var params = new URLSearchParams(window.location.search);
        window.location.href = params.get('redirect') || 'index.html';
      }
    });
  }

  function boot(){
    var c = getClient();
    if (!c) return;

    var page = document.body.dataset.page;
    var protocolId = document.body.dataset.protocolId;

    if (protocolId){
      initProtocolGuard(c, protocolId);
    } else if (page === 'home'){
      initTileGuard(c);
      initPublicPage(c);
    } else if (page === 'auth'){
      initAuthPage(c);
    } else {
      initPublicPage(c);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.RS_AUTH = { getClient: getClient };
})();

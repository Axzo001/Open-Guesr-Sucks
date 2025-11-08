// ==UserScript==
// @name         OpenGuessrSucks
// @namespace    https://openguessr.com/
// @version      2.6
// @description  A sleek, frosted-glass enhanced hack for OpenGuessr that auto-fetches map coordinates, shows dynamic country flags, compact vertical info bar, detailed location panel, and a resizable, floating minimap with style.
// @author       XzA01
// @license      MIT
// @match        https://openguessr.com/*
// @icon         https://education.openguessr.com/assets/home/openguessr_icon.png
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_log
// @grant        GM_setClipboard
// ==/UserScript==

(function(){
  'use strict';
  GM_log('OpenGuessr HUD v1.5 loaded');

  /* =====================
     Storage & Defaults
     ===================== */
  const KEY = {
    settings: 'oghud_v1_5_settings',
    cachePrefix: 'oghud_v1_5_cache_'
  };

  const DEFAULTS = {
    showInfobar: true,
    showMinimap: true,
    minimap: { w: 260, h: 150 },
    defaultZoom: 3,
    autoOpenOnRound: true,
    freezeUpdates: false,
    fields: { continent: true, country: true, state: true, city: true, coords: false },
    cacheTTLmin: 30,
    autoHideWhenNotInRound: true
  };

  function loadSettings(){ try { return Object.assign({}, DEFAULTS, GM_getValue(KEY.settings, {})); } catch(e){ return Object.assign({}, DEFAULTS); } }
  function saveSettings(s){ try { GM_setValue(KEY.settings, s); } catch(e){} }
  let settings = loadSettings();

  const GMAPS_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Google_Maps_Logo_2020.svg/2275px-Google_Maps_Logo_2020.svg.png';
  const now = ()=>Date.now();
  const cacheKey = coords => KEY.cachePrefix + coords.replace(/\s+/g,'');

  // small dominant color table (fallback)
  const FLAG_DOMINANT = {
    US:'#b22234', GB:'#012169', FR:'#002395', DE:'#000000', RU:'#003399', CN:'#de2910',
    JP:'#e60012', KR:'#003478', IT:'#009246', ES:'#c60b1e', NL:'#21468b', BR:'#009c3b',
    CA:'#ff0000', AU:'#0e2a47', IN:'#ff9933', SE:'#005eb8', NO:'#ba0c2f', DK:'#c60c30',
    FI:'#003580', IE:'#169b62', CH:'#d52b1e', BE:'#000000', AT:'#ed2939', TR:'#e30a17',
    AR:'#75aadb', MX:'#006847', ZA:'#007749', NG:'#008751', PK:'#006600', EG:'#ce1126'
  };
  function getFlagColor(code){ if(!code) return '#e7eef8'; const cc = String(code||'').toUpperCase(); return FLAG_DOMINANT[cc] || '#9fb6d9'; }
  function ccToEmoji(code){ if(!code||typeof code!=='string') return ''; try{ const cc = code.toUpperCase(); if(cc.length!==2) return ''; return String.fromCodePoint(0x1F1E6+cc.charCodeAt(0)-65, 0x1F1E6+cc.charCodeAt(1)-65); }catch(e){return ''; } }

  /* =====================
     Golden core: extractLocation & Map URL
     ===================== */
  function extractLocation(){
    try {
      const p = document.querySelector('#panorama-iframe');
      if(p && p.getAttribute('src')){
        const src = p.getAttribute('src');
        try {
          const u = new URL(src, location.origin);
          if(u.searchParams.has('pb')){
            const m = u.searchParams.get('pb').match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/);
            if(m) return `${parseFloat(m[1]).toFixed(6)},${parseFloat(m[2]).toFixed(6)}`;
          }
          if(u.searchParams.has('location')){
            const v = u.searchParams.get('location').split(',');
            if(v.length>=2) return `${parseFloat(v[0]).toFixed(6)},${parseFloat(v[1]).toFixed(6)}`;
            return u.searchParams.get('location');
          }
        } catch(e){
          const mm = src.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
          if(mm) return `${parseFloat(mm[1]).toFixed(6)},${parseFloat(mm[2]).toFixed(6)}`;
        }
      }
      // fallback scan other frames
      for(const f of document.querySelectorAll('iframe[src*="google.com/maps"], iframe[src*="maps.google.com"], iframe[src*="google.com/maps/embed"]')){
        const s = f.getAttribute('src')||'';
        if(!s) continue;
        try{
          const u = new URL(s, location.origin);
          if(u.searchParams.has('pb')){
            const m = u.searchParams.get('pb').match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/);
            if(m) return `${parseFloat(m[1]).toFixed(6)},${parseFloat(m[2]).toFixed(6)}`;
          }
          if(u.searchParams.has('location')){
            const v = u.searchParams.get('location').split(',');
            if(v.length>=2) return `${parseFloat(v[0]).toFixed(6)},${parseFloat(v[1]).toFixed(6)}`;
          }
        }catch(e){
          const mm = s.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
          if(mm) return `${parseFloat(mm[1]).toFixed(6)},${parseFloat(mm[2]).toFixed(6)}`;
        }
      }
      return null;
    } catch(e){ return null; }
  }

  function getMapEmbedUrl(coords, zoom){
    const z = (typeof zoom === 'number')?zoom: (settings.defaultZoom||3);
    return `https://maps.google.com/maps?q=${encodeURIComponent(coords)}&ll=${encodeURIComponent(coords)}&t=m&z=${z}&output=embed`;
  }

  /* =====================
     Reverse geocode with caching
     ===================== */
  async function reverseGeocodeMulti(coords){
    if(!coords) return null;
    const k = cacheKey(coords);
    try{
      const raw = GM_getValue(k);
      if(raw){
        const parsed = JSON.parse(raw);
        if(parsed._ts && (now()-parsed._ts) < (settings.cacheTTLmin||DEFAULTS.cacheTTLmin)*60*1000) return parsed.data;
      }
    }catch(e){}
    const [lat, lon] = coords.split(',').map(s=>s.trim());
    const zooms = [18,16,14,12,10,8,6,4];
    const out = { formatted:'—', road:'—', house_number:'—', city:'—', state:'—', postcode:'—', country:'—', country_code:'—', continent:'—', timezone:'—', phone:'—', raw:null };
    async function tryZ(z){
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=${z}&addressdetails=1`;
      try{ const r = await fetch(url, { headers:{ 'User-Agent':'OpenGuessrHUD/1.5' } }); if(!r.ok) return null; return await r.json(); } catch(e){ return null; }
    }
    for(const z of zooms){
      const j = await tryZ(z);
      if(!j) continue;
      const a = j.address||{};
      if(out.formatted==='—' && j.display_name) out.formatted = j.display_name;
      out.road = out.road === '—' ? (a.road||a.pedestrian||'—') : out.road;
      out.house_number = out.house_number === '—' ? (a.house_number||'—') : out.house_number;
      out.city = out.city === '—' ? (a.city||a.town||a.village||a.hamlet||a.county||'—') : out.city;
      out.state = out.state === '—' ? (a.state||a.state_district||a.region||a.province||a.county||'—') : out.state;
      out.postcode = out.postcode === '—' ? (a.postcode||'—') : out.postcode;
      out.country = out.country === '—' ? (a.country||'—') : out.country;
      out.country_code = out.country_code === '—' ? (a.country_code ? a.country_code.toUpperCase() : '—') : out.country_code;
      out.raw = j;
      if(out.formatted!=='—' && out.country!=='—' && out.state!=='—' && out.city!=='—') break;
    }
    // fallback parse
    if((!out.state || out.state==='—') && out.formatted && out.formatted!=='—'){
      const parts = out.formatted.split(',').map(p=>p.trim()).filter(Boolean);
      if(parts.length>=3) out.state = parts[parts.length-2];
    }
    // continent via restcountries
    if(out.country_code && out.country_code!=='—'){
      try{ const rc = await fetch(`https://restcountries.com/v3.1/alpha/${out.country_code}`); if(rc.ok){ const arr = await rc.json(); if(Array.isArray(arr) && arr[0] && arr[0].continents) out.continent = Array.isArray(arr[0].continents)?arr[0].continents[0]:arr[0].continents||'—'; } } catch(e){ out.continent='—'; }
    }
    // timezone placeholder attempt (no API): use Intl if available
    try{
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      out.timezone = tz || '—';
    }catch(e){ out.timezone='—'; }
    // phone placeholder (no reliable free source): keep '—'
    Object.keys(out).forEach(k=>{ if(typeof out[k]==='string' && out[k].trim()==='') out[k]='—'; });
    try{ GM_setValue(k, JSON.stringify({ _ts: now(), data: out })); } catch(e){}
    return out;
  }

  /* =====================
     Build UI nodes
     ===================== */
  function makeTopRight(){
    let el = document.getElementById('oghud_topright');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'oghud_topright';
    el.style.position='fixed'; el.style.top='10px'; el.style.right='10px'; el.style.zIndex='9999999'; el.style.display='flex'; el.style.flexDirection='column'; el.style.gap='10px'; el.style.alignItems='flex-end';
    // buttons container
    el.innerHTML = `
      <div id="oghud_buttons" style="display:flex;gap:8px;">
        <button id="oghud_btn_info" title="Details (Alt+I)">📍</button>
        <button id="oghud_btn_settings" title="Settings (Alt+S)">⚙️</button>
        <button id="oghud_btn_help" title="Help (Alt+H)">ℹ️</button>
        <button id="oghud_btn_eye" title="Toggle infobar (Alt+E)">👁️</button>
      </div>
      <div id="oghud_map_slot" style="margin-top:8px;"></div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function makeInfobarTiles(){
    let bar = document.getElementById('oghud_infobar_tiles');
    if(bar) return bar;
    bar = document.createElement('div');
    bar.id = 'oghud_infobar_tiles';
    bar.style.position='fixed'; bar.style.left='12px'; bar.style.top='46px'; bar.style.zIndex='9999998'; bar.style.display='flex'; bar.style.flexDirection='column'; bar.style.gap='8px';
    // tiles (vertical)
    bar.innerHTML = `
      <div class="oghud_tile" id="tile_timer"><div class="tile_inner" id="oghud_timer">00:00</div></div>
      <div class="oghud_tile" id="tile_country"><div class="tile_inner" id="oghud_country">—</div></div>
      <div class="oghud_tile" id="tile_state"><div class="tile_inner" id="oghud_state">—</div></div>
      <div class="oghud_tile" id="tile_city"><div class="tile_inner" id="oghud_city">—</div></div>
      <div class="oghud_tile" id="tile_coords"><div class="tile_inner" id="oghud_coords">—</div></div>
    `;
    document.body.appendChild(bar);
    return bar;
  }

  function makeRightMinimap(){
    // create independent minimap placed below top-right buttons
    const slot = document.getElementById('oghud_map_slot');
    slot.innerHTML = ''; // clear
    const wrap = document.createElement('div');
    wrap.id = 'oghud_map_container';
    wrap.style.width = settings.minimap.w + 'px';
    wrap.style.height = settings.minimap.h + 'px';
    wrap.style.position = 'relative';
    wrap.style.borderRadius = '12px';
    wrap.style.overflow = 'visible';
    wrap.style.pointerEvents = 'auto';
    wrap.innerHTML = `
      <div id="oghud_map_wrap" style="position:relative;width:100%;height:100%;">
        <iframe id="oghud_map" frameborder="0" loading="lazy" style="width:100%;height:100%;border-radius:12px;border:0;background:transparent"></iframe>
        <div id="oghud_map_controls" style="position:absolute;right:8px;bottom:8px;display:flex;flex-direction:column;gap:6px;opacity:0;transition:opacity 140ms;">
          <button id="oghud_zoom_in" title="Zoom in">+</button>
          <button id="oghud_zoom_out" title="Zoom out">−</button>
        </div>
      </div>
    `;
    slot.appendChild(wrap);
    // hover controls
    const wrapNode = document.getElementById('oghud_map_wrap');
    const ctrls = document.getElementById('oghud_map_controls');
    wrapNode.addEventListener('mouseenter', ()=>ctrls.style.opacity='1');
    wrapNode.addEventListener('mouseleave', ()=>ctrls.style.opacity='0');
    return wrap;
  }

  function makeModals(){
    // details modal (centered)
    if(!document.getElementById('oghud_modal_details')){
      const m = document.createElement('div');
      m.id = 'oghud_modal_details';
      m.className = 'oghud_modal hidden';
      m.style.position='fixed'; m.style.inset='0'; m.style.display='none'; m.style.zIndex='9999996'; m.style.justifyContent='center'; m.style.alignItems='center';
      m.innerHTML = `
        <div class="oghud_modal_card" role="dialog" aria-modal="true" style="width:560px;max-width:95%;max-height:80%;overflow:auto;border-radius:12px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <h3 style="margin:0;color:#fff">Location details</h3>
            <button id="oghud_modal_close" title="Close" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 220px;gap:12px;">
            <div>
              <div style="margin-bottom:8px;"><strong>Full address</strong><div id="oghud_full" style="color:#e7eef8;margin-top:4px">—</div></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <div style="min-width:120px"><strong>Continent</strong><div id="oghud_continent" style="color:#e7eef8;margin-top:4px">—</div></div>
                <div style="min-width:160px"><strong>Country</strong><div id="oghud_country_full" style="color:#e7eef8;margin-top:4px">—</div></div>
                <div style="min-width:160px"><strong>State / Province</strong><div id="oghud_state_full" style="color:#e7eef8;margin-top:4px">—</div></div>
                <div style="min-width:140px"><strong>City</strong><div id="oghud_city_full" style="color:#e7eef8;margin-top:4px">—</div></div>
                <div style="min-width:120px"><strong>Postal</strong><div id="oghud_postal" style="color:#e7eef8;margin-top:4px">—</div></div>
                <div style="min-width:180px"><strong>Timezone</strong><div id="oghud_timezone" style="color:#e7eef8;margin-top:4px">—</div></div>
                <div style="min-width:160px"><strong>Telephone</strong><div id="oghud_phone" style="color:#e7eef8;margin-top:4px">—</div></div>
                <div style="min-width:180px"><strong>Coordinates</strong><div id="oghud_coords_full" style="color:#e7eef8;margin-top:4px">—</div></div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:stretch;">
              <button id="oghud_gmaps" title="Open in Google Maps" style="display:flex;align-items:center;gap:10px;justify-content:center;padding:8px;border-radius:8px;border:none;background:rgba(24,26,30,0.6);cursor:pointer;">
                <img src="${GMAPS_LOGO}" alt="gmaps" style="height:22px;object-fit:contain"> Open in Google Maps
              </button>
              <button id="oghud_copy" style="padding:8px;border-radius:8px;border:none;background:rgba(24,26,30,0.6);color:#fff;cursor:pointer">📋 Copy coordinates</button>
              <div style="flex:1"></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(m);
      // outside click closes
      m.addEventListener('click', (ev)=>{
        if(ev.target === m){ closeDetailsModal(); }
      });
    }

    // help modal
    if(!document.getElementById('oghud_modal_help')){
      const h = document.createElement('div');
      h.id = 'oghud_modal_help';
      h.className = 'oghud_modal hidden';
      h.style.position='fixed'; h.style.inset='0'; h.style.display='none'; h.style.zIndex='9999996'; h.style.justifyContent='center'; h.style.alignItems='center';
      h.innerHTML = `<div class="oghud_modal_card" style="width:360px;padding:12px;border-radius:10px;">
        <h3 style="margin-top:0;color:#fff">HUD Help & Shortcuts</h3>
        <ul style="color:#d7e6ff">
          <li><b>Alt+M</b> - Toggle minimap</li>
          <li><b>Alt+I</b> - Toggle details modal</li>
          <li><b>Alt+S</b> - Open settings</li>
          <li><b>Alt+H</b> - Open help</li>
          <li><b>Alt+E</b> - Toggle infobar</li>
        </ul>
        <div style="text-align:right"><button id="oghud_help_close" style="padding:8px;border-radius:6px;border:none;background:#1f6feb;color:#fff;cursor:pointer">Close</button></div>
      </div>`;
      document.body.appendChild(h);
      h.addEventListener('click', (ev)=>{ if(ev.target===h) { toggleHelp(false); } });
    }

    // settings modal
    if(!document.getElementById('oghud_modal_settings')){
      const s = document.createElement('div');
      s.id = 'oghud_modal_settings';
      s.className = 'oghud_modal hidden';
      s.style.position='fixed'; s.style.inset='0'; s.style.display='none'; s.style.zIndex='9999996'; s.style.justifyContent='center'; s.style.alignItems='center';
      s.innerHTML = `<div class="oghud_modal_card" style="width:420px;padding:12px;border-radius:10px;">
        <h3 style="margin-top:0;color:#fff">HUD Settings</h3>
        <div style="display:flex;flex-direction:column;gap:8px;color:#d7e6ff">
          <label><input id="set_showInfobar" type="checkbox"> Show infobar</label>
          <label><input id="set_showMinimap" type="checkbox"> Show minimap</label>
          <label>Minimap width <input id="set_map_w" type="number" min="120" max="800" style="width:80px;margin-left:8px"></label>
          <label>Minimap height <input id="set_map_h" type="number" min="80" max="600" style="width:80px;margin-left:8px"></label>
          <label>Default zoom <input id="set_zoom" type="number" min="1" max="18" style="width:80px;margin-left:8px"></label>
          <label><input id="set_freeze" type="checkbox"> Freeze updates</label>
          <label><input id="set_autoopen" type="checkbox"> Auto-open on round</label>
          <label><input id="set_autohide" type="checkbox"> Auto-hide when not in round</label>
          <label>Cache TTL (min) <input id="set_cachettl" type="number" min="1" max="1440" style="width:80px;margin-left:8px"></label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button id="set_save" style="padding:8px;border-radius:6px;border:none;background:#1f6feb;color:#fff;cursor:pointer">Save</button><button id="set_cancel" style="padding:8px;border-radius:6px;border:none;background:#6b6b6b;color:#fff;cursor:pointer">Cancel</button></div>
      </div>`;
      document.body.appendChild(s);
      s.addEventListener('click', (ev)=>{ if(ev.target===s) toggleSettings(false); });
    }
  }

  const topRight = makeTopRight();
  const infobar = makeInfobarTiles();
  const mapWrap = makeRightMinimap();
  makeModals();

  /* =====================
     Styles (frosted, dark, consistent tile height)
     ===================== */
  GM_addStyle(`
    /* make sure our elements receive pointer events */
    #oghud_topright, #oghud_infobar_tiles, #oghud_map_container, .oghud_modal { pointer-events: auto; }

    /* buttons (frosted circular) */
    #oghud_topright button { -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); background: rgba(28,30,34,0.44); color:#e7eef8; border-radius:10px; padding:8px; border:1px solid rgba(255,255,255,0.04); cursor:pointer; box-shadow:0 8px 20px rgba(0,0,0,0.45); font-size:14px; }
    #oghud_topright button:hover { transform:translateY(-2px); filter:brightness(1.06); }

    /* tiles */
    .oghud_tile { -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); background: rgba(10,12,14,0.36); border-radius:10px; padding:4px; border:1px solid rgba(255,255,255,0.03); box-shadow:0 8px 22px rgba(0,0,0,0.45); }
    .tile_inner { height:36px; min-width:120px; display:flex; align-items:center; gap:8px; padding:0 12px; color:#e7eef8; font-size:13px; line-height:1; }
    .tile_inner .flag { font-size:16px; margin-right:4px; }
    /* make left tiles aligned */
    #tile_timer .tile_inner { font-family:monospace; font-weight:700; color:#ffd9b3; min-width:80px; }
    #tile_country .tile_inner { min-width:160px; font-weight:700; text-align:left; }
    #tile_state .tile_inner { min-width:140px; }
    #tile_city .tile_inner { min-width:140px; }
    #tile_coords .tile_inner { min-width:140px; font-size:12px; color:#b7c8d9; }

    /* minimap */
    #oghud_map_container { transition:opacity 180ms ease, transform 160ms ease; margin-top:6px; }
    #oghud_map { border-radius:12px; box-shadow:0 8px 20px rgba(0,0,0,0.48); background:transparent !important; }
    #oghud_map_controls button { background: rgba(0,0,0,0.48); color:#fff; border:none; border-radius:8px; padding:6px 8px; cursor:pointer; }
    #oghud_map_controls button:hover{ transform:translateY(-2px); }

    /* modals: center frosted */
    .oghud_modal { backdrop-filter: blur(14px); }
    .oghud_modal .oghud_modal_card { background: rgba(6,8,10,0.82); border-radius:12px; padding:12px; color:#e7eef8; -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border:1px solid rgba(255,255,255,0.03); box-shadow:0 20px 50px rgba(0,0,0,0.6); }
    .oghud_modal.hidden { display:none; }

    /* responsive */
    @media(max-width:760px){
      #oghud_infobar_tiles { left:8px; top:56px; right:8px; }
      #oghud_map_container { right:8px; top:72px; width:160px !important; height:100px !important; }
      #oghud_topright { right:8px; top:8px; }
    }
  `);

  /* =====================
     Node references
     ===================== */
  const btnInfo = document.getElementById('oghud_btn_info');
  const btnSettings = document.getElementById('oghud_btn_settings');
  const btnHelp = document.getElementById('oghud_btn_help');
  const btnEye = document.getElementById('oghud_btn_eye');

  const elTimer = document.getElementById('oghud_timer');
  const elCountry = document.getElementById('oghud_country');
  const elState = document.getElementById('oghud_state');
  const elCity = document.getElementById('oghud_city');
  const elCoords = document.getElementById('oghud_coords');

  const mapContainer = document.getElementById('oghud_map_container');
  const mapIframe = document.getElementById('oghud_map');
  const zoomIn = document.getElementById('oghud_zoom_in');
  const zoomOut = document.getElementById('oghud_zoom_out');

  const detailsModal = document.getElementById('oghud_modal_details');
  const helpModal = document.getElementById('oghud_modal_help');
  const settingsModal = document.getElementById('oghud_modal_settings');

  const elFull = document.getElementById('oghud_full');
  const elCont = document.getElementById('oghud_continent');
  const elCountryFull = document.getElementById('oghud_country_full');
  const elStateFull = document.getElementById('oghud_state_full');
  const elCityFull = document.getElementById('oghud_city_full');
  const elPostal = document.getElementById('oghud_postal');
  const elTZ = document.getElementById('oghud_timezone');
  const elPhone = document.getElementById('oghud_phone');
  const elCoordsFull = document.getElementById('oghud_coords_full');

  const btnGmaps = document.getElementById('oghud_gmaps');
  const btnCopy = document.getElementById('oghud_copy');
  const modalClose = document.getElementById('oghud_modal_close');
  const helpClose = document.getElementById('oghud_help_close');

  const set_showInfobar = document.getElementById('set_showInfobar');
  const set_showMinimap = document.getElementById('set_showMinimap');
  const set_map_w = document.getElementById('set_map_w');
  const set_map_h = document.getElementById('set_map_h');
  const set_zoom = document.getElementById('set_zoom');
  const set_freeze = document.getElementById('set_freeze');
  const set_autoopen = document.getElementById('set_autoopen');
  const set_autohide = document.getElementById('set_autohide');
  const set_cachettl = document.getElementById('set_cachettl');
  const set_save = document.getElementById('set_save');
  const set_cancel = document.getElementById('set_cancel');

  /* =====================
     Behavior: position & independent state
     ===================== */
  // position right-minimap below buttons (top-right)
  function positionRightMap(){
    try {
      const topRightEl = document.getElementById('oghud_topright');
      const rect = topRightEl.getBoundingClientRect();
      // map slot is within topRight as created; keep its block flow
      // ensure size applied
      mapContainer.style.width = (settings.minimap.w||DEFAULTS.minimap.w) + 'px';
      mapContainer.style.height = (settings.minimap.h||DEFAULTS.minimap.h) + 'px';
    } catch(e){}
  }
  window.addEventListener('resize', positionRightMap);
  window.addEventListener('scroll', positionRightMap);

  // independent visibility states
  let mapVisible = !!settings.showMinimap;
  function setMapVisible(v){
    mapVisible = !!v;
    const slot = document.getElementById('oghud_map_container');
    if(slot) slot.style.display = mapVisible ? 'block' : 'none';
    settings.showMinimap = mapVisible; saveSettings(settings);
  }
  function setInfobarVisible(v){
    settings.showInfobar = !!v;
    const bar = document.getElementById('oghud_infobar_tiles');
    if(bar) bar.style.display = settings.showInfobar ? 'flex' : 'none';
    saveSettings(settings);
  }

  /* =====================
     Panel toggles (do not affect map)
     ===================== */
  function openDetails(show){
    const m = detailsModal;
    if(!m) return;
    const willShow = (typeof show==='boolean') ? show : m.classList.contains('hidden');
    if(willShow){
      m.classList.remove('hidden'); m.style.display='flex';
    } else {
      m.classList.add('hidden'); m.style.display='none';
    }
  }
  function toggleHelp(show){
    const h = helpModal;
    if(!h) return;
    const willShow = (typeof show==='boolean') ? show : h.classList.contains('hidden');
    if(willShow){ h.classList.remove('hidden'); h.style.display='flex'; } else { h.classList.add('hidden'); h.style.display='none'; }
  }
  function toggleSettings(show){
    const s = settingsModal;
    if(!s) return;
    const willShow=(typeof show==='boolean')?show: s.classList.contains('hidden');
    if(willShow){ s.classList.remove('hidden'); s.style.display='flex'; populateSettings(); } else { s.classList.add('hidden'); s.style.display='none'; }
  }

  // wire buttons
  btnInfo.addEventListener('click', (e)=>{ e.stopPropagation(); openDetails(); if(lastCoords) populateDetails(lastCoords); });
  btnHelp.addEventListener('click', (e)=>{ e.stopPropagation(); toggleHelp(); });
  btnSettings.addEventListener('click', (e)=>{ e.stopPropagation(); toggleSettings(); });
  btnEye.addEventListener('click', (e)=>{ e.stopPropagation(); setInfobarVisible(!settings.showInfobar); });

  modalClose && modalClose.addEventListener('click', ()=>openDetails(false));
  helpClose && helpClose.addEventListener('click', ()=>toggleHelp(false));

  // settings save/cancel
  set_cancel && set_cancel.addEventListener('click', ()=>toggleSettings(false));
  set_save && set_save.addEventListener('click', ()=>{
    settings.showInfobar = !!set_showInfobar.checked;
    settings.showMinimap = !!set_showMinimap.checked;
    settings.minimap.w = parseInt(set_map_w.value,10) || DEFAULTS.minimap.w;
    settings.minimap.h = parseInt(set_map_h.value,10) || DEFAULTS.minimap.h;
    settings.defaultZoom = parseInt(set_zoom.value,10) || DEFAULTS.defaultZoom;
    settings.freezeUpdates = !!set_freeze.checked;
    settings.autoOpenOnRound = !!set_autoopen.checked;
    settings.autoHideWhenNotInRound = !!set_autohide.checked;
    settings.cacheTTLmin = parseInt(set_cachettl.value,10) || DEFAULTS.cacheTTLmin;
    saveSettings(settings);
    applySettingsUI();
    toggleSettings(false);
  });

  function populateSettings(){
    set_showInfobar.checked = !!settings.showInfobar;
    set_showMinimap.checked = !!settings.showMinimap;
    set_map_w.value = settings.minimap.w || DEFAULTS.minimap.w;
    set_map_h.value = settings.minimap.h || DEFAULTS.minimap.h;
    set_zoom.value = settings.defaultZoom || DEFAULTS.defaultZoom;
    set_freeze.checked = !!settings.freezeUpdates;
    set_autoopen.checked = !!settings.autoOpenOnRound;
    set_autohide.checked = !!settings.autoHideWhenNotInRound;
    set_cachettl.value = settings.cacheTTLmin || DEFAULTS.cacheTTLmin;
  }

  function applySettingsUI(){
    setInfobarVisible(settings.showInfobar);
    setMapVisible(settings.showMinimap);
    positionRightMap();
  }

  /* =====================
     Map controls
     ===================== */
  zoomIn && zoomIn.addEventListener('click', (e)=>{ e.stopPropagation(); settings.defaultZoom = Math.min(18, (settings.defaultZoom||DEFAULTS.defaultZoom)+1); saveSettings(settings); if(lastCoords && mapVisible) mapIframe.src = getMapEmbedUrl(lastCoords, settings.defaultZoom); });
  zoomOut && zoomOut.addEventListener('click', (e)=>{ e.stopPropagation(); settings.defaultZoom = Math.max(1, (settings.defaultZoom||DEFAULTS.defaultZoom)-1); saveSettings(settings); if(lastCoords && mapVisible) mapIframe.src = getMapEmbedUrl(lastCoords, settings.defaultZoom); });

  // map click: open Google Maps; shift-click zoom
  const mapWrapNode = document.getElementById('oghud_map_wrap');
  mapWrapNode && mapWrapNode.addEventListener('click', (e)=>{
    if(!lastCoords) return;
    if(e.shiftKey){ settings.defaultZoom = Math.min(18, (settings.defaultZoom||DEFAULTS.defaultZoom)+2); saveSettings(settings); mapIframe.src = getMapEmbedUrl(lastCoords, settings.defaultZoom); }
    else window.open(`https://www.google.com/maps?q=${encodeURIComponent(lastCoords)}`, '_blank');
  });

  /* =====================
     Polling, mutation, updates
     ===================== */
  let lastCoords = null;
  let pendingToken = null;
  const POLL_MS = 1400;

  async function handleNewCoords(coords){
    if(!coords) return;
    if(settings.freezeUpdates) return;
    lastCoords = coords;
    // quick tile updates
    elCoords.textContent = coords;
    // load map only when visible
    if(settings.showMinimap && mapVisible) mapIframe.src = getMapEmbedUrl(coords, settings.defaultZoom);
    if(pendingToken) pendingToken.cancelled = true;
    const token = { cancelled:false }; pendingToken = token;
    const d = await reverseGeocodeMulti(coords).catch(()=>null);
    if(token.cancelled) return;
    if(d){
      const flag = (d.country_code && d.country_code!=='—')? ccToEmoji(d.country_code)+' ':'';
      elCountry.innerHTML = `<span class="flag">${flag}</span><span class="country-name">${d.country||'—'}</span>`;
      const nameEl = elCountry.querySelector('.country-name');
      if(nameEl) nameEl.style.color = getFlagColor(d.country_code);
      elState.textContent = d.state || '—';
      elCity.textContent = chooseCityEmoji(d.city) + ' ' + (d.city || '—');
      // details modal fill
      elFull && (elFull.textContent = d.formatted || '—');
      elCont && (elCont.textContent = d.continent || '—');
      elCountryFull && (elCountryFull.textContent = d.country || '—');
      elStateFull && (elStateFull.textContent = d.state || '—');
      elCityFull && (elCityFull.textContent = d.city || '—');
      elPostal && (elPostal.textContent = d.postcode || '—');
      elTZ && (elTZ.textContent = d.timezone || '—');
      elPhone && (elPhone.textContent = d.phone || '—');
      elCoordsFull && (elCoordsFull.textContent = coords || '—');
    } else {
      elCountry.textContent='—'; elState.textContent='—'; elCity.textContent='—';
    }
  }

  function chooseCityEmoji(city){
    if(!city || city==='—') return '🏙️';
    const c = city.toLowerCase();
    if(/\b(island|isle|bay|cove|beach|coast)\b/.test(c)) return '🏝️';
    if(/\b(mountain|mont|hill|peak|alp)\b/.test(c)) return '🏔️';
    if(/\b(park|garden|forest|woods)\b/.test(c)) return '🌲';
    if(/\b(lake|river|canal|pond)\b/.test(c)) return '🏞️';
    if(/\b(old|historic|downtown|city|metropolis)\b/.test(c)) return '🏛️';
    return '🏙️';
  }

  // is game active? rely on panorama iframe + mapTimer presence for rounds
  function isGameActive(){
    const pano = document.querySelector('#panorama-iframe');
    if(!pano) return false;
    if(!settings.autoHideWhenNotInRound) return true;
    const timer = document.querySelector('#mapTimer');
    const mapHolder = document.querySelector('#mapHolder');
    // treat presence of panorama or mapTimer as active
    return !!(timer || mapHolder || pano);
  }

  // Poll loop
  setInterval(()=>{
    try{
      const active = isGameActive();
      if(!active){
        if(settings.autoHideWhenNotInRound){ setInfobarVisible(false); setMapVisible(false); }
      } else {
        if(settings.autoOpenOnRound){ setInfobarVisible(settings.showInfobar); setMapVisible(settings.showMinimap); }
      }
      const coords = extractLocation();
      if(coords && coords !== lastCoords) handleNewCoords(coords);
      updateTimerVisual();
    }catch(e){}
  }, POLL_MS);

  // fast MutationObserver for panorama iframe
  try{
    const mo = new MutationObserver((mutations)=>{
      let changed=false;
      for(const m of mutations){
        if(m.type==='attributes' && m.target && m.target.id==='panorama-iframe' && m.attributeName==='src') changed=true;
        if(m.addedNodes) for(const n of m.addedNodes) if(n && n.id==='panorama-iframe') changed=true;
      }
      if(changed){
        setTimeout(()=>{
          const coords = extractLocation();
          if(coords && coords !== lastCoords) handleNewCoords(coords);
        }, 160);
      }
    });
    mo.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['src'] });
  }catch(e){}

  /* =====================
     Timer visuals & tile color pulse
     ===================== */
  function updateTimerVisual(){
    const t = document.querySelector('#mapTimer');
    if(!t){ elTimer.textContent='00:00'; return; }
    const txt = t.textContent.trim();
    elTimer.textContent = txt || '00:00';
    let seconds = null;
    try{ const parts = txt.split(':').map(s=>s.trim()); if(parts.length===2) seconds = parseInt(parts[0],10)*60 + parseInt(parts[1],10); else seconds = parseInt(parts[0],10); }catch(e){}
    const timerTile = document.getElementById('tile_timer');
    if(seconds !== null && !isNaN(seconds)){
      if(seconds <= 30){ timerTile.style.boxShadow = '0 10px 28px rgba(255,50,50,0.14)'; elTimer.style.color='#ffb3a3'; }
      else if(seconds <= 90){ timerTile.style.boxShadow = '0 10px 26px rgba(255,180,40,0.10)'; elTimer.style.color='#ffd9b3'; }
      else { timerTile.style.boxShadow = '0 8px 22px rgba(0,0,0,0.45)'; elTimer.style.color='#ffd9b3'; }
    }
  }
  setInterval(updateTimerVisual, 900);

  /* =====================
     Details modal helpers (open/close/populate)
     ===================== */
  function populateDetails(coords){
    if(!coords) return;
    // try cache first
    try{
      const raw = GM_getValue(cacheKey(coords));
      if(raw){
        const p = JSON.parse(raw);
        if(p && p.data){ fillDetails(p.data, coords); return; }
      }
    }catch(e){}
    reverseGeocodeMulti(coords).then(d=>{ if(d) fillDetails(d, coords); }).catch(()=>{});
  }
  function fillDetails(d, coords){
    elFull && (elFull.textContent = d.formatted || '—');
    elCont && (elCont.textContent = d.continent || '—');
    elCountryFull && (elCountryFull.textContent = d.country || '—');
    elStateFull && (elStateFull.textContent = d.state || '—');
    elCityFull && (elCityFull.textContent = d.city || '—');
    elPostal && (elPostal.textContent = d.postcode || '—');
    elTZ && (elTZ.textContent = d.timezone || '—');
    elPhone && (elPhone.textContent = d.phone || '—');
    elCoordsFull && (elCoordsFull.textContent = coords || '—');
    // ensure infobar chip updated too
    elCountry.innerHTML = (d.country_code && d.country_code!=='—' ? ccToEmoji(d.country_code)+' ':'') + `<span class="country-name">${d.country||'—'}</span>`;
    const nameEl = elCountry.querySelector('.country-name');
    if(nameEl) nameEl.style.color = getFlagColor(d.country_code);
    elState.textContent = d.state || '—';
    elCity.textContent = chooseCityEmoji(d.city) + ' ' + (d.city || '—');
  }

  // modal open/close wiring
  function closeDetailsModal(){ openDetails(false); }
  (document.getElementById('oghud_modal_close')||{}).addEventListener && document.getElementById('oghud_modal_close').addEventListener('click', closeDetailsModal);
  (document.getElementById('oghud_help_close')||{}).addEventListener && document.getElementById('oghud_help_close').addEventListener('click', ()=>toggleHelp(false));

  // GMaps & copy in modal
  btnGmaps && btnGmaps.addEventListener('click', ()=>{ if(lastCoords) window.open(`https://www.google.com/maps?q=${encodeURIComponent(lastCoords)}`, '_blank'); });
  btnCopy && btnCopy.addEventListener('click', async ()=>{ if(!lastCoords) return; try{ await navigator.clipboard.writeText(lastCoords); btnCopy.textContent='✓'; setTimeout(()=>btnCopy.textContent='📋 Copy',900); }catch(e){ alert('Copy failed'); } });

  /* =====================
     Shortcuts: Alt + key (ignore typing)
     ===================== */
  function isTypingTarget(ev){
    const t = ev.target;
    if(!t) return false;
    const tag = (t.tagName||'').toLowerCase();
    if(tag==='input' || tag==='textarea') return true;
    if(t.isContentEditable) return true;
    return false;
  }
  window.addEventListener('keydown', (ev)=>{
    if(!ev.altKey) return;
    if(isTypingTarget(ev)) return;
    const k = ev.key.toLowerCase();
    if(k==='m'){ ev.preventDefault(); ev.stopPropagation(); setMapVisible(!mapVisible); return; }
    if(k==='i'){ ev.preventDefault(); ev.stopPropagation(); openDetails(); if(lastCoords) populateDetails(lastCoords); return; }
    if(k==='s'){ ev.preventDefault(); ev.stopPropagation(); toggleSettings(); return; }
    if(k==='h'){ ev.preventDefault(); ev.stopPropagation(); toggleHelp(); return; }
    if(k==='e'){ ev.preventDefault(); ev.stopPropagation(); setInfobarVisible(!settings.showInfobar); return; }
  });

  /* =====================
     Keep nodes re-attached
     ===================== */
  setInterval(()=>{ if(!document.body.contains(topRight)) document.body.appendChild(topRight); if(!document.body.contains(infobar)) document.body.appendChild(infobar); const slot = document.getElementById('oghud_map_slot'); if(slot && !slot.contains(mapContainer)) slot.appendChild(mapContainer); }, 2000);

  /* =====================
     Initial boot
     ===================== */
  setTimeout(()=>{
    settings = loadSettings();
    applySettingsUI();
    positionRightMap();
    const coords = extractLocation();
    if(coords) handleNewCoords(coords);
    if(settings.autoOpenOnRound && coords){ setInfobarVisible(settings.showInfobar); setMapVisible(settings.showMinimap); }
  }, 1200);

  /* =====================
     Debug helpers
     ===================== */
  window.__oghud_v1_5 = { refresh: ()=>{ const c = extractLocation(); if(c) handleNewCoords(c); }, toggleInfobar: ()=>setInfobarVisible(!settings.showInfobar), toggleMap: ()=>setMapVisible(!mapVisible), extractLocation };

  GM_log('OpenGuessr HUD v1.5 ready');
})();

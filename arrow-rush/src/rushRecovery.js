// Legacy filename retained because index.html already loads this module before main.js.
// It now owns only the Home/navigation shell. The SPINSPIN gameplay event is rendered
// directly by the main Canvas engine so event entry does not create a heavy overlay.

function installStyles(doc) {
  if (doc.querySelector('#pj2-home-style')) return;
  const style = doc.createElement('style');
  style.id = 'pj2-home-style';
  style.textContent = `
    .pj2-home-overlay{position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 28%,rgba(21,49,91,.96),rgba(3,6,14,.98) 55%,#020308);color:#f4f8ff}
    .pj2-home-overlay[hidden]{display:none}
    .pj2-home-card{width:min(620px,94vw);padding:42px 34px;border:1px solid rgba(119,206,255,.22);border-radius:24px;background:rgba(6,11,23,.90);box-shadow:0 28px 100px rgba(0,0,0,.55),inset 0 0 60px rgba(55,165,255,.06);text-align:center}
    .pj2-home-card .eyebrow{margin:0 0 10px;color:#7d9ac8;font-size:11px;font-weight:900;letter-spacing:.2em}
    .pj2-home-card h1{margin:0;font-size:clamp(54px,11vw,104px);line-height:.88;font-style:italic;letter-spacing:-.06em;text-shadow:0 0 30px rgba(75,223,255,.30)}
    .pj2-home-card h1 span{color:#67f7ff}
    .pj2-home-card p{margin:18px auto 28px;color:#9fb1d1;max-width:460px;line-height:1.6}
    .pj2-home-actions{display:grid;gap:12px;width:min(360px,100%);margin:0 auto}
    .pj2-home-actions button,.pj2-home-return{min-height:50px;border-radius:13px;border:1px solid rgba(255,255,255,.12);font-weight:1000;letter-spacing:.04em}
    .pj2-home-actions .primary-home{background:linear-gradient(135deg,#38d9ff,#6975ff);color:#03101d;box-shadow:0 0 30px rgba(67,210,255,.24)}
    .pj2-home-actions .secondary-home,.pj2-home-return{background:rgba(20,31,54,.90);color:#e9f2ff}
    .pj2-home-record{margin-top:24px;color:#7087ae;font-size:11px;letter-spacing:.08em}
    #start-screen.mode-select-only .howto-grid,#start-screen.mode-select-only .lead,#start-screen.mode-select-only .start-note{display:none}
    #start-screen.mode-select-only .onboarding-panel{width:min(660px,94vw)}
    #start-screen.mode-select-only .onboarding-panel>h1{font-size:clamp(46px,8vw,76px)}
    .pj2-home-return{width:100%;margin-top:12px}
    .pj2-hud-home{pointer-events:auto;width:40px;height:40px;display:grid;place-items:center;border-radius:10px;background:rgba(18,28,48,.9);color:#fff;border:1px solid rgba(255,255,255,.13);font-size:18px}
  `;
  doc.head.appendChild(style);
}

export function installProject2Experience(win = window, doc = document) {
  installStyles(doc);

  const startScreen = doc.querySelector('#start-screen');
  const startPanel = startScreen?.querySelector('.start-panel');
  const pausePanel = doc.querySelector('#pause-screen .panel');
  const gameoverPanel = doc.querySelector('#gameover-screen .panel');
  const retryButton = doc.querySelector('#retry-button');
  const settings = doc.querySelector('#settings');
  const settingsButton = doc.querySelector('#settings-open');
  const hudRight = doc.querySelector('.hud-right');
  if (!startScreen || !startPanel || !retryButton) return null;

  const home = doc.createElement('section');
  home.className = 'pj2-home-overlay';
  home.innerHTML = `
    <div class="pj2-home-card">
      <p class="eyebrow">ARCADE HOME</p>
      <h1>ARROW <span>RUSH</span></h1>
      <p>홈에서 원하는 메뉴를 고른 뒤 게임으로 들어갑니다.</p>
      <div class="pj2-home-actions">
        <button type="button" class="primary-home" data-home-action="play">게임 시작</button>
        <button type="button" class="secondary-home" data-home-action="guide">게임 설명</button>
        <button type="button" class="secondary-home" data-home-action="settings">설정</button>
      </div>
      <div class="pj2-home-record">ESC 일시정지 · CTRL 가까운 블록 파괴 · HOME 언제든 복귀</div>
    </div>`;
  doc.body.appendChild(home);

  let returnHomeAfterSettings = false;
  const forceTitleState = () => retryButton.click();
  const showHome = () => { forceTitleState(); startScreen.classList.remove('mode-select-only'); home.hidden = false; };
  const showModeSelect = () => { home.hidden = true; startScreen.classList.add('mode-select-only'); };
  const showGuide = () => { home.hidden = true; startScreen.classList.remove('mode-select-only'); };

  const addHomeButton = (panel, label = '홈으로') => {
    if (!panel || panel.querySelector('.pj2-home-return')) return;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'pj2-home-return';
    button.textContent = label;
    button.addEventListener('click', showHome);
    panel.appendChild(button);
  };

  addHomeButton(startPanel);
  addHomeButton(pausePanel);
  addHomeButton(gameoverPanel);

  if (hudRight && !hudRight.querySelector('.pj2-hud-home')) {
    const hudHome = doc.createElement('button');
    hudHome.type = 'button';
    hudHome.className = 'pj2-hud-home';
    hudHome.title = '홈으로';
    hudHome.setAttribute('aria-label', '홈으로');
    hudHome.textContent = '⌂';
    hudHome.addEventListener('click', () => {
      win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      showHome();
    });
    hudRight.insertBefore(hudHome, settingsButton || null);
  }

  home.addEventListener('click', (event) => {
    const action = event.target.closest('[data-home-action]')?.dataset.homeAction;
    if (action === 'play') showModeSelect();
    else if (action === 'guide') showGuide();
    else if (action === 'settings' && settingsButton) {
      returnHomeAfterSettings = true;
      home.hidden = true;
      settingsButton.click();
    }
  });

  if (settings) {
    const settingsObserver = new MutationObserver(() => {
      if (returnHomeAfterSettings && settings.hidden) {
        returnHomeAfterSettings = false;
        showHome();
      }
    });
    settingsObserver.observe(settings, { attributes: true, attributeFilter: ['hidden'] });
  }

  home.hidden = false;
  return { showHome, showModeSelect, showGuide };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installProject2Experience(window, document);
}

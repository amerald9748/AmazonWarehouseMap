import { esc, icon } from './dom.js';

const TONES = {
  info: { color: '#38bdf8', icon: 'info' },
  success: { color: '#34d399', icon: 'check' },
  warn: { color: '#fbbf24', icon: 'alert' },
  error: { color: '#fb7185', icon: 'alert' },
};

/** 轻量提示：toast('已复制', { tone: 'success' }) */
export function toast(message, { tone = 'info', timeout = 3200 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = TONES[tone] || TONES.info;
  const el = document.createElement('div');
  el.className = 'wh-toast';
  el.style.setProperty('--b', t.color);
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="wh-toast__icon">${icon(t.icon, 'size-4')}</span><span>${esc(message)}</span>`;
  host.append(el);
  const close = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  };
  el.addEventListener('click', close);
  setTimeout(close, timeout);
}

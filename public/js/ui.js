// Small DOM helpers: escaping, keyed list updates, toasts and overlays.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const $ = (selector, root = document) => root.querySelector(selector);

function fromHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

/**
 * Makes `container`'s children match `items` without rebuilding what didn't
 * change, so posters don't flicker and the saber can animate. An element is
 * rebuilt only when its `signature` changes; otherwise `update` patches it.
 */
export function reconcile(container, items, { key, signature, render, update }) {
  const existing = new Map([...container.children].map((el) => [el.dataset.key, el]));
  let previous = null;
  for (const item of items) {
    const id = String(key(item));
    const sig = signature(item);
    let el = existing.get(id);
    existing.delete(id);
    if (el && el.dataset.sig === sig) {
      update?.(el, item, false);
    } else {
      const fresh = fromHtml(render(item));
      fresh.dataset.key = id;
      fresh.dataset.sig = sig;
      update?.(fresh, item, true);
      if (el) el.replaceWith(fresh);
      el = fresh;
    }
    const expected = previous ? previous.nextElementSibling : container.firstElementChild;
    if (el !== expected) container.insertBefore(el, expected);
    previous = el;
  }
  for (const el of existing.values()) el.remove();
}

export function toast(message, { action, onAction, duration = 5000 } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action;
    button.addEventListener('click', () => {
      dismiss();
      onAction();
    });
    el.append(button);
  }
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  timer = setTimeout(dismiss, duration);
}

// Overlays (a title's page, the search) get a browser history entry, so the
// phone's back button closes them instead of leaving the site.
const stack = [];
let closing = false;

export function openOverlay(overlay, { opener, onClose } = {}) {
  overlay.hidden = false;
  $('#app').inert = true;
  stack.at(-1)?.overlay.setAttribute('inert', '');
  stack.push({ overlay, opener, onClose });
  document.documentElement.classList.add('is-locked');
  history.pushState({ overlay: stack.length }, '');
  const target = overlay.querySelector('[data-autofocus]') ?? overlay.querySelector('button, input');
  target?.focus({ preventScroll: true });
}

/** Closes the top overlay by going back in history (the popstate handler hides it). */
export function closeOverlay() {
  if (!stack.length || closing) return;
  closing = true;
  history.back();
}

export const isOverlayOpen = (overlay) => stack.some((entry) => entry.overlay === overlay);

function hideTop() {
  closing = false;
  const top = stack.pop();
  if (!top) return;
  top.overlay.hidden = true;
  const below = stack.at(-1);
  if (below) below.overlay.removeAttribute('inert');
  else {
    $('#app').inert = false;
    document.documentElement.classList.remove('is-locked');
  }
  top.onClose?.();
  if (top.opener?.isConnected) top.opener.focus({ preventScroll: true });
}

/** Closes every overlay at once (e.g. when the session ends). */
export function closeAllOverlays() {
  while (stack.length) hideTop();
}

window.addEventListener('popstate', hideTop);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && stack.length) {
    event.preventDefault();
    closeOverlay();
  }
});

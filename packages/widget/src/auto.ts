import { definePagemoji } from './element.js';

// The script is served at <server>/v1/pagemoji.js, so the server is two levels up.
const script = document.currentScript;
const source = script instanceof HTMLScriptElement && script.src ? script : null;
definePagemoji(source ? { api: new URL('../', source.src).href } : {});

const mount = source?.dataset.mount?.match(/^(before|after|prepend|append):(.+)$/);
if (source && mount) {
  const [, where, selector = ''] = mount;
  const place = (): void => {
    const target = document.querySelector(selector);
    if (!target) return;
    const widget = document.createElement('pagemoji-reactions');
    for (const name of ['emojis', 'page'] as const) {
      const value = source.dataset[name];
      if (value) widget.setAttribute(name, value);
    }
    if (where === 'before') target.before(widget);
    else if (where === 'after') target.after(widget);
    else if (where === 'prepend') target.prepend(widget);
    else target.append(widget);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
  else place();
}

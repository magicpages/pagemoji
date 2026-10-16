import { definePagemoji } from './element.js';
import { resolveMount } from './mount.js';

// The script is served at <server>/v1/pagemoji.js, so the server is two levels up.
const script = document.currentScript;
const source = script instanceof HTMLScriptElement && script.src ? script : null;
definePagemoji(source ? { api: new URL('../', source.src).href } : {});

const spec = source?.dataset.mount;
if (source && spec) {
  const place = (): void => {
    const mount = resolveMount(spec, document);
    if (!mount) return;
    const widget = document.createElement('pagemoji-reactions');
    for (const name of ['emojis', 'page', 'variant', 'label'] as const) {
      const value = source.dataset[name];
      if (value) widget.setAttribute(name, value);
    }
    mount.target[mount.where](widget);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
  else place();
}

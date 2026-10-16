# Pagemoji

Emoji reactions for any web page: Ghost, WordPress, a static site generator or plain HTML. Pick up to five emojis, paste two lines of HTML, and readers react with a click. No account, no cookies, no tracking.

Use the free hosted server at `pagemoji.magicpages.co`, or run your own.

## Embed

```html
<script src="https://pagemoji.magicpages.co/v1/pagemoji.js" defer></script>
<pagemoji-reactions emojis="❤️ 👏 💡"></pagemoji-reactions>
```

| Attribute  | Default                             |                                                                  |
| ---------- | ----------------------------------- | ---------------------------------------------------------------- |
| `emojis`   | `❤️ 👏 💡`                          | One to five emojis, separated by spaces.                         |
| `label`    |                                     | Text before the buttons, e.g. `What did you think?`              |
| `variant`  | `soft`                              | `soft`, `outline` or `plain`. See [Styling](#styling).           |
| `page`     |                                     | A stable page ID, such as a post ID. Counts survive URL changes. |
| `url`      | canonical URL, else the current URL | The page to count reactions for, when `page` isn't set.          |
| `readonly` |                                     | Shows counts without buttons.                                    |
| `api`      | where the script came from          | The server, when you bundle the widget yourself.                 |

Pages are identified by host and path. `www.` is ignored; the query string and fragment are never sent.

All widgets on a page load with a single request.

### Only a header or footer field?

The script can place the widget itself. `data-mount` takes `before:`, `after:`, `prepend:` or `append:` and a CSS selector; nothing happens on pages where the selector doesn't match. `data-label` and `data-variant` work like the attributes above.

```html
<script src="https://pagemoji.magicpages.co/v1/pagemoji.js" defer
  data-emojis="❤️ 👏 💡"
  data-label="What did you think?"
  data-mount="after:article"></script>
```

Pick a selector that only matches on posts; your browser's inspector shows which element holds the post body.

## Platforms

### Ghost

Paste the header/footer snippet into **Settings → Code injection → Site footer**, with `data-mount="after:.gh-content"`: `.gh-content` is the post body in Ghost's official themes.

Or edit your theme to key counts by post ID, so they survive slug changes. In `post.hbs`, inside the `{{#post}}` block (where `{{content}}` is):

```handlebars
<pagemoji-reactions page="{{id}}" label="What did you think?" emojis="❤️ 👏 💡"></pagemoji-reactions>
```

And read-only on post cards, inside `{{#foreach posts}}`:

```handlebars
<pagemoji-reactions page="{{id}}" emojis="❤️ 👏 💡" readonly></pagemoji-reactions>
```

Outside those blocks `{{id}}` is empty, the widget falls back to the URL, and the post and its cards count separately.

### WordPress

With a header/footer plugin, use the snippet with `data-mount="after:.entry-content"`, the post body in most themes.

Or, in a classic theme's `single.php`, inside the loop:

```php
<pagemoji-reactions page="<?php the_ID(); ?>" emojis="❤️ 👏 💡"></pagemoji-reactions>
```

### Static sites

In Hugo, Eleventy, Astro, Jekyll and the like, add the script and element to your post layout. Counts are keyed by URL; if you rename posts, pass something stable from the front matter as `page`.

## Styling

The widget takes its colours from your text colour, so it fits light and dark themes without any configuration. Pressed buttons use `--pagemoji-accent`, which falls back to Ghost's `--ghost-accent-color` and then to the text colour.

Three variants: `soft` (filled, the default), `outline` and `plain` (no chrome until hovered or pressed).

Fine-tune with custom properties. Each one is optional; the defaults are shown.

```css
pagemoji-reactions {
  --pagemoji-accent: var(--ghost-accent-color, currentColor);
  --pagemoji-fg: inherit;
  --pagemoji-font-size: 0.9375rem;
  --pagemoji-gap: 0.5rem;
  --pagemoji-justify: flex-start; /* center, flex-end */
  --pagemoji-radius: 999px;
  --pagemoji-padding: 0.3em 0.75em;
  --pagemoji-bg: color-mix(in srgb, currentColor 5%, transparent);
  --pagemoji-bg-hover: color-mix(in srgb, currentColor 10%, transparent);
  --pagemoji-bg-active: color-mix(in srgb, var(--pagemoji-accent) 14%, transparent);
  --pagemoji-border: color-mix(in srgb, currentColor 14%, transparent);
  --pagemoji-border-active: color-mix(in srgb, var(--pagemoji-accent) 60%, transparent);
}
```

For anything else, style the parts directly:

```css
pagemoji-reactions::part(label) { font-style: italic; }
pagemoji-reactions::part(button) { box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
pagemoji-reactions::part(pressed) { font-weight: 600; }
pagemoji-reactions::part(emoji) { font-size: 1.4em; }
pagemoji-reactions::part(count) { opacity: 0.8; }
```

`list` wraps everything; `item` is an entry of a read-only widget.

Animations play only when the reader reacts, and are switched off for readers who ask their system for reduced motion.

## Privacy

- Nothing is stored on the reader's device: no cookies, no `localStorage`, nothing. Reactions don't survive a reload because there is nowhere to keep them.
- Requests carry no cookies and no referrer, only the page, the emoji and whether it was added or removed.
- The database holds one thing: a count per page and emoji.
- Rate limiting and the one-reaction-per-reader rule run in memory, on an HMAC of the IP address under a random key. The key is replaced every hour, together with everything recorded under it. IP addresses are never stored or logged.
- The widget loads nothing from third parties.

Pagemoji stores nothing on the reader's device, so there is nothing for a cookie banner to ask about.

## Self-hosting

```yaml
services:
  pagemoji:
    image: ghcr.io/magicpages/pagemoji:latest
    ports:
      - '3000:3000'
    environment:
      ALLOWED_ORIGINS: https://example.com,https://blog.example.com
    volumes:
      - pagemoji:/data
    restart: unless-stopped

volumes:
  pagemoji:
```

Then load the script from your own server: `https://pagemoji.example.com/v1/pagemoji.js`.

| Variable             | Default                          |                                                                                                                                      |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`               | `3000`                           |                                                                                                                                      |
| `DATABASE_PATH`      | `/data/pagemoji.db` in the image | SQLite file.                                                                                                                         |
| `ALLOWED_ORIGINS`    | `*`                              | Comma-separated origins allowed to use the server.                                                                                   |
| `TRUST_PROXY_HEADER` |                                  | Header with the client IP behind a reverse proxy, e.g. `X-Forwarded-For`. The last address is used, so your proxy must append to it. |

Run a single instance: the rate limits live in memory.

## API

|                                      |                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GET /v1/counts?host=&key=…&emoji=…` | Counts for up to 100 page keys and 5 emojis.                                                                      |
| `POST /v1/reactions`                 | `{ url, page?, emoji, action: "add" \| "remove" }`, sent as `text/plain`. The `Origin` must match the URL's host. |
| `GET /v1/pagemoji.js`                | The widget.                                                                                                       |
| `GET /healthz`                       | Health check.                                                                                                     |

Each client gets 60 requests per minute.

## npm

```sh
npm install @magicpages/pagemoji
```

```js
import { definePagemoji } from '@magicpages/pagemoji';
definePagemoji({ api: 'https://pagemoji.magicpages.co' });
```

`@magicpages/pagemoji/embed` validates emoji input and generates embed code, for building your own generator.

## Development

```sh
pnpm install
pnpm build   # the server serves the widget build, so build first
pnpm test
pnpm --filter @magicpages/pagemoji-server start
```

## License

MIT

# Pagemoji

Emoji reactions for any web page. Pick up to five emojis, paste two lines of HTML, and readers react with a click. No account, no cookies, no tracking.

Use the free hosted server at `pagemoji.magicpages.co`, or run your own.

## Embed

```html
<script src="https://pagemoji.magicpages.co/v1/pagemoji.js" defer></script>
<pagemoji-reactions emojis="❤️ 👏 💡"></pagemoji-reactions>
```

| Attribute  | Default                             |                                                                  |
| ---------- | ----------------------------------- | ---------------------------------------------------------------- |
| `emojis`   | `❤️ 👏 💡`                          | One to five emojis, separated by spaces.                         |
| `page`     |                                     | A stable page ID, such as a post ID. Counts survive URL changes. |
| `url`      | canonical URL, else the current URL | The page to count reactions for, when `page` isn't set.          |
| `readonly` |                                     | Shows counts without buttons.                                    |
| `api`      | where the script came from          | The server, when you bundle the widget yourself.                 |

Pages are identified by host and path. `www.` is ignored; the query string and fragment are never sent.

### Only a header or footer field?

The script can place the widget itself. `data-mount` takes `before:`, `after:`, `prepend:` or `append:` and a CSS selector; nothing happens on pages where the selector doesn't match.

```html
<script
  src="https://pagemoji.magicpages.co/v1/pagemoji.js"
  defer
  data-emojis="❤️ 👏 💡"
  data-mount="after:.gh-content"
></script>
```

### Ghost

Paste the snippet above into **Settings → Code injection → Site footer**. `.gh-content` is the post body in Ghost's default themes.

Or, in your theme's `post.hbs`, keyed by post ID so counts survive slug changes:

```handlebars
<pagemoji-reactions page='{{id}}' emojis='❤️ 👏 💡'></pagemoji-reactions>
```

And on post cards, read-only:

```handlebars
<pagemoji-reactions page='{{id}}' emojis='❤️ 👏 💡' readonly></pagemoji-reactions>
```

All widgets on a page load with a single request.

### Styling

The widget inherits your font and text color. Adjust it with CSS custom properties, or style the buttons directly with `::part(button)`:

```css
pagemoji-reactions {
  --pagemoji-gap: 0.5rem;
  --pagemoji-radius: 999px;
  --pagemoji-bg: transparent;
  --pagemoji-bg-active: #fde68a;
  --pagemoji-fg: inherit;
  --pagemoji-font-size: 1rem;
}
```

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

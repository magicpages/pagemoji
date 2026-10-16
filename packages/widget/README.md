# @magicpages/pagemoji

Emoji reactions for any web page. Pick up to five emojis, and readers react with a click. No account, no cookies, no tracking.

This package is the widget. Most sites don't need it: load the script from the free hosted server at `pagemoji.magicpages.co`, or from your own. Embed options, styling, privacy and self-hosting are in the [main README](https://github.com/magicpages/pagemoji#readme).

```html
<script src="https://pagemoji.magicpages.co/v1/pagemoji.js" defer></script>
<pagemoji-reactions emojis="❤️ 👏 💡"></pagemoji-reactions>
```

## Bundling it yourself

```sh
npm install @magicpages/pagemoji
```

```js
import { definePagemoji } from '@magicpages/pagemoji';

definePagemoji({ api: 'https://pagemoji.magicpages.co' });
```

`definePagemoji` registers `<pagemoji-reactions>` and sets the server for widgets without an `api` attribute.

## Generating embed code

`@magicpages/pagemoji/embed` validates emoji input and writes the embed code, for building your own generator:

```js
import { embedCode, parseEmojis } from '@magicpages/pagemoji/embed';

const { emojis } = parseEmojis('❤️ 👏 💡');
embedCode('html', { emojis, server: 'https://pagemoji.magicpages.co' });
```

## License

MIT

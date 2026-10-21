export type Placement = 'before' | 'after' | 'prepend' | 'append';

export interface MountPoint {
  target: Element;
  where: Placement;
}

/** Ghost's `{{body_class}}` and WordPress's `body_class()` mark single posts with these. */
const POST_PAGE = 'body.post-template, body.single-post';
/** And pages with these. */
const PAGE = 'body.page-template, body.page';

/**
 * `.gh-content` is the post body in Ghost's official themes, even on a members-only post that
 * shows only a signup prompt. Elsewhere it's the element with the most paragraphs as direct
 * children, which holds for Ghost's `{{content}}` and WordPress's `the_content()` whatever the
 * theme calls the wrapper. A short post ties with banners and calls to action that hold one
 * paragraph too, so a tie goes to the element in an `<article>`, then in `<main>`.
 */
export function findPostBody(root: Document): Element | null {
  if (!root.querySelector(POST_PAGE)) return root.querySelector(PAGE) ? null : findEntryBody(root);
  const ghost = root.querySelector('.gh-content');
  if (ghost) return ghost;
  const counts = new Map<Element, number>();
  for (const paragraph of root.querySelectorAll('body p')) {
    const parent = paragraph.parentElement;
    if (!parent || parent.closest('header, footer, nav, aside, form')) continue;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  let best: Element | null = null;
  let bestCount = 0;
  let bestLandmark = -1;
  for (const [parent, count] of counts) {
    if (count < bestCount) continue;
    const rank = landmark(parent);
    if (count > bestCount || rank > bestLandmark) {
      best = parent;
      bestCount = count;
      bestLandmark = rank;
    }
  }
  return best;
}

function landmark(element: Element): number {
  if (element.closest('article')) return 2;
  return element.closest('main') ? 1 : 0;
}

/**
 * Pika and other IndieWeb platforms mark a post up as an `.h-entry` with its body in `.e-content`.
 * A single post has exactly one entry with a body: replies nested in it don't count, and lists of
 * posts show several bodies or none.
 */
function findEntryBody(root: Document): Element | null {
  const bodies = [...root.querySelectorAll('.h-entry .e-content')].filter(
    (body) => !body.closest('.h-entry')?.parentElement?.closest('.h-entry'),
  );
  return bodies.length === 1 ? (bodies[0] ?? null) : null;
}

/** `auto`, or `before:`, `after:`, `prepend:` or `append:` and a CSS selector. */
export function resolveMount(spec: string, root: Document): MountPoint | null {
  if (spec === 'auto') {
    // Inside, not after: themes lay the post body out as a grid, and outside it the widget
    // would leave the text column.
    const target = findPostBody(root);
    return target ? { target, where: 'append' } : null;
  }
  const match = spec.match(/^(before|after|prepend|append):(.+)$/);
  if (!match) return null;
  const [, where = '', selector = ''] = match;
  const target = root.querySelector(selector);
  return target && isPlacement(where) ? { target, where } : null;
}

function isPlacement(value: string): value is Placement {
  return value === 'before' || value === 'after' || value === 'prepend' || value === 'append';
}

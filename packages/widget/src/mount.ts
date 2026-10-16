export type Placement = 'before' | 'after' | 'prepend' | 'append';

export interface MountPoint {
  target: Element;
  where: Placement;
}

/** Ghost's `{{body_class}}` and WordPress's `body_class()` mark single posts with these. */
const POST_PAGE = 'body.post-template, body.single-post';

/**
 * `.gh-content` is the post body in Ghost's official themes, even on a members-only post that
 * shows only a signup prompt. Elsewhere it's the element with the most paragraphs as direct
 * children, which holds for Ghost's `{{content}}` and WordPress's `the_content()` whatever the
 * theme calls the wrapper.
 */
export function findPostBody(root: Document): Element | null {
  if (!root.querySelector(POST_PAGE)) return null;
  const ghost = root.querySelector('.gh-content');
  if (ghost) return ghost;
  const counts = new Map<Element, number>();
  let best: Element | null = null;
  let bestCount = 0;
  for (const paragraph of root.querySelectorAll('body p')) {
    const parent = paragraph.parentElement;
    if (!parent || parent.closest('header, footer, nav, aside, form')) continue;
    const count = (counts.get(parent) ?? 0) + 1;
    counts.set(parent, count);
    if (count > bestCount) {
      best = parent;
      bestCount = count;
    }
  }
  return best;
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

import { describe, expect, it } from 'vitest';
import { resolveMount } from './mount.js';

function page(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const paragraphs = (count: number) => '<p>Text.</p>'.repeat(count);

describe('resolveMount', () => {
  it('appends to the post body in a Ghost official theme', () => {
    const doc = page(`<body class="post-template">
      <article><header><p class="excerpt">Excerpt.</p></header>
        <section class="gh-content">${paragraphs(4)}</section></article>
      <footer>${paragraphs(6)}</footer></body>`);

    expect(resolveMount('auto', doc)).toEqual({
      target: doc.querySelector('.gh-content'),
      where: 'append',
    });
  });

  it('uses .gh-content on a members-only post that shows only a signup prompt', () => {
    const doc = page(`<body class="post-template">
      <div class="gh-content"><section class="cta"><h2>Subscribe</h2></section></div>
      <div class="related">${paragraphs(3)}</div></body>`);

    expect(resolveMount('auto', doc)?.target).toBe(doc.querySelector('.gh-content'));
  });

  it('finds the post body in a custom Ghost theme without .gh-content', () => {
    const doc = page(`<body class="post-template tag-blog">
      <article class="prose">${paragraphs(3)}<figure class="kg-card"></figure>${paragraphs(2)}</article>
      <section><article>${paragraphs(1)}</article><article>${paragraphs(1)}</article></section></body>`);

    expect(resolveMount('auto', doc)?.target).toBe(doc.querySelector('article.prose'));
  });

  it('finds the post body on a WordPress single post', () => {
    const doc = page(`<body class="post-template-default single single-post">
      <div class="entry-content">${paragraphs(3)}</div><aside>${paragraphs(5)}</aside></body>`);

    expect(resolveMount('auto', doc)?.target).toBe(doc.querySelector('.entry-content'));
  });

  it('finds a one-paragraph post body among banners and calls to action', () => {
    const doc = page(`<body class="post-template">
      <div class="announcement">${paragraphs(1)}<button>Close</button></div>
      <main><div class="cta">${paragraphs(1)}</div>
        <article class="prose">${paragraphs(1)}<figure class="kg-card"></figure></article>
        <div class="comments"><h2>Feedback?</h2>${paragraphs(1)}</div></main></body>`);

    expect(resolveMount('auto', doc)?.target).toBe(doc.querySelector('article.prose'));
  });

  it('stays out of pages, home and tag archives', () => {
    for (const bodyClass of ['page-template', 'home-template', 'tag-template', '']) {
      const doc = page(
        `<body class="${bodyClass}"><div class="gh-content">${paragraphs(3)}</div></body>`,
      );
      expect(resolveMount('auto', doc)).toBeNull();
    }
  });

  it('places the widget at an explicit selector, and only where it matches', () => {
    const doc = page('<body><div class="post"></div></body>');

    expect(resolveMount('prepend:.post', doc)).toEqual({
      target: doc.querySelector('.post'),
      where: 'prepend',
    });
    expect(resolveMount('after:.gh-content', doc)).toBeNull();
    expect(resolveMount('below:.post', doc)).toBeNull();
  });
});

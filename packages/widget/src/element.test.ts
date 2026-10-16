import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePagemoji } from './element.js';

definePagemoji({ api: 'https://pagemoji.test' });

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mount(html: string): HTMLElement[] {
  document.body.innerHTML = html;
  return [...document.querySelectorAll<HTMLElement>('pagemoji-reactions')];
}

function buttons(widget: HTMLElement): HTMLButtonElement[] {
  return [...(widget.shadowRoot?.querySelectorAll('button') ?? [])];
}

function text(widget: HTMLElement): string[] {
  return [...(widget.shadowRoot?.querySelectorAll<HTMLElement>('.r > *') ?? [])]
    .filter((item) => !item.hidden)
    .map((item) => item.textContent ?? '');
}

function requestUrl(call = 0): URL {
  return new URL(String(fetchMock.mock.calls[call]?.[0]));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('<pagemoji-reactions>', () => {
  it('loads every widget on the page with one request, without cookies or referrer', async () => {
    fetchMock.mockResolvedValue(json({ counts: { 'id:a': { '❤️': 3 }, 'id:b': { '👏': 1200 } } }));
    const [first, second] = mount(`
      <pagemoji-reactions page="a" emojis="❤️ 👏" readonly></pagemoji-reactions>
      <pagemoji-reactions page="b" emojis="❤️ 👏" readonly></pagemoji-reactions>
    `);

    await vi.waitFor(() => expect(first && text(first)).toEqual(['❤️3']));
    expect(second && text(second)).toEqual(['👏1.2K']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl().searchParams.getAll('key')).toEqual(['id:a', 'id:b']);
    expect(requestUrl().searchParams.get('host')).toBe('example.com');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'strict-origin',
    });
  });

  it('sends the path without query or fragment, ignoring a canonical URL on another host', async () => {
    document.head.innerHTML = '<link rel="canonical" href="https://original.example/elsewhere">';
    fetchMock.mockResolvedValue(json({ counts: { '/blog/post': {} } }));
    mount('<pagemoji-reactions></pagemoji-reactions>');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestUrl().searchParams.getAll('key')).toEqual(['/blog/post']);
    expect(requestUrl().searchParams.getAll('emoji')).toEqual(['❤️', '👏', '💡']);
  });

  it('uses a canonical URL on the same site', async () => {
    document.head.innerHTML = '<link rel="canonical" href="https://example.com/canonical/">';
    fetchMock.mockResolvedValue(json({ counts: { '/canonical': {} } }));
    mount('<pagemoji-reactions></pagemoji-reactions>');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestUrl().searchParams.getAll('key')).toEqual(['/canonical']);
  });

  it('shows a reaction straight away and keeps the server’s counts', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ counts: { '/blog/post': { '❤️': 1 } } }))
      .mockResolvedValueOnce(json({ key: '/blog/post', applied: true, counts: { '❤️': 5 } }));
    const [widget] = mount('<pagemoji-reactions emojis="❤️"></pagemoji-reactions>');
    if (!widget) throw new Error('no widget');
    await vi.waitFor(() => expect(buttons(widget)).toHaveLength(1));
    const [button] = buttons(widget);

    button?.click();
    expect(button?.textContent).toBe('❤️2');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    await vi.waitFor(() => expect(button?.textContent).toBe('❤️5'));

    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(String(url)).toBe('https://pagemoji.test/v1/reactions');
    expect(JSON.parse(String(init?.body))).toEqual({
      url: 'https://www.example.com/blog/post/',
      emoji: '❤️',
      action: 'add',
    });
  });

  it('rolls a reaction back when the server refuses it', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ counts: { '/blog/post': { '❤️': 1 } } }))
      .mockResolvedValueOnce(json({ error: 'Too many requests.' }, 429));
    const [widget] = mount('<pagemoji-reactions emojis="❤️"></pagemoji-reactions>');
    if (!widget) throw new Error('no widget');
    await vi.waitFor(() => expect(buttons(widget)).toHaveLength(1));
    const [button] = buttons(widget);

    button?.click();
    await vi.waitFor(() => expect(button?.getAttribute('aria-pressed')).toBe('false'));
    expect(button?.textContent).toBe('❤️1');
  });

  it('renders nothing when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const [widget] = mount('<pagemoji-reactions></pagemoji-reactions>');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(widget?.shadowRoot?.childNodes).toHaveLength(0);
  });
});

import {afterEach, describe, expect, it, vi} from 'vitest';
import {classifyHref, installLinkInterceptor} from './links';

describe('classifyHref', () => {
  it('sends web and mail links to the system browser', () => {
    expect(classifyHref('https://status.acme.example/history')).toEqual({kind: 'external', url: 'https://status.acme.example/history'});
    expect(classifyHref('mailto:ops@acme.example')).toEqual({kind: 'external', url: 'mailto:ops@acme.example'});
  });

  it('treats file paths and relative references as local files', () => {
    expect(classifyHref('C:\\work\\acme\\a.md')).toEqual({kind: 'local', path: 'C:\\work\\acme\\a.md'});
    expect(classifyHref('\\\\server\\share\\a.md')).toEqual({kind: 'local', path: '\\\\server\\share\\a.md'});
    expect(classifyHref('runbooks/escalation%20policy.md#top')).toEqual({kind: 'local', path: 'runbooks/escalation policy.md'});
    expect(classifyHref('file:///C:/work/a.md')).toEqual({kind: 'local', path: 'C:\\work\\a.md'});
  });

  it('keeps in-page anchors and blocks everything else', () => {
    expect(classifyHref('#notes')).toEqual({kind: 'anchor', id: 'notes'});
    expect(classifyHref('javascript:alert(1)').kind).toBe('blocked');
    expect(classifyHref('data:text/html,hi').kind).toBe('blocked');
    expect(classifyHref('').kind).toBe('blocked');
  });
});

describe('installLinkInterceptor', () => {
  let uninstall = () => {};
  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function setup() {
    const handlers = {openExternal: vi.fn(), openLocal: vi.fn(), blocked: vi.fn()};
    uninstall = installLinkInterceptor(handlers);
    return handlers;
  }
  function click(href: string, init: MouseEventInit = {}) {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.innerHTML = '<span>label</span>';
    document.body.appendChild(a);
    const event = new MouseEvent('click', {bubbles: true, cancelable: true, button: 0, ...init});
    a.querySelector('span')!.dispatchEvent(event);
    return event;
  }

  it('opens web links outside the app window and never navigates', () => {
    const handlers = setup();
    const event = click('https://example.com/a');
    expect(event.defaultPrevented).toBe(true);
    expect(handlers.openExternal).toHaveBeenCalledWith('https://example.com/a');
  });

  it('opens local files in Files, or the system app with Ctrl', () => {
    const handlers = setup();
    click('reports/q3.md');
    click('reports/q3.md', {ctrlKey: true});
    expect(handlers.openLocal.mock.calls).toEqual([['reports/q3.md', {system: false}], ['reports/q3.md', {system: true}]]);
  });

  it('blocks unsafe schemes and routes window.open', () => {
    const handlers = setup();
    expect(click('javascript:void(0)').defaultPrevented).toBe(true);
    expect(handlers.blocked).toHaveBeenCalled();
    window.open('https://example.org');
    expect(handlers.openExternal).toHaveBeenCalledWith('https://example.org/');
  });

  it('restores window.open when removed', () => {
    const original = window.open;
    setup();
    expect(window.open).not.toBe(original);
    uninstall();
    uninstall = () => {};
    expect(window.open).toBe(original);
  });
});

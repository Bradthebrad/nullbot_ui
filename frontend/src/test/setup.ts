// jsdom gaps the app relies on.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = (() => {}) as any;
if (!(globalThis as any).CSS) (globalThis as any).CSS = {escape: (value: string) => value.replace(/["\\]/g, '\\$&')};

export function cleanFetch(...args: Parameters<typeof fetch>): Promise<Response> {
  if (!(window as any).__cleanFetch) {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    (window as any).__cleanFetch = iframe.contentWindow!.fetch;
  }
  return (window as any).__cleanFetch.apply(window, args);
}

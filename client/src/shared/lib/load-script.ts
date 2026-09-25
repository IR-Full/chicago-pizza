/**
 * Loads a third-party script once, however many components ask for it.
 *
 * Two pickers on one page — or one remounted by a filter change — must not
 * each append a copy of the map bundle. The promise is cached per URL, so the
 * second caller waits on the first one's load event instead of starting
 * another download.
 */
const loading = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('loadScript is browser-only'));
  }

  const cached = loading.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    // A previous page in the same session may already have added it.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = existing ?? document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', () => {
      // Forget the failure so a later attempt can retry rather than inherit
      // a permanently rejected promise.
      loading.delete(src);
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    });

    if (!existing) document.head.appendChild(script);
  });

  loading.set(src, promise);
  return promise;
}

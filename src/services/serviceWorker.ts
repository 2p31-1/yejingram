export async function ensureAppServiceWorkerRegistered(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const hasSw = regs.some((r) => {
            const scriptUrls = [r.active?.scriptURL, r.installing?.scriptURL, r.waiting?.scriptURL].filter(Boolean) as string[];
            return scriptUrls.some((u) => u.endsWith('/sw-cache.js'));
        });

        if (!hasSw) {
            await navigator.serviceWorker.register('/sw-cache.js');
        }
    } catch {
        // Ignore registration failures (e.g., unsupported context or blocked SW).
    }
}

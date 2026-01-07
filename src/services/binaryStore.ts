import localforage from 'localforage';

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

const memoryStore = new Map<string, Blob>();

const binaryInstance = isBrowser
    ? localforage.createInstance({
        name: 'yejingram',
        storeName: 'binary',
    })
    : null;

export type StoredBinaryRef = {
    storageKey: string;
    mimeType: string;
    name?: string;
};

export function isStoredBinaryRef(value: unknown): value is StoredBinaryRef {
    return !!value && typeof value === 'object' && typeof (value as any).storageKey === 'string';
}

export async function blobToBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return base64FromUint8Array(bytes);
}

export async function blobToDataUrl(blob: Blob, mimeType?: string): Promise<string> {
    const base64 = await blobToBase64(blob);
    const type = mimeType || blob.type || 'application/octet-stream';
    return `data:${type};base64,${base64}`;
}

function base64FromUint8Array(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    // btoa expects a binary string
    return typeof btoa !== 'undefined'
        ? btoa(binary)
        : Buffer.from(binary, 'binary').toString('base64');
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    // fetch(data:) works in browsers and is robust for large payloads.
    if (!isBrowser) {
        // Minimal non-browser fallback for tests/SSR: decode base64 portion.
        const comma = dataUrl.indexOf(',');
        if (comma === -1) throw new Error('Invalid dataUrl');
        const meta = dataUrl.slice(0, comma);
        const base64 = dataUrl.slice(comma + 1);
        const mimeMatch = /data:([^;]+);base64/i.exec(meta);
        const mimeType = mimeMatch?.[1] || 'application/octet-stream';
        const buf = Buffer.from(base64, 'base64');
        return new Blob([buf], { type: mimeType });
    }

    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        throw new Error('Expected data: URL');
    }

    try {
        const res = await fetch(dataUrl);
        return await res.blob();
    } catch {
        // Fallback: decode manually (some environments can throw "Failed to fetch" for large/odd data URLs)
        const comma = dataUrl.indexOf(',');
        if (comma === -1) throw new Error('Invalid dataUrl');

        const meta = dataUrl.slice(0, comma);
        const dataPart = dataUrl.slice(comma + 1);
        const mimeMatch = /^data:([^;,]+)/i.exec(meta);
        const mimeType = mimeMatch?.[1] || 'application/octet-stream';
        const isBase64 = /;base64/i.test(meta);

        if (isBase64) {
            const binary = atob(dataPart);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new Blob([bytes], { type: mimeType });
        }

        const decoded = decodeURIComponent(dataPart);
        return new Blob([decoded], { type: mimeType });
    }
}

export async function saveBlob(storageKey: string, blob: Blob): Promise<void> {
    if (!isBrowser || !binaryInstance) {
        memoryStore.set(storageKey, blob);
        return;
    }
    await binaryInstance.setItem(storageKey, blob);
}

export function base64ToBlob(base64: string, mimeType = 'application/octet-stream'): Blob {
    // Note: decoding base64 inherently creates bytes in memory; avoid creating data: URLs.
    if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(base64, 'base64');
        return new Blob([buf], { type: mimeType });
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
}

export async function saveBase64(storageKey: string, base64: string, mimeType?: string): Promise<void> {
    await saveBlob(storageKey, base64ToBlob(base64, mimeType || 'application/octet-stream'));
}

export async function getBlob(storageKey: string): Promise<Blob | null> {
    if (!isBrowser || !binaryInstance) {
        return memoryStore.get(storageKey) ?? null;
    }
    const item = await binaryInstance.getItem(storageKey);
    if (!item) return null;
    return item as Blob;
}

export async function deleteBlob(storageKey: string): Promise<void> {
    if (!isBrowser || !binaryInstance) {
        memoryStore.delete(storageKey);
        return;
    }
    await binaryInstance.removeItem(storageKey);
}

export async function clearAllBinaries(): Promise<void> {
    if (!isBrowser || !binaryInstance) {
        memoryStore.clear();
        return;
    }
    await binaryInstance.clear();
}

export async function getBase64(storageKey: string): Promise<{ mimeType: string; base64: string } | null> {
    const blob = await getBlob(storageKey);
    if (!blob) return null;

    const buf = await blob.arrayBuffer();
    const base64 = base64FromUint8Array(new Uint8Array(buf));
    return { mimeType: blob.type || 'application/octet-stream', base64 };
}

export async function getDataUrl(storageKey: string): Promise<string | null> {
    const res = await getBase64(storageKey);
    if (!res) return null;
    return `data:${res.mimeType};base64,${res.base64}`;
}

export async function resolveDataUrlFromRef(ref: string | StoredBinaryRef | null | undefined): Promise<string | null> {
    if (!ref) return null;
    if (typeof ref === 'string') return ref;
    if (!ref.storageKey) return null;
    return await getDataUrl(ref.storageKey);
}

export function makeMessageBinaryKey(messageId: string): string {
    return `msgfile:${messageId}`;
}

export function makeStickerBinaryKey(stickerId: string): string {
    return `sticker:${stickerId}`;
}

export function makeAvatarBinaryKey(avatarId: string | number): string {
    return `avatar:${avatarId}`;
}

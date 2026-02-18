import { extractBasicCharacterInfo } from './risuai/risuCharacterCard';
import { decodeText } from './imageStego';
import { newCharacterDefault, type Character, type PersonaChatAppCharacterCard } from '../entities/character/types';
import { dataUrlToBlob, isStoredBinaryRef, makeAvatarBinaryKey, makeStickerBinaryKey, saveBlob, type StoredBinaryRef } from '../services/binaryStore';
import { nanoid } from '@reduxjs/toolkit';

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

type CleanPngOptions = {
    /** If provided, draws an opaque background first (helps remove alpha-channel stego/noise). */
    opaqueBackground?: string;
};

function isPngFile(file: File): boolean {
    return file.type === 'image/png' || /\.png$/i.test(file.name);
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
    return await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), type);
    });
}

/**
 * Re-encodes an image File into a clean PNG blob.
 * This strips PNG trailers/custom chunks used for character cards.
 */
async function rasterizeToCleanPngBlob(file: File, options?: CleanPngOptions): Promise<Blob | null> {
    if (!isBrowser) return null;
    if (!(file instanceof Blob)) return null;

    const objectUrl = URL.createObjectURL(file);
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Prefer createImageBitmap when available.
        if (typeof createImageBitmap !== 'undefined') {
            const bitmap = await createImageBitmap(file);
            try {
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                if (options?.opaqueBackground) {
                    ctx.fillStyle = options.opaqueBackground;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                ctx.drawImage(bitmap, 0, 0);
            } finally {
                bitmap.close?.();
            }
        } else {
            // Fallback: HTMLImageElement decode
            const img = new Image();
            const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'));
                img.src = objectUrl;
            });
            canvas.width = loaded.width;
            canvas.height = loaded.height;
            if (options?.opaqueBackground) {
                ctx.fillStyle = options.opaqueBackground;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.drawImage(loaded, 0, 0);
        }

        const blob = await canvasToBlob(canvas, 'image/png');
        if (blob) return blob;

        // Rare fallback when toBlob returns null.
        const dataUrl = canvas.toDataURL('image/png');
        return await dataUrlToBlob(dataUrl);
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

/**
 * UI/Import 공용: 아바타로 저장하기 전에 PNG를 "픽셀만" 남도록 재인코딩합니다.
 * - 카드 PNG(ccv3/chara/png-trailer)처럼 메타데이터/트레일러가 붙은 경우 용량 폭증을 막습니다.
 * - PNG가 아니거나 브라우저가 아니면 원본 File을 그대로 반환합니다.
 */
export async function sanitizeAvatarImageForStorage(
    file: File,
    options?: { opaqueBackground?: string }
): Promise<{ blob: Blob; suggestedName: string } | null> {
    if (!isBrowser) return null;
    if (!file) return null;

    if (!isPngFile(file)) {
        // JPEG/WEBP 등은 별도 메타가 크게 붙는 케이스가 드물고,
        // import/export 카드 포맷은 PNG 중심이라 그대로 저장.
        return { blob: file, suggestedName: file.name };
    }

    const cleaned = await rasterizeToCleanPngBlob(file, options);
    if (!cleaned) {
        return { blob: file, suggestedName: file.name };
    }

    const suggestedName = file.name && /\.png$/i.test(file.name)
        ? file.name
        : `${file.name || 'avatar'}.png`;
    return { blob: cleaned, suggestedName };
}

type CharacterImportDraft = Omit<Character, 'avatar' | 'stickers'> & {
    avatar: StoredBinaryRef | string | Blob | null;
    stickers: any[];
};

function mimeTypeFromDataUrl(dataUrl: string): string {
    try {
        return dataUrl.split(',')[0].split(':')[1].split(';')[0] || 'application/octet-stream';
    } catch {
        return 'application/octet-stream';
    }
}

async function persistImportedBinaries(character: CharacterImportDraft): Promise<Character> {
    // Avatar
    let avatar: StoredBinaryRef | null;
    const rawAvatar = character.avatar;
    if (rawAvatar instanceof Blob) {
        const storageKey = makeAvatarBinaryKey(nanoid());
        await saveBlob(storageKey, rawAvatar);
        avatar = { storageKey, mimeType: rawAvatar.type || 'application/octet-stream' };
    } else if (typeof rawAvatar === 'string' && rawAvatar.startsWith('data:')) {
        const storageKey = makeAvatarBinaryKey(nanoid());
        await saveBlob(storageKey, await dataUrlToBlob(rawAvatar));
        avatar = { storageKey, mimeType: mimeTypeFromDataUrl(rawAvatar) };
    } else if (isStoredBinaryRef(rawAvatar)) {
        avatar = rawAvatar;
    } else {
        avatar = null;
    }

    // Stickers
    const stickers = (await Promise.all((character.stickers ?? []).map(async (sticker) => {
        const id = String((sticker as any)?.id || nanoid());
        const name = String((sticker as any)?.name || '');

        const existingStorageKey = (sticker as any)?.storageKey;
        const existingMimeType = (sticker as any)?.mimeType;
        if (typeof existingStorageKey === 'string') {
            return {
                id,
                name,
                storageKey: existingStorageKey,
                mimeType: typeof existingMimeType === 'string' ? existingMimeType : 'application/octet-stream',
            };
        }

        const data = (sticker as any)?.data;
        if (typeof data === 'string' && data.startsWith('data:')) {
            const storageKey = makeStickerBinaryKey(id);
            await saveBlob(storageKey, await dataUrlToBlob(data));
            return { id, name, storageKey, mimeType: mimeTypeFromDataUrl(data) };
        }

        return null;
    }))).filter((v): v is NonNullable<typeof v> => v != null);

    return {
        ...(character as any),
        avatar,
        stickers
    } as Character;
}

const personaCardToCharacter = (card: PersonaChatAppCharacterCard, avatarBlob: Blob | null): CharacterImportDraft => {
    const { name, prompt, responseTime, thinkingTime, reactivity, tone, proactiveEnabled } = card;

    return {
        id: Date.now(),
        name,
        prompt,
        responseTime: parseInt(responseTime, 10),
        thinkingTime: parseInt(thinkingTime, 10),
        reactivity: parseInt(reactivity, 10),
        tone: parseInt(tone, 10),
        proactiveEnabled,
        avatar: avatarBlob,
        messageCountSinceLastSummary: 0,
        media: [],
        stickers: [],
    };
};

export type ImportCharacterResult =
    | { success: true; character: Character }
    | { success: false; error: 'invalidFormat' | 'noCharacterData' | 'importFailed' };

/**
 * File 객체에서 캐릭터를 import합니다.
 */
export async function importCharacterFromFile(file: File): Promise<ImportCharacterResult> {
    // 1) 우선 extractBasicCharacterInfo로 시도 (PNG/JSON/CHARX/JPEG 지원)
    try {
        const info = await extractBasicCharacterInfo({ name: file.name, data: file });
        if (info) {
            const promptParts: string[] = [];
            if (info.description) promptParts.push(info.description);
            if (info.personality) promptParts.push(`personality: ${info.personality}`);
            if (info.scenario) promptParts.push(`scenario: ${info.scenario}`);

            const characterFromCard: CharacterImportDraft = {
                ...newCharacterDefault,
                id: Date.now(),
                name: info.name || '',
                prompt: promptParts.join('\n\n'),
                // PNG 카드의 경우 avatarDataUrl이 "파일 전체"(메타 포함)일 수 있으므로,
                // 가능한 경우 픽셀만 남도록 깨끗한 PNG로 다시 인코딩해 저장합니다.
                avatar: (isPngFile(file)
                    ? (await rasterizeToCleanPngBlob(file)) ?? (info.avatarDataUrl ?? null)
                    : (info.avatarDataUrl ?? null)),
                lorebook: info.lorebook ?? [],
                stickers: [],
            };

            const persisted = await persistImportedBinaries(characterFromCard);
            return { success: true, character: persisted };
        }
    } catch (err) {
        console.warn('extractBasicCharacterInfo 실패, decodeText로 폴백:', err);
    }

    // 2) 폴백: 기존 PNG 스테가노 방식 (PersonaChatAppCharacterCard/예진그램 png-trailer)
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
        let objectUrl: string | null = null;
        try {
            objectUrl = URL.createObjectURL(file);
            const decodeResult = await decodeText(objectUrl);
            if (!decodeResult.text) {
                return { success: false, error: 'noCharacterData' };
            }

            try {
                let characterFromCard: CharacterImportDraft;
                if (decodeResult.method === "png-trailer") {
                    characterFromCard = JSON.parse(decodeResult.text) as any;
                    if (!Array.isArray(characterFromCard.stickers)) characterFromCard.stickers = [];
                    if (!characterFromCard.avatar) {
                        characterFromCard.avatar = (await rasterizeToCleanPngBlob(file)) ?? null;
                    }
                } else {
                    const jsonData = JSON.parse(decodeResult.text) as PersonaChatAppCharacterCard;
                    if (jsonData.source !== 'PersonaChatAppCharacterCard') {
                        return { success: false, error: 'invalidFormat' };
                    }
                    const cleanAvatar = await rasterizeToCleanPngBlob(file, { opaqueBackground: '#ffffff' });
                    characterFromCard = personaCardToCharacter(jsonData, cleanAvatar ?? file);
                }
                const persisted = await persistImportedBinaries(characterFromCard);
                return { success: true, character: persisted };
            } catch (e) {
                console.error("Failed to parse character card:", e);
                return { success: false, error: 'invalidFormat' };
            }
        } catch (err) {
            console.error(err);
            return { success: false, error: 'importFailed' };
        } finally {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
    }

    return { success: false, error: 'noCharacterData' };
}

/**
 * URL에서 이미지를 다운로드하여 캐릭터를 import합니다.
 * @param url 다운로드할 URL
 * @param defaultFileName 기본 파일명
 * @param onProgress 진행률 콜백 (0-100)
 */
export async function importCharacterFromUrl(
    url: string,
    defaultFileName: string = 'character.png',
    onProgress?: (progress: number) => void
): Promise<ImportCharacterResult> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return { success: false, error: 'importFailed' };
        }

        // Content-Length로 전체 크기 확인
        const contentLength = response.headers.get('Content-Length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;

        let blob: Blob;

        if (total > 0 && response.body && onProgress) {
            // 스트리밍으로 진행률 추적
            const reader = response.body.getReader();
            const chunks: BlobPart[] = [];
            let received = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                received += value.length;

                const progress = Math.round((received / total) * 100);
                onProgress(progress);
            }

            blob = new Blob(chunks);
        } else {
            // 진행률 추적 불가능한 경우 기존 방식 사용
            blob = await response.blob();
            if (onProgress) onProgress(100);
        }

        // 파일 이름 추출 (Content-Disposition 헤더에서 또는 기본값 사용)
        const contentDisposition = response.headers.get('Content-Disposition');
        let fileName = defaultFileName;
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match && match[1]) {
                fileName = match[1].replace(/['"]/g, '');
            }
        }

        // Content-Type 확인
        const contentType = response.headers.get('Content-Type') || 'image/png';

        const file = new File([blob], fileName, { type: contentType });
        return importCharacterFromFile(file);
    } catch (error) {
        console.error('Import from URL error:', error);
        return { success: false, error: 'importFailed' };
    }
}

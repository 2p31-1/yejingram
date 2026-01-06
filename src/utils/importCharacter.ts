import { extractBasicCharacterInfo } from './risuai/risuCharacterCard';
import { decodeText } from './imageStego';
import { newCharacterDefault, type Character, type PersonaChatAppCharacterCard } from '../entities/character/types';
import { isStoredBinaryRef, makeAvatarBinaryKey, makeStickerBinaryKey, saveDataUrl, type StoredBinaryRef } from '../services/binaryStore';
import { nanoid } from '@reduxjs/toolkit';

type CharacterImportDraft = Omit<Character, 'avatar' | 'stickers'> & {
    avatar: StoredBinaryRef | string | null;
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
    const rawAvatar = (character as any).avatar;
    if (typeof rawAvatar === 'string' && rawAvatar.startsWith('data:')) {
        const storageKey = makeAvatarBinaryKey(nanoid());
        await saveDataUrl(storageKey, rawAvatar);
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
            await saveDataUrl(storageKey, data);
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

const personaCardToCharacter = (card: PersonaChatAppCharacterCard, imageUrl: string | null): CharacterImportDraft => {
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
        avatar: imageUrl || null,
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
                avatar: info.avatarDataUrl ?? null,
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
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const decodeResult = await decodeText(dataUrl);
            if (decodeResult.text) {
                try {
                    let characterFromCard: CharacterImportDraft;
                    if (decodeResult.method === "png-trailer") {
                        characterFromCard = JSON.parse(decodeResult.text) as any;
                        if (!Array.isArray(characterFromCard.stickers)) characterFromCard.stickers = [];
                    } else {
                        const jsonData = JSON.parse(decodeResult.text) as PersonaChatAppCharacterCard;
                        if (jsonData.source !== 'PersonaChatAppCharacterCard') {
                            return { success: false, error: 'invalidFormat' };
                        }
                        characterFromCard = personaCardToCharacter(jsonData, dataUrl);
                    }
                    const persisted = await persistImportedBinaries(characterFromCard);
                    return { success: true, character: persisted };
                } catch (e) {
                    console.error("Failed to parse character card:", e);
                    return { success: false, error: 'invalidFormat' };
                }
            } else {
                return { success: false, error: 'noCharacterData' };
            }
        } catch (err) {
            console.error(err);
            return { success: false, error: 'importFailed' };
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

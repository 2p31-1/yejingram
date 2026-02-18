import type { RootState } from '../app/store';

/**
 * Extract all binary storage keys referenced by the Redux state.
 * Safe against partial states and unknown shapes.
 */
export function collectBinaryStorageKeysFromState(state: Partial<RootState> | any): string[] {
    const keys = new Set<string>();

    // Messages: file attachments + sticker messages
    const msgEntities = (state?.messages as any)?.entities as Record<string, any> | undefined;
    if (msgEntities) {
        for (const msg of Object.values(msgEntities)) {
            if (!msg) continue;
            const file = msg.file;
            if (file && typeof file.storageKey === 'string') keys.add(file.storageKey);

            if (msg.type === 'STICKER' && msg.sticker && typeof msg.sticker.storageKey === 'string') {
                keys.add(msg.sticker.storageKey);
            }
        }
    }

    // Characters: avatar + stickers
    const charEntities = (state?.characters as any)?.entities as Record<string, any> | undefined;
    if (charEntities) {
        for (const ch of Object.values(charEntities)) {
            if (!ch) continue;
            const avatar = ch.avatar;
            if (avatar && typeof avatar === 'object' && typeof avatar.storageKey === 'string') {
                keys.add(avatar.storageKey);
            }
            if (Array.isArray(ch.stickers)) {
                for (const st of ch.stickers) {
                    if (st && typeof st.storageKey === 'string') keys.add(st.storageKey);
                }
            }
        }
    }

    return Array.from(keys);
}

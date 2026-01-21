
import type { Sticker } from '../../entities/character/types';
import { Plus, X, Smile } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { charactersActions } from '../../entities/character/slice';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filesToStickers, formatBytes } from '../../utils/sticker';
import { StickerGrid } from '../common/StickerGrid';
import { getBlob, makeStickerBinaryKey, saveBlob } from '../../services/binaryStore';

interface StickerPanelProps {
    characterId: number;
    stickers: Sticker[];
    onSelectSticker: (sticker: Sticker) => void;
    onClose: () => void;
}

export function StickerPanel({ characterId, stickers, onSelectSticker, onClose }: StickerPanelProps) {
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [totalSize, setTotalSize] = useState(0);

    const handleAddStickerClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        const newStickers = await filesToStickers(files);
        for (const sticker of newStickers) {
            const storageKey = makeStickerBinaryKey(sticker.id);
            try {
                await saveBlob(storageKey, sticker.blob);
                const refSticker: Sticker = { id: sticker.id, name: sticker.name, storageKey, mimeType: sticker.mimeType };
                dispatch(charactersActions.addSticker({ characterId, sticker: refSticker }));
            } catch (e) {
                console.warn('Failed to persist sticker binary; skipping sticker', e);
            }
        }
    };

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            let sum = 0;
            for (const sticker of stickers) {
                if (!sticker.storageKey) continue;
                const blob = await getBlob(sticker.storageKey);
                if (blob) sum += blob.size;
            }
            if (!cancelled) setTotalSize(sum);
        })();
        return () => {
            cancelled = true;
        };
    }, [stickers]);

    const handleDeleteSticker = (stickerId: string) => {
        if (confirm(t('main.stickerPanel.deleteConfirm'))) {
            dispatch(charactersActions.deleteSticker({ characterId, stickerId }));
        }
    };

    const handleEditStickerName = (stickerId: string, currentName: string) => {
        const newName = prompt(t('main.stickerPanel.renamePrompt'), currentName);
        if (newName && newName.trim() !== '') {
            dispatch(charactersActions.editStickerName({ characterId, stickerId, newName: newName.trim() }));
        }
    };

    return (
        <div className="absolute bottom-full left-0 mb-2 w-96 h-96 bg-(--color-bg-main) rounded-2xl shadow-xl border border-(--color-border) animate-fadeIn flex flex-col">
            <div className="p-4 border-b border-(--color-border-secondary) flex items-center justify-between shrink-0">
                <h3 className="text-sm font-semibold text-(--color-text-primary)">{t('main.stickerPanel.title')}</h3>
                <div className="flex gap-2">
                    <button onClick={handleAddStickerClick} className="p-2 bg-(--color-button-primary) hover:bg-(--color-button-primary-accent) text-(--color-text-accent) rounded-full transition-colors shadow-sm" title={t('main.stickerPanel.addTitle')}>
                        <Plus className="w-4 h-4" />
                    </button>
                    <button onClick={onClose} className="p-2 bg-(--color-button-secondary) hover:bg-(--color-button-secondary-accent) text-(--color-icon-primary) rounded-full transition-colors" title={t('common.close')}>
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div className="p-4 flex-1 overflow-y-auto flex flex-col">
                <div className="flex items-center justify-between text-xs text-(--color-text-secondary) mb-4 shrink-0">
                    <span>{t('main.stickerPanel.supportedFormats')}</span>
                    <span className="bg-(--color-bg-input-primary) px-2 py-1 rounded-full">{t('main.stickerPanel.count', { count: stickers.length })}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-(--color-text-secondary) mb-4 shrink-0">
                    <span>{t('main.stickerPanel.totalSize', { size: formatBytes(totalSize) })}</span>
                </div>
                {stickers.length === 0 ? (
                    <div className="text-center text-(--color-icon-tertiary) py-8 flex-1 flex flex-col justify-center">
                        <Smile className="w-12 h-12 mx-auto mb-3 text-(--color-icon-primary)/50" />
                        <p className="text-sm font-medium mb-2">{t('main.stickerPanel.emptyTitle')}</p>
                        <button onClick={handleAddStickerClick} className="text-sm text-(--color-button-primary) hover:text-(--color-button-primary-accent) font-medium">{t('main.stickerPanel.emptyCta')}</button>
                    </div>
                ) : (
                    <StickerGrid
                        stickers={stickers}
                        mode="panel"
                        onStickerClick={onSelectSticker}
                        onEdit={handleEditStickerName}
                        onDelete={handleDeleteSticker}
                        gridCols="grid-cols-3"
                        maxHeight="100%"
                    />
                )}
            </div>
            <input type="file" accept="image/jpg,image/gif,image/png,image/bmp,image/webp" ref={fileInputRef} className="hidden" multiple onChange={handleFileChange} />
        </div>
    );
}

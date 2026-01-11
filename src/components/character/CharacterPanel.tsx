import { useSelector, useDispatch } from 'react-redux';
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Upload, Download, ChevronDown } from 'lucide-react';
import { selectEditingCharacterId, selectCharacterById } from '../../entities/character/selectors';
import { charactersActions } from '../../entities/character/slice';
import type { RootState } from '../../app/store';
import { newCharacterDefault, type Character, type PersonaChatAppCharacterCard } from '../../entities/character/types';
import { AttributeSliders } from './AttributeSliders';
import { StickerManager } from './StickerManager';
import { encodeText } from '../../utils/imageStego';
import { LorebookEditor } from './LorebookEditor';
import { importCharacterFromFile, sanitizeAvatarImageForStorage } from '../../utils/importCharacter';
import { blobToDataUrl, deleteBlob, getBlob, getDataUrl, makeAvatarBinaryKey, makeBinaryUrl, resolveDataUrlFromRef, saveBlob } from '../../services/binaryStore';
import { nanoid } from '@reduxjs/toolkit';

const characterToPersonaCard = (character: Character): PersonaChatAppCharacterCard => {
    return {
        name: character.name,
        prompt: character.prompt,
        responseTime: String(character.responseTime),
        thinkingTime: String(character.thinkingTime),
        reactivity: String(character.reactivity),
        tone: String(character.tone),
        source: "PersonaChatAppCharacterCard",
        proactiveEnabled: character.proactiveEnabled,
    };
};

interface CharacterPanelProps {
    onClose: () => void;
}

function CharacterPanel({ onClose }: CharacterPanelProps) {
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const editingId = useSelector(selectEditingCharacterId);
    const editingCharacter = useSelector((state: RootState) => editingId ? selectCharacterById(state, editingId) : null);
    // const proactiveChatEnabled = useSelector((state: RootState) => state.settings.proactiveChatEnabled)

    const [char, setChar] = useState<Character>(newCharacterDefault);
    const [activeTab, setActiveTab] = useState<'basicInfo' | 'lorebook' | 'backup'>('basicInfo');
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [avatarPreviewSrc, setAvatarPreviewSrc] = useState<string | null>(null);

    const isNew = !editingId;

    useEffect(() => {
        if (editingCharacter) {
            setChar(editingCharacter);
        } else {
            setChar(newCharacterDefault);
        }
    }, [editingCharacter]);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            if (!char.avatar) {
                setAvatarPreviewSrc(null);
                return;
            }

            const blob = await getBlob(char.avatar.storageKey);
            if (!blob || cancelled) {
                setAvatarPreviewSrc(null);
                return;
            }
            // Ensure presence/backfill, then use stable URL.
            setAvatarPreviewSrc(makeBinaryUrl(char.avatar.storageKey));
        })();

        return () => {
            cancelled = true;
        };
    }, [char.avatar?.storageKey]);

    const handleSave = async () => {
        if (!char.name) return;

        // Ensure stable id before persisting binaries.
        const id = editingId ?? Date.now();

        const nextAvatar = char.avatar;
        const nextStickers = char.stickers ?? [];

        const charToSave = {
            ...char,
            id,
            avatar: nextAvatar,
            stickers: nextStickers,
        };

        dispatch(charactersActions.upsertOne(charToSave));
        dispatch(charactersActions.resetEditingCharacterId());
        onClose();
    };

    const handleInputChange = (field: keyof Character, value: any) => {
        setChar(prev => ({ ...prev, [field]: value }));
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Best-effort cleanup of previous stored avatar
        if (char.avatar?.storageKey) {
            void deleteBlob(char.avatar.storageKey);
        }

        const storageKey = makeAvatarBinaryKey(nanoid());
        try {
            const sanitized = await sanitizeAvatarImageForStorage(file);
            const blobToSave = sanitized?.blob ?? file;
            const nameToSave = sanitized?.suggestedName ?? file.name;
            await saveBlob(storageKey, blobToSave);
            setChar(prev => ({ ...prev, avatar: { storageKey, mimeType: blobToSave.type || 'application/octet-stream', name: nameToSave } }));
        } catch (e) {
            console.warn('Failed to persist avatar blob; retrying with cloned Blob', e);
            try {
                const sanitized = await sanitizeAvatarImageForStorage(file);
                const blobToSave = sanitized?.blob ?? file;
                const nameToSave = sanitized?.suggestedName ?? file.name;
                const cloned = new Blob([await blobToSave.arrayBuffer()], { type: blobToSave.type || 'application/octet-stream' });
                await saveBlob(storageKey, cloned);
                setChar(prev => ({ ...prev, avatar: { storageKey, mimeType: cloned.type || 'application/octet-stream', name: nameToSave } }));
            } catch (e2) {
                console.warn('Failed to persist avatar blob; aborting avatar update', e2);
            }
        }
    };

    const importPersonaImage = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,.json,.charx";

        input.onchange = async (e: Event) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];
            if (!file) return;

            const result = await importCharacterFromFile(file);
            if (result.success) {
                setChar(result.character);
            } else {
                const errorMessages: Record<typeof result.error, string> = {
                    invalidFormat: t('characterPanel.alerts.invalidCardFormat'),
                    noCharacterData: t('characterPanel.alerts.noContactDataInImage'),
                    importFailed: t('characterPanel.alerts.importFailed'),
                };
                alert(errorMessages[result.error]);
            }
        };

        input.click();
    }

    const exportPersonaImage = async (method: "png-trailer" | "alpha-channel") => {
        if (!char.avatar) {
            alert(t('characterPanel.alerts.missingAvatar'));
            return;
        }

        const avatarBlob = await getBlob(char.avatar.storageKey);
        let avatarDataUrl: string | null = null;
        let avatarObjectUrl: string | null = null;

        try {
            if (avatarBlob) {
                avatarObjectUrl = URL.createObjectURL(avatarBlob);
                avatarDataUrl = await blobToDataUrl(avatarBlob, char.avatar.mimeType);
            } else {
                avatarDataUrl = await resolveDataUrlFromRef(char.avatar);
            }

            if (!avatarDataUrl) {
                alert(t('characterPanel.alerts.missingAvatar'));
                return;
            }

            const stickersForExport = await Promise.all((char.stickers ?? []).map(async (sticker) => {
                const data = await getDataUrl(sticker.storageKey);
                return {
                    id: sticker.id,
                    name: sticker.name,
                    data,
                    type: sticker.mimeType,
                };
            }));

            const exportChar: any = {
                ...char,
                avatar: avatarDataUrl,
                stickers: stickersForExport,
            };

            const dataURL = await encodeText(
                avatarObjectUrl ?? avatarDataUrl,
                JSON.stringify(method === "png-trailer" ? exportChar : characterToPersonaCard(exportChar)),
                method
            );
            const link = document.createElement("a");
            link.href = dataURL;
            link.download = `${char.name || 'character'}_persona.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } finally {
            if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
        }
    };

    return (
        <div className="fixed inset-y-0 right-0 z-40 w-96 max-w-full bg-[var(--color-bg-main)] border-l border-[var(--color-border)] shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)] shrink-0">
                <h3 className="text-xl font-semibold text-[var(--color-text-primary)]">{isNew ? t('characterPanel.titleAdd') : t('characterPanel.titleEdit')}</h3>
            </div>
            <div className="flex border-b border-[var(--color-border)]">
                <button
                    className={`py-3 px-6 text-sm font-medium transition-colors ${activeTab === 'basicInfo' ? 'text-[var(--color-button-primary-accent)] border-b-2 border-[var(--color-focus-border)]' : 'text-[var(--color-icon-tertiary)] hover:text-[var(--color-text-interface)]'}`}
                    onClick={() => setActiveTab('basicInfo')}
                >
                    {t('characterPanel.tabs.basicInfo')}
                </button>
                <button
                    className={`py-3 px-6 text-sm font-medium transition-colors ${activeTab === 'lorebook' ? 'text-[var(--color-button-primary-accent)] border-b-2 border-[var(--color-focus-border)]' : 'text-[var(--color-icon-tertiary)] hover:text-[var(--color-text-interface)]'}`}
                    onClick={() => setActiveTab('lorebook')}
                >
                    {t('characterPanel.tabs.lorebook')}
                </button>
                <button
                    className={`py-3 px-6 text-sm font-medium transition-colors ${activeTab === 'backup' ? 'text-[var(--color-button-primary-accent)] border-b-2 border-[var(--color-focus-border)]' : 'text-[var(--color-icon-tertiary)] hover:text-[var(--color-text-interface)]'}`}
                    onClick={() => setActiveTab('backup')}
                >
                    {t('characterPanel.tabs.backup')}
                </button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
                {activeTab === 'basicInfo' && (
                    <>
                        <div className="flex items-center space-x-4">
                            <div className="w-20 h-20 rounded-full bg-[var(--color-bg-input-primary)] flex items-center justify-center overflow-hidden shrink-0 border-2 border-[var(--color-border)]">
                                {avatarPreviewSrc ? <img src={avatarPreviewSrc} alt="Avatar Preview" className="w-full h-full object-cover" /> : <Image className="w-8 h-8 text-[var(--color-icon-secondary)]" />}
                            </div>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => avatarInputRef.current?.click()} className="py-2 px-4 bg-[var(--color-button-primary)] hover:bg-[var(--color-button-primary-accent)] text-[var(--color-text-accent)] rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
                                    <Image className="w-4 h-4" /> {t('characterPanel.profileImage')}
                                </button>
                                <button onClick={importPersonaImage} className="py-2 px-4 bg-[var(--color-button-secondary)] hover:bg-[var(--color-button-secondary-accent)] text-[var(--color-text-interface)] rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
                                    <Upload className="w-4 h-4" /> {t('characterPanel.importContact')}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-[var(--color-text-interface)] mb-2 block">{t('characterPanel.nameLabel')}</label>
                            <input id="character-name" type="text" placeholder={t('characterPanel.namePlaceholder')} value={char.name} onChange={e => handleInputChange('name', e.target.value)} className="w-full px-4 py-3 bg-[var(--color-bg-input-secondary)] text-[var(--color-text-primary)] rounded-xl border border-[var(--color-border)] focus:ring-2 focus:ring-[var(--color-focus-border)]/50 focus:border-[var(--color-focus-border)] text-sm" />
                        </div>
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-[var(--color-text-interface)]">{t('characterPanel.personInfoLabel')}</label>
                            </div>
                            <textarea id="character-prompt" placeholder={t('characterPanel.personInfoPlaceholder')} value={char.prompt} onChange={e => handleInputChange('prompt', e.target.value)} className="w-full px-4 py-3 bg-[var(--color-bg-input-secondary)] text-[var(--color-text-primary)] rounded-xl border border-[var(--color-border)] focus:ring-2 focus:ring-[var(--color-focus-border)]/50 focus:border-[var(--color-focus-border)] text-sm" rows={6}></textarea>
                        </div>
                        {/* {proactiveChatEnabled && (

                            <Toggle
                                id="character-proactive-toggle"
                                label={t('characterPanel.allowProactive')}
                                checked={char.proactiveEnabled || false}
                                onChange={checked => handleInputChange('proactiveEnabled', checked)}
                                icon={<MessageSquarePlus className="w-4 h-4" />}
                            />

                        )} */}

                        <details className="group/additional border-t border-[var(--color-border)] pt-4">
                            <summary className="flex items-center justify-between cursor-pointer list-none">
                                <span className="text-base font-medium text-[var(--color-text-primary)]">{t('characterPanel.additionalSettings')}</span>
                                <ChevronDown className="w-5 h-5 text-[var(--color-icon-secondary)] transition-transform duration-300 group-open/additional:rotate-180" />
                            </summary>
                            <div className="content-wrapper">
                                <div className="content-inner pt-6 space-y-6">
                                    <details className="group/sticker border-t border-[var(--color-border)] pt-2">
                                        <summary className="flex items-center justify-between cursor-pointer list-none py-2">
                                            <h4 className="text-sm font-medium text-[var(--color-text-interface)]">{t('characterPanel.stickers')}</h4>
                                            <ChevronDown className="w-5 h-5 text-[var(--color-icon-secondary)] transition-transform duration-300 group-open/sticker:rotate-180" />
                                        </summary>
                                        <StickerManager characterId={char.id} draft={char} onDraftChange={setChar} />
                                    </details>
                                    {/* 메모리는 별도 탭으로 이동 */}
                                    <details className="group/attribute border-t border-[var(--color-border)] pt-2">
                                        <summary className="flex items-center justify-between cursor-pointer list-none py-2">
                                            <h4 className="text-sm font-medium text-[var(--color-text-interface)]">{t('characterPanel.messageReactivity')}</h4>
                                            <ChevronDown className="w-5 h-5 text-[var(--color-icon-secondary)] transition-transform duration-300 group-open/attribute:rotate-180" />
                                        </summary>
                                        <AttributeSliders characterId={char.id} draft={char} onDraftChange={setChar} />
                                    </details>
                                </div>
                            </div>
                        </details>
                    </>
                )}
                {activeTab === 'lorebook' && (
                    <div className="space-y-6">
                        <LorebookEditor characterId={char.id} draft={char} onDraftChange={setChar} />
                    </div>
                )}
                {activeTab === 'backup' && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('characterPanel.backupSettings')}</h4>
                        <div className="flex flex-col gap-3">
                            <button onClick={() => exportPersonaImage("alpha-channel")} className="py-3 px-4 bg-[var(--color-button-secondary)] hover:bg-[var(--color-button-secondary-accent)] text-[var(--color-text-interface)] rounded-lg transition-colors text-sm flex items-center justify-center gap-2 border border-[var(--color-border)]">
                                <Download className="w-4 h-4" /> {t('characterPanel.shareArisutalk')}
                            </button>
                            <button onClick={() => exportPersonaImage("png-trailer")} className="py-3 px-4 bg-[var(--color-button-primary)] hover:bg-[var(--color-button-primary-accent)] text-[var(--color-text-accent)] rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
                                <Download className="w-4 h-4" /> {t('characterPanel.shareYejingram')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <div className="p-6 mt-auto border-t border-[var(--color-border)] shrink-0 flex justify-end space-x-3">
                <button onClick={() => { dispatch(charactersActions.resetEditingCharacterId()); onClose(); }} className="flex-1 py-2.5 px-4 bg-[var(--color-button-secondary)] hover:bg-[var(--color-button-secondary-accent)] text-[var(--color-text-interface)] rounded-lg transition-colors">{t('common.cancel')}</button>
                <button onClick={handleSave} className="flex-1 py-2.5 px-4 bg-[var(--color-button-primary)] hover:bg-[var(--color-button-primary-accent)] text-[var(--color-text-accent)] rounded-lg transition-colors">{t('characterPanel.save')}</button>
            </div>
            {/* 숨겨진 파일 입력: 어디서든 아바타 업로드 버튼이 동작하도록 전역 배치 */}
            <input type="file" accept="image/png,image/jpeg" ref={avatarInputRef} onChange={handleAvatarChange} className="hidden" />
        </div>
    );
}

export default CharacterPanel;

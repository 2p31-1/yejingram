import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, X, Sparkles, RefreshCw, CheckCircle2, AlertCircle, Phone, MessageCircle } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { charactersActions } from '../../entities/character/slice';
import { importCharacterFromUrl } from '../../utils/importCharacter';
import type { Character } from '../../entities/character/types';

export interface RealmImportParams {
    realmId: string;
    charname?: string;
}

interface RealmImportModalProps extends RealmImportParams {
    onClose: (character: Character | null) => void;
}

function RealmImportModal({ realmId, charname, onClose }: RealmImportModalProps) {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const [status, setStatus] = useState<'confirm' | 'loading' | 'success' | 'error'>('confirm');
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [imageLoaded, setImageLoaded] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [character, setCharacter] = useState<Character | null>(null);

    const downloadUrl = `https://d3rd8muqzoyvtk.cloudfront.net/realm/${realmId}/download`;
    const thumbnailUrl = `https://dt3lfi1tp9am3.cloudfront.net/${realmId}/${realmId}_thumb.webp`;

    const handleImport = async () => {
        setStatus('loading');
        setErrorMessage('');
        setDownloadProgress(0);

        try {
            const result = await importCharacterFromUrl(
                downloadUrl,
                `realm_${realmId}.png`,
                (progress) => setDownloadProgress(progress)
            );

            if (result.success) {
                const importResult = dispatch(charactersActions.upsertOne(result.character));
                setCharacter(importResult.payload);
                setStatus('success');
            } else {
                const errorMessages: Record<typeof result.error, string> = {
                    invalidFormat: t('realmImport.errors.invalidFormat'),
                    noCharacterData: t('realmImport.errors.noCharacterData'),
                    importFailed: t('realmImport.errors.importFailed'),
                };
                throw new Error(errorMessages[result.error]);
            }
        } catch (error) {
            console.error('Realm import error:', error);
            setStatus('error');
            setErrorMessage(error instanceof Error ? error.message : t('realmImport.errors.unknown'));
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div
                className="bg-linear-to-b from-(--color-bg-main) to-(--color-bg-secondary) rounded-3xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-(--color-border)/50 transform transition-all duration-300 animate-in fade-in zoom-in-95"
            >
                {/* 닫기 버튼 - 플로팅 스타일 */}
                <button
                    onClick={() => onClose(null)}
                    className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-sm transition-all duration-200 group"
                    aria-label={t('common.close')}
                >
                    <X className="w-5 h-5 text-white/80 group-hover:text-white transition-colors" />
                </button>

                {status === 'confirm' && (
                    <>
                        {/* 연락처 카드 스타일 헤더 */}
                        <div className="relative pt-8 pb-4 bg-linear-to-b from-(--color-button-primary)/10 to-transparent">
                            {/* 프로필 이미지 */}
                            <div className="flex flex-col items-center">
                                <div className={`relative w-24 h-24 rounded-full overflow-hidden shadow-xl ring-4 ring-(--color-button-primary)/30 transition-all duration-500 ${imageLoaded ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`}>
                                    <img
                                        src={thumbnailUrl}
                                        alt={t('realmImport.contactPreview')}
                                        className="w-full h-full object-cover"
                                        onLoad={() => setImageLoaded(true)}
                                        onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                            setImageLoaded(true);
                                        }}
                                    />
                                    {!imageLoaded && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-(--color-bg-secondary)">
                                            <Sparkles className="w-8 h-8 text-(--color-button-primary) animate-pulse" />
                                        </div>
                                    )}
                                </div>
                                {/* 이름 표시 */}
                                {charname && (
                                    <h3 className="mt-4 text-xl font-bold text-(--color-text-primary)">
                                        {charname}
                                    </h3>
                                )}
                                {/* 연락처 아이콘 표시 */}
                                <div className="flex gap-4 mt-3">
                                    <div className="flex items-center gap-1.5 text-(--color-text-tertiary) text-sm">
                                        <Phone className="w-4 h-4" />
                                        <span>{t('realmImport.newContact')}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-(--color-text-tertiary) text-sm">
                                        <MessageCircle className="w-4 h-4" />
                                        <span>{t('realmImport.canChat')}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 콘텐츠 섹션 */}
                        <div className="p-6">
                            <div className="text-center mb-6">
                                <p className="text-sm text-(--color-text-secondary) leading-relaxed">
                                    {charname
                                        ? t('realmImport.confirmDescriptionWithName', { name: charname })
                                        : t('realmImport.confirmDescription')}
                                </p>
                            </div>

                            {/* 버튼 그룹 */}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => onClose(null)}
                                    className="flex-1 py-3 px-4 bg-(--color-bg-secondary) hover:bg-(--color-bg-hover) text-(--color-text-secondary) rounded-xl transition-all duration-200 font-medium border border-(--color-border)/50"
                                >
                                    {t('realmImport.block')}
                                </button>
                                <button
                                    onClick={handleImport}
                                    className="flex-1 py-3 px-4 bg-linear-to-r from-(--color-button-primary) to-(--color-button-primary-accent) hover:shadow-lg hover:shadow-(--color-button-primary)/25 text-(--color-text-accent) rounded-xl transition-all duration-200 flex items-center justify-center gap-2 font-medium hover:-translate-y-0.5"
                                >
                                    <UserPlus className="w-4 h-4" />
                                    {t('realmImport.addContact')}
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {status === 'loading' && (
                    <div className="p-8 py-16">
                        <div className="text-center">
                            {/* 프로필 아이콘 */}
                            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-(--color-button-primary)/10 flex items-center justify-center">
                                <UserPlus className="w-8 h-8 text-(--color-button-primary) animate-pulse" />
                            </div>
                            {/* 프로그레스 표시 */}
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-(--color-text-secondary)">
                                        {downloadProgress < 100 ? t('realmImport.syncing') : t('realmImport.processing')}
                                    </span>
                                    <span className="text-sm font-bold text-(--color-button-primary)">
                                        {downloadProgress}%
                                    </span>
                                </div>
                                <div className="w-full h-2 bg-(--color-border)/30 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-linear-to-r from-(--color-button-primary) to-(--color-button-primary-accent) rounded-full transition-all duration-300 ease-out"
                                        style={{ width: `${downloadProgress}%` }}
                                    />
                                </div>
                            </div>
                            <p className="text-(--color-text-primary) font-medium">
                                {t('realmImport.loading')}
                            </p>
                        </div>
                    </div>
                )}

                {status === 'success' && (
                    <div className="p-8 py-12">
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-linear-to-br from-green-400 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/30">
                                <CheckCircle2 className="w-10 h-10 text-white" />
                            </div>
                            <h3 className="text-xl font-bold text-(--color-text-primary) mb-2">
                                {t('realmImport.successTitle')}
                            </h3>
                            <p className="text-(--color-text-secondary) mb-8">
                                {t('realmImport.success')}
                            </p>
                            <button
                                onClick={() => onClose(character)}
                                className="w-full py-3 px-4 bg-linear-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-xl transition-all duration-200 font-medium hover:shadow-lg hover:shadow-green-500/25"
                            >
                                {t('realmImport.startChat')}
                            </button>
                        </div>
                    </div>
                )}

                {status === 'error' && (
                    <div className="p-8 py-12">
                        <div className="text-center">
                            {/* 에러 아이콘 */}
                            <div className="relative w-20 h-20 mx-auto mb-6">
                                <div className="absolute inset-0 rounded-full bg-red-500/10" />
                                <div className="absolute inset-2 rounded-full bg-linear-to-br from-red-400 to-red-600 flex items-center justify-center shadow-lg shadow-red-500/30">
                                    <AlertCircle className="w-10 h-10 text-white" />
                                </div>
                            </div>
                            <h3 className="text-xl font-bold text-(--color-text-primary) mb-2">
                                {t('realmImport.error')}
                            </h3>
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-6">
                                <p className="text-sm text-red-400">
                                    {errorMessage}
                                </p>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => onClose(null)}
                                    className="flex-1 py-3 px-4 bg-(--color-bg-secondary) hover:bg-(--color-bg-hover) text-(--color-text-secondary) rounded-xl transition-all duration-200 font-medium border border-(--color-border)/50"
                                >
                                    {t('common.close')}
                                </button>
                                <button
                                    onClick={handleImport}
                                    className="flex-1 py-3 px-4 bg-linear-to-r from-(--color-button-primary) to-(--color-button-primary-accent) hover:shadow-lg hover:shadow-(--color-button-primary)/25 text-(--color-text-accent) rounded-xl transition-all duration-200 flex items-center justify-center gap-2 font-medium"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    {t('realmImport.retry')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default RealmImportModal;

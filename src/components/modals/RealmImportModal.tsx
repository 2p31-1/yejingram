import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X, Loader2 } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { charactersActions } from '../../entities/character/slice';
import { importCharacterFromUrl } from '../../utils/importCharacter';

interface RealmImportModalProps {
    realmId: string;
    onClose: () => void;
}

function RealmImportModal({ realmId, onClose }: RealmImportModalProps) {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const [status, setStatus] = useState<'confirm' | 'loading' | 'success' | 'error'>('confirm');
    const [errorMessage, setErrorMessage] = useState<string>('');

    const downloadUrl = `https://d3rd8muqzoyvtk.cloudfront.net/realm/${realmId}/download`;

    const handleImport = async () => {
        setStatus('loading');
        setErrorMessage('');

        try {
            const result = await importCharacterFromUrl(downloadUrl, `realm_${realmId}.png`);

            if (result.success) {
                dispatch(charactersActions.upsertOne(result.character));
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-[var(--color-bg-main)] rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden border border-[var(--color-border)]">
                {/* 헤더 */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                        {t('realmImport.title')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-[var(--color-bg-hover)] transition-colors"
                        aria-label={t('common.close')}
                    >
                        <X className="w-5 h-5 text-[var(--color-icon-secondary)]" />
                    </button>
                </div>

                {/* 본문 */}
                <div className="p-6">
                    {status === 'confirm' && (
                        <div className="text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-button-primary)]/10 flex items-center justify-center">
                                <Download className="w-8 h-8 text-[var(--color-button-primary)]" />
                            </div>
                            <p className="text-[var(--color-text-primary)] mb-2">
                                {t('realmImport.confirmMessage')}
                            </p>
                            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                                {t('realmImport.confirmDescription')}
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={onClose}
                                    className="flex-1 py-2.5 px-4 bg-[var(--color-button-secondary)] hover:bg-[var(--color-button-secondary-accent)] text-[var(--color-text-interface)] rounded-lg transition-colors"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={handleImport}
                                    className="flex-1 py-2.5 px-4 bg-[var(--color-button-primary)] hover:bg-[var(--color-button-primary-accent)] text-[var(--color-text-accent)] rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <Download className="w-4 h-4" />
                                    {t('realmImport.download')}
                                </button>
                            </div>
                        </div>
                    )}

                    {status === 'loading' && (
                        <div className="text-center py-8">
                            <Loader2 className="w-12 h-12 mx-auto mb-4 text-[var(--color-button-primary)] animate-spin" />
                            <p className="text-[var(--color-text-primary)]">
                                {t('realmImport.loading')}
                            </p>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
                                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <p className="text-[var(--color-text-primary)] mb-6">
                                {t('realmImport.success')}
                            </p>
                            <button
                                onClick={onClose}
                                className="w-full py-2.5 px-4 bg-[var(--color-button-primary)] hover:bg-[var(--color-button-primary-accent)] text-[var(--color-text-accent)] rounded-lg transition-colors"
                            >
                                {t('common.close')}
                            </button>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                                <X className="w-8 h-8 text-red-500" />
                            </div>
                            <p className="text-[var(--color-text-primary)] mb-2">
                                {t('realmImport.error')}
                            </p>
                            <p className="text-sm text-red-500 mb-6">
                                {errorMessage}
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={onClose}
                                    className="flex-1 py-2.5 px-4 bg-[var(--color-button-secondary)] hover:bg-[var(--color-button-secondary-accent)] text-[var(--color-text-interface)] rounded-lg transition-colors"
                                >
                                    {t('common.close')}
                                </button>
                                <button
                                    onClick={handleImport}
                                    className="flex-1 py-2.5 px-4 bg-[var(--color-button-primary)] hover:bg-[var(--color-button-primary-accent)] text-[var(--color-text-accent)] rounded-lg transition-colors"
                                >
                                    {t('realmImport.retry')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default RealmImportModal;

import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectSyncConflict } from '../../entities/sync/selectors';
import { restoreStateFromServer, backupStateToServer } from '../../utils/backup';
import type { RootState } from '../../app/store';
import { uiActions } from '../../entities/ui/slice';

function SyncConflictModal() {
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const conflict = useSelector(selectSyncConflict);
    const syncSettings = useSelector((state: RootState) => state.settings.syncSettings);

    if (!conflict) return null;

    const handleKeepLocal = async () => {
        dispatch(uiActions.forceShowSyncModal());
        try {
            await backupStateToServer(syncSettings.syncClientId, syncSettings.syncBaseUrl);
        } catch (error) {
            console.error('Failed to resolve conflict (Keep Local):', error);
        }
    };

    const handleApplyServer = async () => {
        dispatch(uiActions.forceShowSyncModal());
        try {
            await restoreStateFromServer(syncSettings.syncClientId, syncSettings.syncBaseUrl, true);
        } catch (error) {
            console.error('Failed to resolve conflict (Apply Server):', error);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg-shadow)]/40 backdrop-blur-[2px] p-4">
            <div
                className="bg-[var(--color-bg-main)] rounded-2xl w-full max-w-md mx-4 shadow-xl border border-[var(--color-border)]"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-[var(--color-border)]">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                            ⚠️ {t('sync.conflict.title', 'Sync Conflict')}
                        </h3>
                    </div>
                </div>
                <div className="p-6 space-y-4">
                    <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
                        {t('sync.conflict.message', 'A sync conflict has occurred. Choose how to resolve it:')}
                    </p>

                    {/* Conflict Information */}
                    <div className="p-4 bg-[var(--color-bg-input-secondary)] rounded-xl border border-[var(--color-border)]">
                        <div className="text-sm space-y-2.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[var(--color-text-interface)] font-medium">
                                    {t('sync.conflict.serverPatchSeq', 'Server Patch Seq')}
                                </span>
                                <span className="font-mono text-[var(--color-text-primary)] bg-[var(--color-bg-hover)] px-2.5 py-1 rounded-md">
                                    {conflict!.lastServerPatchSeq}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[var(--color-text-interface)] font-medium">
                                    {t('sync.conflict.serverTimestamp', 'Server Timestamp')}
                                </span>
                                <span className="font-mono text-xs text-[var(--color-text-primary)] bg-[var(--color-bg-hover)] px-2.5 py-1 rounded-md">
                                    {new Date(conflict!.lastServerTimestamp).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2.5 pt-2">
                        <button
                            onClick={handleKeepLocal}
                            className="w-full px-4 py-3 bg-[var(--color-button-neutral)] text-[var(--color-text-accent)] rounded-xl hover:bg-[var(--color-button-neutral-hover)] transition-colors font-medium"
                        >
                            {t('sync.conflict.keepLocal', 'Keep Local Changes')}
                        </button>
                        <button
                            onClick={handleApplyServer}
                            className="w-full px-4 py-3 bg-[var(--color-bg-input-secondary)] text-[var(--color-text-primary)] rounded-xl hover:bg-[var(--color-bg-hover)] transition-colors font-medium border border-[var(--color-border)]"
                        >
                            {t('sync.conflict.applyServer', 'Apply Server Changes')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SyncConflictModal;

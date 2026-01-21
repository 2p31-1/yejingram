import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectUI, selectSyncProgress } from '../../entities/ui/selectors';

function SyncModal() {
    const { t } = useTranslation();
    const ui = useSelector(selectUI);
    const isSyncing = (ui.syncProgress ?? 0) > 0;
    const progress = useSelector(selectSyncProgress);
    if (!isSyncing) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--color-bg-shadow)/40 backdrop-blur-[2px] p-4">
            <div className="bg-(--color-bg-main) text-(--color-text-primary) border border-(--color-border) rounded-2xl px-5 py-4 shadow-xl w-[min(420px,90vw)]">
                <div className="font-semibold mb-2">{t('common.syncing')}</div>
                <div className="w-full h-2 rounded-full bg-(--color-bg-input-secondary) overflow-hidden">
                    <div className="h-full bg-(--color-button-primary) transition-[width] duration-200" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-2 text-sm text-(--color-text-interface)">{progress}%</div>
            </div>
        </div>
    );
}

export default SyncModal;

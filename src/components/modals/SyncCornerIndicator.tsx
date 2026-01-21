import { useSelector } from 'react-redux';
import { selectUI, selectSyncProgress } from '../../entities/ui/selectors';
import { useTranslation } from 'react-i18next';

function SyncCornerIndicator() {
    const { t } = useTranslation();
    const ui = useSelector(selectUI);
    const isUploading = (ui.syncProgress ?? 0) > 0;
    const uploadProgress = useSelector(selectSyncProgress);

    // Only show when syncing but global modal isn't desired
    if (!isUploading) return null;

    return (
        <div className="fixed right-3 bottom-3 z-40 select-none">
            <div className="flex items-center gap-2 bg-(--color-bg-main)/90 backdrop-blur-sm border border-(--color-border) rounded-xl px-3 py-2 shadow-md">
                <div className="w-28">
                    <div className="h-1.5 rounded-full bg-(--color-bg-input-secondary) overflow-hidden">
                        <div className="h-full bg-(--color-button-primary) transition-[width] duration-200" style={{ width: `${uploadProgress}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-(--color-text-interface)">
                        <span>{t('common.syncing')}</span>
                        <span>{uploadProgress}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SyncCornerIndicator;

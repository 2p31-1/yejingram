import { store } from '../app/store';
import { backupStateToServer, checkForConflict as checkConflict } from '../utils/backup';
import { syncActions } from '../entities/sync/slice';

export const syncService = {
    async sync() {
        const state = store.getState();
        if (state.sync.isSyncing) return;

        if (!state.settings.syncSettings.syncEnabled) return;

        store.dispatch(syncActions.setIsSyncing(true));

        try {
            while (true) {
                const currentState = store.getState();
                const { patchQueue } = currentState.sync;

                if (patchQueue.length === 0) break;

                const patch = patchQueue[0];
                const { syncSettings } = currentState.settings;

                await backupStateToServer(
                    syncSettings.syncClientId,
                    syncSettings.syncBaseUrl,
                    patch
                );

                const nextState = store.getState();
                // If the patch is still in the queue (failed to sync), break the loop to avoid infinite retry
                if (nextState.sync.patchQueue.length > 0 && nextState.sync.patchQueue[0].id === patch.id) {
                    break;
                }
            }
        } catch (e) {
            console.error("Sync failed", e);
        } finally {
            store.dispatch(syncActions.setIsSyncing(false));
        }
    },

    async checkConflict() {
        const state = store.getState();
        const { syncSettings } = state.settings;
        checkConflict(
            syncSettings.syncClientId,
            syncSettings.syncBaseUrl
        );
    }
};
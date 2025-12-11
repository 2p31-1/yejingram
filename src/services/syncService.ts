import { store } from '../app/store';
import { backupStateToServer, checkForConflict as checkConflict } from '../utils/backup';

export const syncService = {
    async sync() {
        const state = store.getState();
        const { syncSettings } = state.settings;
        const { patchQueue } = state.sync;

        if (!syncSettings.syncEnabled) return;
        const patch = patchQueue.length > 0 ? patchQueue[0] : null;

        try {
            if (patch) {
                backupStateToServer(
                    syncSettings.syncClientId,
                    syncSettings.syncBaseUrl,
                    patch
                );
            }
        } catch (e) {
            console.error("Sync failed", e);
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
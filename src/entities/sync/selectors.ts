import type { RootState } from '../../app/store';

export const selectSyncConflict = (state: RootState) => state.sync.conflict;
export const selectSyncStatus = (state: RootState) => state.sync.status;
export const selectIsSyncConflict = (state: RootState) => state.sync.status === 'conflict';

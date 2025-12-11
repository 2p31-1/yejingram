import type { RootState } from '../../app/store';

export const selectSyncConflict = (state: RootState) => state.sync.conflict;
export const selectIsSyncConflict = (state: RootState) => !!state.sync.conflict;

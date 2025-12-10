import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Patch, SyncState } from './types';

const initialState: SyncState = {
    snapshotSeq: 0,
    patchSeq: 0,
    status: 'synced',
    patchQueue: [],
    isSyncing: false,
};

export const syncSlice = createSlice({
    name: 'sync',
    initialState,
    reducers: {
        enqueuePatch: (state, action: PayloadAction<Patch>) => {
            state.patchQueue.push(action.payload);
            state.status = 'syncing';
        },
        setSnapshotSeq: (state, action: PayloadAction<number>) => {
            state.snapshotSeq = action.payload;
        },
        setPatchSeq: (state, action: PayloadAction<number>) => {
            state.patchSeq = action.payload;
        },
        setSyncStatus: (state, action: PayloadAction<SyncState['status']>) => {
            state.status = action.payload;
        },
        updateFromSnapshot: (state, action: PayloadAction<{ snapshotSeq: number, patchSeq: number }>) => {
            state.snapshotSeq = action.payload.snapshotSeq;
            state.patchSeq = action.payload.patchSeq;
            // In a real implementation, we might want to rebase patches here
            // But for now, following the simple flow: "Client updates local state based on server state"
            state.status = 'synced';
        },
        setConflict: (state, action: PayloadAction<NonNullable<SyncState['conflict']>>) => {
            state.status = 'conflict';
            state.conflict = action.payload;
        },
        resolveConflict: (state) => {
            state.status = 'synced';
            state.conflict = undefined;
        },
        popPatchQueue: (state) => {
            state.patchQueue.shift();
        },
        clearPatchQueue: (state) => {
            state.patchQueue = [];
        }
    },
});

export const syncActions = syncSlice.actions;
export default syncSlice.reducer;

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Patch, SyncState } from './types';

const initialState: SyncState = {
    snapshotSeq: 0,
    patchSeq: 0,
    patchQueue: [],
    isSyncing: false,
};

export const syncSlice = createSlice({
    name: 'sync',
    initialState,
    reducers: {
        enqueuePatch: (state, action: PayloadAction<Patch>) => {
            state.patchQueue.push(action.payload);
        },
        setSnapshotSeq: (state, action: PayloadAction<number>) => {
            state.snapshotSeq = action.payload;
        },
        setPatchSeq: (state, action: PayloadAction<number>) => {
            state.patchSeq = action.payload;
        },
        updateFromSnapshot: (state, action: PayloadAction<{ snapshotSeq: number, patchSeq: number }>) => {
            state.snapshotSeq = action.payload.snapshotSeq;
            state.patchSeq = action.payload.patchSeq;
        },
        setConflict: (state, action: PayloadAction<NonNullable<SyncState['conflict']>>) => {
            state.conflict = action.payload;
        },
        resolveConflict: (state) => {
            state.conflict = undefined;
        },
        popPatchQueue: (state) => {
            state.patchQueue.shift();
        },
        clearPatchQueue: (state) => {
            state.patchQueue = [];
        },
        setIsSyncing: (state, action: PayloadAction<boolean>) => {
            state.isSyncing = action.payload;
        }
    },
});

export const syncActions = syncSlice.actions;
export default syncSlice.reducer;

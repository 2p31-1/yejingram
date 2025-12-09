import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Patch, SyncState } from './types';

const initialState: SyncState = {
    serverSeq: 0,
    appliedSeq: 0,
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
        confirmPatch: (state, action: PayloadAction<{ patchId: string, serverSeq: number }>) => {
            const { patchId, serverSeq } = action.payload;
            state.patchQueue = state.patchQueue.filter(p => p.id !== patchId);
            state.serverSeq = serverSeq;
            state.appliedSeq = serverSeq;
            if (state.patchQueue.length === 0) {
                state.status = 'synced';
            }
        },
        setServerSeq: (state, action: PayloadAction<number>) => {
            state.serverSeq = action.payload;
        },
        setSyncStatus: (state, action: PayloadAction<SyncState['status']>) => {
            state.status = action.payload;
        },
        updateFromSnapshot: (state, action: PayloadAction<{ seq: number }>) => {
            state.serverSeq = action.payload.seq;
            state.appliedSeq = action.payload.seq;
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
        clearPatchQueue: (state) => {
            state.patchQueue = [];
        }
    },
});

export const syncActions = syncSlice.actions;
export default syncSlice.reducer;

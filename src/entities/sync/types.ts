import type { Operation } from 'fast-json-patch';

export interface Patch {
    id: string;
    seq: number;
    baseSnapshotSeq: number;
    diff: Operation[];
    timestamp: number;
}

export interface Snapshot {
    seq: number;
    data: any;
}

export interface ServerState {
    snapshot: Snapshot;
    patches: Patch[];
}

export interface ClientSyncResponse {
    snapshotSeq: number;
    patchSeq: number;
    patches: Patch[];
}

export interface SyncState {
    snapshotSeq: number;
    patchSeq: number;
    status: 'synced' | 'offline' | 'conflict' | 'syncing';
    patchQueue: Patch[];
    isSyncing: boolean;
    conflict?: {
        serverSnapshot: Snapshot | null;
        serverPatches: Patch[];
        localPatch: Patch;
    };
}

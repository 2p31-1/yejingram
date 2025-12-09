export interface Patch {
    id: string;
    baseSeq: number;
    diff: any;
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

export interface SyncState {
    serverSeq: number;
    appliedSeq: number;
    status: 'synced' | 'offline' | 'conflict' | 'syncing';
    patchQueue: Patch[];
    isSyncing: boolean;
    conflict?: {
        serverSnapshot: Snapshot | null;
        serverPatches: Patch[];
        localPatch: Patch;
    };
}

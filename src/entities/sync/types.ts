import type { Operation } from 'fast-json-patch';
import type { RootState } from '../../app/store';

export interface Patch {
    id: string;
    seq: number;
    baseSnapshotSeq: number;
    diff?: Operation[];
    snapshot?: Pick<RootState, 'characters' | 'rooms' | 'messages' | 'settings'>;
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
    patchQueue: Patch[];
    isSyncing: boolean;
    conflict?: {
        lastServerTimestamp: number;
        lastServerPatchSeq: number;
    };
}

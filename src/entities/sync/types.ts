import type { Operation } from 'fast-json-patch';
import type { RootState } from '../../app/store';

export type BackupState = Pick<RootState, 'characters' | 'rooms' | 'messages' | 'settings' | 'lastSaved'>;

export type BackupFile = {
    app: 'yejingram';
    version: number;
    createdAt: string;
    data: BackupState;
};

export interface Patch {
    id: string;
    seq: number;
    baseSnapshotSeq: number;
    diff?: Operation[];
    timestamp: number;
}

export interface Snapshot {
    snapshot: RootState;
    version: number;
}

export interface SyncMetadata {
    snapshotSeq: number;
    patchSeq: number;
    version: number;
}

export interface ServerState {
    metadata: SyncMetadata;
    patches: Patch[];
}

export interface ClientSyncResponse {
    type: 'patch';
    snapshotSeq: number;
    patchSeq: number;
    patches: Patch[];
    version: number;
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

export type BackupError =
    | { cause: 'conflict'; timestamp: number; seq: number }
    | { cause: 'snapshot_mismatch' };
import type { Operation } from 'fast-json-patch';
import type { RootState } from '../../app/store';

export type BackupData = Pick<RootState, 'characters' | 'rooms' | 'messages' | 'settings' | 'lastSaved'>;

export type BackupFile = {
    app: 'yejingram';
    version: number;
    createdAt: string;
    data: BackupData;
};

export interface Patch {
    id: string;
    seq: number;
    baseSnapshotSeq: number;
    diff?: Operation[];
    snapshot?: BackupData;
    timestamp: number;
}

export interface SyncMetadata {
    snapshotSeq: number;
    patchSeq: number;
}

export interface ServerState {
    metadata: SyncMetadata;
    snapshot: RootState;
    patches: Patch[];
}

export type ClientSyncResponse = FullSyncResponse | PatchSyncResponse;

export interface FullSyncResponse {
    type: 'full';
    snapshotSeq: number;
    patchSeq: number;
    snapshot: RootState;
    patches: Patch[];
}

export interface PatchSyncResponse {
    type: 'patch';
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

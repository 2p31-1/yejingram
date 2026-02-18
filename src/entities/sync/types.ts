import type { Operation } from 'fast-json-patch';
import type { RootState } from '../../app/store';

export type BackupState = Pick<RootState, 'characters' | 'rooms' | 'messages' | 'settings' | 'lastSaved'>;

export type BackupFile = {
    app: 'yejingram';
    version: number;         // 우리 스키마 버전 (persist 버전과 별개)
    createdAt: string;       // ISO 문자열
    data: Pick<RootState, 'characters' | 'rooms' | 'messages' | 'settings' | 'lastSaved'>;
    binaries: Array<{ storageKey: string; dataUrl: string }>;
};

export interface Patch {
    id: string;
    seq: number;
    baseSnapshotSeq: number;
    diff?: Operation[];
    /**
     * Binary side-effects that must be processed outside JSON diff.
     * - put: binaries newly referenced by this patch (client uploads / other clients download)
     * - del: binaries no longer referenced after this patch (server deletes)
     */
    binary?: {
        put?: string[];
        del?: string[];
    };
    timestamp: number;
}

export interface Snapshot {
    snapshot: RootState;
    version: number;
}

export interface SyncMetadata {
    snapshotSeq: number;
    patchSeq: number;
    version?: number;
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
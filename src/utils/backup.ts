// src/app/stateBackup.ts
import { store, persistor, resetAll, migrations, persistConfig, isBrowser } from '../app/store';
import type { RootState } from '../app/store';
import { charactersActions } from '../entities/character/slice';
import { roomsActions } from '../entities/room/slice';
import { messagesActions } from '../entities/message/slice';
import { settingsActions } from '../entities/setting/slice';
import { lastSavedActions } from '../entities/lastSaved/slice';
import type { EntityState, EntityId } from '@reduxjs/toolkit';
import { uiActions } from '../entities/ui/slice';
import type { ClientSyncResponse, Patch, BackupFile, BackupData } from '../entities/sync/types';
import { syncActions } from '../entities/sync/slice';
import { applyPatch } from './diff';

export function entityStateToArray<T>(
  // Id extends PropertyKey 대신 Id extends EntityId를 사용합니다.
  state: Pick<EntityState<T, EntityId>, 'ids' | 'entities'>
): T[] {
  // undefined 안전 처리 (타입·런타임 모두)
  return state.ids
    .map((id) => state.entities[id as EntityId])
    .filter((v): v is T => v !== undefined);
}

export async function wipeAllState() {
  persistor.pause();
  await persistor.flush();     // 남은 write 처리
  await persistor.purge();     // ← localforage에 저장된 'yejingram' 스냅샷 제거
  store.dispatch(resetAll());  // ← 메모리상의 Redux 상태 초기화
}

// 백업 파일 스키마

// Build a compact payload from current state
export function buildBackupPayload() {
  const state = store.getState();
  const data = {
    characters: state.characters,
    rooms: state.rooms,
    messages: state.messages,
    settings: state.settings,
    lastSaved: state.lastSaved,
  } satisfies BackupData;
  const payload: BackupFile = {
    app: 'yejingram',
    version: persistConfig.version,
    createdAt: new Date().toISOString(),
    data,
  };
  return payload;
}

// ---------- 백업 ----------
export async function backupStateToFile() {
  const payload = buildBackupPayload();

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `yejingram-backup-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

// ---------- 복원 ----------
export async function restoreStateFromFile(file: File, autoSync?: boolean) {
  const text = await file.text();

  let parsed: BackupFile;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('잘못된 JSON 파일입니다.');
  }

  await restoreStateFromPayload(parsed, autoSync);
}

export async function restoreStateFromPayload(payload: BackupFile, autoSync = true) {
  if (payload.app !== 'yejingram' || !payload.data) {
    throw new Error('이 앱의 백업 형식이 아닙니다.');
  }

  if (autoSync) store.dispatch({ type: 'sync/applyDeltaStart' });

  await restoreState(payload.data, persistConfig.version, autoSync);
}

async function restoreState(state: Partial<RootState>, lastVersion = persistConfig.version, autoSync = true) {
  await wipeAllState();
  for (let v = lastVersion + 1; v <= persistConfig.version; v++) {
    if (migrations[v] == null) continue;
    state = migrations[v](state as unknown as any) as unknown as typeof state;
  }

  const { characters, rooms, messages, settings, lastSaved } = state;
  persistor.persist();
  if (characters) store.dispatch(charactersActions.importCharacters(entityStateToArray(characters)));
  if (rooms) store.dispatch(roomsActions.importRooms(entityStateToArray(rooms)));
  if (messages) store.dispatch(messagesActions.importMessages(entityStateToArray(messages)));
  if (settings) store.dispatch(settingsActions.importSettings(settings));
  if (lastSaved) store.dispatch(lastSavedActions.importLastSaved(lastSaved));

  if (autoSync) store.dispatch({ type: 'sync/applyDeltaEnd' });
}

// ---------- 서버 동기화 ----------
export async function checkForConflict(clientId: string, baseURL: string) {
  const state = store.getState();
  try {
    const response = await fetch(`${baseURL}/api/sync/check/${clientId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        seq: state.sync.patchSeq,
        baseSnapshotSeq: state.sync.snapshotSeq
      } as Patch),
    });

    if (response.ok) {
      return;
    } else if (response.status === 409) {
      const res = await response.json();
      handleBackupError({
        cause: 'conflict',
        timestamp: Number(res.timestamp),
        seq: Number(res.seq)
      }, clientId, baseURL);
    } else if (response.status === 410) {
      handleBackupError({ cause: 'snapshot_mismatch' }, clientId, baseURL);
    } else {
      throw new Error(`Check failed: ${response.statusText}`);
    }
  } catch (error) {
    throw new Error('Check failed');
  }
}

export async function backupStateToServer(clientId: string, baseURL: string, diff?: Patch) {
  // 업로드 인디케이터 시작
  store.dispatch(uiActions.setUploadProgress(0));

  let url = `${baseURL}/api/sync/${clientId}`;

  let snapshotNeeded = !diff;
  if (snapshotNeeded) {
    url += '?type=snapshot';
    const payload = buildBackupPayload();

    diff = {
      id: `backup-${Date.now()}`,
      baseSnapshotSeq: 0,
      seq: 0,
      snapshot: payload.data,
      timestamp: Date.now()
    };
  }

  try {
    if (isBrowser) {
      let newSeq: number | undefined;
      try {
        newSeq = await new Promise<number>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url);
          xhr.setRequestHeader('Content-Type', 'application/json');

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.max(0, Math.min(100, Math.floor((event.loaded / event.total) * 100)));
              store.dispatch(uiActions.setUploadProgress(percent));
            }
          };

          xhr.onload = async () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(Number(JSON.parse(xhr.responseText).seq));
            } else if (xhr.status === 404) {
              await backupStateToServer(clientId, baseURL);
              resolve(0);
            }
            else if (xhr.status === 409) {
              const res = JSON.parse(xhr.responseText);
              reject({
                cause: 'conflict',
                timestamp: Number(res.timestamp),
                seq: Number(res.seq)
              });
            }
            else if (xhr.status === 410) {
              reject({ cause: 'snapshot_mismatch', });
            }
            else {
              reject(new Error(`Upload failed: ${xhr.statusText}`));
            }
          };

          xhr.onerror = () => reject(new Error('Upload failed'));
          xhr.send(JSON.stringify(diff));
        });
      } catch (err) {
        const error = err as { cause: 'conflict'; timestamp: number; seq: number } | { cause: 'snapshot_mismatch' };

        handleBackupError(error, clientId, baseURL);
      }
      console.log('Backup uploaded, new seq:', newSeq);

      if (newSeq != null) {
        store.dispatch(syncActions.setPatchSeq(newSeq));
        store.dispatch(syncActions.popPatchQueue());
      }

      if (snapshotNeeded) {
        store.dispatch(syncActions.resolveConflict())
      }
    }
  } finally {
    // 업로드 인디케이터 종료
    store.dispatch(uiActions.clearUploadProgress());
  }
}

export async function restoreStateFromServer(clientId: string, baseURL: string, full = false) {
  // 다운로드 진행률을 바이트 기준으로 표시
  store.dispatch(uiActions.setSyncProgress(0));
  try {
    let jsonText: string | null = null;

    if (isBrowser) {
      jsonText = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `${baseURL}/api/sync/${clientId}${full ? '?full=true' : ''}`);

        xhr.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.max(0, Math.min(100, Math.floor((event.loaded / event.total) * 100)));
            store.dispatch(uiActions.setSyncProgress(percent));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            reject(new Error(`Download failed: ${xhr.statusText}`));
          }
        };

        xhr.onerror = () => reject(new Error('Download failed'));
        xhr.send();
      });
    } else {
      const res = await fetch(`${baseURL}/api/sync/${clientId}`);
      if (!res.ok) return;
      jsonText = await res.text();
    }

    if (jsonText) {
      const serverState: ClientSyncResponse = JSON.parse(jsonText);
      const state = serverState.type === 'full' ? serverState.snapshot : store.getState();
      const patchedState = applyPatch(state, serverState.patches);
      store.dispatch({ type: 'sync/applyDeltaStart' });
      await restoreState(patchedState, persistConfig.version, false);

      store.dispatch(syncActions.updateFromSnapshot({
        snapshotSeq: serverState.snapshotSeq,
        patchSeq: serverState.patchSeq
      }));
      store.dispatch(syncActions.clearPatchQueue());
      store.dispatch(syncActions.resolveConflict());
      store.dispatch({ type: 'sync/applyDeltaEnd' });
    }
  } finally {
    store.dispatch(uiActions.clearSyncProgress());
  }
}

export function handleBackupError(
  error: { cause: 'conflict'; timestamp: number; seq: number } | { cause: 'snapshot_mismatch' },
  clientId: string,
  baseURL: string
) {
  if (error.cause === 'conflict') {
    console.log('⚠️ 충돌 발생!');
    store.dispatch(syncActions.setConflict({
      lastServerPatchSeq: error.seq,
      lastServerTimestamp: error.timestamp
    }));
    return;
  }
  if (error.cause === 'snapshot_mismatch') {
    console.log('⚠️ 스냅샷 불일치!');
    restoreStateFromServer(clientId, baseURL);
  }
}
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
import type { ClientSyncResponse, Patch, BackupFile, BackupData, BackupError } from '../entities/sync/types';
import { syncActions } from '../entities/sync/slice';
import { applyPatch } from './diff';

async function jsonStringify(value: any, replacer?: any, space?: string | number): Promise<string> {
  if (!isBrowser) {
    return JSON.stringify(value, replacer, space);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./jsonWorker.ts', import.meta.url));
    worker.postMessage({ action: 'stringify', data: { value, replacer, space } });
    worker.onmessage = (e) => {
      if (e.data.success) {
        resolve(e.data.result);
      } else {
        reject(new Error(e.data.error));
      }
      worker.terminate();
    };
    worker.onerror = reject;
  });
}

async function jsonParse(text: string): Promise<any> {
  if (!isBrowser) {
    return JSON.parse(text);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./jsonWorker.ts', import.meta.url));
    worker.postMessage({ action: 'parse', data: { text } });
    worker.onmessage = (e) => {
      if (e.data.success) {
        resolve(e.data.result);
      } else {
        reject(new Error(e.data.error));
      }
      worker.terminate();
    };
    worker.onerror = reject;
  });
}

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

  const json = await jsonStringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `yejingram-backup-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

// ---------- 복원 ----------
export async function restoreStateFromFile(file: File) {
  const text = await file.text();

  let parsed: BackupFile;
  try {
    parsed = await jsonParse(text);
  } catch (e) {
    throw new Error('잘못된 JSON 파일입니다.');
  }

  await restoreStateFromPayload(parsed);
}

export async function restoreStateFromPayload(payload: BackupFile) {
  if (payload.app !== 'yejingram' || !payload.data) {
    throw new Error('이 앱의 백업 형식이 아닙니다.');
  }

  await restoreState(payload.data, persistConfig.version);
}

async function restoreState(state: Partial<RootState>, lastVersion = persistConfig.version) {
  store.dispatch({ type: 'sync/applyDeltaStart' });

  await wipeAllState();
  for (let v = lastVersion + 1; v <= persistConfig.version; v++) {
    if (migrations[v] == null) continue;
    state = migrations[v](state as unknown as any) as unknown as typeof state;
  }

  const { characters, rooms, messages, settings, lastSaved } = state;
  if (characters) store.dispatch(charactersActions.importCharacters(entityStateToArray(characters)));
  if (rooms) store.dispatch(roomsActions.importRooms(entityStateToArray(rooms)));
  if (messages) store.dispatch(messagesActions.importMessages(entityStateToArray(messages)));
  if (settings) store.dispatch(settingsActions.importSettings(settings));
  if (lastSaved) store.dispatch(lastSavedActions.importLastSaved(lastSaved));
  persistor.persist();

  store.dispatch({ type: 'sync/applyDeltaEnd' });
}

// ---------- 서버 동기화 ----------
export async function checkForConflict(clientId: string, baseURL: string) {
  const state = store.getState();
  try {
    const response = await fetch(`${baseURL}/api/${clientId}/sync/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: await jsonStringify({
        seq: state.sync.patchSeq,
        baseSnapshotSeq: state.sync.snapshotSeq
      } as Patch),
    });

    if (response.ok) {
      store.dispatch(syncActions.resolveConflict());
      return;
    } else if (response.status === 409) {
      const res = await response.json();
      const serverSnapshotSeq = Number(res.snapshotSeq);
      const serverPatchSeq = Number(res.seq);
      const clientSnapshotSeq = state.sync.snapshotSeq;
      const clientPatchSeq = state.sync.patchSeq;

      if (clientPatchSeq < serverPatchSeq) {
        // 클라이언트 패치가 서버보다 뒤처져 있음
        restoreStateFromServer(clientId, baseURL, false);
      } else if (clientSnapshotSeq < serverSnapshotSeq) {
        // 클라이언트 스냅샷이 서버보다 뒤처져 있음
        restoreStateFromServer(clientId, baseURL, true);
      } else {
        // 클라이언트가 서버 보다 앞서 있음
        console.log(`⚠️ 충돌 발생! 서버 패치 시퀀스: ${serverPatchSeq}, 클라이언트 패치 시퀀스: ${clientPatchSeq}`);
        handleBackupError({
          cause: 'conflict',
          timestamp: res.timestamp ? Number(res.timestamp) : Date.now(),
          seq: serverPatchSeq
        }, clientId, baseURL);
      }
    } else if (response.status === 410) {
      handleBackupError({ cause: 'snapshot_mismatch' }, clientId, baseURL);
    } else {
      throw new Error(`Check failed: ${response.statusText}`);
    }
  } catch (error) {
    throw new Error('Check failed');
  }
}

export async function backupStateToServer(
  clientId: string,
  baseURL: string,
  diff?: Patch
) {
  store.dispatch(uiActions.setSyncProgress(0));

  let url = `${baseURL}/api/${clientId}/sync`;

  const snapshotNeeded = !diff;
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

  let statusCode: number | null = null;
  let responseText: string | null = null;

  try {
    const state = store.getState();
    console.log(`[backupStateToServer] Client patchSeq: ${state.sync.patchSeq}, snapshotSeq: ${state.sync.snapshotSeq}`);

    if (isBrowser) {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.floor((event.loaded / event.total) * 100);
            store.dispatch(uiActions.setSyncProgress(percent));
          }
        };

        xhr.onload = () => {
          statusCode = xhr.status;
          responseText = xhr.responseText;
          resolve();
        };

        xhr.onerror = () => reject(new Error('Upload failed'));
        jsonStringify(diff).then((json) => xhr.send(json)).catch(reject);
      });
    } else {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await jsonStringify(diff)
      });

      statusCode = res.status;
      responseText = await res.text();

      // fetch 환경에서는 progress 불가
      store.dispatch(uiActions.setSyncProgress(100));
    }

    if (statusCode == null) {
      throw new Error('No response status');
    }

    switch (statusCode) {
      case 200: {
        const res = await jsonParse(responseText ?? '{}');
        const newSeq = Number(res.seq);

        store.dispatch(syncActions.setPatchSeq(newSeq));
        store.dispatch(syncActions.popPatchQueue());

        if (snapshotNeeded) {
          store.dispatch(syncActions.clearPatchQueue());
          store.dispatch(syncActions.resolveConflict());
        }
        break;
      }

      case 404: {
        await backupStateToServer(clientId, baseURL);
        break;
      }

      case 409: {
        const res = await jsonParse(responseText ?? '{}');
        console.log(`[backupStateToServer] Conflict: Server seq: ${res.seq}, timestamp: ${res.timestamp}, Client patchSeq: ${state.sync.patchSeq}`);
        throw {
          cause: 'conflict',
          timestamp: Number(res.timestamp),
          seq: Number(res.seq)
        };
      }

      case 410: {
        throw { cause: 'snapshot_mismatch' };
      }

      default:
        throw new Error(`Upload failed: ${statusCode}`);
    }
  } catch (err) {
    if (err && (err as BackupError).cause) {
      handleBackupError(
        err as BackupError,
        clientId,
        baseURL
      );
    } else {
      console.error('백업 실패', err);
    }
  } finally {
    store.dispatch(uiActions.clearSyncProgress());
    store.dispatch(uiActions.clearForceShowSyncModal());
  }
}

export async function restoreStateFromServer(clientId: string, baseURL: string, full = false) {
  // 다운로드 진행률을 바이트 기준으로 표시
  store.dispatch(uiActions.setSyncProgress(0));
  try {
    const currentState = store.getState();
    const queryParams = new URLSearchParams({
      sinceSnapshotSeq: currentState.sync.snapshotSeq.toString(),
      sincePatchSeq: full ? '0' : currentState.sync.patchSeq.toString(),
      ...(full && { full: 'true' })
    });
    let jsonText: string | null = null;

    if (isBrowser) {
      jsonText = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `${baseURL}/api/${clientId}/sync?${queryParams.toString()}`);

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
      const res = await fetch(`${baseURL}/api/${clientId}/sync?${queryParams.toString()}`);
      if (!res.ok) return;
      jsonText = await res.text();
    }

    if (jsonText) {
      const serverState: ClientSyncResponse = await jsonParse(jsonText);
      const state = serverState.type === 'full' ? serverState.snapshot : store.getState();
      const patchedState = applyPatch(state, serverState.patches);
      await restoreState(patchedState, persistConfig.version);

      store.dispatch(syncActions.updateFromSnapshot({
        snapshotSeq: serverState.snapshotSeq,
        patchSeq: serverState.patchSeq
      }));
      store.dispatch(syncActions.clearPatchQueue());
      store.dispatch(syncActions.resolveConflict());
    }
  } finally {
    store.dispatch(uiActions.clearSyncProgress());
    store.dispatch(uiActions.clearForceShowSyncModal());
  }
}

export function handleBackupError(
  error: BackupError,
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
import type { Middleware } from "redux";
import { type RootState } from "../app/store";
import { syncActions } from "../entities/sync/slice";
import { getPatch } from "../utils/diff";
import { syncService } from "./syncService";
import { nanoid } from "@reduxjs/toolkit";
import type { Patch } from "../entities/sync/types";

let applying = true;
let messagePrevState: RootState = {} as RootState;

export const syncMiddleware: Middleware<{}, RootState> = store => next => (action: any) => {
    const blacklist = ['app/resetAll', 'rooms/resetUnread'];
    const blacklistPrefixes = ['persist/', 'ui/', 'lastSaved/', 'sync/'];

    let prevState = store.getState();
    if (action.type === 'sync/applyDeltaStart' || action.type === 'messages/writingStart') {
        applying = false;
        messagePrevState = store.getState();
    }
    else if (action.type === 'sync/applyDeltaEnd' || action.type === 'messages/writingEnd') {
        applying = true;
        prevState = messagePrevState;
    }

    if (blacklist.includes(action.type) || blacklistPrefixes.some(prefix => action.type.startsWith(prefix))) {
        return next(action);
    }

    const result = next(action);
    const nextState = store.getState();

    if (applying && nextState.settings.syncSettings.syncEnabled) {
        const relevantSlices = ['characters', 'rooms', 'messages', 'settings'];
        const prevRelevant: any = {};
        const nextRelevant: any = {};

        relevantSlices.forEach(key => {
            prevRelevant[key] = (prevState as any)[key];
            nextRelevant[key] = (nextState as any)[key];
        });

        const diff = getPatch(prevRelevant, nextRelevant);

        if (diff) {
            const patch: Patch = {
                id: nanoid(),
                baseSnapshotSeq: nextState.sync.snapshotSeq,
                seq: nextState.sync.patchSeq + nextState.sync.patchQueue.length,
                diff: diff,
                timestamp: Date.now()
            };
            store.dispatch(syncActions.enqueuePatch(patch));

            // Trigger sync
            syncService.sync();
        }
    }

    return result;
};
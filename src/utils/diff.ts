import type { RootState } from "../app/store";
import type { Patch } from "../entities/sync/types";
import jsonpatch, { type Operation } from "fast-json-patch";

export function getPatch(prev: RootState, next: RootState): Operation[] | undefined {
    const patch = jsonpatch.compare(prev, next);
    return patch.length > 0 ? patch : undefined;
}

export function applyPatch(base: RootState, patches: Patch[]): RootState {
    let result: RootState = base;

    for (const patch of patches) {
        if (!patch.diff) continue;

        try {
            result = jsonpatch.applyPatch(result, patch.diff, false, false).newDocument;
        } catch (error) {
            continue;
        }
    }

    return result;
}
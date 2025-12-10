import type { RootState } from "../app/store";
import type { Patch } from "../entities/sync/types";
import jsonpatch, { type Operation } from "fast-json-patch";

export function getPatch(prev: RootState, next: RootState): Operation[] | undefined {
    const patch = jsonpatch.compare(prev, next);
    return patch.length > 0 ? patch : undefined;
}

export function applyPatch(base: RootState, patches: Patch[]): RootState {
    let result: RootState = structuredClone(base);

    for (const patch of patches) {
        if (!patch.diff) continue;

        const applied = jsonpatch.applyPatch(result, patch.diff, false);
        result = applied.newDocument;
    }

    return result;
}
import type { RootState } from "../app/store";
import type { Patch } from "../entities/sync/types";

export function getPatch(prev: any, next: any): Patch['diff'] {
    if (prev === next) return undefined;
    if (typeof prev !== 'object' || prev === null || typeof next !== 'object' || next === null) {
        return next;
    }
    if (Array.isArray(next)) {
        // For arrays, we just return the new array if it's different
        // A better diff would be needed for large arrays, but this is a start
        if (!Array.isArray(prev) || prev.length !== next.length) return next;
        // Deep compare arrays? Or just return next.
        // JSON.stringify is expensive but safe for simple data.
        return JSON.stringify(prev) === JSON.stringify(next) ? undefined : next;
    }

    const diff: any = {};
    let hasChanges = false;

    // Check for updates and additions
    for (const key in next) {
        if (Object.prototype.hasOwnProperty.call(prev, key)) {
            const d = getPatch(prev[key], next[key]);
            if (d !== undefined) {
                diff[key] = d;
                hasChanges = true;
            }
        } else {
            diff[key] = next[key];
            hasChanges = true;
        }
    }

    // Check for deletions (keys in prev but not in next)
    // In this simple version, we might miss deletions if we don't handle them.
    // To handle deletion, we could use a special value or just return the whole object if keys are missing.
    // For Redux states which are usually consistent in shape, this might be rare for top-level keys.
    // But for maps (entities), keys are removed.
    for (const key in prev) {
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
            // Key removed. We need to indicate deletion.
            // Since we can't easily represent "delete" in a merge without a special symbol,
            // we might have to send the parent object fully if keys are removed?
            // Or use null to mean delete?
            // Let's assume null means delete for now, or just return the whole 'next' object if we detect deletion.
            return next;
        }
    }

    return hasChanges ? diff : undefined;
}

function applyDiff(base: any, diff: any): any {
    if (typeof diff !== 'object' || diff === null) {
        return diff;
    }
    if (Array.isArray(diff)) {
        return diff;
    }
    // If base is not an object (e.g. undefined), just take diff
    if (typeof base !== 'object' || base === null) {
        return diff;
    }

    const result = { ...base };
    for (const key in diff) {
        result[key] = applyDiff(base[key], diff[key]);
    }
    return result;
}

export function applyPatch(base: RootState, patches: Patch[]): RootState {
    let result = base;
    for (const patch of patches) {
        result = applyDiff(result, patch.diff);
    }
    return result;
}

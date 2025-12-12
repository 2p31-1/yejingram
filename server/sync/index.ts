import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { promises as fsp } from 'fs';
import type { ClientSyncResponse, Patch, ServerState } from '../../src/entities/sync/types';
import type { RootState } from '../../src/app/store';
import { applyPatch } from '../../src/utils/diff';

interface ApiError extends Error {
    status?: number;
}

// ---- App setup ----
const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = path.resolve(process.cwd(), 'data');

// ---- Utils ----

function sanitizeClientId(input: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input)) {
        const err: ApiError = new Error('Invalid clientId format');
        err.status = 400;
        throw err;
    }
    return input;
}

function filePath(clientId: string): string {
    return path.join(DATA_DIR, `${clientId}.json`);
}

async function ensureDataDir(): Promise<void> {
    await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function readServerState(clientId: string): Promise<ServerState | null> {
    try {
        const json = await fsp.readFile(filePath(clientId), 'utf-8');
        const parsed = JSON.parse(json);

        if (parsed && parsed.snapshot && Array.isArray(parsed.patches)) {
            if (!parsed.metadata) {
                parsed.metadata = {
                    snapshotSeq: parsed.snapshot.seq || 0,
                    patchSeq: parsed.patches.length
                };
                delete (parsed.snapshot as any).seq;
            }
            return parsed as ServerState;
        }
        // Migration from old format
        if (parsed && parsed.backup) {
            return {
                metadata: { snapshotSeq: 0, patchSeq: 0 },
                snapshot: parsed.backup as RootState,
                patches: []
            };
        }
        return null
    } catch (err: any) {
        if (err?.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

async function writeServerState(clientId: string, state: ServerState): Promise<void> {
    await fsp.writeFile(filePath(clientId), JSON.stringify(state, null, 2));
}

function validatePatchSequence(patch: Patch, state: ServerState, res: Response): boolean {
    if (patch.baseSnapshotSeq !== state.metadata.snapshotSeq) {
        console.error('Snapshot seq mismatch', { expected: state.metadata.snapshotSeq, received: patch.baseSnapshotSeq });
        res.status(410).json({
            error: 'Snapshot sequence mismatch',
        });
        return false;
    } else if (patch.seq !== state.metadata.patchSeq) {
        console.error('Patch seq out of order', { expected: state.metadata.patchSeq, received: patch.seq });
        res.status(409).json({
            error: 'Patch sequence out of order',
            seq: state.metadata.patchSeq,
            timestamp: state.patches.length > 0 ? state.patches[state.patches.length - 1].timestamp : new Date().getTime()
        });
        return false;
    }
    return true;
}


// ---- Routes ----
app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
});

app.post('/api/sync/check/:clientId', async (req: Request<{ clientId: string }>, res: Response, next: NextFunction) => {
    try {
        const clientId = sanitizeClientId(req.params.clientId);
        const state = await readServerState(clientId);
        if (!state) {
            return res.status(404).json({ error: 'State not found' });
        }
        const patch = req.body as Patch;
        if (!validatePatchSequence(patch, state, res)) return;
        res.json({ valid: true });
    } catch (err) {
        next(err);
    }
});

app.get(
    '/api/sync/:clientId',
    async (req: Request<{ clientId: string }, any, any, { sinceSnapshotSeq: number, sincePatchSeq: number, full?: string }>, res: Response, next: NextFunction) => {
        try {
            const clientId = sanitizeClientId(req.params.clientId);
            const state = await readServerState(clientId);
            if (!state) {
                return res.status(404).json({ error: 'State not found' });
            }

            if (req.query.full === 'true') {
                return res.json({
                    type: 'full',
                    snapshotSeq: state.metadata.snapshotSeq,
                    patchSeq: state.metadata.patchSeq,
                    snapshot: state.snapshot,
                    patches: state.patches
                } as ClientSyncResponse);
            }

            if (req.query.sinceSnapshotSeq < state.metadata.snapshotSeq) {
                return res.json({
                    type: 'full',
                    snapshotSeq: state.metadata.snapshotSeq,
                    patchSeq: state.metadata.patchSeq,
                    snapshot: state.snapshot,
                    patches: state.patches
                } as ClientSyncResponse);
            }

            const newPatches = state.patches.filter(p => p.seq >= req.query.sincePatchSeq);

            return res.json({
                type: 'patch',
                snapshotSeq: state.metadata.snapshotSeq,
                patchSeq: state.metadata.patchSeq,
                patches: newPatches,
            } as ClientSyncResponse);
        } catch (err) {
            next(err);
        }
    }
);

app.post(
    '/api/sync/:clientId',
    async (req: Request<{ clientId: string }, any, any, { type?: string }>, res: Response, next: NextFunction) => {
        try {
            const clientId = sanitizeClientId(req.params.clientId);

            if (req.query.type === 'snapshot') {
                const patch = req.body as Patch;
                const newState: ServerState = {
                    metadata: { snapshotSeq: 0, patchSeq: 0 },
                    snapshot: patch.snapshot as RootState,
                    patches: []
                };
                await writeServerState(clientId, newState);
                return res.json({ seq: 0 });
            }

            const state = await readServerState(clientId);
            console.log(req.body);
            if (!state && !req.body.diff) {
                return res.status(404).json({ error: 'State not found' });
            }

            if (!state) {
                return;
            }

            const patch = req.body as Patch;

            if (!validatePatchSequence(patch, state, res)) return;

            state.patches.push(patch);
            state.metadata.patchSeq = state.patches.length;

            // Snapshot every 100 patches
            if (state.patches.length >= 100) {
                state.metadata.snapshotSeq = state.metadata.snapshotSeq + 1;
                state.metadata.patchSeq = 0;

                state.snapshot = applyPatch(state.snapshot, state.patches);
                state.patches = [];
            }

            await writeServerState(clientId, state);

            return res.json({ seq: state.metadata.patchSeq });

        } catch (err) {
            next(err);
        }
    }
);

// ---- Not found & Error handlers ----
app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((err: ApiError, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) {
        console.error('[Server Error]', err);
    }
    res.status(status).json({ error: err.message ?? 'Internal Server Error' });
});

ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log(`Data directory: ${DATA_DIR}`);
        console.log('Press Ctrl+C to stop the server');
    });
});
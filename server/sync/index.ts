import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { promises as fsp } from 'fs';
import type { ClientSyncResponse, Patch, ServerState, Snapshot } from '../../src/entities/sync/types';
import { applyPatch } from '../../src/utils/diff';
import type { BackupFile } from '../../src/utils/backup';

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
            return parsed as ServerState;
        }
        // Migration from old format
        if (parsed && parsed.backup) {
            return {
                snapshot: { seq: 0, data: parsed.backup },
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

// ---- Routes ----
app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
});

app.get(
    '/api/sync/:clientId',
    async (req: Request<{ clientId: string }, any, any, { sinceSeq?: string }>, res: Response, next: NextFunction) => {
        try {
            const clientId = sanitizeClientId(req.params.clientId);
            const state = await readServerState(clientId);
            if (!state) {
                return res.status(404).json({ error: 'State not found' });
            }
            const sinceSeq = Number(req.query.sinceSeq) || 0;

            if (sinceSeq < state.snapshot.seq) {
                return res.json({
                    snapshot: state.snapshot,
                    patches: state.patches
                });
            }

            const newPatches = state.patches.filter(p => p.baseSnapshotSeq >= sinceSeq);
            return res.json({
                snapshotSeq: state.snapshot.seq,
                patchSeq: state.patches.length,
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

            // Handle snapshot submission (initialization or reset)
            if (req.query.type === 'snapshot') {
                const snapshotData = req.body as BackupFile['data'];
                const newState: ServerState = {
                    snapshot: {
                        seq: 0,
                        data: snapshotData
                    },
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

            if (patch.baseSnapshotSeq !== state.snapshot.seq) {
                console.error('Snapshot seq mismatch', { expected: state.snapshot.seq, received: patch.baseSnapshotSeq });
                return res.status(410).json({
                    error: 'Snapshot sequence mismatch',
                    seq: state.snapshot.seq,
                    snapshot: state.snapshot,
                    patches: state.patches
                });
            } else if (patch.seq !== state.patches.length) {
                console.error('Patch seq out of order', { expected: state.patches.length, received: patch.seq });
                return res.status(409).json({
                    error: 'Patch sequence out of order',
                    seq: state.patches.length
                });
            }

            state.patches.push(patch);

            // Snapshot every 100 patches
            if (state.patches.length >= 100) {
                state.snapshot = {
                    seq: state.snapshot.seq + 1,
                    data: applyPatch(state.snapshot.data, patch.diff)
                };
                state.patches = [];
            }

            await writeServerState(clientId, state);

            return res.json({ seq: state.patches.length });

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
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { promises as fsp } from 'fs';
import multer from 'multer';
import type { ClientSyncResponse, Patch, ServerState, SyncMetadata } from '../../src/entities/sync/types';
import { applyPatch } from '../../src/utils/diff';

interface ApiError extends Error {
    status?: number;
}

/* =====================================================
   App setup
===================================================== */
const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const upload = multer({ limits: { fieldSize: 100 * 1024 * 1024 } }); // 100MB

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const BIN_DIR = path.join(DATA_DIR, 'binaries');

/* =====================================================
   In-memory cache & write debounce
===================================================== */
const stateCache = new Map<string, ServerState>();

/* =====================================================
   Utils
===================================================== */
function sanitizeClientId(input: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input)) {
        const err: ApiError = new Error('Invalid clientId format');
        err.status = 400;
        throw err;
    }
    return input;
}

function metadataPath(clientId: string) {
    return path.join(DATA_DIR, `${clientId}.metadata.json`);
}

function snapshotPath(clientId: string) {
    return path.join(DATA_DIR, `${clientId}.snapshot.json`);
}

function patchLogPath(clientId: string) {
    return path.join(DATA_DIR, `${clientId}.patches.log`);
}

async function ensureDataDir(): Promise<void> {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.mkdir(BIN_DIR, { recursive: true });
}

function toBase64Url(input: string): string {
    // Avoid relying on Node's 'base64url' encoding for TS/lib compatibility.
    return Buffer.from(input, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function binaryDataPath(clientId: string, storageKey: string): string {
    return path.join(BIN_DIR, clientId, `${toBase64Url(storageKey)}.bin`);
}

function binaryMetaPath(clientId: string, storageKey: string): string {
    return path.join(BIN_DIR, clientId, `${toBase64Url(storageKey)}.meta.json`);
}

async function ensureBinaryDir(clientId: string): Promise<void> {
    await fsp.mkdir(path.join(BIN_DIR, clientId), { recursive: true });
}

async function deleteBinary(clientId: string, storageKey: string): Promise<void> {
    try { await fsp.unlink(binaryDataPath(clientId, storageKey)); } catch { }
    try { await fsp.unlink(binaryMetaPath(clientId, storageKey)); } catch { }
}

async function clearAllClientBinaries(clientId: string): Promise<void> {
    const dir = path.join(BIN_DIR, clientId);
    try {
        // Node 14+: rm exists in fs.promises
        await (fsp as any).rm(dir, { recursive: true, force: true });
    } catch {
        // fallback for older
        try { await fsp.rmdir(dir, { recursive: true } as any); } catch { }
    }
    await ensureBinaryDir(clientId);
}

/* =====================================================
   Storage: metadata
===================================================== */
async function readMetadata(
    clientId: string
): Promise<ServerState['metadata'] | null> {
    try {
        const raw = await fsp.readFile(metadataPath(clientId), 'utf-8');
        return JSON.parse(raw);
    } catch (err: any) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

async function writeMetadata(
    clientId: string,
    metadata: ServerState['metadata']
): Promise<void> {
    await fsp.writeFile(
        metadataPath(clientId),
        JSON.stringify(metadata, null, 2)
    );
}

/* =====================================================
   Storage: snapshot
===================================================== */
async function readSnapshot(clientId: string): Promise<string | null> {
    try {
        const raw = await fsp.readFile(snapshotPath(clientId), 'utf-8');
        return raw;
    } catch (err: any) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

async function writeSnapshot(
    clientId: string,
    snapshot: string
): Promise<void> {
    await fsp.writeFile(snapshotPath(clientId), snapshot);
}

/* =====================================================
   Storage: patches
===================================================== */
async function appendPatch(clientId: string, patch: Patch): Promise<void> {
    await fsp.appendFile(
        patchLogPath(clientId),
        JSON.stringify(patch) + '\n'
    );
}

async function resetPatchLog(clientId: string): Promise<void> {
    const file = patchLogPath(clientId);

    try {
        await fsp.truncate(file, 0);
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            await fsp.writeFile(file, '');
            return;
        }
        throw err;
    }
}

/* =====================================================
   State loader
===================================================== */
async function readServerState(clientId: string): Promise<ServerState | null> {
    if (stateCache.has(clientId)) {
        return stateCache.get(clientId)!;
    }

    const metadata = await readMetadata(clientId);
    if (!metadata) return null;

    const state: ServerState = {
        metadata,
        patches: []
    };

    try {
        const log = await fsp.readFile(patchLogPath(clientId), 'utf-8');
        state.patches = log
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line));
    } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
    }

    stateCache.set(clientId, state);
    return state;
}

/* =====================================================
   Validation
===================================================== */
function validatePatchSequence(
    patch: Patch,
    state: ServerState,
    res: Response
): boolean {
    if (patch.baseSnapshotSeq !== state.metadata.snapshotSeq) {
        res.status(410).json({ error: 'Snapshot sequence mismatch' });
        return false;
    }

    if (patch.seq !== state.metadata.patchSeq) {
        res.status(409).json({
            error: 'Patch sequence out of order',
            seq: state.metadata.patchSeq,
            timestamp: state.patches.length
                ? state.patches[state.patches.length - 1].timestamp
                : Date.now()
        });
        return false;
    }

    return true;
}

/* =====================================================
   Routes
===================================================== */
app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

/* ---------- sync check ---------- */
app.post('/api/:clientId/sync/check', async (req, res, next) => {
    try {
        const clientId = sanitizeClientId(req.params.clientId);
        const state = await readServerState(clientId);
        if (!state) return res.status(404).json({ error: 'State not found' });

        const patch = req.body as Patch;
        if (!validatePatchSequence(patch, state, res)) return;

        res.json({ valid: true });
    } catch (err) {
        next(err);
    }
});

/* ---------- sync fetch ---------- */
app.get('/api/:clientId/sync', async (req, res, next) => {
    try {
        const clientId = sanitizeClientId(req.params.clientId);
        const state = await readServerState(clientId);
        if (!state) return res.status(404).json({ error: 'State not found' });

        const sinceSnapshotSeq = Number(req.query.sinceSnapshotSeq ?? 0);
        const sincePatchSeq = Number(req.query.sincePatchSeq ?? 0);

        if (req.query.full === 'true' || sinceSnapshotSeq < state.metadata.snapshotSeq) {
            return res.json({
                snapshotSeq: state.metadata.snapshotSeq,
                patchSeq: state.metadata.patchSeq,
                version: state.metadata.version,
                patches: state.patches
            } as ClientSyncResponse);
        }

        return res.json({
            type: 'patch',
            snapshotSeq: state.metadata.snapshotSeq,
            patchSeq: state.metadata.patchSeq,
            version: state.metadata.version,
            patches: state.patches.filter(p => p.seq >= sincePatchSeq)
        } as ClientSyncResponse);
    } catch (err) {
        next(err);
    }
});

/* ---------- snapshot download ---------- */
app.get('/api/:clientId/snapshot', async (req, res, next) => {
    try {
        const clientId = sanitizeClientId(req.params.clientId);
        const snapshot = await readSnapshot(clientId);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="snapshot.json"');
        res.send(snapshot);
    } catch (err) {
        next(err);
    }
});

/* ---------- snapshot upload ---------- */
app.post('/api/:clientId/snapshot', upload.none(), async (req, res, next) => {
    try {
        const clientId = sanitizeClientId(req.params.clientId);

        const metadata = {
            snapshotSeq: 0,
            patchSeq: 0,
            version: Number(req.body.version)
        };

        const state: ServerState = {
            metadata,
            patches: []
        };

        stateCache.set(clientId, state);

        await writeMetadata(clientId, metadata);
        await writeSnapshot(clientId, req.body.snapshot);
        await resetPatchLog(clientId);

        // Snapshot overwrite implies the server should drop stale binaries.
        await clearAllClientBinaries(clientId);

        res.json({
            snapshotSeq: 0,
            patchSeq: 0
        } as SyncMetadata);
    } catch (err) {
        next(err);
    }
});

/* ---------- binary upload/download/delete ---------- */
app.put(
    '/api/:clientId/binaries/:storageKey',
    express.raw({ type: '*/*', limit: '100mb' }),
    async (req, res, next) => {
        try {
            const clientId = sanitizeClientId(req.params.clientId);
            const storageKey = String(req.params.storageKey ?? '');
            if (!storageKey) return res.status(400).json({ error: 'Missing storageKey' });

            await ensureBinaryDir(clientId);
            const buf = req.body as Buffer;
            if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
                return res.status(400).json({ error: 'Empty body' });
            }

            await fsp.writeFile(binaryDataPath(clientId, storageKey), buf);
            await fsp.writeFile(
                binaryMetaPath(clientId, storageKey),
                JSON.stringify({ storageKey, mimeType: req.header('content-type') ?? 'application/octet-stream' }, null, 2)
            );

            return res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    }
);

app.get('/api/:clientId/binaries/:storageKey', async (req, res, next) => {
    try {
        const clientId = sanitizeClientId(req.params.clientId);
        const storageKey = String(req.params.storageKey ?? '');
        if (!storageKey) return res.status(400).json({ error: 'Missing storageKey' });

        const dataFile = binaryDataPath(clientId, storageKey);
        try {
            const metaRaw = await fsp.readFile(binaryMetaPath(clientId, storageKey), 'utf-8');
            const meta = JSON.parse(metaRaw);
            res.setHeader('Content-Type', meta?.mimeType || 'application/octet-stream');
        } catch {
            res.setHeader('Content-Type', 'application/octet-stream');
        }

        const buf = await fsp.readFile(dataFile);
        res.send(buf);
    } catch (err: any) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Binary not found' });
        next(err);
    }
});

app.delete('/api/:clientId/binaries/:storageKey', async (req, res, next) => {
    try {
        const clientId = sanitizeClientId(req.params.clientId);
        const storageKey = String(req.params.storageKey ?? '');
        if (!storageKey) return res.status(400).json({ error: 'Missing storageKey' });

        await deleteBinary(clientId, storageKey);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

/* ---------- sync push ---------- */
app.post('/api/:clientId/sync', async (req, res, next) => {
    try {
        const clientId = sanitizeClientId(req.params.clientId);

        const state = await readServerState(clientId);
        if (!state) return res.status(404).json({ error: 'State not found' });

        const patch = req.body as Patch;
        if (!validatePatchSequence(patch, state, res)) return;

        // Interpret binary deletes server-side.
        if (patch.binary?.del?.length) {
            await ensureBinaryDir(clientId);
            await Promise.all(patch.binary.del.map(k => deleteBinary(clientId, String(k))));
        }

        state.patches.push(patch);
        state.metadata.patchSeq = state.patches.length;

        /* Write-behind */
        appendPatch(clientId, patch);
        writeMetadata(clientId, state.metadata);

        /* snapshot every 100 patches */
        if (state.patches.length >= 100) {
            const currentSnapshot = await readSnapshot(clientId);
            if (!currentSnapshot) return res.status(404).json({ error: 'Snapshot not found' });

            const newSnapshot = applyPatch(JSON.parse(currentSnapshot), state.patches);

            state.metadata.snapshotSeq += 1;
            state.metadata.patchSeq = 0;
            state.patches = [];

            await writeSnapshot(clientId, JSON.stringify(newSnapshot));
            await writeMetadata(clientId, state.metadata);
            await resetPatchLog(clientId);
        }

        return res.json({
            snapshotSeq: state.metadata.snapshotSeq,
            patchSeq: state.metadata.patchSeq
        } as SyncMetadata);
    } catch (err) {
        next(err);
    }
});

/* =====================================================
   Error handlers
===================================================== */
app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((err: ApiError, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error('[Server Error]', err);
    res.status(status).json({ error: err.message ?? 'Internal Server Error' });
});

/* =====================================================
   Startup
===================================================== */
ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log(`Data directory: ${DATA_DIR}`);
        console.log('Press Ctrl+C to stop the server');
    });
});
import fs from 'fs/promises';
import express from 'express';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import sharp from 'sharp';
import { getBlob } from '../../src/services/binaryStore';
import type { RootState } from '../../src/app/store';
import { selectAllRooms } from '../../src/entities/room/selectors';
import { headlessLoadState, headlessSendMessage, printMessages } from '../../src/lib/headlessUtils.ts';
import webpush, { type PushSubscription } from 'web-push';
import 'dotenv/config';
import en from '../../src/i18n/locales/en.ts';
import ko from '../../src/i18n/locales/ko.ts';
import ja from '../../src/i18n/locales/ja.ts';
import { selectCharacterById } from '../../src/entities/character/selectors.ts';
import path from 'path';
import type { ProactiveTimeRestriction, ProactivePeriodicSettings, ProactiveProbabilisticSettings } from '../../src/entities/setting/types.ts';

const resources = {
    ko: { translation: ko },
    en: { translation: en },
    ja: { translation: ja }
};

i18next
    .use(initReactI18next)
    .init({
        resources,
        lng: 'en',
        fallbackLng: 'en',
        interpolation: { escapeValue: false },
    });

const pushPublicKey = process.env.push_public_key;
const pushPrivateKey = process.env.push_private_key;
if (!pushPublicKey || !pushPrivateKey || !process.env.SYNC_BASE_URL) {
    if (!pushPublicKey) {
        console.error(i18next.t('proactiveServer.missingEnv', { var: 'push_public_key' }));
    }
    if (!pushPrivateKey) {
        console.error(i18next.t('proactiveServer.missingEnv', { var: 'push_private_key' }));
    }
    if (!process.env.SYNC_BASE_URL) {
        console.error(i18next.t('proactiveServer.missingEnv', { var: 'SYNC_BASE_URL' }));
    }
    process.exit(1);
}

webpush.setVapidDetails(
    'https://github.com/YEJIN-DEV/yejingram',
    pushPublicKey,
    pushPrivateKey
);

interface SubscriptionBody extends PushSubscription {
    clientId: string;
}

function sanitizeClientId(input: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input)) {
        throw new Error('Invalid clientId format');
    }
    return input;
}

const avatarCache = new Map<string, Buffer>();

async function prepareAvatarCache(state: RootState, clientId: string, authorId: number) {
    try {
        const character = selectCharacterById(state, authorId);
        if (!character?.avatar) return;

        const blob = await getBlob(character.avatar.storageKey);
        if (!blob) return;

        const buffer = await blob.arrayBuffer();
        const resizedPng = await sharp(buffer)
            .resize(192, 192, { fit: 'cover' })
            .png()
            .toBuffer();

        const key = `${clientId}:${authorId}`;
        avatarCache.set(key, resizedPng);

        // 10분 후 캐시 삭제
        setTimeout(() => {
            avatarCache.delete(key);
        }, 10 * 60 * 1000);
    } catch (err) {
        console.error(`[${clientId}] Failed to cache avatar for ${authorId}:`, err);
    }
}

const SUBSCRIPTION_DIR = path.resolve(process.cwd(), 'data');
async function readSubscriptions(clientId?: string): Promise<PushSubscription | { [key: string]: PushSubscription }> {
    await fs.mkdir(SUBSCRIPTION_DIR, { recursive: true });

    if (clientId) {
        const safeClientId = sanitizeClientId(clientId);
        const filePath = path.join(SUBSCRIPTION_DIR, `${safeClientId}.json`);
        const json = await fs.readFile(filePath, 'utf-8');
        const parsed: PushSubscription = JSON.parse(json);
        return parsed;
    } else {
        const entries = await fs.readdir(SUBSCRIPTION_DIR, { withFileTypes: true });
        const subs: { [key: string]: PushSubscription } = {};

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            try {
                const json = await fs.readFile(path.join(SUBSCRIPTION_DIR, entry.name), 'utf-8');
                subs[entry.name.replace('.json', '')] = JSON.parse(json);
            } catch {
                // 개별 파일 오류는 무시하고 나머지 파일만 사용
                continue;
            }
        }
        return subs;
    }
}

export async function saveSubscription(subscription: SubscriptionBody): Promise<void> {
    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth || !subscription.clientId) {
        throw new Error('Invalid subscription object');
    }

    const safeClientId = sanitizeClientId(subscription.clientId);
    const { clientId, ...pure } = subscription;
    const filePath = path.join(SUBSCRIPTION_DIR, `${safeClientId}.json`);
    await fs.mkdir(SUBSCRIPTION_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(pure, null, 2));
}

function startSubscriptionApi(port: number = Number(process.env.HEADLESS_PORT ?? 4001)) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        next();
    });

    app.post('/api/:clientId/push/subscription', async (req, res) => {
        try {
            const clientId = sanitizeClientId(req.params.clientId);
            const subscription = { ...req.body, clientId };
            await saveSubscription(subscription as SubscriptionBody);
            res.json({ ok: true });
        } catch (err: any) {
            console.error('[Subscription API Error]', err);
            res.status(400).json({ error: err?.message ?? 'Invalid subscription' });
        }
    });

    app.post('/api/:clientId/push/unsubscribe', async (req, res) => {
        try {
            const clientId = sanitizeClientId(req.params.clientId);
            const filePath = path.join(SUBSCRIPTION_DIR, `${clientId}.json`);
            if (!(await fs.stat(filePath).catch(() => false))) {
                return res.status(404).json({ error: 'Subscription not found' });
            } else {
                await fs.unlink(filePath);
            }
            res.json({ ok: true });
        } catch (err: any) {
            console.error('[Unsubscription API Error]', err);
            res.status(500).json({ error: err?.message ?? 'Internal server error' });
        }
    });

    app.get('/api/:clientId/push/icon/:authorId', async (req, res) => {
        try {
            const clientId = sanitizeClientId(req.params.clientId);
            const authorId = Number(req.params.authorId);
            if (Number.isNaN(authorId)) {
                return res.status(400).json({ error: 'Invalid authorId' });
            }

            const cacheKey = `${clientId}:${authorId}`;
            if (avatarCache.has(cacheKey)) {
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                return res.end(avatarCache.get(cacheKey));
            } else {
                res.status(404).json({ error: 'Not found' });
            }
        } catch (err: any) {
            console.error('[Icon API Error]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.listen(port, () => {
        console.log(`[headless] Subscription API server (express) listening on port ${port}`);
    });
}

/**
 * 현재 시간이 제한 시간대에 해당하는지 확인
 * 제한 시간대라면 true 반환 (선톡 불가)
 */
function isInRestrictedTime(timeRestriction: ProactiveTimeRestriction): boolean {
    if (!timeRestriction.enabled || !timeRestriction.startHour || !timeRestriction.startMinute || !timeRestriction.endHour || !timeRestriction.endMinute) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = timeRestriction.startHour * 60 + timeRestriction.startMinute;
    const endMinutes = timeRestriction.endHour * 60 + timeRestriction.endMinute;

    // 시작 시간이 종료 시간보다 클 경우 (예: 23:00 ~ 07:00 = 밤 시간대)
    if (startMinutes > endMinutes) {
        // 자정을 넘기는 경우
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
        // 자정을 넘기지 않는 경우 (예: 13:00 ~ 15:00)
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
}

/**
 * 오늘 날짜를 YYYY-MM-DD 형식으로 반환
 */
function getTodayDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 클라이언트별 확률적 선톡 카운트 관리 (서버 메모리)
interface ProbabilisticTriggerState {
    date: string;
    count: number;
}
const probabilisticTriggerCounts: Map<string, ProbabilisticTriggerState> = new Map();

/**
 * 확률적 선톡을 트리거할지 결정
 * 하루에 최대 N번까지 트리거되며, 설정된 확률에 따라 결정
 * 카운트는 서버 측에서 관리
 */
function shouldTriggerProbabilistic(clientId: string, settings: ProactiveProbabilisticSettings): boolean {
    if (!settings.enabled || !settings.maxTriggersPerDay || !settings.probability) return false;

    const today = getTodayDateString();
    let triggerState = probabilisticTriggerCounts.get(clientId);

    // 날짜가 바뀌었거나 처음이면 리셋
    if (!triggerState || triggerState.date !== today) {
        triggerState = { date: today, count: 0 };
        probabilisticTriggerCounts.set(clientId, triggerState);
    }

    // 오늘 최대 횟수에 도달했다면 더 이상 트리거하지 않음
    const maxTriggers = settings.maxTriggersPerDay;
    if (triggerState.count >= maxTriggers) {
        console.log(`[${clientId}] ${i18next.t('proactiveServer.probabilisticMaxReached', { max: maxTriggers, current: triggerState.count })}`);
        return false;
    }

    // 확률 계산 (0-100 사이의 값)
    const roll = Math.random() * 100;
    const shouldTrigger = roll < settings.probability;

    console.log(`[${clientId}] ${i18next.t('proactiveServer.probabilisticRoll', { roll: roll.toFixed(2), probability: settings.probability, current: triggerState.count, max: maxTriggers })}`);

    if (shouldTrigger) {
        triggerState.count++;
        probabilisticTriggerCounts.set(clientId, triggerState);
        return true;
    }

    return false;
}

// 클라이언트별 마지막 주기적 선톡 시간 기록
const lastPeriodicTriggerTime: Map<string, number> = new Map();

/**
 * 주기적 선톡을 트리거할지 결정
 */
function shouldTriggerPeriodic(clientId: string, settings: ProactivePeriodicSettings): boolean {
    if (!settings.enabled || !settings.intervalMinutes) return false;

    const now = Date.now();
    const lastTrigger = lastPeriodicTriggerTime.get(clientId) ?? 0;
    const intervalMs = settings.intervalMinutes * 60 * 1000;

    if (now - lastTrigger >= intervalMs) {
        lastPeriodicTriggerTime.set(clientId, now);
        return true;
    }

    return false;
}

(async () => {
    startSubscriptionApi();

    while (true) {
        const subscription = await readSubscriptions();

        for (const [clientId, push] of Object.entries(subscription)) {
            try {
                console.log(`[${clientId}] ${i18next.t('proactiveServer.restoreStart')}`);

                const store = await headlessLoadState({
                    savetype: 'sync',
                    baseUrl: process.env.SYNC_BASE_URL!,
                    clientId
                });

                console.log(i18next.t('proactiveServer.restoreComplete'));

                const state = store.getState();
                const proactiveSettings = state.settings.proactiveSettings;

                if (!proactiveSettings.proactiveChatEnabled) {
                    console.log(i18next.t('proactiveServer.featureDisabled'));
                    continue;
                }

                // 제한 시간대 체크
                if (proactiveSettings.timeRestriction && isInRestrictedTime(proactiveSettings.timeRestriction)) {
                    console.log(`[${clientId}] ${i18next.t('proactiveServer.restrictedTime')}`);
                    continue;
                }

                // 주기적 선톡 또는 확률적 선톡 중 하나라도 트리거 조건을 만족해야 함
                let shouldSendProactive = false;

                // 주기적 선톡 체크
                if (proactiveSettings.periodicSettings?.enabled) {
                    if (shouldTriggerPeriodic(clientId, proactiveSettings.periodicSettings)) {
                        console.log(`[${clientId}] ${i18next.t('proactiveServer.periodicTriggered')}`);
                        shouldSendProactive = true;
                    }
                }

                // 확률적 선톡 체크 (하루 N번)
                if (proactiveSettings.probabilisticSettings?.enabled && !shouldSendProactive) {
                    if (shouldTriggerProbabilistic(clientId, proactiveSettings.probabilisticSettings)) {
                        console.log(`[${clientId}] ${i18next.t('proactiveServer.probabilisticTriggered', { probability: proactiveSettings.probabilisticSettings.probability })}`);
                        shouldSendProactive = true;
                    }
                }

                // 둘 다 비활성화되어 있으면 기본적으로 선톡 실행
                if (!proactiveSettings.periodicSettings?.enabled && !proactiveSettings.probabilisticSettings?.enabled) {
                    shouldSendProactive = true;
                }

                if (!shouldSendProactive) {
                    console.log(`[${clientId}] ${i18next.t('proactiveServer.conditionNotMet')}`);
                    continue;
                }

                const allRooms = selectAllRooms(state);
                if (!allRooms || allRooms.length === 0) {
                    console.error(i18next.t('proactiveServer.noRooms'));
                    continue;
                }

                // 선톡 허용된 방만 필터링
                const proactiveEnabledRooms = allRooms.filter(room => room.proactiveEnabled === true);
                if (proactiveEnabledRooms.length === 0) {
                    console.log(`[${clientId}] ${i18next.t('proactiveServer.noProactiveRooms')}`);
                    continue;
                }

                const randomRoom = proactiveEnabledRooms[Math.floor(Math.random() * proactiveEnabledRooms.length)];

                await headlessSendMessage({
                    store,
                    room: randomRoom,
                    onMessage: async (newlyAdded) => {
                        const characterName = selectCharacterById(state, newlyAdded.authorId)?.name ?? 'Unknown';
                        printMessages([newlyAdded]);
                        if (!avatarCache.has(`${clientId}:${newlyAdded.authorId}`)) {
                            await prepareAvatarCache(state, clientId, newlyAdded.authorId);
                        }

                        try {
                            await webpush.sendNotification(
                                push,
                                JSON.stringify({
                                    icon: `${proactiveSettings.proactiveServerBaseUrl}/api/${clientId}/push/icon/${newlyAdded.authorId}`,
                                    badge: '/yejingram.png',
                                    body: characterName + ": " + (newlyAdded.content ?? i18next.t('proactiveServer.stickerOrImage')),
                                    tag: randomRoom.id
                                })
                            );
                        } catch (err) {
                            console.error(`[${clientId}] ${i18next.t('proactiveServer.pushError')}`, err);
                        }
                    },
                    onStart: (id) => {
                        if (id) {
                            console.log(i18next.t('proactiveServer.messageGenerating'), id);
                        } else {
                            console.log(i18next.t('proactiveServer.messageComplete'));
                        }
                    },
                    t: i18next.t,
                    mode: 'proactive',
                });
            } catch (err) {
                console.error(`[${clientId}] Unhandled error during proactive processing:`, err);
            }
        }
        // 체크 주기: 1분
        await new Promise(resolve => setTimeout(resolve, 60 * 1000));
    }
})();

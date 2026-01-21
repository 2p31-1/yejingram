import fs from 'fs/promises';
import arg from 'arg';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { nanoid } from '@reduxjs/toolkit';
import { store } from '../src/app/store';
import { messagesActions } from '../src/entities/message/slice.ts';
import { selectRoomById } from '../src/entities/room/selectors';
import { selectMessagesByRoomId } from '../src/entities/message/selectors';
import { Message } from '../src/entities/message/types';
import { Room } from '../src/entities/room/types.ts';
import { backupStateToServer, buildBackupPayload, restoreStateFromPayload, restoreStateFromServer } from '../src/utils/backup';
import { SendMessage } from '../src/services/llm/LLMcaller';
import en from '../src/i18n/locales/en.ts';
import ko from '../src/i18n/locales/ko.ts';
import ja from '../src/i18n/locales/ja.ts';

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

function printMessages(messages: Message[]) {
    for (const m of messages) {
        const baseInfo = `- [${m.type}] authorId=${m.authorId} at ${m.createdAt}`;
        if (m.type === 'TEXT') {
            console.log(baseInfo + `\n  ${m.content ?? ''}`);
        } else if (m.type === 'STICKER') {
            console.log(baseInfo + `\n  [Sticker] ${m.sticker?.name ?? m.sticker?.id ?? 'unknown'}`);
        } else if (m.type === 'IMAGE') {
            console.log(baseInfo + `\n  [Image] ${m.file?.name ?? m.file?.mimeType ?? 'image'}`);
        } else {
            console.log(baseInfo);
        }
    }
}

function printRoomInfo(characterId: number) {
    const state = store.getState();
    const rooms = Object.values(state.rooms.entities).filter(r => r && r.memberIds.includes(characterId)) as Room[];

    for (const room of rooms) {
        console.log(`- ${room.name} (ID: ${room.id})`);
        const messages = selectMessagesByRoomId(state, room.id);
        console.log(`  Messages: ${messages.length}`); // 간단한 메시지 통계
        console.log(`  Last Message: ${messages.length > 0 ? messages[messages.length - 1].content : 'No messages'}`);
    }
}

function printCharacters() {
    const state = store.getState();
    const characters = Object.values(state.characters.entities).filter(c => c) as { id: number; name: string }[];
    for (const char of characters) {
        console.log(`Character: ${char.name} (ID: ${char.id})`);
        printRoomInfo(char.id);
        console.log('');
    }
}

(async () => {
    const argv = arg(
        {
            '--printCharacters': Boolean,
            '--printRoomInfo': Number,
            '--room': String,
            '--text': String,
            '--help': Boolean,
            '--file': String,
            '--sync': String,
            '--clientId': String,
            '-c': '--printCharacters',
            '-r': '--room',
            '-t': '--text',
            '-h': '--help',
            '-f': '--file',
            '-s': '--sync',
        },
        { permissive: true, argv: process.argv.slice(2) }
    );

    if (argv['--help']) {
        const usage = `
Usage:
    tsx headless/index.ts [options]
    node dist/headless/index.js [options]

Options:
    --printCharacters, -c            Print all characters and their room summaries
    --printRoomInfo <characterId>    Print room info for a specific character (number)
    --room <roomId>, -r <roomId>     Specify room ID to send message to
    --text <message>, -t <message>   Specify text message to add before sending
    --file <path>, -f <path>         Backup JSON path to restore (local file)
    --sync <baseUrl>, -s <baseUrl>   Remote sync server baseUrl (e.g., http://localhost:3001, --clientId required)
    --help, -h                       Show help and exit

Examples:
    tsx headless/index.ts -f backup.json --printCharacters
    tsx headless/index.ts -f backup.json --printRoomInfo 0
    tsx headless/index.ts -f backup.json -r 1760380953855-1760380955372 -t "Hello from CLI"
    tsx headless/index.ts -f backup.json -c
    tsx headless/index.ts --sync http://localhost:3001 --clientId asm6788 --printCharacters

Note:
    --file and --sync cannot be used at the same time.
    When using --sync, the --clientId option is required.
    When both --room and --text are provided, a message will be added to the room and a response will be generated.`.trim();
        console.log(usage);
        return;
    }

    // --file and --sync cannot be used together
    if (argv['--file'] && argv['--sync']) {
        console.error('Error: --file and --sync cannot be used together. Please choose only one.');
        return;
    }

    // --sync: load/save from remote server
    if (argv['--sync']) {
        const baseUrl = argv['--sync'];
        const clientId = argv['--clientId'];
        if (!clientId) {
            console.error('--sync requires --clientId option (or environment variable SYNC_CLIENT_ID).');
            return;
        }

        try {
            const ok = await restoreStateFromServer(clientId, baseUrl, true);
            if (!ok) {
                console.error('Failed to load state from server.');
                return;
            }
            console.log(`Remote sync state loaded: ${baseUrl} (clientId=${clientId})`);
        } catch (e: any) {
            console.error('Remote sync failed:', e?.message ?? e);
            return;
        }


        if (argv['--printCharacters']) {
            printCharacters();
            return;
        }
    }

    const backupFile = argv['--file'];
    if (backupFile) {
        try {
            const raw = await fs.readFile(backupFile, 'utf-8');
            await restoreStateFromPayload(JSON.parse(raw));
            console.log(`Backup loaded: ${backupFile}`);
        } catch (e: any) {
            console.error(`Failed to read backup file: ${backupFile}\n`, e?.message ?? e);
            return;
        }

        if (argv['--printCharacters']) {
            printCharacters();
            return;
        }
    }

    const printRoomInfoCharId = argv['--printRoomInfo'];
    if (typeof printRoomInfoCharId === 'number' && !Number.isNaN(printRoomInfoCharId)) {
        printRoomInfo(printRoomInfoCharId);
        return;
    } else if (argv['--printRoomInfo'] !== undefined) {
        console.error('Invalid character id for --printRoomInfo:', argv['--printRoomInfo']);
    }

    const state = store.getState();

    const roomId = argv['--room'];
    if (roomId) {
        if (!argv['--text']) {
            console.error('Please provide text content with --text when sending a message.');
            return;
        }

        const room = selectRoomById(state, roomId);
        if (!room) {
            console.error("Room not found:", roomId);
            return;
        }

        store.dispatch(messagesActions.upsertOne({
            id: nanoid(),
            roomId: room.id,
            authorId: 0,
            createdAt: new Date().toISOString(),
            type: 'TEXT',
            content: argv['--text']
        }));

        const beforeMessages = selectMessagesByRoomId(store.getState(), roomId);
        const beforeIds = new Set(beforeMessages.map(m => m.id));
        printMessages(beforeMessages);

        const sentNotificationIds = new Set<string>();

        const unsubscribe = store.subscribe(async () => {
            const allMessages = selectMessagesByRoomId(store.getState(), room.id);
            const newMessages = allMessages.filter(m => !beforeIds.has(m.id) && !sentNotificationIds.has(m.id));

            if (newMessages.length === 0) return;

            sentNotificationIds.add(newMessages[0].id);
            printMessages(newMessages);

            if (argv['--file'] && backupFile) {
                console.log("Saving backup file");
                const payload = buildBackupPayload();
                await fs.writeFile(backupFile, JSON.stringify(payload, null, 2));
            } else if (argv['--sync'] && !state.settings.syncSettings.syncEnabled) {
                console.log("Uploading remote sync state");
                const baseUrl = argv['--sync'];
                const clientId = argv['--clientId']!;

                try {
                    await backupStateToServer(clientId, baseUrl);
                    console.log(`Remote sync state saved: ${baseUrl} (clientId=${clientId})`);
                } catch (e: any) {
                    console.error('Failed to save remote sync state:', e?.message ?? e);
                    return;
                }

            }
        });

        store.dispatch({ type: 'messages/writingStart' });
        await SendMessage(
            room,
            (id) => {
                if (id) {
                    console.log("Message Generating... id:", id);
                } else {
                    console.log("Message generation completed.");
                }
            },
            i18next.t,
            "normal"
        );
        unsubscribe();
    }
})();

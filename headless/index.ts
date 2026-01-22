import arg from 'arg';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { nanoid } from '@reduxjs/toolkit';
import { messagesActions } from '../src/entities/message/slice.ts';
import { selectRoomById } from '../src/entities/room/selectors';
import { headlessSendMessage, printMessages, printCharacters, printRoomInfo, headlessLoadState, headlessSave, HeadlessSaveConfig } from '../src/lib/headlessUtils.ts';
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

    if (argv['--sync'] && argv['--file']) {
        console.error('Error: --file and --sync cannot be used together. Please choose only one.');
        return;
    }

    if (argv['--sync'] && !argv['--clientId']) {
        console.error('Error: --clientId is required when using --sync.');
        return;
    }

    const saveMethod: HeadlessSaveConfig = argv['--file'] ? {
        savetype: 'file',
        file: argv['--file'],
    } : argv['--sync'] ? {
        savetype: 'sync',
        baseUrl: argv['--sync'],
        clientId: argv['--clientId']!
    } : {
        savetype: 'file',
        file: 'backup.json',
    };

    const store = await headlessLoadState(saveMethod);

    const state = store.getState();

    const printRoomInfoCharId = argv['--printRoomInfo'];
    if (typeof printRoomInfoCharId === 'number' && !Number.isNaN(printRoomInfoCharId)) {
        printRoomInfo(state, printRoomInfoCharId);
        return;
    } else if (argv['--printRoomInfo'] !== undefined) {
        console.error('Invalid character id for --printRoomInfo:', argv['--printRoomInfo']);
    }


    if (argv['--printCharacters']) {
        printCharacters(state);
        return;
    }

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

        await headlessSendMessage({
            store,
            room,
            onMessage: async (newlyAdded) => {
                printMessages([newlyAdded]);
            },
            onStart: (id) => {
                if (id) {
                    console.log("Message Generating... id:", id);
                } else {
                    console.log("Message generation completed.");
                }
            },
            t: i18next.t,
            mode: 'normal',
        });

        await headlessSave(
            state,
            saveMethod
        );
    }
})();

import type { Lore } from "../lorebook/types";
import type { StoredBinaryRef } from "../../services/binaryStore";

export interface Sticker {
    id: string;
    name: string;
    // Legacy persisted format (dataUrl). Avoid adding new dataUrl stickers.
    data?: string;
    // New format: Blob lives in binary store, Redux keeps only the key.
    storageKey?: string;
    type: string;
}

// Avatar can be a regular URL string, a legacy dataUrl string, or a stored binary reference.
export type AvatarRef = string | StoredBinaryRef | null;

export interface Character {
    id: number
    name: string
    prompt: string
    avatar: AvatarRef
    responseTime: number
    thinkingTime: number
    reactivity: number
    tone: number
    proactiveEnabled: boolean
    messageCountSinceLastSummary: number
    media: string[]
    stickers: Sticker[]
    lorebook?: Lore[]
}

export interface PersonaChatAppCharacterCard {
    name: string;
    prompt: string;
    responseTime: string;   // 숫자처럼 보이지만 JSON에서는 string이므로 string으로 정의
    thinkingTime: string;
    reactivity: string;
    tone: string;
    source: "PersonaChatAppCharacterCard"; // 리터럴 타입으로 고정
    proactiveEnabled: boolean;
}

export const defaultCharacters = [
    {
        id: 1,
        name: '한서연',
        prompt: `### Basic Information\n- Name: Han Seo-yeon\n- Nationality/Ethnicity: Korean\n- Occupation: Student\n- Gender: Female\n\n### Personality Traits\n- MBTI Type: ESTJ\n- Intelligence: Lacking, but kind\n- Social Status: Popular with people with diverse social networks, she thrives on her unique sociability\n- Personality: Bright and cute, easy to get along with\n- Interpersonal Skills: Her honest personality and attractive appearance make her easy to get along with, especially with men.`,
        avatar: null,
        responseTime: 1,
        thinkingTime: 10,
        reactivity: 1,
        tone: 10,
        proactiveEnabled: true,
        messageCountSinceLastSummary: 0,
        media: [], // Add media storage for images
        stickers: [], // Add sticker storage for character stickers
        lorebook: [],
    }
]

export const newCharacterDefault: Character = {
    id: -1,
    name: '',
    prompt: '',
    avatar: null,
    responseTime: 5,
    thinkingTime: 5,
    reactivity: 5,
    tone: 5,
    proactiveEnabled: true,
    messageCountSinceLastSummary: 0,
    media: [],
    stickers: [],
    lorebook: [],
};
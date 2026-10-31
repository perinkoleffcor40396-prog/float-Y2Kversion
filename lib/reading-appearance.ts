"use client";

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { openIndexedDbAtLeast } from "./idb-open";
import { identityIndexedDbFactory, identityDatabaseName } from "./identity-runtime";

export type ReadingFontFamilyId = "system" | "song" | "serif" | "sans" | "custom";

export type ReadingAppearance = {
    fontFamily: ReadingFontFamilyId;
    fontSize: number;
    textColor: string;
    lineHeight: number;
    customFontName?: string;
};

export const READING_FONT_OPTIONS: Array<{ id: ReadingFontFamilyId; label: string; cssValue: string }> = [
    { id: "system", label: "系统阅读", cssValue: "var(--app-font-family)" },
    { id: "song", label: "宋体", cssValue: "\"Songti SC\", \"STSong\", \"Noto Serif SC\", serif" },
    { id: "serif", label: "衬线", cssValue: "\"Source Han Serif SC\", \"Noto Serif SC\", serif" },
    { id: "sans", label: "黑体", cssValue: "\"PingFang SC\", \"Hiragino Sans GB\", \"Noto Sans SC\", sans-serif" },
    { id: "custom", label: "自定义上传", cssValue: "var(--app-font-family)" },
];

const APPEARANCE_STORAGE_KEY = "ai_phone_reading_appearance_v1";
registerKvMigration(APPEARANCE_STORAGE_KEY);
const BG_DB_NAME = "reading-appearance-assets";
const BG_STORE_NAME = "assets";
const BG_KEY = "shared-background";
const FONT_KEY = "custom-font";

export const DEFAULT_READING_APPEARANCE: ReadingAppearance = {
    fontFamily: "system",
    fontSize: 20,
    textColor: "#111111",
    lineHeight: 2.3,
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function canUseStorage(): boolean {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeAppearance(raw: Partial<ReadingAppearance> | null | undefined): ReadingAppearance {
    const fontFamily = READING_FONT_OPTIONS.some((option) => option.id === raw?.fontFamily)
        ? raw!.fontFamily!
        : DEFAULT_READING_APPEARANCE.fontFamily;
    const fontSize = clamp(Number(raw?.fontSize ?? DEFAULT_READING_APPEARANCE.fontSize) || DEFAULT_READING_APPEARANCE.fontSize, 12, 30);
    const lineHeight = clamp(Number(raw?.lineHeight ?? DEFAULT_READING_APPEARANCE.lineHeight) || DEFAULT_READING_APPEARANCE.lineHeight, 1.2, 2.8);
    const textColor = typeof raw?.textColor === "string" && raw.textColor.trim()
        ? raw.textColor.trim()
        : DEFAULT_READING_APPEARANCE.textColor;
    const customFontName = typeof raw?.customFontName === "string" && raw.customFontName.trim()
        ? raw.customFontName.trim()
        : undefined;

    return { fontFamily, fontSize, textColor, lineHeight, customFontName };
}

export function resolveReadingFontFamily(fontFamily: ReadingFontFamilyId, customFontFamily?: string): string {
    if (fontFamily === "custom" && customFontFamily) return customFontFamily;
    return READING_FONT_OPTIONS.find((option) => option.id === fontFamily)?.cssValue || READING_FONT_OPTIONS[0].cssValue;
}

export function loadReadingAppearance(): ReadingAppearance {
    if (!canUseStorage()) return DEFAULT_READING_APPEARANCE;
    try {
        const raw = kvGet(APPEARANCE_STORAGE_KEY);
        return normalizeAppearance(raw ? JSON.parse(raw) : null);
    } catch {
        return DEFAULT_READING_APPEARANCE;
    }
}

export function saveReadingAppearance(appearance: ReadingAppearance): ReadingAppearance {
    const normalized = normalizeAppearance(appearance);
    if (!canUseStorage()) return normalized;
    try {
        kvSet(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // Ignore quota or serialization failures and keep in-memory settings usable.
    }
    return normalized;
}

async function openBackgroundDb(): Promise<IDBDatabase> {
    // A restored database can have a higher version but still be missing this
    // store. In that case, explicitly upgrade the existing database schema.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const db = await openIndexedDbAtLeast(BG_DB_NAME, 1, (upgradeDb) => {
            if (!upgradeDb.objectStoreNames.contains(BG_STORE_NAME)) {
                upgradeDb.createObjectStore(BG_STORE_NAME);
            }
        });
        if (db.objectStoreNames.contains(BG_STORE_NAME)) return db;

        const nextVersion = db.version + 1;
        db.close();
        try {
            const repairedDb = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = identityIndexedDbFactory().open(identityDatabaseName(BG_DB_NAME), nextVersion);
                request.onupgradeneeded = () => {
                    if (!request.result.objectStoreNames.contains(BG_STORE_NAME)) {
                        request.result.createObjectStore(BG_STORE_NAME);
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(request.error || new Error("阅读背景数据库升级被阻止"));
            });
            if (repairedDb.objectStoreNames.contains(BG_STORE_NAME)) return repairedDb;
            repairedDb.close();
        } catch (error) {
            // Another tab may have upgraded the database first; reopen and check.
            if (!(error instanceof DOMException) || error.name !== "VersionError") throw error;
        }
    }
    throw new Error("阅读背景数据库缺少 assets 数据表，修复失败");
}

export async function saveReadingBackground(blob: Blob | null): Promise<void> {
    const db = await openBackgroundDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BG_STORE_NAME, "readwrite");
        const store = tx.objectStore(BG_STORE_NAME);
        if (blob) store.put(blob, BG_KEY);
        else store.delete(BG_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

export async function loadReadingBackground(): Promise<Blob | null> {
    try {
        const db = await openBackgroundDb();
        const blob = await new Promise<Blob | null>((resolve, reject) => {
            const tx = db.transaction(BG_STORE_NAME, "readonly");
            const req = tx.objectStore(BG_STORE_NAME).get(BG_KEY);
            req.onsuccess = () => resolve((req.result as Blob) || null);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return blob;
    } catch {
        return null;
    }
}

export async function saveReadingCustomFont(blob: Blob | null): Promise<void> {
    const db = await openBackgroundDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BG_STORE_NAME, "readwrite");
        const store = tx.objectStore(BG_STORE_NAME);
        if (blob) store.put(blob, FONT_KEY);
        else store.delete(FONT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

export async function loadReadingCustomFont(): Promise<Blob | null> {
    try {
        const db = await openBackgroundDb();
        const blob = await new Promise<Blob | null>((resolve, reject) => {
            const tx = db.transaction(BG_STORE_NAME, "readonly");
            const req = tx.objectStore(BG_STORE_NAME).get(FONT_KEY);
            req.onsuccess = () => resolve((req.result as Blob) || null);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return blob;
    } catch {
        return null;
    }
}

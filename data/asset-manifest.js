import { ASSET_CODE_TABLE } from './asset-manifest.generated.js';

function normalizeAchievementId(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim().toUpperCase();
    const match = trimmed.match(/^([A-Z]{2})_?([0-9]{3})$/);
    if (!match) {
        return '';
    }

    return `${match[1]}_${match[2]}`;
}

function deriveFilename(id) {
    const normalizedId = normalizeAchievementId(id);
    if (!normalizedId) {
        return '';
    }

    const [prefix, sequence] = normalizedId.split('_');
    return `${prefix}${Number(sequence)}.png`;
}

function buildAssetManifest() {
    const entries = ASSET_CODE_TABLE
        .trim()
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [id, code, customFilename] = line.split(/\s+/);
            const normalizedId = normalizeAchievementId(id);
            const filename = customFilename || deriveFilename(normalizedId);
            const url = `https://i.postimg.cc/${code}/${filename}`;

            return [
                normalizedId,
                {
                    thumb: url,
                    full: url,
                    fit: 'cover',
                },
            ];
        });

    return Object.fromEntries(entries);
}

export const ASSET_MANIFEST = buildAssetManifest();

export function getAchievementAsset(id) {
    const normalizedId = normalizeAchievementId(id);
    return ASSET_MANIFEST[normalizedId] ?? ASSET_MANIFEST[id] ?? null;
}

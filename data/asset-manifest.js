export const ASSET_MANIFEST = {
    //
    // 预留接口：
    //
    // RE_001: {
    //     thumb: '../assets/achievements/RE_001-thumb.webp',
    //     full: '../assets/achievements/RE_001.webp',
    //     fit: 'cover',
    //     placeholder: 'memory',
    // },
    //
    // 说明：
    // - `thumb`：卡面小图
    // - `full`：后续详情页大图
    // - 路径既可以是相对 `album-frame.html` 的路径，也可以是绝对 `file:///` / `https://` 地址
    // - 以后如果你想做“压缩包导入”，只要把压缩包解到本地目录，再把路径写进这里即可
};

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

export function getAchievementAsset(id) {
    const normalizedId = normalizeAchievementId(id);
    return ASSET_MANIFEST[normalizedId] ?? ASSET_MANIFEST[id] ?? null;
}

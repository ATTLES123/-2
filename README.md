# Album Bridge Pure

纯 SillyTavern 插件版成就相册。

## 特点

- 只需要安装一个 Git 插件
- 只对指定角色卡生效
- 内置悬浮小相册入口
- 内置开书、合书、拖拽翻页、目录页、成就页
- 支持 `mvu` / 变量文本里输出成就 ID 触发解锁

## 仓库结构

- `manifest.json`
- `index.js`
- `style.css`
- `album-frame.html`
- `album-frame.css`
- `album-frame.js`
- `data/achievements.js`
- `data/asset-manifest.js`
- `character-card-binding.example.json`

这个目录本身就是给酒馆 Git 安装器使用的仓库根目录。

## 安装

### 1. 上传到 GitHub

把 `C:\Users\16680\Desktop\相册\album-pure-plugin` 这个目录作为仓库根目录上传。

### 2. 在酒馆里安装

在扩展安装窗口填你的 Git 仓库地址，例如：

`https://github.com/your-name/album-bridge-pure`

### 3. 合并角色卡字段

把 `character-card-binding.example.json` 里的 `extensions.album_book` 合并到目标角色卡。

默认字段：

- `bind_id`: `luochaoxi_private_album_v1`
- `profile`: `pure-plugin-flagship`
- `variable_key`: `album_unlocked_ids`
- `variable_scope`: `global`
- `trigger_key`: `album_unlock_queue`
- `trigger_scope`: `global`
- `clear_trigger_on_read`: `true`

## MVU / 变量触发

当前支持两种输入：

- `album_unlocked_ids`：直接保存已解锁 ID 列表
- `album_unlock_queue`：临时触发文本，插件会自动抓取 `RE_001` 这类成就 ID

运行时也保留了接口：

- `window.AlbumBridge.unlock('RE_001')`
- `window.AlbumBridge.lock('RE_001')`
- `window.AlbumBridge.syncUnlocked([...])`
- `window.AlbumBridge.openTo('RE_001')`

## 图片接口

图片资源仍然通过 `data/asset-manifest.js` 配置。

示例：

```js
RE_001: {
    thumb: './assets/RE_001.webp',
    full: './assets/RE_001-full.webp',
    fit: 'cover',
    placeholder: '门铃响了',
}
```

## 成就数据

当前导入来源：

- `C:\Users\16680\Desktop\成就清单.txt`

当前实际导入：

- `641` 条成就

重新导入命令：

```bash
node tools/import-achievements.mjs "C:\Users\16680\Desktop\成就清单.txt" "C:\Users\16680\Desktop\相册\album-pure-plugin\data\achievements.js"
```

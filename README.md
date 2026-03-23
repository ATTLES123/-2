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
- `read_mvu_achievements`: `true`
- `mvu_path`: `stat_data.成就`

## MVU / 变量触发

当前支持两种输入：

- `album_unlocked_ids`：直接保存已解锁 ID 列表
- `album_unlock_queue`：临时触发文本，插件会自动抓取 `RE_001` / `RE001` 这类成就 ID
- `stat_data.成就`：直接读取 MVU 成就对象键名，兼容旧相册脚本的 `RE001`

运行时也保留了接口：

- `window.AlbumBridge.unlock('RE_001')`
- `window.AlbumBridge.unlock('RE001')`
- `window.AlbumBridge.lock('RE_001')`
- `window.AlbumBridge.syncUnlocked([...])`
- `window.AlbumBridge.openTo('RE_001')`

## 旧角色卡适配

你这张 `C:\Users\16680\Desktop\潮去汐来，她一直在.json` 里的旧相册脚本有两个关键特点：

- 解锁来源不是单独变量，而是直接读 `Mvu.getMvuData({ type: 'message', message_id: -1 }).stat_data.成就`
- 成就 ID 格式是 `RE001`、`DA042` 这种无下划线格式

现在插件已经兼容这套方式：

- 角色卡字段里开启 `read_mvu_achievements: true`
- 使用 `mvu_path: "stat_data.成就"`
- 插件内部会把 `RE001` 统一规范成 `RE_001`

## 旧相册脚本删除

如果你切到插件版，旧卡里建议移除或禁用：

- `data.extensions.tavern_helper.scripts` 里 `name: "相册"` 的那一项

通常保留下面两项更稳：

- `name: "zod结构脚本"`
- `name: "MVUzod"`

这样 MVU 的 `成就` 数据结构还在，但旧 UI 不会和新插件重复挂载。

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

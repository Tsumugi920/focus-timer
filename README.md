# 专注时钟 · 番茄钟与任务统计

纯静态单页应用：番茄钟 + 任务清单 + 专注统计。只用 `index.html`、`style.css`、`app.js` 三个文件，零依赖、零构建、零后端，数据保存在浏览器 localStorage。

## 使用方法

1. 下载本目录的 `index.html`、`style.css`、`app.js`，放在同一文件夹，双击 `index.html` 即可在浏览器中使用（推荐最新版 Chrome / Edge / Firefox / Safari）。
2. **番茄钟**
   - 三档模式：专注（默认 25 分钟）、短休息（5 分钟）、长休息（15 分钟），点右上角「⚙ 设置」可自定义时长。
   - 「开始 / 暂停 / 重置」控制倒计时；每完成 4 个番茄（间隔可调）自动进入长休息。
   - 倒计时结束会播放提示音（Web Audio 现场生成，无音频文件）并弹出桌面通知（需授权）。
   - 刷新或关闭页面后重新打开，计时进度会恢复；若关闭期间倒计时已走完，会按完成计入。
3. **任务清单**
   - 输入任务名后回车或点「添加」；勾选完成；「✕」删除。
   - 点任务行的「专注」把它设为当前专注任务（再点一次取消），番茄钟完成一段专注后会自动给该任务 +1 🍅。
   - 任务被勾选为完成后会自动解除关联。
4. **统计**
   - 每日专注分钟数与完成番茄数自动保存到 localStorage，「近 7 天」柱状图（纯 CSS/JS 手写）直观展示，今天一列高亮。
   - 数据只存在本机浏览器中：换浏览器 / 换设备不共享，清除浏览器数据会一并清除，不会上传到任何服务器。

## 部署到 GitHub Pages

1. 在 GitHub 上新建一个公开仓库（例如 `focus-timer`）。
2. 把 4 个文件（`index.html`、`style.css`、`app.js`、`README.md`）上传到仓库根目录。
   - 网页方式：仓库页 → **Add file → Upload files** → 拖入文件 → Commit。
   - 或命令行：
     ```bash
     git init
     git add index.html style.css app.js README.md
     git commit -m "专注时钟：番茄钟 + 任务 + 统计"
     git branch -M main
     git remote add origin https://github.com/<你的用户名>/focus-timer.git
     git push -u origin main
     ```
3. 打开仓库 **Settings → Pages**，在 **Build and deployment** 里：
   - Source 选 **Deploy from a branch**；
   - Branch 选 `main`、目录选 `/ (root)`，点 **Save**。
4. 等待约 1 分钟，访问 `https://<你的用户名>.github.io/focus-timer/` 即可。

> 说明：GitHub Pages 是 HTTPS，桌面通知可正常授权使用；直接用 `file://` 打开时，个别浏览器可能限制通知授权，但不影响计时、任务和统计功能。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `index.html` | 页面结构（番茄钟 / 任务清单 / 统计 / 设置弹窗） |
| `style.css` | 全部样式，含桌面与移动端响应式布局 |
| `app.js` | 全部逻辑：计时器状态机、任务管理、统计与柱状图、localStorage 持久化、通知与提示音 |

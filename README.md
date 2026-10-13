# PianoEveryday · 公开练琴室

[在线使用](https://greynails.github.io/PianoEveryday-Public/)

导入自己的 MIDI 和 PDF / 图片琴谱，即可在浏览器里播放、调速、循环练习，并连接 MIDI 键盘逐音跟练。无需账号，也不需要启动本地服务器。

## 使用

1. 导入一个 `.mid` / `.midi` 文件（SMF Type 0 / 1，最大 20 MB）。
2. 可选：添加对应的 PDF（最大 50 MB）或 PNG / JPEG / WebP 琴谱。
3. 选择「聆听播放」或「等你弹对」，调整速度和声部。
4. USB 连接 MIDI 键盘后点击「连接 MIDI 键盘」并授权；也可点击屏幕琴键。
5. PDF 不自动识别音符。播放和跟练以 MIDI 为准；需要原谱进度线时，逐行标记 MIDI 时间对应的谱面位置。

文件只在本次浏览器会话中处理，不上传、不保存到 GitHub，也不向其他访客共享。刷新后需重新导入。跟练判断音高，不对演奏时值和力度打分。Web MIDI 需要支持该功能的 HTTPS 浏览器，推荐桌面 Chrome / Edge。非钢琴音色以钢琴回放，打击乐通道忽略。

## 托管与维护

这是完整的静态网页程序，发布源为本仓库的 `main` 分支根目录。GitHub Pages 发布后不依赖任何本地进程；更新 `main` 后会自动重新发布。`.nojekyll` 保证静态资源原样提供。

本地预览：`python3 -m http.server 8766`，打开 `http://localhost:8766/`。

解析测试：`node tests/midi.test.mjs`（使用新版 Node）。

本公开仓库仅包含网页程序、开源组件、钢琴采样及原创练习片段，不包含任何私人曲库资料。

## 致谢

- Salamander Grand Piano / Alexander Holm / CC BY 3.0，见 [音源许可](audio/piano/SOURCE-LICENSE.txt)。
- Mozilla PDF.js 5.4.624 / Apache-2.0，见 [组件许可](vendor/LICENSE)。

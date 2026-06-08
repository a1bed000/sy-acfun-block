# AcFun 文章区助手

Chrome / Edge 扩展（MV3）。在 AcFun 文章区（`/v/as*`）和首页信息流中识别作者 UID，**屏蔽**或**标记**特定用户的内容，提升浏览体验。

---

## 功能

- **屏蔽**指定 UID 的文章 / 评论
  - 隐藏（默认）
  - 折叠为占位，鼠标悬停可临时展开
  - 变灰弱化
- **关注 / 标记**指定 UID（不会屏蔽，只是视觉上突出）
  - 背景高亮
  - 边框标记
  - 角标
- **详情页作者区**显示快捷操作按钮（屏蔽 / 关注 / 解除）
- **每张文章卡片**悬停出现小按钮，一键屏蔽或关注
- **弹窗**显示当前页检测到的所有作者 UID，状态一目了然
- **选项页**完整管理名单：
  - 屏蔽 / 关注 两个标签
  - 搜索、备注、批量添加 / 清空
  - 导入 / 导出（JSON 或纯文本）
- 数据存于 `chrome.storage.local`，不上传、不联网

---

## 安装

1. 打开 Chrome / Edge，访问 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角 **「开发者模式」**
3. 点击 **「加载已解压的扩展程序」**
4. 选择本仓库根目录（包含 `manifest.json` 的目录）
5. 安装完成，工具栏会出现橙色漏斗图标

> 之后若修改了文件，回到扩展页点 **「重新加载」** 即可生效。

---

## 使用

### 第一次打开

点击工具栏图标会打开**选项页**，先添加几个 UID；也可以直接进入 AcFun 文章区，用卡片上的小按钮逐个添加。

### 三种添加方式

1. **详情页作者区**：「屏蔽此用户」/「关注此用户」按钮
2. **文章卡片悬停**：右上角出现小按钮
3. **弹窗**：「添加 UID」输入框，粘贴用户主页链接或纯数字 UID 都可以

### 屏蔽 / 关注 区别

| 状态 | 屏蔽 | 关注 |
|------|------|------|
| 列表中的卡片 | 默认隐藏（可改为折叠或变灰） | 高亮 / 边框 / 角标 |
| 详情页正文 | 整篇隐藏 | 高亮作者区 |
| 评论 | 隐藏 | 高亮 |

### 导入 / 导出

**导出（纯文本）** 格式：

```
# 屏蔽名单
123456: 内容质量差
789012

# 关注名单
345678
```

**导出（JSON）** 格式：

```json
{
  "blockList": ["123456", "789012"],
  "markList": ["345678"],
  "notes": { "123456": "内容质量差" }
}
```

导入时支持「合并」或「替换」。

---

## 适用页面

- `https://www.acfun.cn/v/as*` — 文章详情
- `https://www.acfun.cn/` — 首页信息流
- 文章详情页的评论区

> 如果你想让扩展在更多 AcFun 子页生效，编辑 `manifest.json` 里的 `content_scripts.matches` 即可。

---

## 目录结构

```
sy.acfunas.block/
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── shared/
│   │   └── storage.js          # 共享存储工具
│   ├── content/
│   │   ├── content.js          # 注入到 acfun.cn 的脚本
│   │   └── content.css         # 注入样式
│   ├── background/
│   │   └── service-worker.js   # MV3 service worker
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── options/
│       ├── options.html
│       ├── options.css
│       └── options.js
└── scripts/
    └── generate_icons.py       # 重新生成图标的脚本
```

---

## 调试

- 扩展页 → 「服务工作者」旁的 **「检查视图」** → Console 看 `service-worker.js` 日志
- 任意 AcFun 页面 → F12 → Console 过滤 `AcFunBlock`
- 改完代码：在扩展页点 **「重新加载」** 并刷新 AcFun 页面

### 选择器不适配？

AcFun 前端会更新。如果卡片识别或 UID 提取失效，编辑 `src/content/content.js`：

- `findCardContainer(articleLink)` — 卡片容器识别
- `findAuthorInContainer(container)` — 在容器里找作者链接
- `findCommentItems()` — 评论区识别
- `findDetailContainer()` — 详情页主体识别

修改保存后，扩展页点「重新加载」+ 刷新 AcFun 即可。

---

## 隐私

- 全部数据存在本地 `chrome.storage.local`
- 不发起任何网络请求
- 不读取任何非 AcFun 域名下的页面
- 卸载即清除所有数据

---

**版本**: 1.0.0  
**Manifest**: V3

# ZotEasyTran

<img src="docs/icon.png" width="128" alt="ZotEasyTran icon" align="right">

**为“精读英文文献”而做的 Zotero 本地翻译插件。**
不是通用翻译器，也不是聊天助手：目标是在读论文时，用尽可能短的时间拿到**可用的中文译文、准确的术语和原文发音**。

[![Zotero 7/8/10](https://img.shields.io/badge/Zotero-7%20%7C%208%20%7C%2010-CC2936?style=flat-square&logo=zotero&logoColor=white)](https://www.zotero.org)
[![Local first](https://img.shields.io/badge/local--first-offline-1B3A4B?style=flat-square)](#为什么是本地化)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-2F6F5E?style=flat-square)](LICENSE)

---

## 这个项目解决什么问题

精读文献时，真正费时间的通常不是“看不懂一个生词”，而是：

- 一句话里术语很多，在线翻译经常把 **polymer / damping / strain / potential** 译成日常义；
- 等网络、等接口、复制到另一个窗口，思路被打断；
- 公式、单位、引用编号、材料牌号被翻译器改坏；
- 读完想回听某个词或某句话的发音，还要重新选中、再点一次；
- 自己的课题有一批固定译法，通用翻译器记不住。

ZotEasyTran 的选择很明确：**优先本地化、低延迟、可定制**。
用离线词典保证术语稳定，用机械句法引擎保证速度与可解释性，用系统 TTS 解决发音，用术语表解决个人课题的固定译法。

> 它不追求“像人写的漂亮译文”。它追求的是：**在精读场景下，最快得到一份术语可靠、结构可读、不会泄露内容的中文草稿。**

## 为什么是本地化

- **不联网**：选区和原文不离开本机，不经过任何翻译 API。
- **没有额度**：不消耗 token，不按字符计费，不受并发限制。
- **低延迟**：本地 SQLite 查询 + 规则引擎，常规句子通常在毫秒到几十毫秒级。
- **可离线**：飞机、内网、保密环境都能用。
- **可修改**：术语表、领域词条、机械规则都在仓库里，不依赖黑盒模型。

这也是本项目做二次开发的核心原因：**通用翻译服务无法针对个人课题做稳定的术语约束，而本地引擎可以。**

## 主要功能

### 单词

- 约 **77 万词条 + 36.7 万词组**（ECDICT 为主，合并 WordNet / COW / CMUdict 信息）。
- 音标、词性、本义、引申义、专业义、词形还原。
- 单词卡片不再显示 COCA/BNC 频次，避免干扰阅读。
- 自动播放原文发音；支持重播。

### 句子 / 段落

- 完全本地的机械英译中引擎：分词、词性消歧、短语匹配、被动/从句/并列结构转移、后处理。
- 优先使用学术术语表与领域词表，其次才是通用词典义。
- 数字、单位、百分比、引用、DOI、公式、材料牌号（如 `PUU-1`、`La3+`）原样保护。
- 支持材料、物理、计算机等领域的术语短语。

### 发音与注释

- 使用系统离线语音（Windows SAPI / macOS / Linux 语音）朗读**英文原文**。
- 在 PDF 中点击高亮/注释，注释弹窗出现时自动重播；点弹窗里的中文可再次重播。
- 阅读器侧栏的注释头也有 🔊。
- 切换标签/窗口自动停止朗读，避免后台一直读。

### 术语表

- 设置中可直接导入 CSV：`term,translation[,domain][,caseSensitive]`。
- 术语表优先于内置词典和学术词表。
- 示例：[docs/glossary.example.csv](docs/glossary.example.csv)。

### 与上游一致的保存方式

- 翻译仍通过 Zotero 原生的“加入笔记 / 标注评论”保存。
- 不新增历史数据库、不写子笔记、不生成音频文件。
- 上游的 40+ 在线翻译服务仍然保留；本地引擎是默认选项。

## 与上游项目的关系

本项目是 **二次开发**，基于：

- GitHub：[`windingwind/zotero-pdf-translate`](https://github.com/windingwind/zotero-pdf-translate)
- 本地参考路径：`\\wsl.localhost\Ubuntu\home\shzhao\AGitRep\GitRep\zotero-pdf-translate`
- 上游版本基线：`v2.4.8`（commit `2e3d77d`）
- 上游许可证：**AGPL-3.0-or-later**

主要改动：

- 新增完全本地的英汉词典、机械句法引擎、领域术语表；
- 新增本地 TTS、注释重播、术语表导入；
- 默认服务改为本地词典/本地句子引擎；
- 保留上游在线服务与 Zotero 原生交互；
- 针对精读场景修复选区拼接、短词误拼、术语覆盖等问题。

这不是上游官方版本。上游作者与贡献者的版权归其各自所有；本项目的修改与新增部分见 [NOTICE](NOTICE)。

## 安装

### 1. 安装插件

从 [Releases](https://github.com/ShZhao27208/ZotEasyTran/releases) 下载最新的 `.xpi`：

1. Zotero → 工具 → 插件；
2. 右上角齿轮 → 从文件安装插件；
3. 选择 `.xpi`，重启 Zotero。

也可以本地构建：

```bash
npm ci
npm run build
# 产物：build/zot-easy-tran.xpi
```

### 2. 准备本地词典

词典文件约 **241 MB**，不放进 Git 仓库。任选一种方式：

**方式 A：构建**

```bash
npm run build:dict
# 产物：dist/dictionary.sqlite
```

**方式 B：放到 Zotero 数据目录**

把 `dictionary.sqlite` 放到：

```text
<Zotero 数据目录>/zoteasytran/dictionary.sqlite
```

Windows 示例：

```text
E:\Zotero_Storage\zoteasytran\dictionary.sqlite
```

也可以到 `设置 → ZotEasyTran 本地翻译 → 词典文件 → 选择…` 指定任意路径。

### 3. 重启 Zotero

插件启动时会自检词典；`selftest.json` 会写到词典同目录，便于排查版本、词条数、语音和句子引擎状态。

## 使用

- **选单词**：弹出词典卡，自动读原文；卡片内可重播。
- **选句子/段落**：弹出机械译文；可复制、加入笔记/注释。
- **注释重播**：点 PDF 高亮 → 注释弹窗出现时自动读；点弹窗中的中文可再读。
- **侧边栏**：翻译结果下方有 🔊 重播。
- **术语表**：设置 → 导入 CSV；自己的固定译法优先。

### 关于“拼接模式”

上游有一个拼接模式：按住 `Ctrl/⌘`，或勾选侧栏“拼接”，可以把多次选区拼成一条任务。

它适合“分几次选同一句”，但也很容易把后一次选区拼到上一句上，表现为“后面翻译全是同一句”。本项目已加保护：

- Ctrl 状态过期自动失效；
- 完整新句子、单词、短术语默认新建任务；
- 只有明确的下半句片段才继续拼接。

仍建议：**平时不要勾选“拼接”**；确需拼接时再按住 Ctrl。

## 构建与开发

要求：Node.js ≥ 20（建议 24）、npm。

```bash
npm ci
npm run build          # 构建插件
npm run build:dict     # 构建本地词典（需要下载/准备源数据）
npm run test:unit      # 单元测试
npm run check:dict     # 词典完整性检查
npm run lint
```

关键目录：

```text
src/modules/local/          本地词典、机械引擎、TTS、术语
src/modules/services/       翻译服务注册（本地服务 + 上游在线服务）
src/elements/               阅读器弹窗、侧栏、设置页
addon/                      清单、偏好、语言包、图标
scripts/build-dict.mjs      词典构建
test/unit/                  引擎与格式化测试
docs/DICTIONARY.md          数据源、schema、构建细节
```

### 按个人需求二次开发

推荐从这三处入手：

1. **术语表 CSV**：不改代码，直接导入课题固定译法；
2. **`src/modules/local/domainTerms.ts`**：加领域词与多词短语；
3. **`src/modules/local/engine.ts`**：改句法规则、标记规则、后处理。

改完执行：

```bash
npm run test:unit
npm run build
```

## 已知限制

- 机械引擎不是大模型：复杂长句、省略、指代、修辞仍可能生硬；它优先保证术语与结构可读。
- 词典未收录的极新术语会保留英文；可加入术语表解决。
- 不同系统的中文/英文语音质量差异较大；插件只调用系统语音，不内置语音模型。
- 词典文件较大，仓库不直接包含；需构建或单独放置。
- 本项目面向精读与术语稳定，不适合替代通用聊天翻译。

## 许可证与署名

本项目是 **AGPL-3.0-or-later** 衍生作品。

- 上游 `zotero-pdf-translate` 采用 **AGPL-3.0-or-later**；
- 本仓库整体（包含上游代码、修改与新增部分）按 **AGPL-3.0-or-later** 分发，见 [LICENSE](LICENSE)；
- 上游版权与第三方数据源署名见 [NOTICE](NOTICE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；
- 不使用 Apache-2.0 作为本项目许可证。

## 致谢

- [windingwind/zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate)：上游插件、Zotero 交互与在线服务；
- [ECDICT](https://github.com/skywind3000/ECDICT)：英汉词典数据（MIT）；
- WordNet 3.0、Chinese Open Wordnet、CMUdict：词义、词形与音标补充；
- Zotero 与 zotero-plugin-template 社区。

如果这个项目帮到你精读文献，欢迎提 issue 或直接改 `domainTerms.ts` 提交 PR。

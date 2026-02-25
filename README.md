# 层级管理器（hierarchy-manager）

这是一个 SillyTavern 第三方前端扩展，用于给以下数据增加“路径层级折叠显示”：

- World Info（世界书）
- Chat Completion 预设 Prompt 列表（`prompts`）

并支持 CharacterBook 路径字段同步。

## 主要功能

1. 在 `#world_popup_entries_list` 中按路径分组展示条目（可展开/收起）。
2. 给每个条目维护路径字段：`entries[*].path_chain`。
3. 在世界书根级维护文件夹列表：`folder_paths`（可保留空文件夹）。
4. 在预设 Prompt Manager（`#completion_prompt_manager_list`）中按路径分组展示 prompt，并维护：
   - `prompts[*].path_chain`
   - `folder_paths`
5. 自动同步到角色卡：
   - `data.character_book.entries[*].path_chain`
   - `data.character_book.folder_paths`

## 新增字段

### 世界书 JSON

- `entries[uid].path_chain: string`
- `folder_paths: string[]`

### 角色卡 CharacterBook

- `data.character_book.entries[i].path_chain: string`
- `data.character_book.folder_paths: string[]`

### Chat Completion 预设

- `prompts[i].path_chain: string`
- `folder_paths: string[]`

## 路径格式

- 分隔符：`/`
- 示例：`设定/组织/黑曜议会`
- 自动规范化：去掉首尾 `/`，去掉空段，自动补齐父路径。

## 使用方式

1. 打开 World Info 编辑器。
2. 在顶部工具栏点击“层级”按钮开启/关闭层级视图。
3. 每个世界书条目头部新增“路径”输入框，填写后会自动保存。
4. 点击“新建文件夹”可插入空目录（会写入 `folder_paths`）。

预设 Prompt 列表：

1. 打开 Chat Completion 的 Prompt Manager。
2. 在每个 prompt 名称下方会出现“路径”输入框。
3. 顶部提供“新建文件夹 / 重命名文件夹 / 删除空文件夹”按钮。
4. 可通过拖拽在文件夹中重排；路径与 `folder_paths` 会自动规范化并保存。

## 安装路径

将整个文件夹放到：

`SillyTavern/public/scripts/extensions/third-party/hierarchy-manager/`

然后在扩展管理里启用“层级管理器”。

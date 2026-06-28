# Changelog

## [1.7.0] - 2026-06-28

### Added
- 点击日历月份标签可创建或打开月度笔记（使用事件捕获阶段拦截）
- 月度笔记日期段落双击进入编辑，失焦自动保存
- 支持 Escape 键取消编辑（不保存）
- 编辑状态智能判断：未聚焦/未修改时失焦自动取消，已修改时失焦自动保存
- `DateActionModal` 弹窗样式优化，限制宽度避免影响其他弹窗
- 月度笔记区域 checkbox 任务列表对齐样式修复

### Fixed
- 修复 `.modal` 全局样式影响 Obsidian 其他弹窗（如 New Daily Note）宽度的问题，改为 `.date-action-modal` 专属类名
- 修复 Escape 取消编辑时内容被清空的 bug（添加 `isCancelling` 标志位）
- 修复编辑模式下点击其他区域导致空白内容被保存的问题

### Changed
- 移除编辑区域的 Save/Cancel 按钮，改为失焦自动保存交互
- 移除无用的 `.mt-edit-actions`、`.mt-edit-save`、`.mt-edit-cancel` 样式

### Known Issues
- 选框（checkbox）对齐问题尚未完全修复，待进一步调试

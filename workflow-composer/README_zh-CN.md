# @maitask/workflow-composer

根据自然语言描述和官方包目录生成可审阅的 Maitask 工作流图。Plane 从
`POST /workflows/drafts` 调用本包。结果在人工确认并创建之前不是正式工作流。

## 契约

- 输入包含 `description`、`language` 和 `catalog`
- 输出包含 `name`、`description`、`nodes`、`edges`、`notes` 和 `warnings`
- 包名必须来自提供的目录
- 凭证、适配器标识和 webhook 密钥保持为空
- 缺少凭证或图不合法时返回 `success: false`

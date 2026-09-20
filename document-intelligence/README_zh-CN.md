# @maitask/document-intelligence

对文档进行摘要、分类或结构化抽取。包调用 OpenAI 兼容的 Chat Completions
接口；缺少凭证或模型结果不可发布时失败终止，并返回带来源的发布文稿。

## 任务

- `summarize`：可发布的标题、正文和来源列表
- `classify`：仅使用显式标签列表进行分类
- `extract`：按 `options.schema` 抽取 JSON 字段

## 选项

| 字段 | 说明 |
| --- | --- |
| `task` | `summarize`、`classify` 或 `extract` |
| `language` | `zh-CN` 或 `en` |
| `labels` | `classify` 必填 |
| `schema` | `extract` 必填 |
| `ai.apiKey` | 提供商凭证 |
| `ai.baseUrl` | OpenAI 兼容基址 |
| `ai.model` | 模型标识 |
| `output.includeSources` | 在发布文稿中附加来源链接 |

没有抽取式回退。缺少凭证、空补全或不可发布的正文一律返回 `success: false`。

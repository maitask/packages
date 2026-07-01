# Maitask 官方包贡献指南

感谢你为官方 Maitask 包生态做出贡献。为确保包保持生产级质量，请遵循以下流程：

## 1. 立项或提交问题
- 先在 issue 中描述计划的改动（新增包 / 功能 / 修复）。
- 包命名需遵循 `@maitask/<name>`，并面向 Node.js 18+ 运行时。

## 2. 本地开发
- 如有需要，可复制现有包作为起点。
- 根据需要提供 TypeScript 类型定义。
- 新功能必须提供生产可用的 `example.json`；如果 `package.json` 使用 `files` 白名单，也必须把 `example.json` 纳入发布产物。
- 展示元数据统一写在 `maitask.locales.en` 与 `maitask.locales.zh` 下。如果只有一组中性展示文案，则使用扁平的 `maitask.locales.display_name`、`description`、`category`、`keywords` 作为默认兜底。

## 3. 验证清单
- 执行 `npm install` 并确保 lint/测试通过（如项目提供脚本）。
- 运行 `npm pack` 确认最终发布产物无误。
- 当修改包元数据或发布产物时，可使用 `scripts/publish_to_plane.sh <package-dir>` 向开发环境 Plane 做 registry 发布验证。
- 使用 Maitask Runtime 本地测试：
  ```bash
  cd ../../runtime
  cargo run -- run @maitask/package-name --input sample.json
  ```

## 4. 文档维护
- 在 [PACKAGES.md](./PACKAGES.md) 中补充或更新对应条目。
- 如 README 中新增引用，请同步更新 [README.md](./README.md) 与 [README_zh-CN.md](./README_zh-CN.md)。

## 5. 提交 Pull Request
- 再次运行 `npm pack`，必要时在 PR 描述中附上产物信息。
- 关联 issue，并说明测试范围与结果。
- 提交 message/body 必须使用简洁、正式且符合代码改动内容的英文。除非仓库工具强制要求，不使用 `fix:`、`feat:` 或其它 Conventional Commit 前缀。
- 维护者会进行复核、补充测试，并通过 `scripts/publish_to_plane.sh` 发布，确保 registry 元数据与 tarball 存储保持一致。

如需协调重大版本发布，可通过 `team@maitask.com` 联系维护团队。

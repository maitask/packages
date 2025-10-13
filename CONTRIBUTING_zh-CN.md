# Maitask 官方包贡献指南

感谢你为官方 Maitask 包生态做出贡献。为确保包保持生产级质量，请遵循以下流程：

## 1. 立项或提交问题
- 先在 issue 中描述计划的改动（新增包 / 功能 / 修复）。
- 包命名需遵循 `@maitask/<name>`，并面向 Node.js 18+ 运行时。

## 2. 本地开发
- 如有需要，可复制现有包作为起点。
- 根据需要提供 TypeScript 类型定义。
- 新功能请在 `examples/` 中附带示例数据或说明。

## 3. 验证清单
- 执行 `npm install` 并确保 lint/测试通过（如项目提供脚本）。
- 运行 `npm pack` 确认最终发布产物无误。
- 使用 Maitask Engine 本地测试：
  ```bash
  cd ../../engine
  cargo run -- run @maitask/package-name --input sample.json
  ```

## 4. 文档维护
- 在 [PACKAGES.md](./PACKAGES.md) 中补充或更新对应条目。
- 如 README 中新增引用，请同步更新 [README.md](./README.md) 与 [README_zh-CN.md](./README_zh-CN.md)。

## 5. 提交 Pull Request
- 再次运行 `npm pack`，必要时在 PR 描述中附上产物信息。
- 关联 issue，并说明测试范围与结果。
- 维护者会进行复核、补充测试并负责最终发布。

如需协调重大版本发布，可通过 `team@maitask.com` 联系维护团队。

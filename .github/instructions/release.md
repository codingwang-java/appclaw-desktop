# AppClaw 发布操作指南

当用户要求"发布"或"发版"时，执行以下流程：

## 1. 更新版本号

在 `package.json` 中更新 `version` 字段。版本号规则：`major.minor.patch`

## 2. Git 操作

```powershell
git add package.json <其他变更文件>
git commit -m "chore: bump version to v<版本号>"
git tag v<版本号>
git push
git push origin v<版本号>
```

## 3. GitHub Actions 自动执行

推送 tag 会触发 `.github/workflows/build.yml`，自动完成：

1. `npm install` + `npm run build`
2. `electron-builder --win --publish always` 生成 exe 并上传
3. 自动将 draft release 发布为正式版（`draft: false`）

## 4. 验证

无需手动操作。确认 https://github.com/codingwang-java/appclaw-desktop/releases 上显示最新版本即可。客户端启动后自动检测更新。
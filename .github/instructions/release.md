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

## 3. 检查构建

推送 tag 会触发 GitHub Actions（`.github/workflows/build.yml`），自动构建并在 GitHub Releases 创建 draft release。

## 4. 发布正式版

GitHub Actions 默认创建 draft release，需要手动发布为正式版（`draft: false`），否则客户端无法检测到更新。

```powershell
# 获取 release id
$r = Invoke-RestMethod -Uri "https://api.github.com/repos/codingwang-java/appclaw-desktop/releases/tags/v<版本号>" -Headers @{"Authorization"="token $env:GH_TOKEN"}
# 发布为正式版
Invoke-RestMethod -Uri "https://api.github.com/repos/codingwang-java/appclaw-desktop/releases/$($r.id)" -Headers @{"Authorization"="token $env:GH_TOKEN"} -Method Patch -Body '{"draft":false}' -ContentType "application/json"
```

## 5. 验证

确认 https://github.com/codingwang-java/appclaw-desktop/releases 上 release 显示为正式版。客户端启动后应能检测到更新。
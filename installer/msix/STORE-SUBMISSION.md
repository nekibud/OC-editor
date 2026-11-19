# Microsoft Store 提交说明（OC editor）

## 关于 `runFullTrust` 警告

这是**预期警告，不是包损坏**。

OC editor 是 WinForms + Microsoft Edge WebView2 的 Win32 桌面程序，打包为 MSIX。
`runFullTrust` 是这类桌面程序启动自身的必要能力；删除它会导致程序无法启动。
本项目只声明了 `runFullTrust` 一个受限能力，没有 `broadFileSystemAccess`、
`allowElevation`、`packageManagement`、`startupTask` 等其他受限能力。

## 可直接粘贴到 Partner Center 的英文说明

> OC editor is a local-first Windows desktop application for character and
> worldbuilding creation. The package is a Win32 desktop app (WinForms host +
> Microsoft Edge WebView2) packaged as MSIX, so it requires the standard
> `runFullTrust` capability to launch its own desktop process and read/write the
> user's own local application data (WebView2 profile, IndexedDB, and local
> images).
>
> The app does not request elevation, does not install services or drivers,
> does not access other applications' data, and does not use
> `broadFileSystemAccess`. It has no account system, no cloud sync, no telemetry,
> and no automatic update. All content remains on the user's device and is only
> exported when the user explicitly chooses an export action.
>
> `runFullTrust` is the only restricted capability declared. It is required for
> the desktop host process; without it the application cannot start.

## 中文说明（给审核/客服）

> OC editor 是一款完全离线的 Windows 桌面创作软件，使用 WinForms + WebView2。
> 打包为 MSIX 后必须声明 `runFullTrust` 才能启动桌面进程并读写用户自己的本地数据
> （WebView2 配置、IndexedDB、本地图片）。
>
> 软件不申请管理员权限，不安装服务/驱动，不访问其他应用的数据，不使用
> `broadFileSystemAccess`；没有账号、云同步、遥测或自动更新。所有内容只保存在
> 用户本机，只有用户主动导出时才会生成文件。
>
> `runFullTrust` 是本包唯一声明的受限能力，删除后软件无法启动。

## Partner Center 操作

1. 在包页面确认已上传 `OC-editor-0.20.6.msix`。
2. 如果页面提示 “Click Save to confirm removal of the indicated package(s)…”，
   这是把旧包标记为移除；确认无误后点页面底部 **Save** 提交这次变更。
3. 在 **Restricted capabilities / 受限能力** 处填写上面的英文说明并提交审批。
4. 审批通过前，这个警告会一直显示；它不表示包本身验证失败。

## 隐私与数据位置

- 商店版数据目录：`%LOCALAPPDATA%\Packages\<包家族名>\LocalState\OC editor\WebView2`
- 便携版 / Setup：`%LOCALAPPDATA%\OC editor\WebView2`
- 无网络请求、无遥测、无崩溃上报、无自动更新。
- 完整隐私说明见仓库根目录 `PRIVACY.md`。

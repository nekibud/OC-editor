# Microsoft Store MSIX 打包说明

这个目录是 **Microsoft Store 提交包** 的源文件：`AppxManifest.xml` + 商店图标。

> 官方说明：提交到 Microsoft Store 的 MSIX **不需要自己签名**，商店会在提交时签名。
> 只有在本地/侧载测试时才需要用自签名证书。参见
> [Sign your MSIX package](https://learn.microsoft.com/windows/msix/package/sign-msix-package-guide)。

## 一、确认商店身份

`AppxManifest.xml` 顶部的 `Identity` 必须与 Partner Center 里应用的
「包/标识」一致：

```xml
<Identity
  Name="nekibud.OCeditor"
  Publisher="CN=A253FC2F-9875-4EC2-81A3-B72B3FBF5200"
  Version="0.22.1.0"
  ProcessorArchitecture="x64" />
```

- `Name`：Partner Center → 产品 → 产品标识 → **包/标识名称**（Package/Identity Name）
- `Publisher`：同一页面的 **发布者 ID**（Publisher ID，形如 `CN=...`）
- `Version`：必须比上一次提交的版本高；商店包版本号是四段式（`x.y.z.0`）。

如果和你商店里的值不同，改这两个属性后重新打包即可。

## 二、打包

前置条件：安装 .NET 10 SDK 与 Windows SDK 的 `makeappx.exe`
（`Microsoft.Windows.SDK.BuildTools` NuGet 包里也有）。

```powershell
# 在仓库根目录执行
powershell -ExecutionPolicy Bypass -File installer/msix/build-msix.ps1 `
  -MakeAppx "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe"
```

脚本会：

1. 用 `dotnet publish` 生成自包含单文件 `OCeditor.exe`（压缩，约 47 MB）；
2. 把 `OCeditor.exe`、`wwwroot/`、`Assets/`、`AppxManifest.xml` 组装到 `artifacts/msix-layout`；
3. 调用 `makeappx pack` 生成 `artifacts/OC-editor-<Version>.msix`。

## 三、提交到 Partner Center

1. Partner Center → 你的应用 → **包**；
2. 删除旧包（或直接新增），上传 `OC-editor-<Version>.msix`；
3. 等待校验通过后提交审核。

商店会用自己的证书重新签名，所以不需要 `.pfx`，也不需要在本地信任证书。

## 四、本地测试（可选）

要在本机双击安装，需要先信任一个与 `Publisher` 同名的自签名证书：

```powershell
$cert = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature `
  -Subject "CN=A253FC2F-9875-4EC2-81A3-B72B3FBF5200" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
Export-PfxCertificate -Cert $cert -FilePath devcert.pfx -Password (ConvertTo-SecureString "dev" -AsPlainText -Force)
Import-PfxCertificate -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" -FilePath devcert.pfx -Password (ConvertTo-SecureString "dev" -AsPlainText -Force)
signtool sign /fd SHA256 /f devcert.pfx /p dev /a OC-editor-0.22.1.msix
```

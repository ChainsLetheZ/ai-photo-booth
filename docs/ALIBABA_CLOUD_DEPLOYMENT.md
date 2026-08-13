# 阿里云 OSS + 函数计算 FC 部署

## 架构

- 拍照电脑只在本机运行 `/booth`，保留摄像头与打印能力。
- 本机 Node 服务携带上传令牌，向函数计算 FC 申请 5 分钟有效的 OSS V4 预签名 URL，再把成片和原图直接上传私有 OSS；图片不经过 FC 请求体。
- FC 把编号占位、领取令牌、照片元数据和墙面索引保存为私有 OSS JSON 对象，不再依赖 CloudBase/COS 或另一套数据库。
- 大屏打开阿里云静态站点的 `?view=wall` 页面，每 2 秒从 FC 同步。
- 手机扫描随机领取链接，通过 FC 获取短时 OSS 下载 URL。

建议使用两个 Bucket：

1. `photo-booth-private`：私有读写，保存照片和 JSON 数据。
2. `photo-booth-site`：公共读，开启静态网站托管，只保存前端 `dist/`。

## 1. 创建私有 OSS Bucket

在上海区域创建私有 Bucket，记下完整名称。不要为照片 Bucket 开启公共读。

给 FC 执行角色授予最小 OSS 权限。把下面的 Bucket 名替换成实际值：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject"],
      "Resource": ["acs:oss:*:*:photo-booth-private/photo-booth/*"]
    }
  ]
}
```

FC 会通过执行角色取得临时 STS 凭证；不要把 AccessKey 写入代码或 `s.yaml`。

## 2. 部署函数计算

安装并配置 Serverless Devs 后执行：

```powershell
cd functions/photoBoothApi
npm ci
$env:PHOTO_BOOTH_FC_ROLE_ARN='acs:ram::<account-id>:role/<role-name>'
s deploy -y
```

部署前修改 `functions/photoBoothApi/s.yaml` 中的三个环境变量：

- `PHOTO_BOOTH_OSS_BUCKET`：私有照片 Bucket。
- `PHOTO_BOOTH_OSS_REGION`：例如 `oss-cn-shanghai`。
- `PHOTO_BOOTH_UPLOAD_TOKEN`：至少 32 字节的随机密钥。

HTTP 触发器必须允许匿名访问 GET、POST、OPTIONS。应用自己的上传令牌会保护所有 POST；GET 用于公开照片墙和随机领取链接。部署后记下公网函数 URL。

## 3. 部署静态站点

复制 `.env.aliyun.example` 为 `.env.aliyun.local`，填写：

```dotenv
VITE_ALIBABA_CLOUD_ENABLED=true
VITE_ALIBABA_CLOUD_API_URL=https://<function-url>
VITE_PUBLIC_APP_URL=https://<site-domain>/ai-photo-booth/index.html
```

构建并把 `dist/` 内容上传到静态 Bucket 的 `ai-photo-booth/` 前缀：

```powershell
npm run build:aliyun
ossutil cp -r dist oss://photo-booth-site/ai-photo-booth/ -f
```

将静态网站默认首页设为 `index.html`。如果使用 CDN 或自定义域名，让 `/ai-photo-booth/*` 回源到这个前缀并启用 HTTPS。

## 4. 配置拍照电脑

复制 `.env.local.example` 为 `.env.local`：

```dotenv
PHOTO_BOOTH_CLOUD_SYNC=true
PHOTO_BOOTH_FC_API_URL=https://<function-url>
PHOTO_BOOTH_UPLOAD_TOKEN=<与-FC-一致的随机密钥>
VITE_ALIBABA_CLOUD_ENABLED=true
VITE_PUBLIC_APP_URL=https://<site-domain>/ai-photo-booth/index.html
# 只有公司网络必须走代理时才保留：
# PHOTO_BOOTH_HTTPS_PROXY=http://localhost:3128
```

启动后使用：

- 拍照端：`https://localhost:3000/booth`
- 大屏端：`https://<site-domain>/ai-photo-booth/index.html?view=wall`
- 手机端：结果页自动生成二维码。

## 5. 上线前验证

```powershell
npm run test:rules
npm run build
npm run build:aliyun
```

再做一轮真实设备冒烟测试：拍照、上墙、扫码预览、下载、重启大屏后恢复历史照片。确认浏览器能访问 FC 域名和 `*.oss-cn-shanghai.aliyuncs.com`。

## 运维与隐私

- 上传令牌只能保存在 FC 环境变量和拍照电脑 `.env.local`。
- OSS 预签名上传 URL 有效期 5 分钟，照片读取 URL 默认 1 小时。
- 活动结束后，按隐私告知期限删除私有 Bucket 的 `photo-booth/` 前缀。
- FC 的墙面索引采用单拍照端的现场模型；不要同时运行多个拍照端发布照片。
- 开启 OSS 生命周期规则作为兜底，避免活动照片超期保留。

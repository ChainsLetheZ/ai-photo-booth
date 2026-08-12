# 腾讯云 CloudBase 部署 / Tencent CloudBase Deployment

## 中文

### 架构

- 拍照电脑在本地运行 `/booth`，摄像头与打印不暴露到公网。
- 本地 Node 服务携带私密上传令牌，将成片和原图上传到 CloudBase。
- 大屏电脑打开 CloudBase 静态站点的 `?view=wall` 页面，每 2 秒同步一次。
- 手机扫描结果页二维码，通过随机领取令牌查看并下载自己的照片。
- 三台设备只需能访问互联网，不要求连接同一个 Wi-Fi。

本项目固定使用环境 `uxgs-d4gv4c7qr60f22622`、集合 `PhotoBoothPhotos`、函数
`photoBoothApi`、网关前缀 `/photo-booth` 和静态目录 `/ai-photo-booth/`。现有根目录
应用 `supplier-day-feedback` 不应被覆盖。

### CloudBase 控制台配置

1. 保持 `PhotoBoothPhotos` 为“无权限（ADMINONLY）”。
2. 创建 Node.js 云函数 `photoBoothApi`，上传 `cloudfunctions/photoBoothApi/`，入口为
   `index.main`，并设置环境变量 `PHOTO_BOOTH_UPLOAD_TOKEN`。
3. 在 HTTP 网关添加 `/photo-booth` 路由并指向该函数，开启路径透传；GET、POST、
   OPTIONS 均需可用。
4. 执行 `npm run build:cloudbase`，把 `dist` 内的文件上传到静态托管目录
   `/ai-photo-booth/`，不要上传到根目录。
5. 拍照电脑复制 `.env.local.example` 为 `.env.local`，把同一令牌填入
   `PHOTO_BOOTH_UPLOAD_TOKEN`，然后双击对应系统的启动脚本。

### 现场地址

- 拍照端：`http://localhost:3000/booth`
- 大屏端：`https://uxgs-d4gv4c7qr60f22622-1317468313.tcloudbaseapp.com/ai-photo-booth/index.html?view=wall`
- 手机端：由拍照结果页面自动生成二维码。

上传令牌只能存在于 CloudBase 函数环境变量和拍照电脑的 `.env.local`，不得提交到 Git。
活动结束后应按隐私告知的期限删除 `photo-booth/` 云存储文件及对应数据库记录。

## English

### Architecture

- The capture computer runs `/booth` locally, keeping camera and printer access off the public internet.
- Its local Node service attaches a private upload token and sends the portrait and source image to CloudBase.
- The display computer opens the CloudBase static `?view=wall` page and refreshes every two seconds.
- A guest scans the result-page QR code and uses a random claim token to view and download only that photo.
- All three devices only need internet access; they do not need the same Wi-Fi network.

This project uses environment `uxgs-d4gv4c7qr60f22622`, collection `PhotoBoothPhotos`, function
`photoBoothApi`, gateway prefix `/photo-booth`, and static directory `/ai-photo-booth/`. Do not
overwrite the existing root application `supplier-day-feedback`.

### CloudBase console setup

1. Keep `PhotoBoothPhotos` at ADMINONLY permission.
2. Create the Node.js cloud function `photoBoothApi`, upload `cloudfunctions/photoBoothApi/`, set
   the entry to `index.main`, and add the `PHOTO_BOOTH_UPLOAD_TOKEN` environment variable.
3. Add an HTTP Gateway route at `/photo-booth`, target the function, enable path passthrough, and
   allow GET, POST, and OPTIONS.
4. Run `npm run build:cloudbase` and upload the contents of `dist` into the static-hosting directory
   `/ai-photo-booth/`, not the hosting root.
5. On the capture computer, copy `.env.local.example` to `.env.local`, insert the same token as
   `PHOTO_BOOTH_UPLOAD_TOKEN`, and double-click the launcher for that operating system.

### Event URLs

- Capture: `http://localhost:3000/booth`
- Wall: `https://uxgs-d4gv4c7qr60f22622-1317468313.tcloudbaseapp.com/ai-photo-booth/index.html?view=wall`
- Phone: generated automatically as a QR code on the result screen.

The upload token may exist only in the function environment and the capture computer's `.env.local`;
never commit it to Git. After the event, delete the `photo-booth/` storage objects and matching database
records according to the stated privacy retention period.

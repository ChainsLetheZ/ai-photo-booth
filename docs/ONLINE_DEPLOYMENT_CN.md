# AI Photo Booth 公网部署

## 目标架构

- 拍照电脑：本地运行 `/booth`，负责摄像头、AI 生成和本地打印。
- 公网服务器：保存照片、提供 WebSocket 同步与手机下载。
- 大屏电脑：打开 `https://你的域名/wall`。
- 用户手机：二维码打开 `https://你的域名/photo/<随机领取令牌>`。

手机、大屏和拍照电脑只需分别能访问互联网，不需要处于同一个局域网。

## 腾讯云资源

第一版使用一台腾讯云轻量应用服务器或 CVM，建议：

- 地域：与活动地点接近，例如上海。
- 系统：Ubuntu 24.04 LTS。
- 配置：至少 2 核 CPU、4 GB 内存、80 GB SSD。
- 安全组：开放 TCP 80、443；SSH 22 仅向管理员 IP 开放。
- 域名：例如 `photo.example.cn`，A 记录指向服务器公网 IP。
- 中国大陆服务器上的域名需要完成 ICP 备案；若时间不足，应选择已备案域名或中国香港地域。

## 服务器安装

在服务器安装 Docker Engine 和 Docker Compose，然后克隆本仓库：

```bash
git clone <企业 GitHub 仓库地址> ai-photo-booth
cd ai-photo-booth
cp .env.production.example .env.production
```

修改 `.env.production`：

```text
PUBLIC_DOMAIN=photo.example.cn
PHOTO_BOOTH_UPLOAD_TOKEN=一段至少32字符的随机字符串
```

不要提交 `.env.production`。启动：

```bash
docker compose --env-file .env.production up -d --build
```

Caddy 会自动申请并续期 HTTPS 证书，并代理普通 HTTP、照片下载和 WebSocket。

## 现场入口

```text
拍照电脑：http://localhost:3000/booth
大屏电脑：https://photo.example.cn/wall
手机领取：https://photo.example.cn/photo/<随机领取令牌>
```

大屏应直接打开公网 `/wall`，不要打开拍照电脑的局域网 IP。

## 数据与备份

照片和 `wall-entries.json` 位于 Docker 卷 `photo_data`。活动前应测试：

```bash
docker compose ps
docker compose logs -f app
```

活动结束后导出或删除照片，并按活动隐私告知的保存期限执行。二维码采用随机领取令牌；三位短编号只用于现场大屏，不作为照片访问凭证。

## 本地跨平台

不要在 Mac 与 Windows 之间复制 `node_modules`。两台电脑共享源码与 `package-lock.json`，但分别执行 `npm ci`：

- Mac：双击 `启动-Mac.command`
- Windows：双击 `启动-Windows.bat`

锁文件同时包含 Mac 和 Windows 的原生可选依赖；每台电脑会自动选择自己的版本。

## 尚需绑定的生产参数

在确定腾讯云公网域名后，需要把拍照电脑的本地 Node 服务锁定到该域名，并由本地服务在服务端附加上传口令。上传口令不能放入 Vite 前端或二维码中。

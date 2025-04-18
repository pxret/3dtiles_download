# 3DTiles 地图数据下载工具

一个用于下载3DTiles格式地图数据的Node.js工具，支持目录结构保持和断点续传功能。

## 主要特性

- ✨ 智能解析3DTiles数据结构
- 📁 自动复制服务器目录结构
- ⏸️ 断点续传功能
- 🔑 自动API密钥管理
- ⚡ 多线程并发下载
- 🔄 自动恢复中断的下载任务

## 开始使用

### 系统要求

- Node.js 14.0.0 或更高版本
- npm 6.0.0 或更高版本

### 安装

克隆仓库并安装依赖：

```bash
npm install
```

## 使用方法

```bash
npm start
```

程序将开始下载指定的3DTiles数据。下载的文件将保存在`downloaded`目录中，下载记录将保存在`download_record.db`文件中。

## 配置

你可以在`index.js`文件中修改以下配置：

```javascript
const config = {
  baseUrl: 'https://xxxx',
  initialPath: 'tileset.json',
  apiKey: 'xxxxxxxxxxxxxxxxx',
  downloadDir: path.join(__dirname, 'downloaded'),
  dbPath: path.join(__dirname, 'download_record.db'),
  concurrentDownloads: 6,
  downloadInterval: { min: 1000, max: 2000 },
  downloadDuration: 10 * 60 * 1000,
  pauseDuration: 5 * 60 * 1000
};
```
baseUrl为3DTiles数据的基本URL，initialPath为初始路径（如：f2/tileset.json、tileset.json），apiKey为API密钥，downloadDir为下载目录，dbPath为数据库路径。
concurrentDownloads为并发下载数，downloadInterval为下载间隔，downloadDuration为下载时长，pauseDuration为暂停时长。

## 中断和恢复

如果下载过程被中断（例如按下Ctrl+C），程序会自动保存下载记录。下次启动时，程序将从中断处继续下载。
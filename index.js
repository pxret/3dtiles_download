const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const url = require('url');
const { URL } = require('url');
const sqlite3 = require('sqlite3').verbose();

// 配置
const config = {
  baseUrl: 'https://xxxxxxxxxxxxxx/',
  initialPath: 'tileset.json',
  apiKey: 'xxxxxxxxxxxxxxxxx',
  downloadDir: path.join(__dirname, 'downloaded'),
  dbPath: path.join(__dirname, 'download_record.db'),
  concurrentDownloads: 6,
  downloadInterval: { min: 1000, max: 2000 },
  downloadDuration: 10 * 60 * 1000,
  pauseDuration: 5 * 60 * 1000
};

// 下载记录
let downloadRecord = {
  downloaded: [],
  pending: []
};

let db;

// 初始化数据库
async function initDB() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(config.dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS downloaded_files (
          path TEXT PRIMARY KEY,
          download_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS pending_files (
          path TEXT PRIMARY KEY,
          add_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 新增表记录已处理的 tileset
        db.run(`CREATE TABLE IF NOT EXISTS processed_tilesets (
          url TEXT PRIMARY KEY,
          process_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  });
}

// 初始化
async function init() {
  await fs.ensureDir(config.downloadDir);
  await initDB();
  
  // 加载下载记录
  return new Promise((resolve, reject) => {
    db.all('SELECT path FROM downloaded_files', [], (err, downloaded) => {
      if (err) {
        reject(err);
        return;
      }
      
      db.all('SELECT path FROM pending_files', [], (err, pending) => {
        if (err) {
          reject(err);
          return;
        }
        
        downloadRecord.downloaded = downloaded.map(row => row.path);
        downloadRecord.pending = pending.map(row => row.path);
        console.log(`已加载下载记录，已下载: ${downloadRecord.downloaded.length} 文件，待下载: ${downloadRecord.pending.length} 文件`);
        resolve();
      });
    });
  });
}

// 更新下载记录
async function updateRecord(path, isDownloaded = true) {
  return new Promise((resolve, reject) => {
    if (isDownloaded) {
      db.run('INSERT OR REPLACE INTO downloaded_files (path) VALUES (?)', [path], (err) => {
        if (err) {
          reject(err);
          return;
        }
        db.run('DELETE FROM pending_files WHERE path = ?', [path], (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } else {
      db.run('INSERT OR REPLACE INTO pending_files (path) VALUES (?)', [path], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }
  });
}

// 修改 downloadFile 函数
async function downloadFile(fileUrl) {
  // 确保URL是完整的URL
  let fullUrl = fileUrl;
  if (!fullUrl.startsWith('http')) {
    fullUrl = new URL(fileUrl, config.baseUrl).href;
  }
  
  // 如果URL不包含key参数，添加它
  const urlWithKey = fullUrl.includes('?') 
    ? `${fullUrl}&key=${config.apiKey}` 
    : `${fullUrl}?key=${config.apiKey}`;
  
  const relativePath = extractLocalPath(fullUrl);
  const localPath = path.join(config.downloadDir, relativePath);
  
  // 检查是否已下载
  if (downloadRecord.downloaded.includes(relativePath)) {
    console.log(`文件已下载，跳过: ${relativePath}`);
    return localPath;
  }
  
  try {
    // 确保目录存在
    await fs.ensureDir(path.dirname(localPath));
    
    console.log(`下载文件: ${relativePath}`);
    const response = await axios({
      method: 'GET',
      url: urlWithKey,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
    
    // 写入文件
    await fs.writeFile(localPath, response.data);
    
    // 更新下载记录
    await updateRecord(relativePath, true);
    downloadRecord.downloaded.push(relativePath);
    downloadRecord.pending = downloadRecord.pending.filter(p => p !== relativePath);
    
    // 添加随机延迟
    await sleep(getRandomInterval());
    
    console.log(`文件下载完成: ${relativePath}`);
    return localPath;
  } catch (error) {
    console.error(`下载文件失败 ${relativePath}:`, error.message);
    throw error;
  }
}

// 修改 downloadWithConcurrencyLimit 函数
async function downloadWithConcurrencyLimit(urls) {
  const chunks = [];
  for (let i = 0; i < urls.length; i += config.concurrentDownloads) {
    chunks.push(urls.slice(i, i + config.concurrentDownloads));
  }
  
  for (const chunk of chunks) {
    await Promise.all(chunk.map(async url => {
      const relativePath = getRelativePath(url);
      if (downloadRecord.downloaded.includes(relativePath)) {
        return Promise.resolve();
      }
      if (!downloadRecord.pending.includes(relativePath)) {
        downloadRecord.pending.push(relativePath);
        await updateRecord(relativePath, false);
      }
      return downloadFile(url);
    }));
  }
}

// 处理程序退出
process.on('SIGINT', async () => {
  console.log('\n程序被中断，关闭数据库连接...');
  if (db) {
    db.close();
  }
  console.log('程序退出');
  process.exit(0);
});

// 解析tileset.json并获取引用的文件
async function parseTileset(tilesetPath, tilesetUrl) {
  try {
    const tilesetContent = await fs.readFile(tilesetPath, 'utf8');
    const tileset = JSON.parse(tilesetContent);
    const filesToDownload = [];
    
    // 获取当前tileset的基础URL，用于解析相对路径
    const baseUrl = getBaseUrlFromPath(tilesetUrl);
    
    // 递归函数来提取所有引用
    function extractReferences(node) {
      if (!node) return;
      
      // 处理content
      if (node.content && node.content.uri) {
        const uri = node.content.uri;
        // 构建完整URL（相对于当前tileset.json的路径）
        const fullUrl = new URL(uri, baseUrl).href;
        filesToDownload.push(fullUrl);
      }
      
      // 递归处理子节点
      if (node.children) {
        for (const child of node.children) {
          extractReferences(child);
        }
      }
    }
    
    // 从根节点开始提取
    extractReferences(tileset.root);
    
    return filesToDownload;
  } catch (error) {
    console.error(`解析tileset失败 ${tilesetPath}:`, error.message);
    return [];
  }
}

// 限制并发下载
async function downloadWithConcurrencyLimit(urls) {
  const chunks = [];
  for (let i = 0; i < urls.length; i += config.concurrentDownloads) {
    chunks.push(urls.slice(i, i + config.concurrentDownloads));
  }
  
  for (const chunk of chunks) {
    await Promise.all(chunk.map(url => {
      const relativePath = getRelativePath(url);
      // 如果已经在下载记录中，跳过
      if (downloadRecord.downloaded.includes(relativePath)) {
        return Promise.resolve();
      }
      // 添加到待下载列表
      if (!downloadRecord.pending.includes(relativePath)) {
        downloadRecord.pending.push(relativePath);
      }
      return downloadFile(url);
    }));
  }
}

// 递归处理所有tileset文件
// 修改 processAllTilesets 函数
async function processAllTilesets() {
  let processedTilesets = new Set();
  let tilesetQueue = [];
  let hasNewFiles = false;
  
  // 添加初始tileset到队列
  const initialTilesetUrl = `${config.baseUrl}${config.initialPath}`;
  tilesetQueue.push(initialTilesetUrl);

  // 用于记录所有应该存在的文件
  let expectedFiles = new Set();

  while (tilesetQueue.length > 0) {
    const currentTilesetUrl = tilesetQueue.shift();
    
    try {
      const relativePath = getRelativePath(currentTilesetUrl);
      const localPath = path.join(config.downloadDir, relativePath);
      
      // 添加tileset文件到预期文件列表
      expectedFiles.add(relativePath);
      
      // 下载tileset文件（如果需要）
      if (!await fs.pathExists(localPath) || !downloadRecord.downloaded.includes(relativePath)) {
        hasNewFiles = true;
        await downloadFile(currentTilesetUrl);
      }
      
      // 解析tileset并获取引用的文件
      const referencedFiles = await parseTileset(localPath, currentTilesetUrl);
      
      // 处理引用的文件
      for (const file of referencedFiles) {
        const filePath = getRelativePath(file);
        const fullPath = path.join(config.downloadDir, filePath);
        
        // 添加到预期文件列表
        expectedFiles.add(filePath);
        
        // 检查文件是否存在且已记录为下载
        if (!await fs.pathExists(fullPath) || !downloadRecord.downloaded.includes(filePath)) {
          hasNewFiles = true;
          await downloadWithConcurrencyLimit([file]);
        }
        
        // 如果是json文件，添加到处理队列
        if (file.endsWith('.json') && !processedTilesets.has(file)) {
          tilesetQueue.push(file);
          processedTilesets.add(file);
        }
      }
      
    } catch (error) {
      console.error(`处理tileset失败 ${currentTilesetUrl}:`, error.message);
      hasNewFiles = true;
    }
  }

  // 检查数据库中记录的已下载文件是否真实存在
  for (const downloadedPath of downloadRecord.downloaded) {
    const fullPath = path.join(config.downloadDir, downloadedPath);
    if (!await fs.pathExists(fullPath)) {
      console.log(`发现记录中的文件不存在: ${downloadedPath}`);
      hasNewFiles = true;
      
      // 从数据库中删除不存在的文件记录
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM downloaded_files WHERE path = ?', [downloadedPath], 
          err => err ? reject(err) : resolve()
        );
      });
      
      // 从内存中移除记录
      downloadRecord.downloaded = downloadRecord.downloaded.filter(p => p !== downloadedPath);
    }
  }

  // 输出统计信息
  console.log(`预期文件总数: ${expectedFiles.size}`);
  console.log(`已下载文件数: ${downloadRecord.downloaded.length}`);
  console.log(`待下载文件数: ${expectedFiles.size - downloadRecord.downloaded.length}`);
  
  return hasNewFiles;
}

// 修改主函数
async function main() {
  try {
    console.log('开始下载3DTiles数据...');
    await init();
    
    let startTime = Date.now();
    let hasNewFiles = true;
    
    while (hasNewFiles) {
      const currentTime = Date.now();
      const elapsedTime = currentTime - startTime;
      
      if (elapsedTime >= config.downloadDuration) {
        console.log('达到下载时间限制，暂停下载...');
        await sleep(config.pauseDuration);
        console.log('恢复下载...');
        startTime = Date.now();
      }
      
      hasNewFiles = await processAllTilesets();
      if (!hasNewFiles) {
        console.log('所有文件下载完成，程序退出！');
        break;
      }
      console.log('当前批次下载完成！');
    }
  } catch (error) {
    console.error('下载过程中发生错误:', error.message);
  } finally {
    if (db) {
      db.close();
    }
  }
}

// 启动程序
main();

// 解析URL并获取相对路径
function getRelativePath(fileUrl, baseUrl = config.baseUrl) {
  let fullUrl;
  
  // 检查是否是完整URL
  if (fileUrl.startsWith('http')) {
    fullUrl = fileUrl;
  } else {
    // 处理相对路径
    fullUrl = new URL(fileUrl, baseUrl).href;
  }
  
  return extractLocalPath(fullUrl);
}

// 从URL获取基础URL（用于解析相对路径）
function getBaseUrlFromPath(fileUrl) {
  if (!fileUrl.startsWith('http')) {
    return config.baseUrl;
  }
  
  const parsedUrl = new URL(fileUrl);
  return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1)}`;
}

// 从URL路径中提取本地路径
function extractLocalPath(fileUrl) {
  // 移除协议和域名部分
  let localPath = fileUrl.replace(/^https?:\/\/[^\/]+\/api\/3d-data\/3dtiles\//, '');
  
  // 处理相对路径（如../dir/file.json）
  if (localPath.includes('../')) {
    // 将../替换为实际路径
    localPath = localPath.replace(/\.\.\//g, '');
  }
  
  // 移除查询参数
  localPath = localPath.split('?')[0];
  
  return localPath;
}

// 添加休眠函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 获取随机间隔时间
function getRandomInterval() {
  return Math.floor(Math.random() * (config.downloadInterval.max - config.downloadInterval.min)) + config.downloadInterval.min;
}
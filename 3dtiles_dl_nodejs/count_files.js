const axios = require('axios');
const { URL } = require('url');

const config = {
  baseUrl: 'https://data.map.gov.hk/api/3d-data/3dtiles/',
  initialPath: 'f2/tileset.json',
  apiKey: '3967f8f365694e0798af3e7678509421'
};

// 用于存储所有文件URL
const allFiles = new Set();
const processedTilesets = new Set();

// 从URL获取基础URL（用于解析相对路径）
function getBaseUrlFromPath(fileUrl) {
  if (!fileUrl.startsWith('http')) {
    return config.baseUrl;
  }
  const parsedUrl = new URL(fileUrl);
  return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1)}`;
}

// 解析tileset.json
async function parseTileset(tilesetUrl) {
  try {
    // 如果URL不包含key参数，添加它
    const urlWithKey = tilesetUrl.includes('?') 
      ? `${tilesetUrl}&key=${config.apiKey}` 
      : `${tilesetUrl}?key=${config.apiKey}`;

    console.log(`解析 tileset: ${tilesetUrl}`);
    const response = await axios.get(urlWithKey);
    const tileset = response.data;
    
    // 获取当前tileset的基础URL
    const baseUrl = getBaseUrlFromPath(tilesetUrl);
    
    // 递归提取引用
    function extractReferences(node) {
      if (!node) return;
      
      if (node.content && node.content.uri) {
        const uri = node.content.uri;
        const fullUrl = new URL(uri, baseUrl).href;
        allFiles.add(fullUrl);
      }
      
      if (node.children) {
        for (const child of node.children) {
          extractReferences(child);
        }
      }
    }
    
    // 从根节点开始提取
    extractReferences(tileset.root);
    
    // 处理新发现的tileset文件
    const newTilesets = Array.from(allFiles)
      .filter(url => url.endsWith('.json') && !processedTilesets.has(url));
    
    for (const newTileset of newTilesets) {
      if (!processedTilesets.has(newTileset)) {
        processedTilesets.add(newTileset);
        await parseTileset(newTileset);
      }
    }
  } catch (error) {
    console.error(`解析tileset失败 ${tilesetUrl}:`, error.message);
  }
}

// 主函数
async function main() {
  try {
    console.log('开始统计文件...');
    const initialTilesetUrl = `${config.baseUrl}${config.initialPath}`;
    processedTilesets.add(initialTilesetUrl);
    await parseTileset(initialTilesetUrl);
    
    // 统计文件类型
    const fileTypes = {};
    allFiles.forEach(file => {
      const ext = file.split('.').pop().toLowerCase();
      fileTypes[ext] = (fileTypes[ext] || 0) + 1;
    });
    
    console.log('\n文件统计结果:');
    console.log('================');
    console.log(`总文件数: ${allFiles.size}`);
    console.log('\n按类型统计:');
    Object.entries(fileTypes).forEach(([ext, count]) => {
      console.log(`${ext}: ${count} 个文件`);
    });
    
  } catch (error) {
    console.error('统计过程中发生错误:', error.message);
  }
}

// 启动程序
main();
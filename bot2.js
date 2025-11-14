require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Конфигурация
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 20000;
const BOT_USERNAME = process.env.BOT_USERNAME || '@DAC_CTO_bot';
const DATABASE_FILE = path.join(__dirname, 'database.json');
const botStartTime = new Date();
const PORT = process.env.PORT || 3000;

// -------------------------------
// Простой HTTP сервер для Render
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
}).listen(PORT, () => console.log(`Server running on port ${PORT}`));

// -------------------------------
// Инициализация бота
let bot;
try {
  if (!BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
  }
  if (!CHANNEL_ID) {
    throw new Error('TELEGRAM_CHANNEL_ID is not defined in .env file');
  }
  
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Bot is running!');
} catch (error) {
  console.error('❌ Bot initialization error:', error.message);
  process.exit(1);
}

// -------------------------------
// База данных обработанных токенов
let processedTokens = new Set();

function loadDatabase() {
  try {
    if (fs.existsSync(DATABASE_FILE)) {
      const data = fs.readFileSync(DATABASE_FILE, 'utf8');
      const parsed = JSON.parse(data);
      processedTokens = new Set(Array.isArray(parsed) ? parsed : []);
      console.log(`✅ Loaded ${processedTokens.size} processed tokens`);
    } else {
      console.log('ℹ️ No database file found, starting fresh');
    }
  } catch (err) {
    console.error('❌ Database load error:', err.message);
    processedTokens = new Set();
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DATABASE_FILE, JSON.stringify([...processedTokens], null, 2), 'utf8');
    console.log('💾 Database saved');
  } catch (err) {
    console.error('❌ Database save error:', err.message);
  }
}

// -------------------------------
// API функции
async function fetchLatestCTOs() {
  try {
    const res = await axios.get('https://api.dexscreener.com/community-takeovers/latest/v1', {
      timeout: 10000,
      headers: { 
        'Accept': 'application/json', 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error('❌ Error fetching latest CTOs:', err.message);
    return [];
  }
}

async function fetchTokenDetails(chainId, tokenAddress) {
  try {
    await new Promise(r => setTimeout(r, 1000)); // rate-limit
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      timeout: 10000,
      headers: { 
        'Accept': 'application/json', 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const pairs = res.data?.pairs || [];
    const pair = pairs.find(p => p.chainId && p.chainId.toLowerCase() === chainId.toLowerCase()) || pairs[0];
    
    if (pair) {
      // Приоритет: header -> imageUrl -> icon
      pair.banner = pair.info?.header || pair.info?.imageUrl || pair.info?.icon || null;
      console.log(`📸 Banner URL for ${tokenAddress}:`, pair.banner);
    }
    
    return pair || null;
  } catch (err) {
    console.error(`❌ Error fetching token ${tokenAddress}:`, err.message);
    return null;
  }
}

// -------------------------------
// Утилиты
function formatNumber(num) {
  if (!num || isNaN(num)) return 'N/A';
  num = parseFloat(num);
  if (num >= 1e9) return `$${(num/1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num/1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num/1e3).toFixed(1)}k`;
  return `$${num.toFixed(2)}`;
}

function formatPercent(percent) {
  if (percent === null || percent === undefined || isNaN(percent)) return 'N/A';
  const num = parseFloat(percent);
  return `${num >= 0 ? '+' : ''}${num.toFixed(0)}%`;
}

function getTokenAge(timestamp) {
  if (!timestamp) return 'N/A';
  try {
    const diff = new Date() - new Date(timestamp);
    const days = Math.floor(diff / (1000*60*60*24));
    return days === 0 ? '< 1 day' : `${days} ${days === 1 ? 'day' : 'days'}`;
  } catch (err) {
    return 'N/A';
  }
}

function getChainName(chainId) {
  const names = {
    'ethereum': 'ETH',
    'bsc': 'BSC',
    'polygon': 'POLYGON',
    'arbitrum': 'ARBITRUM',
    'solana': 'SOLANA',
    'base': 'BASE',
    'avalanche': 'AVAX',
    'fantom': 'FTM'
  };
  return names[chainId.toLowerCase()] || chainId.toUpperCase();
}

function extractSocials(ctoData) {
  const socials = [];
  if (!ctoData || !ctoData.links || !Array.isArray(ctoData.links)) return socials;
  
  ctoData.links.forEach(link => {
    if (!link || !link.url) return;
    const url = link.url.toLowerCase();
    if (url.includes('twitter.com') || url.includes('x.com')) {
      socials.push({ type: '🐦', url: link.url });
    } else if (url.includes('t.me') || url.includes('telegram')) {
      socials.push({ type: '📱', url: link.url });
    } else if (url.includes('discord')) {
      socials.push({ type: '💬', url: link.url });
    } else {
      socials.push({ type: '🌐', url: link.url });
    }
  });
  
  return socials;
}

function formatMessage(ctoData, tokenDetails) {
  const chainName = getChainName(ctoData.chainId);
  let msg = `🕵️‍♂️ New *${chainName}* CTO Detected\n\n`;
  
  if (tokenDetails && tokenDetails.baseToken) {
    const name = tokenDetails.baseToken.name || 'Unknown';
    const symbol = tokenDetails.baseToken.symbol || 'N/A';
    msg += `🪙 ${name} (${symbol})\n`;
  } else {
    msg += `🪙 Token Details Unavailable\n`;
  }
  
  msg += `🏦 Market Cap: *${tokenDetails?.marketCap ? formatNumber(tokenDetails.marketCap) : 'N/A'}*\n`;
  msg += `🌱 Token Age: *${tokenDetails?.pairCreatedAt ? getTokenAge(tokenDetails.pairCreatedAt) : 'N/A'}*\n`;
  
  const socials = extractSocials(ctoData);
  if (socials.length) {
    msg += `👥 Socials: `;
    socials.forEach((s, i) => {
      msg += `[${s.type}](${s.url})`;
      if (i < socials.length - 1) msg += ' ';
    });
    msg += '\n\n';
  }
  
  msg += `CA: \`${ctoData.tokenAddress}\`\n➖➖➖➖➖➖\n`;
  
  if (tokenDetails?.volume) {
    const v = tokenDetails.volume;
    msg += `💸 5m: *${formatNumber(v.m5 || 0)}* | 1hr: *${formatNumber(v.h1 || 0)}* | 6hr: *${formatNumber(v.h6 || 0)}* | 24hr: *${formatNumber(v.h24 || 0)}*\n`;
  } else {
    msg += `💸 5m: *N/A* | 1hr: *N/A* | 6hr: *N/A* | 24hr: *N/A*\n`;
  }
  
  if (tokenDetails?.priceChange) {
    const p = tokenDetails.priceChange;
    msg += `📈 5m: *${formatPercent(p.m5)}* | 1hr: *${formatPercent(p.h1)}* | 6hr: *${formatPercent(p.h6)}* | 24hr: *${formatPercent(p.h24)}*\n`;
  } else {
    msg += `📈 5m: *N/A* | 1hr: *N/A* | 6hr: *N/A* | 24hr: *N/A*\n`;
  }
  
  msg += `➖➖➖➖➖➖\nPowered by @DigitalAssetClubEU`;
  return msg;
}

async function sendToChannel(ctoData, tokenDetails) {
  try {
    const message = formatMessage(ctoData, tokenDetails);
    const keyboard = {
      inline_keyboard: [[
        { text: '📊 DexScreener', url: ctoData.url },
        { text: '🪙 Axiom.trade', url: 'https://axiom.trade/' },
        { text: '🤖 @maestro', url: 'https://t.me/maestro' }
      ]]
    };
    
    // Приоритет: header из CTO данных -> header из token details -> другие изображения
    const banner = ctoData.header || 
                   tokenDetails?.info?.header || 
                   tokenDetails?.banner || 
                   ctoData.banner || 
                   ctoData.image || 
                   null;
    
    console.log(`📤 Sending to channel. Banner:`, banner ? 'Yes' : 'No');
    
    if (banner) {
      await bot.sendPhoto(CHANNEL_ID, banner, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else {
      await bot.sendMessage(CHANNEL_ID, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboard
      });
    }
    
    console.log(`✅ Sent message about Token: ${ctoData.tokenAddress}`);
  } catch (err) {
    console.error('❌ Failed to send message:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

// -------------------------------
// Основная проверка токенов
async function checkForNewTokens() {
  console.log('🔍 Looking for New CTO Tokens...');
  const tokens = await fetchLatestCTOs();
  
  if (!tokens.length) {
    console.log('ℹ️ No new tokens found');
    return;
  }
  
  console.log(`📋 Found ${tokens.length} tokens in API`);
  
  let newCount = 0;
  for (const token of tokens) {
    if (!token.chainId || !token.tokenAddress) {
      console.log('⚠️ Invalid token data, skipping');
      continue;
    }
    
    // Normalize addresses to lowercase for consistent comparison
    const normalizedAddress = token.tokenAddress.toLowerCase();
    const tokenId = `${token.chainId.toLowerCase()}-${normalizedAddress}`;
    
    if (!processedTokens.has(tokenId)) {
      console.log(`🆕 New Token Found: ${token.tokenAddress} (${token.chainId})`);
      console.log(`   Token ID: ${tokenId}`);
      console.log(`   Claim Date: ${token.claimDate}`);
      
      const details = await fetchTokenDetails(token.chainId, token.tokenAddress);
      await sendToChannel(token, details);
      
      processedTokens.add(tokenId);
      newCount++;
      
      await new Promise(r => setTimeout(r, 2000)); // задержка между отправками
    } else {
      console.log(`⏭️ Already processed: ${normalizedAddress}`);
    }
  }
  
  if (newCount) {
    saveDatabase();
    console.log(`✨ Processed ${newCount} new token(s)`);
  } else {
    console.log('ℹ️ All tokens already processed');
  }
}

// -------------------------------
// Команды Telegram
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 
    '🤖 *DAC CTO Hunter Bot* 🤖\n\n' +
    'Available commands:\n' +
    '/status - Check bot status\n' +
    '/check - Force check for new tokens\n' +
    '/stats - View statistics\n' +
    '/list - Show processed tokens\n' +
    '/getchatid - Get current chat ID\n' +
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `✅ *Bot Status*\n\n` +
    `Processed Tokens: ${processedTokens.size}\n` +
    `Check Interval: ${CHECK_INTERVAL / 1000}s\n` +
    `Target Channel: \`${CHANNEL_ID}\`\n` +
    `Uptime: ${Math.floor((new Date() - botStartTime) / 1000 / 60)} minutes`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/check/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '🔍 Checking for new tokens...');
  await checkForNewTokens();
  await bot.sendMessage(msg.chat.id, '✅ Check complete!');
});

bot.onText(/\/stats/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `📈 *Bot Statistics*\n\n` +
    `Processed Tokens: ${processedTokens.size}\n` +
    `Running Since: ${botStartTime.toLocaleString('en-US')}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/getchatid/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🆔 *Chat Information*\n\n` +
    `Chat ID: \`${msg.chat.id}\`\n` +
    `Chat Type: ${msg.chat.type}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/clear/, (msg) => {
  const cleared = processedTokens.size;
  processedTokens.clear();
  saveDatabase();
  bot.sendMessage(msg.chat.id, `🗑️ Database cleared!\nRemoved ${cleared} token(s)`);
});

bot.onText(/\/list/, (msg) => {
  if (processedTokens.size === 0) {
    bot.sendMessage(msg.chat.id, '📋 No tokens in database yet.');
    return;
  }
  
  const tokens = [...processedTokens].slice(0, 10);
  let message = `📋 *Processed Tokens* (showing ${tokens.length}/${processedTokens.size}):\n\n`;
  tokens.forEach((token, i) => {
    message += `${i + 1}. \`${token}\`\n`;
  });
  
  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.message);
});

bot.on('error', (error) => {
  console.error('❌ Bot error:', error.message);
});

// -------------------------------
// Старт бота
async function startBot() {
  console.log('🤖 Starting bot...');
  loadDatabase();
  
  console.log('🔍 Running initial check...');
  await checkForNewTokens();
  
  setInterval(checkForNewTokens, CHECK_INTERVAL);
  console.log(`✅ Bot is running!`);
  console.log(`⏰ Check interval: ${CHECK_INTERVAL / 1000} seconds`);
  console.log(`📢 Target channel: ${CHANNEL_ID}`);
}

// Обработка ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  saveDatabase();
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down bot...');
  saveDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down...');
  saveDatabase();
  process.exit(0);
});

// Запуск
startBot().catch(err => {
  console.error('❌ Fatal error during bot startup:', err);
  process.exit(1);
});


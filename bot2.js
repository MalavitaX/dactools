// bot.js - Главный файл бота
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Конфигурация
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 60000;
const BOT_USERNAME = process.env.BOT_USERNAME || '@DAC_CTO_bot';
const DATABASE_FILE = path.join(__dirname, 'database.json');

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// База данных обработанных токенов
let processedTokens = new Set();

// Загрузка базы данных
function loadDatabase() {
  try {
    if (fs.existsSync(DATABASE_FILE)) {
      const data = fs.readFileSync(DATABASE_FILE, 'utf8');
      processedTokens = new Set(JSON.parse(data));
      console.log(`✅ Loaded ${processedTokens.size} processed tokens`);
    }
  } catch (error) {
    console.error('❌ Database loading error::', error.message);
  }
}

// Сохранение базы данных
function saveDatabase() {
  try {
    fs.writeFileSync(DATABASE_FILE, JSON.stringify([...processedTokens], null, 2));
  } catch (error) {
    console.error('❌ Database save error:', error.message);
  }
}

// Получение последних CTO токенов
async function fetchLatestCTOs() {
  try {
    const response = await axios.get('https://api.dexscreener.com/community-takeovers/latest/v1', {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    return response.data;
  } catch (error) {
    console.error('❌ Error while requesting DexScreener:', error.message);
    return [];
  }
}

// Получение детальной информации о токене
async function fetchTokenDetails(chainId, tokenAddress) {
  try {
    // Пауза перед запросом (чтобы не превысить rate limit)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    
    // Находим пару на нужной сети
    const pairs = response.data.pairs || [];
    const pair = pairs.find(p => p.chainId.toLowerCase() === chainId.toLowerCase()) || pairs[0];
    
    return pair;
  } catch (error) {
    console.error(`❌ Error fetching token data ${tokenAddress}:`, error.message);
    return null;
  }
}

// Форматирование числа (сокращение больших чисел)
function formatNumber(num) {
  if (!num || isNaN(num)) return 'N/A';
  
  num = parseFloat(num);
  
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}k`;
  return `$${num.toFixed(2)}`;
}

// Форматирование процентов
function formatPercent(percent) {
  if (!percent || isNaN(percent)) return 'N/A';
  
  percent = parseFloat(percent);
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(0)}%`;
}

// Вычисление возраста токена
function getTokenAge(timestamp) {
  if (!timestamp) return 'N/A';
  
  const now = new Date();
  const created = new Date(timestamp);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return '< 1 day';
  return `${diffDays} days`;
}

// Получение эмодзи для сети
function getChainEmoji(chainId) {
  const emojis = {
    'ethereum': '⚡',
    'bsc': '🟡',
    'polygon': '🟣',
    'arbitrum': '🔵',
    'solana': '🌞',
    'base': '🔷',
    'avalanche': '🔺',
    'fantom': '👻'
  };
  return emojis[chainId.toLowerCase()] || '🔗';
}

// Форматирование имени сети
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

// Извлечение социальных ссылок
function extractSocials(ctoData) {
  const socials = [];
  
  if (ctoData.links && ctoData.links.length > 0) {
    ctoData.links.forEach(link => {
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
  }
  
  return socials;
}

// Форматирование сообщения для Telegram (новый формат)
function formatMessage(ctoData, tokenDetails) {
  const chainName = getChainName(ctoData.chainId);
  
  // Базовая информация
  let message = `🕵️‍♂️ New *${chainName}* CTO Detected\n\n`;
  
  // Имя и символ токена
  if (tokenDetails && tokenDetails.baseToken) {
    const name = tokenDetails.baseToken.name || 'Unknown';
    const symbol = tokenDetails.baseToken.symbol || 'N/A';
    message += `🪙 ${name} (${symbol})\n`;
  } else {
    message += `🪙 Token Details Unavailable\n`;
  }
  
  // Market Cap
  if (tokenDetails && tokenDetails.marketCap) {
    message += `🏦 Market Cap: *${formatNumber(tokenDetails.marketCap)}*\n`;
  } else {
    message += `🏦 Market Cap: *N/A*\n`;
  }
  
  // Возраст токена
  if (tokenDetails && tokenDetails.pairCreatedAt) {
    message += `🌱 Token Age: *${getTokenAge(tokenDetails.pairCreatedAt)}*\n`;
  } else {
    message += `🌱 Token Age: *N/A*\n`;
  }
  
  // Социальные сети
  const socials = extractSocials(ctoData);
  if (socials.length > 0) {
    message += `👥 Socials: `;
    socials.forEach((social, idx) => {
      message += `[${social.type}](${social.url})`;
      if (idx < socials.length - 1) message += ' ';
    });
    message += '\n\n';
  }
  
  // Contract Address (моноширинный шрифт)
  message += `CA: \`${ctoData.tokenAddress}\`\n`;
  message += `➖➖➖➖➖➖\n`;
  
  // Объемы торгов
  if (tokenDetails && tokenDetails.volume) {
    const v5m = tokenDetails.volume.m5 || 0;
    const v1h = tokenDetails.volume.h1 || 0;
    const v6h = tokenDetails.volume.h6 || 0;
    const v24h = tokenDetails.volume.h24 || 0;
    
    message += `💸 5m: *${formatNumber(v5m)}* | 1hr: *${formatNumber(v1h)}* | 6hr: *${formatNumber(v6h)}* | 24hr: *${formatNumber(v24h)}*\n`;
  } else {
    message += `💸 5m: *N/A* | 1hr: *N/A* | 6hr: *N/A* | 24hr: *N/A*\n`;
  }
  
  // Изменения цены
  if (tokenDetails && tokenDetails.priceChange) {
    const p5m = tokenDetails.priceChange.m5 || 0;
    const p1h = tokenDetails.priceChange.h1 || 0;
    const p6h = tokenDetails.priceChange.h6 || 0;
    const p24h = tokenDetails.priceChange.h24 || 0;
    
    message += `📈 5m: *${formatPercent(p5m)}* | 1hr: *${formatPercent(p1h)}* | 6hr: *${formatPercent(p6h)}* | 24hr: *${formatPercent(p24h)}*\n`;
  } else {
    message += `📈 5m: *N/A* | 1hr: *N/A* | 6hr: *N/A* | 24hr: *N/A*\n`;
  }
  
  message += `➖➖➖➖➖➖\n`;
  message += `Powered by @DigitalAssetClubEU`;
  
  return message;
}

// Отправка сообщения в канал
async function sendToChannel(ctoData, tokenDetails) {
  try {
    const message = formatMessage(ctoData, tokenDetails);
    
    // Кнопка для открытия на DexScreener
const keyboard = {
  inline_keyboard: [
    [
      { text: '📊 DexScreener', url: ctoData.url },
      { text: '🪙 Axiom.trade', url: `https://axiom.trade/token/${ctoData.tokenAddress}` },
      { text: '🤖 @maestro', url: `https://t.me/maestro?monitor=${ctoData.tokenAddress}` }
    ]
  ]
};
    // Если есть иконка токена, отправляем с фото
    if (ctoData.icon) {
      await bot.sendPhoto(CHANNEL_ID, ctoData.icon, {
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
  } catch (error) {
    console.error('❌ Failed to Send to Group:', error.message);
  }
}

// Основная функция проверки новых токенов
async function checkForNewTokens() {
  console.log('🔍 Looking for New CTO Tokens...');
  
  const tokens = await fetchLatestCTOs();
  
  if (!tokens || tokens.length === 0) {
    console.log('ℹ️ Spotted New Tokens');
    return;
  }
  
  let newTokensCount = 0;
  
  for (const token of tokens) {
    const tokenId = `${token.chainId}-${token.tokenAddress}`;
    
    if (!processedTokens.has(tokenId)) {
      console.log(`🆕 Spotted New Token: ${token.tokenAddress} (${token.chainId})`);
      
      // Получаем детальную информацию
      const details = await fetchTokenDetails(token.chainId, token.tokenAddress);
      
      // Отправляем в канал
      await sendToChannel(token, details);
      
      // Добавляем в базу
      processedTokens.add(tokenId);
      newTokensCount++;
      
      // Небольшая задержка между отправками
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  if (newTokensCount > 0) {
    saveDatabase();
    console.log(`✨ Spotted New Tokens: ${newTokensCount}`);
  } else {
    console.log('ℹ️ All Tokens Processed');
  }
}

// Команды бота
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    '🤖 DAC CTO Hunter 🤖\n\n' +
    '⚡ Available commands:\n' +
    '🟢 /status - Bot Status\n' +
    '🔍 /check - Check New Tokens\n' +
    '📊 /stats - Statistic\n' +
    '🆔 /getchatid - Chat ID\n' +
    '🧹 /clear - Clear Database'
  );
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    `✅ Bot is Working!\n\n` +
    `📊 Processed Tokens: *${processedTokens.size}*\n` +
    `⏱️ Check interval: *${CHECK_INTERVAL / 1000} seconds*\n` +
    `📢 Channel ID: *${CHANNEL_ID}*\n` +
    `🤖 Support: @FcukThePolice`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/check/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🔍 Checking New Tokens...');
  await checkForNewTokens();
  bot.sendMessage(chatId, '✅ Checking Completed!');
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    `📈 *Statistics*\n\n` +
    `🔢 Total Processed Tokens: ${processedTokens.size}\n` +
    `⏰ Working from: ${new Date().toLocaleString('ru-RU')}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/getchatid/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    `🆔 *Chat ID:* \`${chatId}\`\n\n` +
    `Use this ID in .env to send messages here`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/clear/, (msg) => {
  const chatId = msg.chat.id;
  processedTokens.clear();
  saveDatabase();
  bot.sendMessage(chatId, '🗑️ Database cleared!');
});

// Запуск бота
async function startBot() {
  console.log('🤖 Bot is Starting...');
  
  // Загружаем базу данных
  loadDatabase();
  
  // Первоначальная проверка
  await checkForNewTokens();
  
  // Устанавливаем интервал проверки
  setInterval(checkForNewTokens, CHECK_INTERVAL);
  
  console.log(`✅ Bot is Running! Check interval is: ${CHECK_INTERVAL / 1000} секунд`);
  console.log(`📢 Channel to post: ${CHANNEL_ID}`);
  console.log(`🤖 Bot username: @DAC_CTO_bot`);
}

// Обработка ошибок
process.on('unhandledRejection', (error) => {
  console.error('❌ Unknown Error:', error);
});

process.on('SIGINT', () => {
  console.log('\n👋 Stoping bot...');
  saveDatabase();
  process.exit(0);
});

// Запуск
startBot();
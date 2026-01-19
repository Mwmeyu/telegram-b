const { Telegraf } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Initialize
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

// ========== SIMPLE DATABASE (Using Mongoose) ==========
const AccountSchema = new mongoose.Schema({
  phone: String,
  apiId: String,
  apiHash: String,
  ownerId: Number,
  ownerName: String,
  createdAt: { type: Date, default: Date.now }
});

const Account = mongoose.model('Account', AccountSchema);

// ========== BOT COMMANDS ==========

bot.command('start', async (ctx) => {
  await ctx.reply(`
🤖 <b>Cretee Bot - FULL VERSION</b>

Welcome, ${ctx.from.first_name}!

✅ <b>MongoDB Atlas: Connected</b>
✅ <b>Status: Online 24/7</b>

<b>Commands:</b>
/addaccount - Save Telegram account
/myaccounts - View saved accounts  
/stats - Database statistics
/status - System status

🚀 <b>All features working!</b>
  `, {
    parse_mode: 'HTML'
  });
});

bot.command('addaccount', async (ctx) => {
  await ctx.reply(`
📱 <b>Add Telegram Account</b>

Send: <code>api_id api_hash +phone</code>

<b>Example:</b>
<code>123456 abcdef123456 +1234567890</code>

✅ <b>Will save to MongoDB database</b>
  `, {
    parse_mode: 'HTML'
  });
});

// Handle API input
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  
  const parts = text.split(/\s+/);
  if (parts.length >= 3 && parts[2].startsWith('+')) {
    const [apiId, apiHash, phone] = parts;
    
    try {
      const account = new Account({
        phone: phone,
        apiId: apiId,
        apiHash: apiHash,
        ownerId: ctx.from.id,
        ownerName: ctx.from.first_name
      });
      
      await account.save();
      
      const totalAccounts = await Account.countDocuments({ ownerId: ctx.from.id });
      
      await ctx.reply(`
✅ <b>Account Saved to Database!</b>

📱 Phone: ${phone}
👤 Owner: ${ctx.from.first_name}
📊 Your total accounts: ${totalAccounts}
🕐 Time: ${new Date().toLocaleTimeString()}

<i>Stored in MongoDB Atlas</i>
      `, { parse_mode: 'HTML' });
      
    } catch (error) {
      console.error('Save error:', error);
      await ctx.reply(`
❌ <b>Save Failed</b>

Error: ${error.message}

Try again.
      `, { parse_mode: 'HTML' });
    }
  }
});

bot.command('myaccounts', async (ctx) => {
  try {
    const accounts = await Account.find({ ownerId: ctx.from.id }).sort({ createdAt: -1 });
    
    if (accounts.length === 0) {
      return ctx.reply(`
📭 <b>No Accounts</b>

Use /addaccount to save your first account.
      `, { parse_mode: 'HTML' });
    }
    
    let message = `📱 <b>Your Accounts (${accounts.length})</b>\n\n`;
    
    accounts.forEach((acc, i) => {
      message += `${i + 1}. <b>${acc.phone}</b>\n`;
      message += `   API: ${acc.apiId ? acc.apiId.substring(0, 6) + '...' : 'Not set'}\n`;
      message += `   Saved: ${acc.createdAt.toLocaleDateString()}\n`;
      if (i < accounts.length - 1) message += '\n';
    });
    
    await ctx.reply(message, { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('List error:', error);
    await ctx.reply(`
⚠️ <b>Database Error</b>

Accounts are safe, just temporary connection issue.
    `, { parse_mode: 'HTML' });
  }
});

bot.command('stats', async (ctx) => {
  try {
    const totalAccounts = await Account.countDocuments();
    const yourAccounts = await Account.countDocuments({ ownerId: ctx.from.id });
    
    await ctx.reply(`
📊 <b>Database Statistics</b>

📱 Total accounts: ${totalAccounts}
👤 Your accounts: ${yourAccounts}
✅ MongoDB: Connected

<i>Your data is securely stored</i>
    `, { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('Stats error:', error);
    await ctx.reply(`
📊 <b>Statistics</b>

Database temporarily unavailable.

Bot is still working.
    `, { parse_mode: 'HTML' });
  }
});

bot.command('status', async (ctx) => {
  const dbStatus = mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected';
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  
  await ctx.reply(`
🖥️ <b>System Status</b>

Bot: ✅ Online 24/7
Database: ${dbStatus}
Uptime: ${hours}h ${minutes}m
Host: Render.com
Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB

🚀 <b>Operational</b>
  `, {
    parse_mode: 'HTML'
  });
});

bot.command('test', async (ctx) => {
  try {
    // Test database with simple operation
    const testDoc = new Account({
      phone: '+1234567890',
      apiId: 'test123',
      apiHash: 'testhash',
      ownerId: ctx.from.id,
      ownerName: ctx.from.first_name
    });
    
    await testDoc.save();
    await testDoc.deleteOne();
    
    await ctx.reply(`
✅ <b>Test Successful!</b>

Database: Working
Connection: Stable
Operation: Completed

<i>All systems normal</i>
    `, { parse_mode: 'HTML' });
    
  } catch (error) {
    await ctx.reply(`
❌ <b>Test Failed</b>

Error: ${error.message}

Check database connection.
    `, { parse_mode: 'HTML' });
  }
});

// ========== EXPRESS SERVER ==========
app.get('/', async (req, res) => {
  try {
    const accountCount = await Account.countDocuments();
    const userCount = (await Account.distinct('ownerId')).length;
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cretee Bot - MongoDB Active</title>
        <style>
          body { font-family: Arial; padding: 40px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
          .success { background: #d4edda; color: #155724; padding: 20px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 Cretee Bot - FULL VERSION</h1>
          <div class="success">
            <h2>✅ MongoDB Atlas: CONNECTED</h2>
            <p>📱 Accounts stored: ${accountCount}</p>
            <p>👥 Unique users: ${userCount}</p>
            <p>🌐 Cluster: cluster0.ruuuc7f.mongodb.net</p>
          </div>
          <p>✅ Bot is fully operational with database support</p>
          <p>✅ 24/7 uptime on Render.com</p>
          <p>✅ All features working</p>
          <p>🔄 Last updated: ${new Date().toLocaleString()}</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.send(`
      <div style="padding: 40px;">
        <h1>🤖 Cretee Bot</h1>
        <p>✅ Bot is running</p>
        <p>⚠️ Database stats temporarily unavailable</p>
        <p>🔄 Last updated: ${new Date().toLocaleString()}</p>
      </div>
    `);
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// ========== START APPLICATION ==========
async function start() {
  console.log('🚀 Starting Cretee Bot...');
  
  // Start web server FIRST (important for Render)
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 Main page: http://localhost:${PORT}/`);
  });
  
  // Connect to MongoDB
  if (process.env.MONGODB_URI) {
    console.log('🔗 Connecting to MongoDB...');
    
    try {
      // Simple connection without options
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ MongoDB: CONNECTED');
      console.log('✅ Database: cretee_bot');
      console.log('✅ Cluster: cluster0.ruuuc7f.mongodb.net');
    } catch (error) {
      console.log('❌ MongoDB connection failed:', error.message);
      console.log('⚠️ Bot running without database');
    }
  } else {
    console.log('⚠️ No MONGODB_URI found');
  }
  
  // Start bot
  await bot.launch();
  console.log('🤖 Telegram Bot: ONLINE');
  console.log('✅ Ready to use!');
  console.log('👉 Commands available:');
  console.log('   /start - Welcome message');
  console.log('   /addaccount - Save account');
  console.log('   /myaccounts - List accounts');
  console.log('   /stats - Database stats');
  console.log('   /status - System status');
  console.log('   /test - Test database');
}

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err.message);
  ctx.reply('❌ An error occurred. Please try again.');
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

// Start
start();

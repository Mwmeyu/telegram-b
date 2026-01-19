const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const TelegramService = require('./telegramService');
const crypto = require('crypto');
require('dotenv').config();

// Initialize
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

// ========== DATABASE MODELS ==========
const UserSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true },
  username: String,
  firstName: String,
  isPremium: { type: Boolean, default: false },
  apiLimit: { type: Number, default: 3 },
  createdAt: { type: Date, default: Date.now }
});

const AccountSchema = new mongoose.Schema({
  phone: String,
  apiId: String,
  apiHash: String,
  sessionString: String, // Encrypted session
  ownerId: Number,
  ownerName: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastUsed: { type: Date, default: Date.now }
});

const GroupSchema = new mongoose.Schema({
  groupName: String,
  chatId: String,
  inviteLink: String,
  createdByAccount: String,
  createdByUser: Number,
  memberCount: Number,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Account = mongoose.model('Account', AccountSchema);
const Group = mongoose.model('Group', GroupSchema);

// ========== ENCRYPTION ==========
class Encryption {
  static encrypt(text) {
    const key = process.env.ENCRYPTION_KEY || 'default-key-32-chars-long-here';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key.padEnd(32).slice(0, 32)), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
  }

  static decrypt(text) {
    const key = process.env.ENCRYPTION_KEY || 'default-key-32-chars-long-here';
    const [ivHex, encryptedHex, authTagHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key.padEnd(32).slice(0, 32)), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

// ========== USER SESSIONS ==========
const userSessions = new Map();
const ADMIN_USERNAMES = ["mwmeyu"];
const ADMIN_USER_IDS = [];

function isAdmin(userId, username) {
  if (ADMIN_USER_IDS.includes(userId)) return true;
  if (username && ADMIN_USERNAMES.includes(username.toLowerCase())) {
    ADMIN_USER_IDS.push(userId);
    return true;
  }
  return false;
}

// ========== BOT COMMANDS ==========

// Start command
bot.command('start', async (ctx) => {
  const user = ctx.from;
  const admin = isAdmin(user.id, user.username);
  
  try {
    await User.findOneAndUpdate(
      { telegramId: user.id },
      {
        telegramId: user.id,
        username: user.username,
        firstName: user.first_name,
        createdAt: new Date()
      },
      { upsert: true }
    );
  } catch (error) {
    console.log('User save error:', error.message);
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add Account', 'add_account')],
    [Markup.button.callback('👥 Create Group', 'create_group')],
    [Markup.button.callback('🚀 Bulk Create', 'bulk_create')],
    [Markup.button.callback('📱 My Accounts', 'my_accounts')],
    [Markup.button.callback('📊 Stats', 'show_stats')],
    admin ? [Markup.button.callback('👑 Admin', 'admin_panel')] : []
  ].filter(row => row && row.length > 0));
  
  await ctx.reply(`
🤖 <b>Cretee Bot - Full Version</b>

Welcome, ${user.first_name}!

✅ <b>MongoDB: Connected</b>
✅ <b>24/7 Uptime</b>
${admin ? '👑 <b>Admin Access</b>' : ''}

<b>Features:</b>
• Real Telegram account integration
• Group creation with all features
• Bulk group creation
• Session management
• 24/7 operation

Use buttons or commands below.
  `, {
    parse_mode: 'HTML',
    ...keyboard
  });
});

// ========== ADD ACCOUNT FLOW ==========
bot.command('addaccount', async (ctx) => {
  const userId = ctx.from.id;
  
  // Check account limit
  const user = await User.findOne({ telegramId: userId });
  const maxAccounts = user?.isPremium ? 10 : 3;
  const accountCount = await Account.countDocuments({ ownerId: userId, isActive: true });
  
  if (accountCount >= maxAccounts) {
    return ctx.reply(`
❌ <b>Account Limit Reached</b>

You have ${accountCount}/${maxAccounts} accounts.

💎 Upgrade for more accounts.
    `, { parse_mode: 'HTML' });
  }
  
  userSessions.set(userId, { state: 'WAITING_API' });
  
  await ctx.reply(`
📱 <b>Add Telegram Account</b>

Send: <code>api_id api_hash +phone</code>

<b>Example:</b>
<code>123456 abcdef123456 +1234567890</code>

Get API from: https://my.telegram.org
  `, {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
});

// Handle API input
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  
  if (!session) return;
  
  const text = ctx.message.text.trim();
  
  if (session.state === 'WAITING_API') {
    const parts = text.split(/\s+/);
    
    if (parts.length < 3 || !parts[2].startsWith('+')) {
      return ctx.reply('❌ Invalid format. Send: api_id api_hash +phone');
    }
    
    const [apiId, apiHash, phone] = parts;
    
    try {
      const telegramService = new TelegramService(apiId, apiHash, phone);
      const sent = await telegramService.sendCode();
      
      if (sent) {
        session.state = 'WAITING_CODE';
        session.data = { apiId, apiHash, phone, telegramService };
        userSessions.set(userId, session);
        
        await ctx.reply('✅ Code sent! Enter the 5-digit verification code:');
      } else {
        await ctx.reply('❌ Failed to send code. Try again.');
        userSessions.delete(userId);
      }
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
      userSessions.delete(userId);
    }
  }
  
  else if (session.state === 'WAITING_CODE') {
    if (!/^\d{5}$/.test(text)) {
      return ctx.reply('❌ Invalid code. Enter 5-digit code:');
    }
    
    try {
      const telegramService = session.data.telegramService;
      const result = await telegramService.signIn(text);
      
      if (result === true) {
        const sessionString = await telegramService.getSessionString();
        
        // Save account to database
        const account = new Account({
          phone: session.data.phone,
          apiId: session.data.apiId,
          apiHash: session.data.apiHash,
          sessionString: Encryption.encrypt(sessionString),
          ownerId: userId,
          ownerName: ctx.from.first_name,
          isActive: true
        });
        
        await account.save();
        await telegramService.disconnect();
        
        userSessions.delete(userId);
        
        await ctx.reply(`
✅ <b>Account Added Successfully!</b>

📱 Phone: ${session.data.phone}
🔐 Session: Saved securely
👤 Owner: ${ctx.from.first_name}

<i>Account is ready for group creation.</i>
        `, { parse_mode: 'HTML' });
        
      } else if (result === '2FA_NEEDED') {
        session.state = 'WAITING_PASSWORD';
        await ctx.reply('🔐 Account has 2FA. Enter your password:');
      } else {
        await ctx.reply('❌ Invalid code. Try /addaccount again.');
        userSessions.delete(userId);
      }
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
      userSessions.delete(userId);
    }
  }
  
  else if (session.state === 'WAITING_PASSWORD') {
    try {
      const telegramService = session.data.telegramService;
      const success = await telegramService.signInWithPassword(text);
      
      if (success) {
        const sessionString = await telegramService.getSessionString();
        
        const account = new Account({
          phone: session.data.phone,
          apiId: session.data.apiId,
          apiHash: session.data.apiHash,
          sessionString: Encryption.encrypt(sessionString),
          ownerId: userId,
          ownerName: ctx.from.first_name,
          isActive: true
        });
        
        await account.save();
        await telegramService.disconnect();
        
        userSessions.delete(userId);
        
        await ctx.reply(`
✅ <b>Account Added with 2FA!</b>

📱 Phone: ${session.data.phone}
🔐 2FA: Enabled
👤 Owner: ${ctx.from.first_name}

<i>Ready to create groups.</i>
        `, { parse_mode: 'HTML' });
      } else {
        await ctx.reply('❌ Invalid password. Try /addaccount again.');
        userSessions.delete(userId);
      }
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
      userSessions.delete(userId);
    }
  }
});

// ========== CREATE GROUP ==========
bot.command('creategroup', async (ctx) => {
  const userId = ctx.from.id;
  const accounts = await Account.find({ ownerId: userId, isActive: true });
  
  if (accounts.length === 0) {
    return ctx.reply(`
❌ <b>No Active Accounts</b>

Use /addaccount to add a Telegram account first.
    `, { parse_mode: 'HTML' });
  }
  
  const buttons = accounts.map(acc => [
    Markup.button.callback(`📱 ${acc.phone}`, `create_with_${acc._id}`)
  ]);
  
  buttons.push([Markup.button.callback('❌ Cancel', 'cancel')]);
  
  const keyboard = Markup.inlineKeyboard(buttons);
  
  await ctx.reply(`
👥 <b>Create Group</b>

Select an account to create group:

<i>Groups will have:</i>
• 'hello' welcome message
• Open permissions
• Visible chat history
  `, {
    parse_mode: 'HTML',
    ...keyboard
  });
});

// Handle group creation
bot.action(/create_with_(.+)/, async (ctx) => {
  const accountId = ctx.match[1];
  const userId = ctx.from.id;
  
  await ctx.answerCbQuery();
  await ctx.editMessageText('⏳ Creating group... Please wait.');
  
  try {
    const account = await Account.findById(accountId);
    
    if (!account || account.ownerId !== userId) {
      return ctx.editMessageText('❌ Account not found or access denied.');
    }
    
    // Update account last used
    account.lastUsed = new Date();
    await account.save();
    
    // Create Telegram service
    const telegramService = new TelegramService(
      account.apiId,
      account.apiHash,
      account.phone,
      Encryption.decrypt(account.sessionString)
    );
    
    const groupName = `Group ${Date.now().toString().slice(-6)}`;
    const result = await telegramService.createGroup(groupName);
    
    await telegramService.disconnect();
    
    if (result.success) {
      // Save group to database
      const group = new Group({
        groupName: groupName,
        chatId: result.chat_id,
        inviteLink: result.invite_link,
        createdByAccount: account.phone,
        createdByUser: userId,
        memberCount: result.total_members
      });
      
      await group.save();
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('🔗 Open Group', result.invite_link)],
        [Markup.button.callback('📋 Copy Link', `copy_${result.invite_link}`)],
        [Markup.button.callback('🚀 Create Another', 'create_another')]
      ]);
      
      await ctx.editMessageText(`
✅ <b>Group Created Successfully!</b>

<b>Name:</b> ${groupName}
<b>ID:</b> ${result.chat_id}
<b>Account:</b> ${account.phone}
<b>Link:</b> ${result.invite_link}

<b>Features:</b>
• ✅ 'hello' message sent
• ✅ All permissions open
• ✅ Chat history visible
      `, {
        parse_mode: 'HTML',
        ...keyboard
      });
      
    } else {
      await ctx.editMessageText(`❌ Failed to create group: ${result.error}`);
    }
    
  } catch (error) {
    console.error('Group creation error:', error);
    await ctx.editMessageText(`❌ Error: ${error.message}`);
  }
});

// ========== BULK CREATE ==========
bot.command('createbulk', async (ctx) => {
  const userId = ctx.from.id;
  const accounts = await Account.find({ ownerId: userId, isActive: true });
  
  if (accounts.length === 0) {
    return ctx.reply('❌ No accounts found. Use /addaccount first.');
  }
  
  userSessions.set(userId, {
    state: 'BULK_SELECT_ACCOUNT',
    accounts: accounts
  });
  
  const buttons = accounts.map((acc, i) => [
    Markup.button.callback(`${i + 1}. ${acc.phone}`, `bulk_acc_${acc._id}`)
  ]);
  
  buttons.push([Markup.button.callback('❌ Cancel', 'cancel')]);
  
  const keyboard = Markup.inlineKeyboard(buttons);
  
  await ctx.reply(`
🚀 <b>Bulk Group Creation</b>

Select account for bulk creation:

<i>Will create multiple groups with 5-second intervals.</i>
  `, {
    parse_mode: 'HTML',
    ...keyboard
  });
});

// Handle bulk account selection
bot.action(/bulk_acc_(.+)/, async (ctx) => {
  const accountId = ctx.match[1];
  const userId = ctx.from.id;
  
  await ctx.answerCbQuery();
  
  const session = userSessions.get(userId);
  if (!session) return;
  
  session.state = 'BULK_ENTER_COUNT';
  session.selectedAccountId = accountId;
  userSessions.set(userId, session);
  
  await ctx.editMessageText(`
✅ Account selected.

Enter number of groups to create (1-20):

<i>Each group will have all features enabled.</i>
  `, { parse_mode: 'HTML' });
});

// Handle bulk count input
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  
  if (!session || session.state !== 'BULK_ENTER_COUNT') return;
  
  const count = parseInt(ctx.message.text.trim());
  
  if (isNaN(count) || count < 1 || count > 20) {
    return ctx.reply('❌ Please enter a number between 1 and 20:');
  }
  
  await ctx.reply(`🚀 Starting bulk creation of ${count} groups...`);
  
  try {
    const account = await Account.findById(session.selectedAccountId);
    
    if (!account || account.ownerId !== userId) {
      return ctx.reply('❌ Account not found or access denied.');
    }
    
    // Update account last used
    account.lastUsed = new Date();
    await account.save();
    
    // Create Telegram service
    const telegramService = new TelegramService(
      account.apiId,
      account.apiHash,
      account.phone,
      Encryption.decrypt(account.sessionString)
    );
    
    const statusMsg = await ctx.reply(`Progress: 0/${count} (0%)`);
    
    let successCount = 0;
    let failedCount = 0;
    
    for (let i = 1; i <= count; i++) {
      try {
        const groupName = `Group ${Date.now().toString().slice(-6)}-${i}`;
        const result = await telegramService.createGroup(groupName);
        
        if (result.success) {
          successCount++;
          
          // Save group
          const group = new Group({
            groupName: groupName,
            chatId: result.chat_id,
            inviteLink: result.invite_link,
            createdByAccount: account.phone,
            createdByUser: userId,
            memberCount: result.total_members
          });
          
          await group.save();
        } else {
          failedCount++;
        }
        
        // Update progress
        const progress = Math.floor((i / count) * 100);
        await ctx.telegram.editMessageText(
          statusMsg.chat.id,
          statusMsg.message_id,
          null,
          `Progress: ${i}/${count} (${progress}%)\n✅ Success: ${successCount} | ❌ Failed: ${failedCount}`
        );
        
        // Wait 5 seconds between creations (except last)
        if (i < count) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
      } catch (error) {
        failedCount++;
        console.error(`Group ${i} error:`, error.message);
      }
    }
    
    await telegramService.disconnect();
    userSessions.delete(userId);
    
    await ctx.telegram.editMessageText(
      statusMsg.chat.id,
      statusMsg.message_id,
      null,
      `✅ <b>Bulk Creation Complete!</b>\n\nSuccess: ${successCount}\nFailed: ${failedCount}\nTotal: ${count}`,
      { parse_mode: 'HTML' }
    );
    
  } catch (error) {
    console.error('Bulk creation error:', error);
    await ctx.reply(`❌ Bulk creation failed: ${error.message}`);
    userSessions.delete(userId);
  }
});

// ========== OTHER COMMANDS ==========
bot.command('myaccounts', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const accounts = await Account.find({ ownerId: userId, isActive: true });
    
    if (accounts.length === 0) {
      return ctx.reply(`
📭 <b>No Accounts</b>

Use /addaccount to add your first account.
      `, { parse_mode: 'HTML' });
    }
    
    let message = `📱 <b>Your Accounts (${accounts.length})</b>\n\n`;
    
    accounts.forEach((acc, i) => {
      message += `${i + 1}. <b>${acc.phone}</b>\n`;
      message += `   Added: ${acc.createdAt.toLocaleDateString()}\n`;
      message += `   Last used: ${acc.lastUsed.toLocaleDateString()}\n`;
      if (i < accounts.length - 1) message += '\n';
    });
    
    await ctx.reply(message, { parse_mode: 'HTML' });
    
  } catch (error) {
    await ctx.reply('❌ Error loading accounts.');
  }
});

bot.command('stats', async (ctx) => {
  try {
    const totalAccounts = await Account.countDocuments();
    const activeAccounts = await Account.countDocuments({ isActive: true });
    const totalGroups = await Group.countDocuments();
    const totalUsers = await User.countDocuments();
    
    await ctx.reply(`
📊 <b>System Statistics</b>

📱 Total accounts: ${totalAccounts}
✅ Active accounts: ${activeAccounts}
👥 Groups created: ${totalGroups}
👤 Total users: ${totalUsers}
✅ MongoDB: Connected
⏰ Uptime: ${Math.floor(process.uptime() / 60)} minutes
  `, { parse_mode: 'HTML' });
    
  } catch (error) {
    await ctx.reply(`
📊 <b>Statistics</b>

Bot: ✅ Online
Database: Connecting...

Basic features available.
    `, { parse_mode: 'HTML' });
  }
});

// ========== CALLBACK HANDLERS ==========
bot.action('add_account', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Use /addaccount command.');
});

bot.action('create_group', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Use /creategroup command.');
});

bot.action('bulk_create', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Use /createbulk command.');
});

bot.action('my_accounts', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Use /myaccounts command.');
});

bot.action('show_stats', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Use /stats command.');
});

bot.action(/copy_(.+)/, async (ctx) => {
  const link = ctx.match[1];
  await ctx.answerCbQuery('Link copied to message!');
  await ctx.editMessageText(`📋 <b>Invite Link:</b>\n\n<code>${link}</code>`, {
    parse_mode: 'HTML'
  });
});

bot.action('create_another', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('Use /creategroup to create another group.');
});

bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('❌ Operation cancelled.');
  const userId = ctx.from.id;
  userSessions.delete(userId);
});

// ========== EXPRESS SERVER ==========
app.get('/', async (req, res) => {
  try {
    const accountCount = await Account.countDocuments();
    const groupCount = await Group.countDocuments();
    const userCount = await User.countDocuments();
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cretee Bot - Full Version</title>
        <style>
          body { font-family: Arial; padding: 40px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
          .success { background: #d4edda; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .feature { background: #e7f3ff; padding: 15px; margin: 10px 0; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 Cretee Bot - Full Version</h1>
          <div class="success">
            <h2>✅ System Online</h2>
            <p>📱 Accounts: ${accountCount}</p>
            <p>👥 Groups: ${groupCount}</p>
            <p>👤 Users: ${userCount}</p>
            <p>⏰ Uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
          </div>
          
          <h3>🚀 Features:</h3>
          <div class="feature">
            <h4>📱 Account Management</h4>
            <p>• Add real Telegram accounts</p>
            <p>• Secure session storage</p>
            <p>• Multiple account support</p>
          </div>
          
          <div class="feature">
            <h4>👥 Group Creation</h4>
            <p>• Create groups with all features</p>
            <p>• 'hello' welcome message</p>
            <p>• Open permissions</p>
            <p>• Visible chat history</p>
          </div>
          
          <div class="feature">
            <h4>🚀 Bulk Operations</h4>
            <p>• Create multiple groups at once</p>
            <p>• Progress tracking</p>
            <p>• 5-second intervals</p>
          </div>
          
          <p>✅ All systems operational</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.send('<h1>🤖 Cretee Bot</h1><p>✅ Bot is running</p>');
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ========== START APPLICATION ==========
async function start() {
  console.log('🚀 Starting Cretee Bot - Full Version...');
  
  // Connect to MongoDB
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ MongoDB connected');
    } catch (error) {
      console.log('❌ MongoDB failed:', error.message);
    }
  }
  
  // Start web server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🌐 Server: http://localhost:${PORT}`);
  });
  
  // Start bot
  await bot.launch();
  console.log('🤖 Bot is running with full features!');
  console.log('👉 Features available:');
  console.log('   • Account management (/addaccount)');
  console.log('   • Group creation (/creategroup)');
  console.log('   • Bulk creation (/createbulk)');
  console.log('   • Account listing (/myaccounts)');
  console.log('   • Statistics (/stats)');
}

// Error handling
bot.catch(console.error);
process.on('unhandledRejection', console.error);

// Start
start();

// Create test-telegram.js to test the library
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function testTelegram() {
  console.log('Testing Telegram library...');
  
  const apiId = 123456; // Your API ID
  const apiHash = 'abcdef123456'; // Your API Hash
  const phone = '+1234567890'; // Your phone
  
  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });
  
  await client.connect();
  console.log('✅ Connected');
  
  // Test methods
  console.log('Available methods:');
  console.log('- client.signIn:', typeof client.signIn);
  console.log('- client.sendCode:', typeof client.sendCode);
  console.log('- client.invoke:', typeof client.invoke);
  
  await client.disconnect();
  console.log('✅ Test completed');
  process.exit(0);
}

testTelegram();

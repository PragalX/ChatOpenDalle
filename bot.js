require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const { MongoClient } = require('mongodb');

// Initialize logging
const log = console.log;

// Environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const BOT_OWNER_ID = parseInt(process.env.BOT_OWNER_ID);
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// MongoDB client
const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let usersCollection;
let subscriptionsCollection;
let giftCodesCollection;

client.connect(err => {
  if (err) throw err;
  const db = client.db('telegram_bot');
  usersCollection = db.collection('users');
  subscriptionsCollection = db.collection('subscriptions');
  giftCodesCollection = db.collection('gift_codes');
  log('Connected to MongoDB');
});

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

const lastAiUse = {};

function isOwner(userId) {
  return userId === BOT_OWNER_ID;
}

function logMessage(bot, user, userInput, botResponse) {
  if (LOG_CHANNEL_ID) {
    const userInfo = `User ID: ${user.id}\nUsername: @${user.username}\nName: ${user.first_name} ${user.last_name}`;
    const message = `${userInfo}\nUser input: ${userInput}\nBot response: ${botResponse}`;
    bot.telegram.sendMessage(LOG_CHANNEL_ID, message);
  }
}

function generateCode(length = 8) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

bot.start(async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  const responseText = 'Hi! Send me a command /ai followed by your prompt to generate an image, or use /ask followed by your query to get an answer, or /dev to get developer info, or /help to get all commands info.\n\nDeveloped by @AkhandanandTripathi';

  await ctx.reply(responseText);
  logMessage(bot, user, userInput, responseText);

  await usersCollection.updateOne({ user_id: user.id }, { $set: { username: user.username, full_name: `${user.first_name} ${user.last_name}` } }, { upsert: true });
});

bot.help((ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  const responseText = 'Available commands:\n/start - Start the bot\n/ai <prompt> - Generate an image based on the prompt\n/proai <prompt> - Generate an image based on the prompt (professional, no time limit)\n/ask <query> - Get an answer to your query\n/dev - Get developer info\n/setlogchannel <id> - Set the log channel (owner only)\n/ping - Check the server response time\n/generate - Generate a gift code (owner only)\n/redeem <code> - Redeem a gift code to get a professional plan\n/users - Get the list of users (owner only)\n/broadcast <message> - Broadcast a message to all users and groups (owner only)';

  ctx.reply(responseText);
  logMessage(bot, user, userInput, responseText);
});

async function generateImage(prompt) {
  try {
    const response = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: '1024x1024'
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.data) {
      return response.data.data[0].url;
    } else {
      log(`Error in response: ${response.data}`);
      return null;
    }
  } catch (error) {
    log(`Error generating image: ${error}`);
    return null;
  }
}

bot.command('ai', async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  const userId = user.id;
  const currentTime = new Date();

  if (lastAiUse[userId] && (currentTime - lastAiUse[userId]) < 5000) {
    const responseText = 'Please wait for 5 seconds before using the /ai command again.';
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
    return;
  }

  lastAiUse[userId] = currentTime;
  const userPrompt = ctx.message.text.split(' ').slice(1).join(' ');
  if (userPrompt) {
    await ctx.reply('Generating image...');
    const imageUrl = await generateImage(userPrompt);
    if (imageUrl) {
      await ctx.replyWithPhoto(imageUrl);
      logMessage(bot, user, userInput, imageUrl);
    } else {
      const responseText = 'Sorry, there was an error generating the image. Please contact @AkhandanandTripathi to fix it.';
      await ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    }
  } else {
    const responseText = 'Please provide a prompt after the /ai command.';
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  }
});

bot.command('proai', async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  const userId = user.id;

  const subscription = await subscriptionsCollection.findOne({ user_id: userId });
  if (subscription && subscription.plan === 'professional') {
    const userPrompt = ctx.message.text.split(' ').slice(1).join(' ');
    if (userPrompt) {
      await ctx.reply('Generating image...');
      const imageUrl = await generateImage(userPrompt);
      if (imageUrl) {
        await ctx.replyWithPhoto(imageUrl);
        logMessage(bot, user, userInput, imageUrl);
      } else {
        const responseText = 'Sorry, there was an error generating the image. Please contact @AkhandanandTripathi to fix it.';
        await ctx.reply(responseText);
        logMessage(bot, user, userInput, responseText);
      }
    } else {
      const responseText = 'Please provide a prompt after the /proai command.';
      await ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    }
  } else {
    const responseText = 'You need to redeem a gift code to use the /proai command.';
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  }
});

async function askQuestion(question) {
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4',
      messages: [{ role: 'user', content: question }],
      max_tokens: 4096
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content.trim();
    } else {
      log(`Error in response: ${response.data}`);
      return null;
    }
  } catch (error) {
    log(`Error generating response: ${error}`);
    return null;
  }
}

bot.command('ask', async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  const userQuestion = ctx.message.text.split(' ').slice(1).join(' ');
  if (userQuestion) {
    await ctx.reply('Thinking...');
    const answer = await askQuestion(userQuestion);
    if (answer) {
      await ctx.reply(answer);
      logMessage(bot, user, userInput, answer);
    } else {
      const responseText = 'Sorry, there was an error generating the answer. Please contact @AkhandanandTripathi to fix it.';
      await ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    }
  } else {
    const responseText = 'Please provide a query after the /ask command.';
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  }
});

bot.command('dev', (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  const responseText = 'Developer @AkhandanandTripathi';
  ctx.reply(responseText);
  logMessage(bot, user, userInput, responseText);
});

bot.command('setlogchannel', (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  if (isOwner(user.id)) {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 1) {
      log_channel_id = args[0];
      const responseText = `Log channel set to ${log_channel_id}`;
      ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    } else {
      const responseText = 'Usage: /setlogchannel <log_channel_id>';
      ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    }
  } else {
    const responseText = "You don't have permission to use this command. Please ask @AkhandanandTripathi to do it.";
    ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  }
});

bot.command('ping', async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  const start_time = Date.now();
  await ctx.reply('Pong!');
  const end_time = Date.now();
  const ping_time = end_time - start_time;
  const responseText = `Pong! ${ping_time} ms`;
  await ctx.reply(responseText);
  logMessage(bot, user, userInput, responseText);
});

bot.command('generate', async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  if (isOwner(user.id)) {
    const code = generateCode();
    await giftCodesCollection.insertOne({ code: code, plan: 'professional' });
    const responseText = `Generated gift code: ${code}`;
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  } else {
    const responseText = "You don't have permission to use this command. Please ask @AkhandanandTripathi to do it.";
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  }
});

bot.command('redeem', async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 1) {
    const code = args[0];
    const giftCode = await giftCodesCollection.findOneAndDelete({ code: code });
    if (giftCode.value) {
      await subscriptionsCollection.updateOne({ user_id: user.id }, { $set: { plan: 'professional' } }, { upsert: true });
      const responseText = "You have successfully redeemed the code and upgraded to the professional plan.";
      await ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    } else {
      const responseText = "Invalid or already redeemed gift code.";
      await ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    }
  } else {
    const responseText = "Usage: /redeem <gift_code>";
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  }
});

bot.command('users', async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  if (isOwner(user.id)) {
    const users = await usersCollection.find().toArray();
    const userList = users.map(user => `${user.full_name} (@${user.username})`).join('\n');
    const responseText = `Users:\n${userList}`;
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  } else {
    const responseText = "Ummmm, you are not capable of it.";
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  }
});

bot.command('broadcast', async (ctx) => {
  const user = ctx.message.from;
  const userInput = ctx.message.text;
  if (isOwner(user.id)) {
    const message = ctx.message.text.split(' ').slice(1).join(' ');
    if (message) {
      const users = await usersCollection.find().toArray();
      for (const user of users) {
        try {
          await bot.telegram.sendMessage(user.user_id, message);
        } catch (error) {
          log(`Error sending message to ${user.user_id}: ${error}`);
        }
      }
      const responseText = "Broadcast message sent.";
      await ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    } else {
      const responseText = "Usage: /broadcast <message>";
      await ctx.reply(responseText);
      logMessage(bot, user, userInput, responseText);
    }
  } else {
    const responseText = "Ummmm, you are not capable of it.";
    await ctx.reply(responseText);
    logMessage(bot, user, userInput, responseText);
  }
});

bot.launch().then(() => {
  log('Bot started');
}).catch(err => {
  log(`Error starting bot: ${err}`);
});

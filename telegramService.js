const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const crypto = require('crypto');

class TelegramService {
  constructor(apiId, apiHash, phone, sessionString = '') {
    this.apiId = parseInt(apiId);
    this.apiHash = apiHash;
    this.phone = phone;
    this.stringSession = new StringSession(sessionString || '');
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = new TelegramClient(this.stringSession, this.apiId, this.apiHash, {
        connectionRetries: 5,
      });
      
      await this.client.connect();
      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('Connection error:', error.message);
      return false;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  async sendCode() {
    try {
      if (!this.isConnected) await this.connect();
      await this.client.sendCode({
        apiId: this.apiId,
        apiHash: this.apiHash,
      }, this.phone);
      return true;
    } catch (error) {
      throw new Error(`Send code failed: ${error.message}`);
    }
  }

  async signIn(code) {
    try {
      await this.client.signIn({
        phoneNumber: this.phone,
        phoneCode: code,
      });
      return true;
    } catch (error) {
      if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        return '2FA_NEEDED';
      }
      throw error;
    }
  }

  async signInWithPassword(password) {
    try {
      await this.client.signIn({
        password: password,
      });
      return true;
    } catch (error) {
      throw error;
    }
  }

  async getSessionString() {
    if (this.client && this.client.session) {
      return this.client.session.save();
    }
    return '';
  }

  async createGroup(groupName, members = []) {
    try {
      if (!this.isConnected) await this.connect();
      
      // Create channel (group)
      const result = await this.client.invoke(
        new Api.channels.CreateChannel({
          title: groupName,
          about: '',
          megagroup: true,
          broadcast: false,
        })
      );

      const channel = result.chats[0];

      // Make chat history visible
      await this.client.invoke(
        new Api.channels.TogglePreHistoryHidden({
          channel: channel,
          enabled: false,
        })
      );

      // Set open permissions
      await this.client.invoke(
        new Api.messages.EditChatDefaultBannedRights({
          peer: channel,
          bannedRights: new Api.ChatBannedRights({
            untilDate: 0,
            viewMessages: false,
            sendMessages: false,
            sendMedia: false,
            sendStickers: false,
            sendGifs: false,
            sendGames: false,
            sendInline: false,
            embedLinks: false,
            sendPolls: false,
            changeInfo: false,
            inviteUsers: false,
            pinMessages: false,
          }),
        })
      );

      // Generate invite link
      const invite = await this.client.invoke(
        new Api.messages.ExportChatInvite({
          peer: channel,
        })
      );

      // Send welcome message
      await this.client.sendMessage(channel, {
        message: 'hello',
      });

      // Add members if provided
      let addedMembers = 0;
      for (const username of members) {
        try {
          const user = await this.client.getEntity(username);
          await this.client.invoke(
            new Api.channels.InviteToChannel({
              channel: channel,
              users: [user],
            })
          );
          addedMembers++;
          // Wait 1 second between adds
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Failed to add ${username}:`, error.message);
        }
      }

      return {
        success: true,
        chat_id: channel.id.toString(),
        invite_link: invite.link,
        title: channel.title,
        members_added: addedMembers,
        total_members: addedMembers + 1,
      };

    } catch (error) {
      console.error('Error creating group:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async createBulkGroups(count, baseName = "Group") {
    const results = [];
    
    for (let i = 1; i <= count; i++) {
      try {
        const groupName = `${baseName} ${i}`;
        const result = await this.createGroup(groupName, []);
        
        results.push({
          number: i,
          success: result.success,
          name: groupName,
          link: result.invite_link,
          error: result.error
        });
        
        // Wait 5 seconds between creations
        if (i < count) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (error) {
        results.push({
          number: i,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

module.exports = TelegramService;
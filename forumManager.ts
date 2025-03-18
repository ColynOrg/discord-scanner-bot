import {
  Client,
  TextChannel,
  ThreadChannel,
  ForumChannel,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  Colors,
  ComponentType,
  Message,
  ButtonInteraction,
  ChatInputCommandInteraction,
  time,
  Events,
  GuildMemberRoleManager
} from 'discord.js';
import Database from 'better-sqlite3';

interface ScheduledClose {
  thread_id: string;
  scheduled_time: string;
}

export class ForumManager {
  private static readonly FORUM_CHANNEL_ID = '1349920447957045329';
  private static readonly SOLVED_TAG_ID = '1349920578987102250';
  private static readonly WAITING_REPLY_TAG_ID = '1351244087642292295';
  private static readonly AUTO_CLOSE_DELAY = 60 * 60 * 1000; // 1 hour in milliseconds
  private static readonly INACTIVITY_CHECK_DELAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private static readonly activeThreads = new Map<string, NodeJS.Timeout>();
  private static readonly inactivityWarnings = new Map<string, boolean>(); // Track which threads have warnings
  private static readonly pendingClosures = new Map<string, number>(); // Track threads awaiting closure

  private db: Database.Database;
  private readonly autoCloseDelay = ForumManager.AUTO_CLOSE_DELAY;

  constructor(private client: Client) {
    this.db = new Database('forum.db');
    this.checkInactiveThreads();
    this.setupForumListeners();

    // Handle graceful shutdown
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  private async getDb(): Promise<Database.Database> {
    return this.db;
  }

  private async findSolvedMessage(thread: ThreadChannel): Promise<Message | undefined> {
    const messages = await thread.messages.fetch({ limit: 10 });
    return messages.find(msg => 
      msg.author.id === this.client.user?.id && 
      msg.embeds[0]?.title === 'Post Marked as Solved'
    );
  }

  private scheduleThreadClose(thread: ThreadChannel, scheduledTime: Date) {
    const delay = scheduledTime.getTime() - Date.now();
    if (delay <= 0) return;

    const timer = setTimeout(async () => {
      try {
        // Check if thread still exists
        try {
          await thread.fetch();
        } catch (error) {
          console.log(`Thread ${thread.id} was deleted before closure`);
          ForumManager.activeThreads.delete(thread.id);
          ForumManager.pendingClosures.delete(thread.id);
          return;
        }

        // Lock the thread when the timer expires
        await thread.setLocked(true);
        
        // Try to find and update the solved message embed
        const solvedMessage = await this.findSolvedMessage(thread);
        if (solvedMessage && solvedMessage.embeds[0]) {
          const originalEmbed = solvedMessage.embeds[0];
          const updatedEmbed = EmbedBuilder.from(originalEmbed)
            .setColor(Colors.Red)
            .setFields([
              { 
                name: 'Post Marked as Solved and is Now Closed', 
                value: `This post was closed ${time(new Date(), 'R')} (${time(new Date(), 'f')}).` 
              }
            ])
            .setTimestamp();

          await solvedMessage.edit({ embeds: [updatedEmbed] });
        } else {
          // Create a new embed if we can't find the original
          const newEmbed = new EmbedBuilder()
            .setColor(Colors.Red)
            .setTitle('Post Marked as Solved and is Now Closed')
            .setDescription(`This post was closed ${time(new Date(), 'R')} (${time(new Date(), 'f')}).`)
            .setTimestamp();

          await thread.send({ embeds: [newEmbed] });
        }

        ForumManager.activeThreads.delete(thread.id);
        ForumManager.pendingClosures.delete(thread.id);
      } catch (error) {
        console.error('Error closing thread:', error);
        // If we get an error, try to clean up the maps anyway
        ForumManager.activeThreads.delete(thread.id);
        ForumManager.pendingClosures.delete(thread.id);
      }
    }, delay);

    ForumManager.activeThreads.set(thread.id, timer);
  }

  private async updateWaitingReplyTag(thread: ThreadChannel, message: Message | boolean) {
    const currentTags = thread.appliedTags;
    const isOP = typeof message === 'boolean' ? false : message.author.id === thread.ownerId;
    const isSolved = currentTags.includes(ForumManager.SOLVED_TAG_ID);
    
    // If OP posted and thread isn't solved, add the waiting for reply tag
    if (isOP && !isSolved) {
      if (!currentTags.includes(ForumManager.WAITING_REPLY_TAG_ID)) {
        const newTags = [...currentTags, ForumManager.WAITING_REPLY_TAG_ID];
        await thread.setAppliedTags(newTags);
      }
    }
    // If not OP or thread is solved, remove the waiting for reply tag
    else if (currentTags.includes(ForumManager.WAITING_REPLY_TAG_ID)) {
      const newTags = currentTags.filter(tag => tag !== ForumManager.WAITING_REPLY_TAG_ID);
      await thread.setAppliedTags(newTags);
    }
  }

  private setupForumListeners() {
    // Listen for new threads
    this.client.on(Events.ThreadCreate, async (thread) => {
      if (thread.parentId === ForumManager.FORUM_CHANNEL_ID) {
        // Wait a short moment for the initial message to be available
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const messages = await thread.messages.fetch({ limit: 1 });
        const firstMessage = messages.first();
        
        // Check if the first message has no content or only attachments
        if (firstMessage && (!firstMessage.content || firstMessage.content.trim() === '')) {
          const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle('Hello, please answer these questions if you haven\'t already, so we can help you faster.')
            .setDescription('• What exactly is your question or the problem you\'re experiencing?\n• What have you already tried?\n• What are you trying to do / what is your overall goal?\n• If possible, please include a screenshot or screen recording of your setup.');

          await thread.send({ embeds: [embed] });
        }

        // Add waiting for reply tag for the initial post
        if (firstMessage) {
          await this.updateWaitingReplyTag(thread, firstMessage);
        }
      }
    });

    // Listen for messages
    this.client.on(Events.MessageCreate, async (message) => {
      // Check if message is in a thread in our forum channel
      if (!message.channel.isThread()) return;
      const thread = message.channel as ThreadChannel;
      if (thread.parentId !== ForumManager.FORUM_CHANNEL_ID) return;

      // Update waiting for reply tag
      await this.updateWaitingReplyTag(thread, message);

      // Check if message is from thread owner
      if (message.author.id === thread.ownerId) {
        // Reset inactivity warning when thread owner sends a message
        ForumManager.inactivityWarnings.delete(thread.id);

        // Check if message indicates the issue is solved
        const content = message.content.toLowerCase();
        if (this.isThankYouMessage(content)) {
          // Don't suggest if the thread is already marked as solved
          if (!thread.appliedTags.includes(ForumManager.SOLVED_TAG_ID)) {
            await message.reply('-# <:tree_corner:1349121251733667921> Command suggestion: </solved:1350200875062136844>');
          }
        }
      }
    });
  }

  private isThankYouMessage(content: string): boolean {
    const thankYouPatterns = [
      /\b(?:thank|thanks|thx|thankyou|ty)\b/i,  // Word boundaries to ensure we match whole words only
      /(?:^|\s)ty(?:\s|$)/i,  // 'ty' with space or start/end of string
      /(?:^|\s)thx(?:\s|$)/i  // 'thx' with space or start/end of string
    ];
    
    return thankYouPatterns.some(pattern => pattern.test(content));
  }

  private async checkInactiveThreads() {
    setInterval(async () => {
      const forumChannel = await this.client.channels.fetch(ForumManager.FORUM_CHANNEL_ID) as ForumChannel;
      if (!forumChannel) return;

      const activeThreads = await forumChannel.threads.fetchActive();
      for (const [_, thread] of activeThreads.threads) {
        // Skip if thread is locked, already has a warning, is marked as solved, or is pending closure
        if (!thread.locked && 
            !ForumManager.inactivityWarnings.has(thread.id) && 
            !thread.appliedTags.includes(ForumManager.SOLVED_TAG_ID) &&
            !ForumManager.pendingClosures.has(thread.id)) {
          const messages = await thread.messages.fetch({ limit: 10 });
          
          const lastNonBotMessage = messages.find(msg => !msg.author.bot);
          const lastThreadOwnerMessage = messages.find(msg => msg.author.id === thread.ownerId);

          if (lastNonBotMessage && lastThreadOwnerMessage &&
              lastNonBotMessage.author.id !== thread.ownerId &&
              Date.now() - lastThreadOwnerMessage.createdTimestamp >= ForumManager.INACTIVITY_CHECK_DELAY) {
            // Check if there's already a warning message with a button
            const existingWarning = messages.find(msg => 
              msg.author.id === this.client.user?.id && 
              msg.embeds[0]?.description?.includes('Hey') &&
              msg.components?.length > 0
            );

            if (!existingWarning) {
              await this.sendInactivityWarning(thread);
              ForumManager.inactivityWarnings.set(thread.id, true);
            }
          }
        }
      }
    }, ForumManager.INACTIVITY_CHECK_DELAY);
  }

  private async sendInactivityWarning(thread: ThreadChannel) {
    const autoSolveTime = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now
    
    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setDescription(`Hey <@${thread.ownerId}>, it seems like your last message was sent more than 24 hours ago.\nIf we don't hear back from you by ${time(autoSolveTime, 'f')} (${time(autoSolveTime, 'R')}), we'll assume the issue is resolved and mark your post as solved.`);

    const solveButton = new ButtonBuilder()
      .setCustomId('mark_solved')
      .setLabel('Issue already solved? Close post now')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(solveButton);

    const message = await thread.send({
      embeds: [embed],
      components: [row]
    });

    // Set up auto-solve timer
    setTimeout(async () => {
      try {
        // Check if the thread still exists and isn't already solved
        const updatedThread = await thread.fetch();
        if (!updatedThread.locked && !updatedThread.appliedTags.includes(ForumManager.SOLVED_TAG_ID)) {
          await this.markAsSolved(updatedThread);
          const closeTime = Date.now() + ForumManager.AUTO_CLOSE_DELAY;
          ForumManager.pendingClosures.set(updatedThread.id, closeTime);
          
          await message.reply({
            content: `No response received. This post has been automatically marked as solved and will be closed ${time(new Date(closeTime), 'R')}.`
          });
        }
      } catch (error) {
        console.error('Error in auto-solve timer:', error);
      }
    }, 12 * 60 * 60 * 1000); // 12 hours

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 24 * 60 * 60 * 1000
    });

    collector.on('collect', async (interaction: ButtonInteraction) => {
      if (interaction.customId === 'mark_solved') {
        // Check if thread is already pending closure
        if (ForumManager.pendingClosures.has(thread.id)) {
          const closeTime = new Date(ForumManager.pendingClosures.get(thread.id)!);
          await interaction.reply({
            content: `This post is already marked as solved and will be closed ${time(closeTime, 'R')}.`,
            ephemeral: true
          });
          return;
        }

        // Check if user is thread owner or has the required role
        const hasRequiredRole = interaction.member?.roles instanceof GuildMemberRoleManager && 
          interaction.member.roles.cache.has('1022899638140928022');
        
        if (interaction.user.id !== thread.ownerId && !hasRequiredRole) {
          await interaction.reply({
            content: 'Only the original poster or moderators can mark a post as solved!',
            ephemeral: true
          });
          return;
        }

        await this.markAsSolved(thread);
        const closeTime = Date.now() + ForumManager.AUTO_CLOSE_DELAY;
        ForumManager.pendingClosures.set(thread.id, closeTime);
        
        await interaction.reply({
          content: `Post has been marked as solved and will be closed ${time(new Date(closeTime), 'R')}.`,
          ephemeral: false
        });
      }
    });
  }

  private async markAsSolved(thread: ThreadChannel) {
    try {
      // Update thread name
      const newName = thread.name.replace(/\[unsolved\]/i, '[solved]');
      await thread.setName(newName);

      // Update the solved message embed
      const solvedMessage = await this.findSolvedMessage(thread);
      if (solvedMessage && solvedMessage.embeds[0]) {
        const originalEmbed = solvedMessage.embeds[0];
        const updatedEmbed = EmbedBuilder.from(originalEmbed)
          .setColor(Colors.Green)  // Change to green since it's not locked yet
          .setFields([
            { 
              name: 'Post Marked as Solved', 
              value: `This post has been marked as solved.\nUse \`/unsolved\` to remove this tag.` 
            }
          ])
          .setTimestamp();

        await solvedMessage.edit({ embeds: [updatedEmbed] });
      }

      // Remove waiting for reply tag if present
      await this.updateWaitingReplyTag(thread, false);

      // Store the scheduled time in the database
      const scheduledTime = new Date(Date.now() + this.autoCloseDelay);
      await this.storeScheduledClose(thread.id, scheduledTime);

      // Schedule the auto-close
      this.scheduleThreadClose(thread, scheduledTime);

      // Log the action
      console.log(`Thread ${thread.name} marked as solved`);
    } catch (error) {
      console.error('Error marking thread as solved:', error);
    }
  }

  private async storeScheduledClose(threadId: string, scheduledTime: Date) {
    const db = await this.getDb();
    try {
      db.prepare('BEGIN').run();

      // Delete any existing entry first
      const deleteStmt = db.prepare('DELETE FROM scheduled_closes WHERE thread_id = ?');
      deleteStmt.run(threadId);

      // Insert new entry
      const insertStmt = db.prepare('INSERT INTO scheduled_closes (thread_id, scheduled_time) VALUES (?, ?)');
      insertStmt.run(threadId, scheduledTime.toISOString());

      db.prepare('COMMIT').run();
    } catch (error) {
      db.prepare('ROLLBACK').run();
      console.error('Error storing scheduled close:', error);
    }
  }

  private async restoreScheduledCloses() {
    try {
      const db = await this.getDb();
      const stmt = db.prepare('SELECT * FROM scheduled_closes WHERE scheduled_time > datetime("now")');
      const rows = stmt.all() as ScheduledClose[];
      
      for (const row of rows) {
        const thread = await this.client.channels.fetch(row.thread_id) as ThreadChannel;
        if (thread && !thread.locked) {
          const scheduledTime = new Date(row.scheduled_time);
          this.scheduleThreadClose(thread, scheduledTime);
        }
      }
    } catch (error) {
      console.error('Error restoring scheduled closes:', error);
    }
  }

  private async initializeDatabase() {
    const db = await this.getDb();
    try {
      db.prepare('BEGIN').run();

      const stmt = db.prepare(`
        CREATE TABLE IF NOT EXISTS scheduled_closes (
          thread_id TEXT PRIMARY KEY,
          scheduled_time TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      stmt.run();

      // Add index for scheduled_time for faster queries
      const indexStmt = db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_time 
        ON scheduled_closes(scheduled_time)
      `);
      indexStmt.run();

      db.prepare('COMMIT').run();
      console.log('Database initialized successfully');
    } catch (error) {
      db.prepare('ROLLBACK').run();
      console.error('Error initializing database:', error);
    }
  }

  private async cleanupDatabase() {
    try {
      const db = await this.getDb();
      const stmt = db.prepare('DELETE FROM scheduled_closes WHERE scheduled_time < datetime("now", "-1 day")');
      stmt.run();
      console.log('Database cleanup completed');
    } catch (error) {
      console.error('Error cleaning up database:', error);
    }
  }

  public async initialize() {
    try {
      await this.initializeDatabase();
      await this.cleanupDatabase(); // Clean up old entries
      await this.restoreScheduledCloses();
      
      // Set up periodic database cleanup
      setInterval(() => {
        this.cleanupDatabase();
      }, 24 * 60 * 60 * 1000); // Run cleanup daily

      console.log('Forum manager initialized successfully');
    } catch (error) {
      console.error('Error initializing forum manager:', error);
    }
  }

  public async handleSolvedCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel?.isThread()) {
      await interaction.reply({
        content: 'This command can only be used in forum posts!',
        ephemeral: true
      });
      return;
    }

    const thread = interaction.channel as ThreadChannel;
    const forumChannel = thread.parent as ForumChannel;

    if (forumChannel.id !== ForumManager.FORUM_CHANNEL_ID) {
      await interaction.reply({
        content: 'This command can only be used in the help forum!',
        ephemeral: true
      });
      return;
    }

    // Check if thread is already pending closure
    if (ForumManager.pendingClosures.has(thread.id)) {
      const closeTime = new Date(ForumManager.pendingClosures.get(thread.id)!);
      await interaction.reply({
        content: `This post is already marked as solved and will be closed ${time(closeTime, 'R')}.`,
        ephemeral: true
      });
      return;
    }

    // Check if user is thread owner or has the required role
    const hasRequiredRole = interaction.member?.roles instanceof GuildMemberRoleManager && 
      interaction.member.roles.cache.has('1022899638140928022');
    if (thread.ownerId !== interaction.user.id && !hasRequiredRole) {
      await interaction.reply({
        content: 'Only the original poster or moderators can mark a post as solved!',
        ephemeral: true
      });
      return;
    }

    await this.markAsSolved(thread);
    
    const closeTime = Date.now() + ForumManager.AUTO_CLOSE_DELAY;
    ForumManager.pendingClosures.set(thread.id, closeTime);

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('Post Marked as Solved')
      .setDescription(`This post has been marked as solved by <@${interaction.user.id}>!\nUse </unsolved:1350224524825727007> to remove this tag.`)
      .addFields({
        name: '🔒 Post awaiting automatic closure',
        value: `This post will be closed ${time(new Date(closeTime), 'R')} (${time(new Date(closeTime), 'f')}).`
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: false
    });
  }

  public async handleUnsolvedCommand(interaction: ChatInputCommandInteraction) {
    try {
      const thread = interaction.channel as ThreadChannel;
      if (!thread || !thread.isThread()) {
        await interaction.reply({ 
          content: 'This command can only be used in forum threads.', 
          ephemeral: true 
        });
        return;
      }

      // Check if the thread is locked
      if (thread.locked) {
        try {
          // Get the last 50 messages to find who marked it as solved
          const messages = await thread.messages.fetch({ limit: 50 });
          const solvedMessage = messages.find(msg => 
            msg.author.id === this.client.user?.id && 
            msg.embeds[0]?.title === 'Post Marked as Solved'
          );

          if (solvedMessage && solvedMessage.embeds[0]) {
            const description = solvedMessage.embeds[0].description || '';
            const userId = description.match(/marked as solved by <@(\d+)>/)?.[1];
            
            if (userId) {
              await interaction.reply({ 
                content: `<@${userId}> marked this post as solved and it was closed ${time(new Date(solvedMessage.createdTimestamp), 'R')} (${time(new Date(solvedMessage.createdTimestamp), 'f')}).`, 
                ephemeral: true 
              });
            } else {
              await interaction.reply({ 
                content: `This post was marked as solved and closed ${time(new Date(solvedMessage.createdTimestamp), 'R')} (${time(new Date(solvedMessage.createdTimestamp), 'f')}).`, 
                ephemeral: true 
              });
            }
          } else {
            await interaction.reply({ 
              content: 'This post was previously marked as solved and closed.', 
              ephemeral: true 
            });
          }
        } catch (error) {
          console.error('Error fetching solved message:', error);
          await interaction.reply({ 
            content: 'This post was previously marked as solved and closed.', 
            ephemeral: true 
          });
        }
        return;
      }

      // Clear any pending closures
      const timer = ForumManager.activeThreads.get(thread.id);
      if (timer) {
        clearTimeout(timer);
        ForumManager.activeThreads.delete(thread.id);
        ForumManager.pendingClosures.delete(thread.id);
      }

      // Remove from database if exists
      try {
        const db = await this.getDb();
        const stmt = db.prepare('DELETE FROM scheduled_closes WHERE thread_id = ?');
        stmt.run(thread.id);
      } catch (error) {
        console.error('Error removing scheduled close from database:', error);
      }

      // Update thread name
      const newName = thread.name.replace(/\[solved\]/i, '[unsolved]');
      await thread.setName(newName);

      // Update the solved message embed
      const solvedMessage = await this.findSolvedMessage(thread);
      if (solvedMessage && solvedMessage.embeds[0]) {
        const originalEmbed = solvedMessage.embeds[0];
        const updatedEmbed = EmbedBuilder.from(originalEmbed)
          .setColor(Colors.Yellow)
          .setFields([
            { 
              name: 'Post Marked as Unsolved', 
              value: `This post has been marked as unsolved by <@${interaction.user.id}>.\nUse \`/solved\` to mark this post as solved.` 
            }
          ])
          .setTimestamp();

        await solvedMessage.edit({ embeds: [updatedEmbed] });
      }

      // Remove solved tag if present
      if (thread.appliedTags.includes(ForumManager.SOLVED_TAG_ID)) {
        const newTags = thread.appliedTags.filter(tag => tag !== ForumManager.SOLVED_TAG_ID);
        await thread.setAppliedTags(newTags);
      }

      await interaction.reply({ 
        content: 'Post marked as unsolved. Use `/solved` to mark it as solved again.', 
        ephemeral: true 
      });
    } catch (error) {
      console.error('Error handling unsolved command:', error);
      await interaction.reply({ 
        content: 'An error occurred while marking the post as unsolved.', 
        ephemeral: true 
      });
    }
  }

  private async cleanup() {
    try {
      // Wait for any imminent closures (within next 10 seconds)
      const imminentClosures = Array.from(ForumManager.activeThreads.entries())
        .filter(([threadId, timer]) => {
          const closeTime = ForumManager.pendingClosures.get(threadId);
          return closeTime && (closeTime - Date.now() <= 10000); // 10 seconds
        });

      if (imminentClosures.length > 0) {
        console.log(`Waiting for ${imminentClosures.length} imminent closures to complete...`);
        await Promise.all(imminentClosures.map(async ([threadId]) => {
          const closeTime = ForumManager.pendingClosures.get(threadId);
          if (closeTime) {
            const timeLeft = closeTime - Date.now();
            if (timeLeft > 0) {
              await new Promise(resolve => setTimeout(resolve, timeLeft));
            }
          }
        }));
      }

      // Clear remaining timers that aren't about to close
      for (const [threadId, timer] of ForumManager.activeThreads) {
        const closeTime = ForumManager.pendingClosures.get(threadId);
        if (!closeTime || (closeTime - Date.now() > 10000)) {
          clearTimeout(timer);
          // Store the remaining time in the database so it can be restored
          const timeLeft = closeTime ? closeTime - Date.now() : 0;
          if (timeLeft > 0) {
            await this.storeScheduledClose(threadId, new Date(Date.now() + timeLeft));
          }
        }
      }

      ForumManager.activeThreads.clear();
      ForumManager.pendingClosures.clear();

      // Close database connection
      if (this.db) {
        this.db.close();
      }

      console.log('Forum manager cleaned up successfully');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
} 
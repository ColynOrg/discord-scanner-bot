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

export class ForumManager {
  private static readonly FORUM_CHANNEL_ID = '1349920447957045329';
  private static readonly SOLVED_TAG_ID = '1349920578987102250';
  private static readonly AUTO_CLOSE_DELAY = 60 * 60 * 1000; // 1 hour in milliseconds
  private static readonly INACTIVITY_CHECK_DELAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private static readonly activeThreads = new Map<string, NodeJS.Timeout>();
  private static readonly inactivityWarnings = new Map<string, boolean>(); // Track which threads have warnings
  private static readonly pendingClosures = new Map<string, number>(); // Track threads awaiting closure

  constructor(private client: Client) {
    this.checkInactiveThreads();
    this.setupForumListeners();
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
      }
    });

    // Listen for messages
    this.client.on(Events.MessageCreate, async (message) => {
      // Check if message is in a thread in our forum channel
      if (!message.channel.isThread()) return;
      const thread = message.channel as ThreadChannel;
      if (thread.parentId !== ForumManager.FORUM_CHANNEL_ID) return;

      // Check if message is from thread owner
      if (message.author.id !== thread.ownerId) return;

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
        // Skip if thread is locked, already has a warning, or is marked as solved
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
            await this.sendInactivityWarning(thread);
            ForumManager.inactivityWarnings.set(thread.id, true);
          }
        }
      }
    }, ForumManager.INACTIVITY_CHECK_DELAY);
  }

  private async sendInactivityWarning(thread: ThreadChannel) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setDescription(`Hey <@${thread.ownerId}>, it seems like your last message was sent more than 24 hours ago.\nIf we don't hear back from you we'll assume the issue is resolved and mark your post as solved.`);

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
    // Add the solved tag if it's not already there
    if (!thread.appliedTags.includes(ForumManager.SOLVED_TAG_ID)) {
      const newTags = [...thread.appliedTags, ForumManager.SOLVED_TAG_ID];
      await thread.setAppliedTags(newTags);
    }

    // Set up auto-close timer
    const closeTimer = setTimeout(async () => {
      try {
        await thread.setLocked(true);
        ForumManager.activeThreads.delete(thread.id);
        ForumManager.pendingClosures.delete(thread.id);
        
        // Get the last 10 messages to find our embed
        const messages = await thread.messages.fetch({ limit: 10 });
        const solvedMessage = messages.find(msg => 
          msg.author.id === this.client.user?.id && 
          msg.embeds[0]?.title === '✅ Post Marked as Solved'
        );

        if (solvedMessage && solvedMessage.embeds[0]) {
          const originalEmbed = solvedMessage.embeds[0];
          const updatedEmbed = EmbedBuilder.from(originalEmbed)
            .setColor(Colors.Red)
            .setTimestamp();

          await solvedMessage.edit({ embeds: [updatedEmbed] });
        }
      } catch (error) {
        console.error('Error closing thread:', error);
      }
    }, ForumManager.AUTO_CLOSE_DELAY);

    ForumManager.activeThreads.set(thread.id, closeTimer);
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
      .setTitle('✅ Post Marked as Solved')
      .setDescription(`This post has been marked as solved by <@${interaction.user.id}>!\nUse </unsolved:1350224524825727007> to remove this tag.`)
      .addFields({
        name: '🔒 Auto-close',
        value: `This post will be closed ${time(new Date(closeTime), 'R')} (${time(new Date(closeTime), 'f')}).`
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: false
    });
  }

  public async handleUnsolvedCommand(interaction: ChatInputCommandInteraction) {
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

    // Check if user is thread owner or has the required role
    const hasRequiredRole = interaction.member?.roles instanceof GuildMemberRoleManager && 
      interaction.member.roles.cache.has('1022899638140928022');
    if (thread.ownerId !== interaction.user.id && !hasRequiredRole) {
      await interaction.reply({
        content: 'Only the original poster or moderators can remove the solved status!',
        ephemeral: true
      });
      return;
    }

    // Clear any existing auto-close timer and pending closure
    const existingTimer = ForumManager.activeThreads.get(thread.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      ForumManager.activeThreads.delete(thread.id);
    }
    ForumManager.pendingClosures.delete(thread.id);

    // Remove the solved tag
    const appliedTags = thread.appliedTags.filter(tag => tag !== ForumManager.SOLVED_TAG_ID);
    await thread.setAppliedTags(appliedTags);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle('🔄 Solved Status Removed')
      .setDescription(`The solved tag has been removed from this post by <@${interaction.user.id}>.`)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: false
    });
  }
} 